// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QByteArray>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QRegularExpression>
#include <QUrl>

namespace PlaybackAdFilter {
inline bool youtube(const QUrl &url) {
  return url.scheme()=="https" && url.host()=="www.youtube.com" && (url.port(-1)==-1||url.port()==443);
}
inline bool playerResponse(const QUrl &url) {
  if(!youtube(url))return false;
  const auto path=url.path();
  return path=="/watch" || path=="/playlist" || path=="/youtubei/v1/player" || path=="/youtubei/v1/next";
}
inline bool adKey(const QString &key) {return key=="adPlacements"||key=="playerAds"||key=="adSlots";}
inline QJsonValue prune(QJsonValue value,bool &changed,int depth=0) {
  if(depth>100)return value;
  if(value.isObject()){
    auto object=value.toObject();
    for(auto it=object.begin();it!=object.end();){
      if(adKey(it.key())){it=object.erase(it);changed=true;}
      else{it.value()=prune(it.value(),changed,depth+1);++it;}
    }
    return object;
  }
  if(value.isArray()){
    auto array=value.toArray();for(qsizetype i=0;i<array.size();++i)array[i]=prune(array[i],changed,depth+1);
    return array;
  }
  return value;
}
// Only quoted object keys inside inline player-data scripts are changed.
// Account state, playability/access errors, signed media URLs and video details
// are preserved. Ordinary string values containing these words are untouched.
inline QString rewriteScript(QString script) {
  for(qsizetype i=0;i<script.size();++i){
    if(script[i]!='"'&&script[i]!='\'')continue;
    const auto quote=script[i];const auto start=i++;
    while(i<script.size()){
      if(script[i]=='\\'){i+=2;continue;}
      if(script[i]==quote)break;
      ++i;
    }
    if(i>=script.size())break;
    const auto key=script.mid(start+1,i-start-1);auto next=i+1;
    while(next<script.size()&&script[next].isSpace())++next;
    if(adKey(key)&&next<script.size()&&script[next]==':'){
      // Same length, keeping inline script offsets and syntax intact.
      script.replace(start+1,2,"no");
    }
  }
  return script;
}
inline QByteArray rewrite(const QByteArray &body,bool html) {
  if(body.size()>16*1024*1024)return body;
  if(!html){
    QJsonParseError error;auto document=QJsonDocument::fromJson(body,&error);
    if(error.error!=QJsonParseError::NoError)return body;
    bool changed=false;
    const auto value=prune(document.isArray()?QJsonValue(document.array()):QJsonValue(document.object()),changed);
    if(!changed)return body;
    return value.isArray()?QJsonDocument(value.toArray()).toJson(QJsonDocument::Compact):QJsonDocument(value.toObject()).toJson(QJsonDocument::Compact);
  }
  auto text=QString::fromUtf8(body);
  static const QRegularExpression scripts("(<script\\b[^>]*>)([\\s\\S]*?)(</script\\s*>)",QRegularExpression::CaseInsensitiveOption);
  auto matches=scripts.globalMatch(text);QList<QPair<qsizetype,QPair<qsizetype,QString>>> replacements;
  while(matches.hasNext()){
    const auto match=matches.next();const auto content=match.captured(2);
    if(content.contains("ytInitialPlayerResponse")||content.contains("ytInitialData")||content.contains("ytplayer")){
      const auto result=rewriteScript(content);
      if(result!=content)replacements.append({match.capturedStart(2),{match.capturedLength(2),result}});
    }
  }
  for(auto it=replacements.crbegin();it!=replacements.crend();++it)text.replace(it->first,it->second.first,it->second.second);
  return replacements.isEmpty()?body:text.toUtf8();
}
}
