// SPDX-License-Identifier: GPL-2.0-or-later
#include "scene-setup.hpp"
#include <string>
#include <cstring>

namespace {
struct Match {
  const char *id;
  const char *url = nullptr;
  obs_sceneitem_t *item = nullptr;
  obs_source_t *source = nullptr;
};
bool matches(obs_source_t *source, const Match &match) {
  if (std::strcmp(obs_source_get_unversioned_id(source), match.id)) return false;
  if (!match.url) return true;
  obs_data_t *settings = obs_source_get_settings(source);
  const bool same = obs_data_get_bool(settings,"playbackOverlay") ||
                    !std::strcmp(obs_data_get_string(settings,"url"),match.url);
  obs_data_release(settings);
  return same;
}
bool findItem(obs_scene_t *, obs_sceneitem_t *item, void *data) {
  auto &match = *static_cast<Match *>(data);
  if (!matches(obs_sceneitem_get_source(item),match)) return true;
  match.item = item;
  return false;
}
bool findSource(void *data, obs_source_t *source) {
  auto &match = *static_cast<Match *>(data);
  if (!matches(source,match)) return true;
  match.source = obs_source_get_ref(source);
  return false;
}
obs_source_t *createUnique(const char *id, const char *label, obs_data_t *settings) {
  std::string name = label;
  for (int n=2;;++n) {
    obs_source_t *existing = obs_get_source_by_name(name.c_str());
    if (!existing) break;
    obs_source_release(existing);
    name = std::string(label)+" ("+std::to_string(n)+")";
  }
  return obs_source_create(id,name.c_str(),settings,nullptr);
}
void fit(obs_sceneitem_t *item, uint32_t width, uint32_t height) {
  vec2 position{}, size{float(width),float(height)}, scale{1.0f,1.0f};
  obs_sceneitem_set_pos(item,&position);
  obs_sceneitem_set_rot(item,0.0f);
  obs_sceneitem_set_scale(item,&scale);
  obs_sceneitem_set_alignment(item,OBS_ALIGN_TOP|OBS_ALIGN_LEFT);
  obs_sceneitem_set_bounds_type(item,OBS_BOUNDS_SCALE_INNER);
  obs_sceneitem_set_bounds_alignment(item,OBS_ALIGN_CENTER);
  obs_sceneitem_set_bounds(item,&size);
}
}

const char *playback_setup_scene(obs_scene_t *scene, int port, uint32_t width, uint32_t height) {
  if (!scene || !width || !height || port<1 || port>65535) return "Cannot read the current scene canvas.";
  Match capture{"fplayback_youtube_output"};
  obs_scene_enum_items(scene,findItem,&capture);
  if (!capture.item) {
    obs_enum_sources(findSource,&capture);
    if (!capture.source) capture.source=createUnique(capture.id,"Playback YouTube Output",nullptr);
    if (!capture.source) return "Playback video source could not be created.";
    capture.item=obs_scene_add(scene,capture.source);
    obs_source_release(capture.source);
    if (!capture.item) return "Playback video source could not be added.";
    fit(capture.item,width,height);
  }
  obs_sceneitem_set_visible(capture.item,true);

  const std::string url="http://127.0.0.1:"+std::to_string(port)+"/overlay";
  Match overlay{"browser_source",url.c_str()};
  obs_scene_enum_items(scene,findItem,&overlay);
  if (overlay.item) overlay.source=obs_source_get_ref(obs_sceneitem_get_source(overlay.item));
  else obs_enum_sources(findSource,&overlay);
  obs_data_t *settings=obs_data_create();
  obs_data_set_string(settings,"url",url.c_str());
  obs_data_set_int(settings,"width",width);
  obs_data_set_int(settings,"height",height);
  obs_data_set_bool(settings,"playbackOverlay",true);
  obs_data_set_bool(settings,"shutdown",false);
  obs_data_set_bool(settings,"restart_when_active",false);
  if (overlay.source) obs_source_update(overlay.source,settings);
  else overlay.source=createUnique(overlay.id,"Playback Overlay",settings);
  obs_data_release(settings);
  if (!overlay.source) return "Video is ready, but OBS Browser is unavailable for the overlay.";
  if (!overlay.item) overlay.item=obs_scene_add(scene,overlay.source);
  obs_source_release(overlay.source);
  if (!overlay.item) return "Video is ready, but the overlay could not be added.";
  fit(overlay.item,width,height);
  obs_sceneitem_set_visible(overlay.item,true);
  obs_sceneitem_set_order(overlay.item,OBS_ORDER_MOVE_TOP);
  return nullptr;
}
