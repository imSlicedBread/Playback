// SPDX-License-Identifier: GPL-2.0-or-later
#include <obs-module.h>
#include <winrt-capture.h>
#include <atomic>
#include <util/platform.h>
#include "video-fade.hpp"
#include "video-fade-effect.hpp"
#include "audio.hpp"
#include "output-resolution.hpp"

static std::atomic<HWND> outputWindow{nullptr};
static std::atomic<uint64_t> outputResolution{OutputResolution{}.packed()};
void playback_set_output_window(HWND window) { outputWindow.store(window);playback_audio_set_enabled(window!=nullptr); }
void playback_set_output_resolution(uint32_t width,uint32_t height) {
  const OutputResolution size{width,height};
  if (size.valid()) outputResolution.store(size.packed());
}
static std::atomic<uint64_t> transitionCommand{0};
uint64_t playback_begin_transition() {
  const auto ticket=(transitionCommand.load()>>2)+1;
  transitionCommand.store((ticket<<2)|1);return ticket;
}
void playback_transition_ready(uint64_t ticket,bool ready,bool reveal) {
  auto expected=transitionCommand.load();
  while ((expected>>2)==ticket && !transitionCommand.compare_exchange_weak(expected,(ticket<<2)|(reveal?3:ready?2:1))) {}
}
void playback_cancel_transition() {transitionCommand.store((((transitionCommand.load()>>2)+1)<<2)|3);}
struct PlaybackCapture {
  winrt_capture *capture = nullptr;
  HWND window = nullptr;
  obs_source_t *source = nullptr;
  BrowserAudio *audio = nullptr;
  bool migrateAudio = false;
  gs_texrender_t *outgoing=nullptr,*incoming=nullptr;
  gs_effect_t *fadeEffect=nullptr;
  VideoFade fade;
  uint64_t transition=0;
  bool cached=false;
};
static void *create(obs_data_t *settings, obs_source_t *source) {
  auto *state=new PlaybackCapture;
  state->source=source; state->migrateAudio=obs_data_get_int(settings,"audioRoutingVersion")<1;
  state->audio=playback_audio_create(source);
  obs_enter_graphics();
  state->outgoing=gs_texrender_create(GS_RGBA,GS_ZS_NONE);
  state->incoming=gs_texrender_create(GS_RGBA,GS_ZS_NONE);
  state->fadeEffect=gs_effect_create(fadeShader,"fplayback-video-fade",nullptr);
  obs_leave_graphics();
  if (!state->fadeEffect) blog(LOG_WARNING,"[fplayback] Fade shader unavailable; using direct capture.");
  return state;
}
static void destroy(void *data) {
  auto *state = static_cast<PlaybackCapture *>(data);
  playback_audio_destroy(state->audio);
  obs_enter_graphics();
  if (state->capture) winrt_capture_free(state->capture);
  gs_texrender_destroy(state->outgoing);gs_texrender_destroy(state->incoming);
  if (state->fadeEffect) gs_effect_destroy(state->fadeEffect);
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
  if (!window) {
    gs_texrender_destroy(state->outgoing);state->outgoing=nullptr;
    gs_texrender_destroy(state->incoming);state->incoming=nullptr;
    state->cached=false;state->fade.cancel();
  } else {
    if(!state->outgoing)state->outgoing=gs_texrender_create(GS_RGBA,GS_ZS_NONE);
    if(!state->incoming)state->incoming=gs_texrender_create(GS_RGBA,GS_ZS_NONE);
  }
  if (!state->capture && window && IsWindow(window) && IsWindowVisible(window) && !IsIconic(window))
    state->capture = winrt_capture_init_window(false,window,true,true);
  obs_leave_graphics();
}
static bool captureFrame(PlaybackCapture *state,gs_texrender_t *target,OutputResolution size) {
  const auto width=winrt_capture_width(state->capture),height=winrt_capture_height(state->capture);
  if (!width || !height || !target) return false;
  gs_texrender_reset(target);
  gs_blend_state_push();gs_blend_function(GS_BLEND_ONE,GS_BLEND_ZERO);
  const bool active=gs_texrender_begin(target,size.width,size.height);
  if (active) {
    vec4 clear{};gs_clear(GS_CLEAR_COLOR,&clear,0.f,0);
    gs_ortho(0.f,float(size.width),0.f,float(size.height),-100.f,100.f);
    gs_matrix_push();gs_matrix_identity();
    gs_matrix_scale3f(float(size.width)/width,float(size.height)/height,1.f);
    winrt_capture_render(state->capture);
    gs_matrix_pop();gs_texrender_end(target);
  }
  gs_blend_state_pop();return active;
}
static void render(void *data, gs_effect_t *) {
  auto *state=static_cast<PlaybackCapture *>(data);
  const auto size=OutputResolution::unpack(outputResolution.load());
  const auto window=outputWindow.load();
  if (!window) {state->cached=false;state->fade.cancel();return;}
  const bool active=state->capture && state->window==window && winrt_capture_active(state->capture);
  if (!state->fadeEffect || !state->outgoing || !state->incoming) {
    if (active) {
      const auto w=winrt_capture_width(state->capture),h=winrt_capture_height(state->capture);
      if (w && h) {gs_matrix_push();gs_matrix_scale3f(float(size.width)/w,float(size.height)/h,1.f);winrt_capture_render(state->capture);gs_matrix_pop();}
    }
    return;
  }
  const int64_t now=int64_t(os_gettime_ns()/1000000);
  const auto command=transitionCommand.load();
  if ((command>>2)!=state->transition) {
    state->transition=command>>2;
    if ((command&3)==1 || (command&3)==2) state->fade.begin(now,state->cached);
    else state->fade.cancel();
    if (state->fade.phase==FadePhase::Holding) blog(LOG_INFO,"[fplayback-fade] Holding outgoing frame while the next video loads.");
  }
  const auto previousPhase=state->fade.phase;
  state->fade.update(now,(command&3)==2,(command&3)==3);
  if (previousPhase!=state->fade.phase) {
    if (state->fade.phase==FadePhase::Blending) blog(LOG_INFO,"[fplayback-fade] Starting 300 ms video crossfade.");
    else if (state->fade.phase==FadePhase::Live) blog(LOG_INFO,"[fplayback-fade] Returned to live output.");
  }
  if (state->fade.phase==FadePhase::Live) {
    if (active && captureFrame(state,state->outgoing,size)) state->cached=true;
  } else if (state->fade.phase==FadePhase::Blending) {
    if (!active || !captureFrame(state,state->incoming,size)) {
      state->fade.cancel(); // Capture failure must not leave a permanent frozen transition.
    }
  }
  if (!state->cached) return;
  auto *a=gs_texrender_get_texture(state->outgoing);
  auto *b=state->fade.phase==FadePhase::Blending?gs_texrender_get_texture(state->incoming):a;
  if (!a || !b) return;
  const bool srgb=gs_framebuffer_srgb_enabled();gs_enable_framebuffer_srgb(true);
  gs_effect_set_texture_srgb(gs_effect_get_param_by_name(state->fadeEffect,"image_a"),a);
  gs_effect_set_texture_srgb(gs_effect_get_param_by_name(state->fadeEffect,"image_b"),b);
  gs_effect_set_float(gs_effect_get_param_by_name(state->fadeEffect,"amount"),state->fade.amount(now));
  while (gs_effect_loop(state->fadeEffect,"Fade")) gs_draw_sprite(nullptr,0,size.width,size.height);
  gs_enable_framebuffer_srgb(srgb);
}
void playback_register_capture() {
  obs_source_info info{};
  info.id = "fplayback_youtube_output";
  info.type = OBS_SOURCE_TYPE_INPUT;
  info.output_flags = OBS_SOURCE_VIDEO | OBS_SOURCE_AUDIO | OBS_SOURCE_CUSTOM_DRAW | OBS_SOURCE_SRGB;
  info.get_name = [](void *) { return "Playback YouTube Output"; };
  info.create = create; info.destroy = destroy; info.video_tick = tick; info.video_render = render;
  info.get_width = [](void *) { return OutputResolution::unpack(outputResolution.load()).width; };
  info.get_height = [](void *) { return OutputResolution::unpack(outputResolution.load()).height; };
  obs_register_source(&info);
}
