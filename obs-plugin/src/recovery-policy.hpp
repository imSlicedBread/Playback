// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <cstdint>
#include <deque>
enum class RecoveryDecision { Reload, Cooldown, Hold };
class RecoveryPolicy {
  std::deque<int64_t> attempts;
public:
  void reset() { attempts.clear(); }
  RecoveryDecision request(int64_t now) {
    while (!attempts.empty() && now-attempts.front() >= 300000) attempts.pop_front();
    if (attempts.size() >= 3) return RecoveryDecision::Hold;
    if (!attempts.empty() && now-attempts.back() < 15000) return RecoveryDecision::Cooldown;
    attempts.push_back(now); return RecoveryDecision::Reload;
  }
};
