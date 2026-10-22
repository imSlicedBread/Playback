// SPDX-License-Identifier: GPL-2.0-or-later
#include "ad-response-policy.hpp"
#include <cstdlib>
#include <iostream>
using namespace PlaybackAdFilter;
static void check(bool ok){if(!ok)std::abort();}
int main(){
  check(playerResponse(QUrl("https://www.youtube.com/watch?v=abc")));
  check(playerResponse(QUrl("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")));
  for(const auto *url:{"https://accounts.google.com/watch","http://www.youtube.com/watch","https://www.youtube.com.evil.test/watch","https://www.youtube.com:444/watch","https://www.youtube.com/api/other"})check(!playerResponse(QUrl(url)));
  const QByteArray raw=R"({"playerResponse":{"adPlacements":[{"ad":1}],"playerAds":[],"adSlots":[],"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"Membership required"},"streamingData":{"formats":[{"url":"https://media.example/signed?sig=unchanged"}]},"videoDetails":{"videoId":"abc","title":"adPlacements"}},"other":17})";
  const auto result=QJsonDocument::fromJson(rewrite(raw,false)).object();
  const auto player=result["playerResponse"].toObject();
  check(!player.contains("adPlacements")&&!player.contains("playerAds")&&!player.contains("adSlots"));
  const auto original=QJsonDocument::fromJson(raw).object()["playerResponse"].toObject();
  for(const auto *key:{"playabilityStatus","streamingData","videoDetails"})check(player[key]==original[key]);
  check(result["other"].toInt()==17);
  const QByteArray html=R"(<html><title>Ad text</title><script>var ytInitialPlayerResponse={"adPlacements":[1],"playerAds":[],"adSlots":[],"title":"adPlacements","playabilityStatus":{"status":"OK"}};</script><script>var unrelated={"adSlots":1};</script></html>)";
  const auto filtered=rewrite(html,true);
  check(filtered.contains("\"noPlacements\":[1]"));check(filtered.contains("\"noayerAds\":[]"));
  check(filtered.contains("\"title\":\"adPlacements\""));
  check(filtered.contains("var unrelated={\"adSlots\":1}"));
  check(filtered.contains("\"playabilityStatus\":{\"status\":\"OK\"}"));
  check(rewrite("invalid json",false)=="invalid json");
  check(rewrite("{\"playabilityStatus\":{\"status\":\"AGE_CHECK_REQUIRED\"}}",false)=="{\"playabilityStatus\":{\"status\":\"AGE_CHECK_REQUIRED\"}}");
  check(rewrite(filtered,true)==filtered);
  check(rewrite(QByteArray(16*1024*1024+1,'x'),false).size()==16*1024*1024+1);
  std::cout<<"Ad response policy: ad removal, account/media preservation, scope and bounds passed\n";
}
