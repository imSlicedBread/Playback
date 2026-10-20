// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <obs.h>

// Returns an error message, or nullptr when both sources are ready.
const char *playback_setup_scene(obs_scene_t *scene, int port, uint32_t width, uint32_t height);
