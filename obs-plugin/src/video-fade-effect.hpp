// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
inline constexpr const char *fadeShader=R"(
uniform float4x4 ViewProj;
uniform texture2d image_a;
uniform texture2d image_b;
uniform float amount;
sampler_state sampler_linear { Filter=Linear; AddressU=Clamp; AddressV=Clamp; };
struct Vertex { float4 pos:POSITION; float2 uv:TEXCOORD0; };
Vertex VSFade(Vertex v) {v.pos=mul(float4(v.pos.xyz,1.0),ViewProj);return v;}
float4 PSFade(Vertex v):TARGET {return lerp(image_a.Sample(sampler_linear,v.uv),image_b.Sample(sampler_linear,v.uv),amount);}
technique Fade {pass {vertex_shader=VSFade(v);pixel_shader=PSFade(v);}}
)";
