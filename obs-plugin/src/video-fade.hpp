// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <cstdint>
#include <algorithm>
enum class FadePhase { Live, Holding, Blending };
class VideoFade {
  int64_t began=0, readyAt=-1, blendAt=0;
public:
  FadePhase phase=FadePhase::Live;
  void cancel() {phase=FadePhase::Live;readyAt=-1;}
  void begin(int64_t now,bool hasFrame) {began=now;readyAt=-1;phase=hasFrame?FadePhase::Holding:FadePhase::Live;}
  void update(int64_t now,bool ready,bool reveal) {
    if (reveal || (phase==FadePhase::Holding && now-began>=15000)) {cancel();return;}
    if (phase==FadePhase::Blending && !ready) {phase=FadePhase::Holding;readyAt=-1;}
    if (phase==FadePhase::Holding) {
      if (!ready) {readyAt=-1;return;}
      if (readyAt<0) readyAt=now;
      if (now-readyAt>=100) {phase=FadePhase::Blending;blendAt=now;}
    }
    if (phase==FadePhase::Blending && now-blendAt>=300) cancel();
  }
  float amount(int64_t now) const {return phase==FadePhase::Blending?std::clamp(float(now-blendAt)/300.f,0.f,1.f):0.f;}
};
