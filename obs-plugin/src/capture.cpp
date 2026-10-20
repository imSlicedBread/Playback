// SPDX-License-Identifier: GPL-2.0-or-later
#include <obs-module.h>
#include <winrt-capture.h>
#include <atomic>
#include "audio.hpp"

static std::atomic<HWND> outputWindow{nullptr};
void playback_set_output_window(HWND window) { outputWindow.store(window); }
struct PlaybackCapture {
  winrt_capture *capture = nullptr;
  HWND window = nullptr;
  obs_source_t *source = nullptr;
  BrowserAudio *audio = nullptr;
  bool migrateAudio = false;
  std::atomic<uint32_t> width{1280}, height{720};
};
static void *create(obs_data_t *settings, obs_source_t *source) {
  auto *state=new PlaybackCapture;
  state->source=source; state->migrateAudio=obs_data_get_int(settings,"audioRoutingVersion")<1;
  state->audio=playback_audio_create(source);
  return state;
}
static void destroy(void *data) {
  auto *state = static_cast<PlaybackCapture *>(data);
  playback_audio_destroy(state->audio);
  obs_enter_graphics();
  if (state->capture) winrt_capture_free(state->capture);
  obs_leave_graphics(); delete state;
}
static void tick(void *data, float) {
  auto *state = static_cast<PlaybackCapture *>(data);
  if (state->migrateAudio) {
    state->migrateAudio=false;
    if (!obs_source_get_audio_mixers(state->source)) obs_source_set_audio_mixers(state->source,1);
    obs_data_t *settings=obs_source_get_settings(state->source);
    obs_data_set_int(settings,"audioRoutingVersion",1); obs_data_release(settings);
  }
  HWND window = outputWindow.load();
  obs_enter_graphics();
  if (state->capture && (window != state->window || !winrt_capture_active(state->capture))) {
    winrt_capture_free(state->capture); state->capture = nullptr;
  }
  state->window = window;
  if (!state->capture && window && IsWindow(window) && IsWindowVisible(window) && !IsIconic(window))
    state->capture = winrt_capture_init_window(false,window,true,true);
  if (state->capture) {
    state->width.store(winrt_capture_width(state->capture));
    state->height.store(winrt_capture_height(state->capture));
  }
  obs_leave_graphics();
}
static void render(void *data, gs_effect_t *) {
  auto *state = static_cast<PlaybackCapture *>(data);
  if (state->capture && state->window == outputWindow.load() && winrt_capture_active(state->capture))
    winrt_capture_render(state->capture);
}
void playback_register_capture() {
  obs_source_info info{};
  info.id = "fplayback_youtube_output";
  info.type = OBS_SOURCE_TYPE_INPUT;
  info.output_flags = OBS_SOURCE_VIDEO | OBS_SOURCE_AUDIO | OBS_SOURCE_CUSTOM_DRAW | OBS_SOURCE_SRGB;
  info.get_name = [](void *) { return "Playback YouTube Output"; };
  info.create = create; info.destroy = destroy; info.video_tick = tick; info.video_render = render;
  info.get_width = [](void *data) { return static_cast<PlaybackCapture *>(data)->width.load(); };
  info.get_height = [](void *data) { return static_cast<PlaybackCapture *>(data)->height.load(); };
  obs_register_source(&info);
}
