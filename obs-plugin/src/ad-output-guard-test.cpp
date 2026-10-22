// SPDX-License-Identifier: GPL-2.0-or-later
#include "ad-output-guard.hpp"
#include <cstdlib>
#include <iostream>
static void check(bool ok) { if (!ok) std::abort(); }
int main() {
  AdOutputGuard guard;
  guard.beginNavigation(); check(guard.suppressed());
  guard.observe(false, false, false); check(guard.suppressed());
  guard.observe(false, true, false); check(!guard.suppressed());
  guard.observe(true, true, true); check(guard.suppressed());
  for (int i=0;i<120;++i) guard.observe(true, false, false);
  check(guard.suppressed()); // Never inherit the 15-second video-fade timeout.
  guard.observe(false, false, false); check(guard.suppressed());
  guard.observe(false, true, false); check(!guard.suppressed());
  guard.beginNavigation(); guard.observe(false, false, true); check(!guard.suppressed());
  guard.configure(false, true); guard.beginNavigation(); guard.observe(true, false, false);
  check(!guard.suppressed());
  guard.configure(true, true); check(guard.suppressed());
  guard.stop(); check(!guard.suppressed());
  guard.configure(true, false); check(!guard.suppressed());
  std::cout << "Ad output guard policy checks passed\n";
}
