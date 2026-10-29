// SPDX-License-Identifier: GPL-2.0-or-later
#define UNICODE
#define _UNICODE
#include "installer-core.hpp"
#include <cstdio>
namespace pi=playback_installer;
static void expect(bool condition,const char *message) {
  if (!condition) {std::fprintf(stderr,"%s\n",message);std::abort();}
}
static void write(const pi::fs::path &file,const char *text) {
  pi::fs::create_directories(file.parent_path()); std::ofstream(file,std::ios::binary)<<text;
}
static bool equals(const pi::fs::path &file,const char *text) {
  const auto bytes=pi::read(file); return std::string(bytes.begin(),bytes.end())==text;
}
int wmain(int argc,wchar_t **argv) {
  expect(argc==5,"Expected installer, OBS folder, plugin DLL and source ZIP paths");
  pi::validate(argv[2]);
  const auto root=pi::fs::temp_directory_path()/(L"fkey-installer-test-"+std::to_wstring(GetCurrentProcessId())+L"-"+std::to_wstring(GetTickCount64()));
  pi::fs::create_directory(root);
  const auto dll=pi::fs::path(L"obs-plugins/64bit/fplayback-youtube.dll");
  const std::vector<pi::Payload> payloads{{dll,reinterpret_cast<const unsigned char *>("new-plugin"),10},
    {L"data/obs-plugins/fplayback-youtube/LICENSE",reinterpret_cast<const unsigned char *>("license"),7}};
  bool rejected=false;try {pi::validate(root);}catch(...) {rejected=true;}expect(rejected,"Reject non-OBS folders");
  const auto probe=root/L"compatibility-probe";
  const auto browserRelative=pi::browserFolder(pi::fs::path());
  for (const auto &relative:std::vector<pi::fs::path>{L"bin/64bit/obs64.exe",L"bin/64bit/Qt6Core.dll",L"bin/64bit/libobs-winrt.dll",browserRelative/L"obs-browser.dll"}) {
    pi::fs::create_directories((probe/relative).parent_path());
    pi::fs::copy_file(pi::fs::path(argv[2])/relative,probe/relative);
  }
  rejected=false;try {pi::validate(probe);}catch(...) {rejected=true;}
  expect(rejected,"Matching OBS/Qt with missing CEF is rejected");
  const auto cef=pi::browserFolder(probe)/L"libcef.dll";
  pi::fs::copy_file(pi::fs::path(argv[2])/L"bin/64bit/Qt6Core.dll",cef);
  rejected=false;try {pi::validate(probe);}catch(...) {rejected=true;}
  expect(rejected,"Matching OBS/Qt with mismatched CEF is rejected");
  pi::fs::remove(cef);
  pi::fs::copy_file(pi::browserFolder(pi::fs::path(argv[2]))/L"libcef.dll",cef);
  pi::validate(probe);
  expect(!pi::fs::exists(probe/dll),"Compatibility checks never install or replace the plugin");
  const auto first=pi::install(root,payloads);
  expect(equals(root/dll,"new-plugin"),"Fresh installation matches payload");
  write(root/dll,"old-plugin");
  const auto backup=pi::install(root,payloads);
  expect(equals(backup/dll,"old-plugin"),"Existing plugin is backed up");
  expect(equals(root/dll,"new-plugin"),"Upgrade installs verified payload");
  write(root/dll,"before-failure");
  rejected=false; bool committed=false;
  try {pi::install(root,payloads,[&](size_t n) {if(n==1){committed=true;throw std::runtime_error("Injected commit failure");}});}
  catch(...) {rejected=true;}
  expect(committed && rejected && equals(root/dll,"before-failure"),"Commit failure restores previous plugin");
  rejected=false;
  try {pi::install(root/L"fresh-failure",payloads,[](size_t) {throw std::runtime_error("Injected fresh install failure");});}
  catch(...) {rejected=true;}
  expect(rejected && !pi::fs::exists(root/L"fresh-failure"/dll),"Failed fresh installation removes committed plugin");
  HANDLE locked=CreateFileW((root/dll).c_str(),GENERIC_READ,0,nullptr,OPEN_EXISTING,0,nullptr);
  expect(locked!=INVALID_HANDLE_VALUE,"Open test file exclusively");
  rejected=false;try {pi::install(root,payloads);}catch(...) {rejected=true;}
  CloseHandle(locked); expect(rejected && equals(root/dll,"before-failure"),"Locked plugin is left intact");
  rejected=false;try {pi::install(root,{{L"../escape",payloads[0].bytes,10}});}catch(...) {rejected=true;}
  expect(rejected,"Payload paths cannot escape installation");
  HMODULE module=LoadLibraryExW(argv[1],nullptr,LOAD_LIBRARY_AS_DATAFILE|LOAD_LIBRARY_AS_IMAGE_RESOURCE);
  expect(module!=nullptr,"Installer resources load without running elevated setup");
  for (int id:{101,102,103}) {
    HRSRC entry=FindResourceW(module,MAKEINTRESOURCEW(id),MAKEINTRESOURCEW(10));
    expect(entry && SizeofResource(module,entry)>0,"Embedded DLL, source and license exist");
    const auto *data=static_cast<const unsigned char *>(LockResource(LoadResource(module,entry)));
    if (id==101 || id==102) {
      const auto original=pi::read(argv[id==101?3:4]);
      expect(original.size()==SizeofResource(module,entry) && std::equal(original.begin(),original.end(),data),"Embedded payload matches build");
    }
  }
  HRSRC manifest=FindResourceW(module,MAKEINTRESOURCEW(1),MAKEINTRESOURCEW(24));
  expect(manifest!=nullptr,"Installer has an elevation manifest");
  const auto *text=static_cast<const char *>(LockResource(LoadResource(module,manifest)));
  expect(std::string(text,SizeofResource(module,manifest)).find("requireAdministrator")!=std::string::npos,"Windows requests administrator approval");
  FreeLibrary(module);
  expect(root.is_absolute() && pi::fs::equivalent(root.parent_path(),pi::fs::temp_directory_path()) &&
    root.filename().wstring().rfind(L"fkey-installer-test-",0)==0,"Cleanup stays in the test temp folder");
  pi::fs::remove_all(root);
  std::puts("Installer: fresh install, upgrade, backup, rollback, locked-file refusal, validation and embedded resources passed.");
}
