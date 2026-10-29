// SPDX-License-Identifier: GPL-2.0-or-later
#include "recovery-policy.hpp"
#include <cstdlib>
static void expect(bool condition) { if (!condition) std::abort(); }
int main() {
  RecoveryPolicy policy;
  expect(policy.request(0)==RecoveryDecision::Reload);
  expect(policy.request(14999)==RecoveryDecision::Cooldown);
  expect(policy.request(15000)==RecoveryDecision::Reload);
  expect(policy.request(30000)==RecoveryDecision::Reload);
  expect(policy.request(45000)==RecoveryDecision::Hold);
  expect(policy.request(299999)==RecoveryDecision::Hold);
  expect(policy.request(300000)==RecoveryDecision::Reload);
  policy.reset(); expect(policy.request(300001)==RecoveryDecision::Reload);
  policy.reset();const int64_t longRun=135LL*60*60*1000;
  expect(policy.request(longRun)==RecoveryDecision::Reload);
  expect(policy.request(longRun+14999)==RecoveryDecision::Cooldown);
  expect(policy.request(longRun+15000)==RecoveryDecision::Reload);
  expect(policy.request(longRun+30000)==RecoveryDecision::Reload);
  expect(policy.request(longRun+45000)==RecoveryDecision::Hold);
  expect(policy.request(longRun+300000)==RecoveryDecision::Reload);
}
