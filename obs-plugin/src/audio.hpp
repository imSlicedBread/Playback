// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <obs-module.h>
struct BrowserAudio;
BrowserAudio *playback_audio_create(obs_source_t *source);
void playback_audio_destroy(BrowserAudio *audio);
void playback_audio_set_enabled(bool enabled);
void playback_audio_set_suppressed(bool suppressed);
