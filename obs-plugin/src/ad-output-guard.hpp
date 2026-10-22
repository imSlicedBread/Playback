// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once

// UI-thread policy; capture/audio receive only the resulting atomic boolean.
// There is deliberately no timeout that can reveal an unconfirmed ad frame.
class AdOutputGuard {
  bool enabled = true;
  bool held = false;
public:
  void configure(bool value, bool running) { enabled = value; held = enabled && running; }
  void beginNavigation() { held = enabled; }
  void stop() { held = false; }
  void observe(bool advertisement, bool contentReady, bool revealPrompt) {
    if (!enabled) { held = false; return; }
    if (advertisement) { held = true; return; }
    if (contentReady || revealPrompt) held = false;
  }
  bool suppressed() const { return held; }
};
