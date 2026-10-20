// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <cstdint>
#include <cmath>
struct OutputResolution {
  uint32_t width=1280, height=720;
  bool valid() const {return width>=320 && height>=180 && width<=8192 && height<=8192 && uint64_t(width)*height<=33177600;}
  uint64_t packed() const {return (uint64_t(width)<<32)|height;}
  static OutputResolution unpack(uint64_t value) {return {uint32_t(value>>32),uint32_t(value)};}
  OutputResolution logical(double ratio) const {
    if (!std::isfinite(ratio) || ratio<1) ratio=1;
    return {uint32_t(std::lround(width/ratio)),uint32_t(std::lround(height/ratio))};
  }
};
