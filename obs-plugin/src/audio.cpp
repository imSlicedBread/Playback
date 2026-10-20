// SPDX-License-Identifier: GPL-2.0-or-later
#include "audio.hpp"
#include <windows.h>
#include <tlhelp32.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <ksmedia.h>
#include <wrl.h>
#include <util/platform.h>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include <cmath>
using Microsoft::WRL::ComPtr;

class AudioActivation final : public Microsoft::WRL::RuntimeClass<
  Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
  Microsoft::WRL::FtmBase, IActivateAudioInterfaceCompletionHandler> {
public:
  HANDLE ready = CreateEventW(nullptr,TRUE,FALSE,nullptr);
  HRESULT result = E_PENDING;
  ComPtr<IUnknown> value;
  ~AudioActivation() { if (ready) CloseHandle(ready); }
  HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation *operation) override {
    HRESULT activated = E_FAIL;
    const HRESULT hr = operation->GetActivateResult(&activated,&value);
    result = FAILED(hr) ? hr : activated;
    SetEvent(ready); return S_OK;
  }
};

// Restrict capture to audio sessions owned by this OBS instance's CEF children.
// OBS itself is excluded, preventing its monitoring output from feeding back.
static std::unordered_set<DWORD> browserProcesses() {
  std::unordered_map<DWORD,DWORD> parents;
  std::vector<DWORD> candidates;
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);
  if (snapshot == INVALID_HANDLE_VALUE) return {};
  PROCESSENTRY32W entry{}; entry.dwSize = sizeof(entry);
  if (Process32FirstW(snapshot,&entry)) do {
    parents[entry.th32ProcessID] = entry.th32ParentProcessID;
    if (_wcsicmp(entry.szExeFile,L"obs-browser-page.exe") == 0) candidates.push_back(entry.th32ProcessID);
  } while (Process32NextW(snapshot,&entry));
  CloseHandle(snapshot);
  std::unordered_set<DWORD> result;
  for (DWORD candidate : candidates) {
    DWORD parent = candidate;
    for (int depth=0; depth<32 && parent; ++depth) {
      const auto found = parents.find(parent);
      if (found == parents.end() || found->second == parent) break;
      parent = found->second;
      if (parent == GetCurrentProcessId()) { result.insert(candidate); break; }
    }
  }
  return result;
}
static DWORD activeBrowserSession() {
  const auto allowed = browserProcesses();
  if (allowed.empty()) return 0;
  ComPtr<IMMDeviceEnumerator> enumerator;
  if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,IID_PPV_ARGS(&enumerator)))) return 0;
  ComPtr<IMMDeviceCollection> devices;
  if (FAILED(enumerator->EnumAudioEndpoints(eRender,DEVICE_STATE_ACTIVE,&devices))) return 0;
  UINT count=0; devices->GetCount(&count);
  for (UINT i=0;i<count;++i) {
    ComPtr<IMMDevice> device; ComPtr<IAudioSessionManager2> manager; ComPtr<IAudioSessionEnumerator> sessions;
    if (FAILED(devices->Item(i,&device)) || FAILED(device->Activate(__uuidof(IAudioSessionManager2),CLSCTX_ALL,nullptr,&manager)) ||
        FAILED(manager->GetSessionEnumerator(&sessions))) continue;
    int size=0; sessions->GetCount(&size);
    for (int j=0;j<size;++j) {
      ComPtr<IAudioSessionControl> control; ComPtr<IAudioSessionControl2> session;
      AudioSessionState state = AudioSessionStateInactive; DWORD pid=0;
      if (SUCCEEDED(sessions->GetSession(j,&control)) && SUCCEEDED(control.As(&session)) &&
          SUCCEEDED(session->GetState(&state)) && state == AudioSessionStateActive &&
          SUCCEEDED(session->GetProcessId(&pid)) && allowed.count(pid)) return pid;
    }
  }
  return 0;
}
struct BrowserAudio {
  obs_source_t *source;
  HANDLE stop = CreateEventW(nullptr,TRUE,FALSE,nullptr);
  std::thread thread;
  explicit BrowserAudio(obs_source_t *owner) : source(owner) {
    if (stop) thread = std::thread([this]() { run(); });
  }
  ~BrowserAudio() {
    if (stop) SetEvent(stop);
    if (thread.joinable()) thread.join();
    if (stop) CloseHandle(stop);
  }
  void capture(DWORD pid) {
    AUDIOCLIENT_ACTIVATION_PARAMS params{};
    params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    params.ProcessLoopbackParams.TargetProcessId = pid;
    params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
    PROPVARIANT variant{}; variant.vt=VT_BLOB;
    variant.blob.cbSize=sizeof(params); variant.blob.pBlobData=reinterpret_cast<BYTE *>(&params);
    auto completion = Microsoft::WRL::Make<AudioActivation>();
    if (!completion || !completion->ready) return;
    ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
    HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,__uuidof(IAudioClient),&variant,completion.Get(),&operation);
    if (FAILED(hr)) { blog(LOG_WARNING,"[fplayback-audio] Process loopback activation failed: 0x%08lx",hr); return; }
    HANDLE activationWait[]{stop,completion->ready};
    if (WaitForMultipleObjects(2,activationWait,FALSE,5000) != WAIT_OBJECT_0+1 || FAILED(completion->result)) return;
    ComPtr<IAudioClient> client;
    if (FAILED(completion->value.As(&client))) return;
    WAVEFORMATEXTENSIBLE format{};
    format.Format.wFormatTag=WAVE_FORMAT_EXTENSIBLE; format.Format.nChannels=2;
    format.Format.nSamplesPerSec=48000; format.Format.wBitsPerSample=32;
    format.Format.nBlockAlign=8; format.Format.nAvgBytesPerSec=48000*8;
    format.Format.cbSize=sizeof(format)-sizeof(format.Format);
    format.Samples.wValidBitsPerSample=32; format.dwChannelMask=SPEAKER_FRONT_LEFT|SPEAKER_FRONT_RIGHT;
    format.SubFormat=KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
    hr=client->Initialize(AUDCLNT_SHAREMODE_SHARED,AUDCLNT_STREAMFLAGS_LOOPBACK|AUDCLNT_STREAMFLAGS_EVENTCALLBACK,200000,0,&format.Format,nullptr);
    if (FAILED(hr)) { blog(LOG_WARNING,"[fplayback-audio] Audio initialization failed: 0x%08lx",hr); return; }
    HANDLE ready=CreateEventW(nullptr,FALSE,FALSE,nullptr);
    if (!ready) return;
    ComPtr<IAudioCaptureClient> input;
    if (FAILED(client->SetEventHandle(ready)) || FAILED(client->GetService(IID_PPV_ARGS(&input))) || FAILED(client->Start())) {
      CloseHandle(ready); return;
    }
    blog(LOG_INFO,"[fplayback-audio] Connected to OBS browser audio");
    HANDLE waits[]{stop,ready}; bool signaled=false, healthy=true;
    ULONGLONG lastCheck=GetTickCount64();
    while (healthy && WaitForMultipleObjects(2,waits,FALSE,500) != WAIT_OBJECT_0) {
      if (!obs_source_active(source)) break;
      if (GetTickCount64()-lastCheck>2000) {
        lastCheck=GetTickCount64(); const DWORD current=activeBrowserSession();
        if (current && current!=pid) break;
      }
      UINT32 pending=0;
      if (FAILED(input->GetNextPacketSize(&pending))) break;
      while (pending) {
        BYTE *bytes=nullptr; UINT32 frames=0; DWORD flags=0; UINT64 timestamp=0;
        if (FAILED(input->GetBuffer(&bytes,&frames,&flags,nullptr,&timestamp))) { healthy=false; break; }
        std::vector<float> silence;
        if ((flags&AUDCLNT_BUFFERFLAGS_SILENT) || !bytes) { silence.resize(size_t(frames)*2); bytes=reinterpret_cast<BYTE *>(silence.data()); }
        obs_source_audio audio{};
        audio.data[0]=bytes; audio.frames=frames; audio.speakers=SPEAKERS_STEREO;
        audio.format=AUDIO_FORMAT_FLOAT; audio.samples_per_sec=48000;
        audio.timestamp=(flags&AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR)||!timestamp ? os_gettime_ns() : timestamp*100;
        obs_source_output_audio(source,&audio);
        if (!signaled && !(flags&AUDCLNT_BUFFERFLAGS_SILENT)) {
          const auto *samples=reinterpret_cast<const float *>(bytes);
          for (size_t i=0;i<size_t(frames)*2;++i) if (std::isfinite(samples[i]) && std::abs(samples[i])>.0001f) {
            blog(LOG_INFO,"[fplayback-audio] Receiving non-silent browser audio"); signaled=true; break;
          }
        }
        input->ReleaseBuffer(frames);
        if (FAILED(input->GetNextPacketSize(&pending))) { healthy=false; break; }
      }
    }
    client->Stop(); CloseHandle(ready);
  }
  void run() {
    const HRESULT initialized=CoInitializeEx(nullptr,COINIT_MULTITHREADED);
    if (FAILED(initialized)) return;
    while (WaitForSingleObject(stop,1000) == WAIT_TIMEOUT) {
      if (!obs_source_active(source)) continue;
      const DWORD pid=activeBrowserSession();
      if (pid) capture(pid);
    }
    CoUninitialize();
  }
};
BrowserAudio *playback_audio_create(obs_source_t *source) { return new BrowserAudio(source); }
void playback_audio_destroy(BrowserAudio *audio) { delete audio; }
