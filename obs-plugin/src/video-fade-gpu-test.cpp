// SPDX-License-Identifier: GPL-2.0-or-later
#include <obs-module.h>
#include <cstdlib>
#include <cstdio>
#include <initializer_list>
#include "video-fade-effect.hpp"
static void expect(bool value,const char *message) {if(!value){std::fprintf(stderr,"%s\n",message);std::abort();}}
int main(int argc,char **argv) {
  expect(obs_startup("en-US",nullptr,nullptr),"OBS startup");
  graphics_t *graphics=nullptr;
  expect(argc==2 && gs_create(&graphics,argv[1],0)==0,"D3D11 graphics initialization");
  gs_enter_context(graphics);
  auto *effect=gs_effect_create(fadeShader,"video-fade-gpu-test",nullptr);
  expect(effect,"Fade shader compiles on the installed GPU");
  const uint8_t red[]={255,0,0,255},blue[]={0,0,255,255};
  const uint8_t *redData=red,*blueData=blue;
  auto *a=gs_texture_create(1,1,GS_RGBA,1,&redData,0);
  auto *b=gs_texture_create(1,1,GS_RGBA,1,&blueData,0);
  auto *target=gs_texrender_create(GS_RGBA,GS_ZS_NONE);
  auto *readback=gs_stagesurface_create(1,1,GS_RGBA);
  expect(a && b && target && readback,"GPU textures allocated");
  for (const float amount:{0.f,.5f,1.f}) {
    gs_texrender_reset(target);expect(gs_texrender_begin(target,1,1),"Begin render");
    gs_ortho(0,1,0,1,-100,100);gs_matrix_identity();
    gs_enable_blending(false);gs_enable_depth_test(false);gs_set_cull_mode(GS_NEITHER);
    gs_effect_set_texture(gs_effect_get_param_by_name(effect,"image_a"),a);
    gs_effect_set_texture(gs_effect_get_param_by_name(effect,"image_b"),b);
    gs_effect_set_float(gs_effect_get_param_by_name(effect,"amount"),amount);
    while(gs_effect_loop(effect,"Fade"))gs_draw_sprite(nullptr,0,1,1);
    gs_texrender_end(target);
    gs_stage_texture(readback,gs_texrender_get_texture(target));
    uint8_t *pixels=nullptr;uint32_t stride=0;
    expect(gs_stagesurface_map(readback,&pixels,&stride),"Read rendered pixel");
    if(amount==0)expect(pixels[0]>=250 && pixels[2]<=3,"Start is outgoing red frame");
    else if(amount==1)expect(pixels[2]>=250 && pixels[0]<=3,"End is incoming blue frame");
    else expect(pixels[0]>=120 && pixels[0]<=135 && pixels[2]>=120 && pixels[2]<=135 && pixels[1]<=3,"Midpoint blends both frames");
    gs_stagesurface_unmap(readback);
  }
  gs_stagesurface_destroy(readback);gs_texrender_destroy(target);
  gs_texture_destroy(a);gs_texture_destroy(b);gs_effect_destroy(effect);
  gs_leave_context();gs_destroy(graphics);obs_shutdown();
}
