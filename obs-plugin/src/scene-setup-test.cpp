// SPDX-License-Identifier: GPL-2.0-or-later
#include "scene-setup.hpp"
#include <cstdlib>
#include <cstring>
#include <cstdio>
static void expect(bool condition, const char *message) {
  if (!condition) { std::fprintf(stderr,"%s\n",message); std::abort(); }
}
static void registerSource(const char *id) {
  obs_source_info info{};
  info.id=id; info.type=OBS_SOURCE_TYPE_INPUT; info.output_flags=OBS_SOURCE_VIDEO;
  info.get_name=[](void *) { return "Scene setup test source"; };
  info.create=[](obs_data_t *,obs_source_t *) -> void * { return new int(0); };
  info.destroy=[](void *data) { delete static_cast<int *>(data); };
  info.get_width=[](void *) -> uint32_t { return 1280; };
  info.get_height=[](void *) -> uint32_t { return 720; };
  obs_register_source(&info);
}
static size_t count(obs_scene_t *scene) {
  size_t result=0;
  obs_scene_enum_items(scene,[](obs_scene_t *,obs_sceneitem_t *,void *data) {
    ++*static_cast<size_t *>(data); return true;
  },&result);
  return result;
}
int main() {
  expect(obs_startup("en-US",nullptr,nullptr),"OBS startup");
  obs_data_t *privateData=obs_get_private_data();
  obs_data_set_bool(privateData,"AbsoluteCoordinates",true); obs_data_release(privateData);
  registerSource("browser_source"); registerSource("fplayback_youtube_output");
  // A name collision must not repurpose an unrelated Browser source.
  obs_data_t *data=obs_data_create(); obs_data_set_string(data,"url","https://example.com/");
  obs_source_t *other=obs_source_create("browser_source","Playback Overlay",data,nullptr);
  obs_data_release(data);
  obs_scene_t *scene=obs_scene_create("Test scene");
  expect(playback_setup_scene(scene,4177,0,1080)!=nullptr && count(scene)==0,"Invalid canvas cannot mutate scene");
  expect(playback_setup_scene(scene,4177,1920,1080)==nullptr,"Initial setup");
  expect(count(scene)==2,"Video and overlay added");
  auto *video=obs_scene_find_source(scene,"Playback YouTube Output");
  auto *overlay=obs_scene_find_source(scene,"Playback Overlay (2)");
  expect(video && overlay,"Unique names without replacing other sources");
  expect(obs_sceneitem_get_order_position(overlay)>obs_sceneitem_get_order_position(video),"Overlay above video");
  auto *source=obs_sceneitem_get_source(overlay);
  data=obs_source_get_settings(source);
  expect(!std::strcmp(obs_data_get_string(data,"url"),"http://127.0.0.1:4177/overlay"),"Correct overlay route");
  expect(obs_data_get_int(data,"width")==1920 && obs_data_get_int(data,"height")==1080,"Canvas dimensions");
  obs_data_release(data);
  vec2 position{}; vec2_set(&position,42,57); obs_sceneitem_set_pos(video,&position);
  obs_sceneitem_set_visible(overlay,false); obs_sceneitem_set_order(overlay,OBS_ORDER_MOVE_BOTTOM);
  expect(playback_setup_scene(scene,4188,1080,1920)==nullptr && count(scene)==2,"Retry reuses managed sources");
  obs_sceneitem_get_pos(video,&position); expect(position.x==42 && position.y==57,"Existing video layout preserved");
  expect(obs_sceneitem_visible(overlay),"Overlay restored to visible");
  data=obs_source_get_settings(source);
  expect(!std::strcmp(obs_data_get_string(data,"url"),"http://127.0.0.1:4188/overlay"),"Configured port updated");
  expect(obs_data_get_int(data,"width")==1080 && obs_data_get_int(data,"height")==1920,"Portrait canvas updated");
  obs_data_release(data);
  // A manually configured overlay with a different name is reused in place.
  obs_scene_t *manual=obs_scene_create("Manual overlay");
  data=obs_data_create(); obs_data_set_string(data,"url","http://127.0.0.1:4177/overlay");
  obs_source_t *custom=obs_source_create("browser_source","Custom overlay",data,nullptr);
  obs_data_release(data); obs_scene_add(manual,custom); obs_source_release(custom);
  expect(playback_setup_scene(manual,4177,1920,1080)==nullptr && count(manual)==2,"Manual overlay reused");
  expect(obs_scene_find_source(manual,"Custom overlay")!=nullptr,"Manual source name preserved");
  data=obs_source_get_settings(other);
  expect(!std::strcmp(obs_data_get_string(data,"url"),"https://example.com/"),"Unrelated browser unchanged");
  obs_data_release(data); obs_source_release(other);
  obs_scene_release(manual); obs_scene_release(scene); obs_shutdown();
}
