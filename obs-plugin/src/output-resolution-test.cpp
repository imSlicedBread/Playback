// SPDX-License-Identifier: GPL-2.0-or-later
#include "output-resolution.hpp"
#include <cstdlib>
#include <initializer_list>
static void expect(bool value) {if(!value)std::abort();}
int main() {
  for (auto size:{OutputResolution{1280,720},OutputResolution{1920,1080},OutputResolution{2560,1440},OutputResolution{3840,2160},OutputResolution{1080,1920}}) {
    expect(size.valid());const auto restored=OutputResolution::unpack(size.packed());
    expect(restored.width==size.width && restored.height==size.height);
  }
  expect(!OutputResolution{0,720}.valid());expect(!OutputResolution{10000,10000}.valid());
  expect(!OutputResolution{8192,8192}.valid());
  const auto logical=OutputResolution{1920,1080}.logical(1.5);
  expect(logical.width==1280 && logical.height==720);
  expect(OutputResolution{1920,1080}.logical(0).width==1920);
}
