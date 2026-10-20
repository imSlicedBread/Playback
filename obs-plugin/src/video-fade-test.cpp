// SPDX-License-Identifier: GPL-2.0-or-later
#include "video-fade.hpp"
#include <cstdlib>
static void expect(bool value) {if(!value)std::abort();}
int main() {
  VideoFade fade;
  fade.begin(0,false);expect(fade.phase==FadePhase::Live);
  fade.begin(0,true);fade.update(5000,false,false);expect(fade.phase==FadePhase::Holding);
  fade.update(5000,true,false);fade.update(5099,true,false);expect(fade.phase==FadePhase::Holding);
  fade.update(5100,true,false);expect(fade.phase==FadePhase::Blending && fade.amount(5100)==0);
  expect(fade.amount(5250)==.5f);fade.update(5400,true,false);expect(fade.phase==FadePhase::Live);
  fade.begin(0,true);fade.update(14999,false,false);expect(fade.phase==FadePhase::Holding);
  fade.update(15000,false,false);expect(fade.phase==FadePhase::Live);
  fade.begin(0,true);fade.update(1,false,true);expect(fade.phase==FadePhase::Live);
  fade.begin(0,true);fade.update(0,true,false);fade.update(100,true,false);
  fade.begin(101,true);expect(fade.phase==FadePhase::Holding && fade.amount(101)==0);
  fade.update(200,true,false);fade.update(250,false,false);fade.update(300,true,false);
  fade.update(399,true,false);expect(fade.phase==FadePhase::Holding);
  fade.update(400,true,false);expect(fade.phase==FadePhase::Blending);
  fade.cancel();expect(fade.phase==FadePhase::Live);
  fade.begin(0,true);fade.update(0,true,false);fade.update(100,true,false);
  fade.update(150,false,false);expect(fade.phase==FadePhase::Holding);
  fade.update(200,true,false);fade.update(300,true,false);expect(fade.phase==FadePhase::Blending && fade.amount(300)==0);
}
