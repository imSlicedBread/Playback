// SPDX-License-Identifier: GPL-2.0-or-later
#include "filtered-browser.hpp"
#include "test-tls-fixture.hpp"
#include "include/cef_app.h"
#include "include/cef_scheme.h"
#include "include/cef_resource_handler.h"
#include <QApplication>
#include <QTemporaryDir>
#include <QTimer>
#include <QElapsedTimer>
#include <QFile>
#include <QProcess>
#include <QFileInfo>
#include <QDir>
#include <QJsonDocument>
#include <QJsonObject>
#include <atomic>
#include <iostream>
#include <cstring>

namespace {
quint16 fixturePort=0;
const char *page=R"HTML(<!doctype html><html><body><div id="movie_player"><video class="html5-main-video"></video></div><script>
const video=document.querySelector('video');let position=0,paused=true;
Object.defineProperties(video,{readyState:{get:()=>4},duration:{get:()=>240},currentTime:{get:()=>position,set:value=>position=value},paused:{get:()=>paused},ended:{get:()=>false},videoWidth:{get:()=>1280},videoHeight:{get:()=>720}});
video.play=()=>{paused=false;return Promise.resolve();};video.pause=()=>{paused=true;};
var ytInitialPlayerResponse={"adPlacements":[1],"playerAds":[2],"adSlots":[3],"playabilityStatus":{"status":"OK"},"videoDetails":{"videoId":"member-fixture"}};
(async()=>{try{
 const clean=!ytInitialPlayerResponse.adPlacements&&!ytInitialPlayerResponse.playerAds&&!ytInitialPlayerResponse.adSlots;
 const response=await fetch('/youtubei/v1/player');const player=await response.json();
 const account=await(await fetch('/account-fixture')).json();
 let blocked=false;try{await fetch('https://googleads.g.doubleclick.net/pagead/test');}catch{blocked=true;}
 const stats=await(await fetch('/stats-fixture')).json();
 const ok=clean&&!player.adPlacements&&!player.playerAds&&!player.adSlots&&
   player.videoDetails.videoId==='member-fixture'&&player.playabilityStatus.status==='OK'&&
   player.streamingData.formats[0].url==='https://media.example/member?signature=unchanged'&&
   account.cookiePreserved&&account.playabilityStatus.status==='LOGIN_REQUIRED'&&blocked&&stats.adRequests===0;
 document.title=ok?'fixture:passed':'fixture:failed:'+JSON.stringify({clean,ads:!!player.adPlacements,cookie:account.cookiePreserved,blocked,member:player.videoDetails.videoId});
}catch(error){document.title='fixture:error:'+error.name;}})();
</script></body></html>)HTML";
class App : public CefApp,public CefBrowserProcessHandler {
  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override{return this;}
  void OnBeforeCommandLineProcessing(const CefString &,CefRefPtr<CefCommandLine> line) override{
    line->AppendSwitch("disable-gpu");line->AppendSwitch("no-proxy-server");
    // Applies only to this isolated test process/profile, never production OBS.
    line->AppendSwitch("ignore-certificate-errors");
    const auto target="127.0.0.1:"+std::to_string(fixturePort);
    line->AppendSwitchWithValue("host-resolver-rules","MAP www.youtube.com "+target+", MAP googleads.g.doubleclick.net "+target);
  }
  void OnBeforeChildProcessLaunch(CefRefPtr<CefCommandLine> line) override{line->AppendSwitchWithValue("parent_pid",std::to_string(GetCurrentProcessId()));}
  IMPLEMENT_REFCOUNTING(App);
};
}

int main(int argc,char **argv){
  std::cout.setf(std::ios::unitbuf);
  if(argc!=4)return 2;
  const QString runtime=QString::fromLocal8Bit(argv[1]);
  SetDllDirectoryW(reinterpret_cast<LPCWSTR>((runtime+"/obs-plugins/64bit").utf16()));
  QApplication app(argc,argv);
  QTemporaryDir profile; if(!profile.isValid()||!FilteredBrowser::runtimeCompatible())return 3;
  for(const auto &entry:{std::pair<const char *,const char *>{"certificate.pem",fixtureCertificate},{"key.pem",fixtureKey},{"fixture.html",page}}){
    QFile file(profile.path()+"/"+entry.first);if(!file.open(QIODevice::WriteOnly))return 8;file.write(entry.second);
  }
  QProcess server;
  server.start(QString::fromLocal8Bit(argv[2]),{"-u",QString::fromLocal8Bit(argv[3]),profile.path()});
  if(!server.waitForStarted(3000)||!server.waitForReadyRead(3000))return 9;
  fixturePort=server.readLine().trimmed().toUShort();if(!fixturePort)return 10;
  std::cout<<"Loopback HTTPS fixture ready\n";
  CefMainArgs args(GetModuleHandleW(nullptr));CefSettings settings;
  settings.no_sandbox=true;settings.multi_threaded_message_loop=true;
  settings.command_line_args_disabled=true;
  CefString(&settings.root_cache_path)=profile.path().toStdString();
  CefString(&settings.cache_path)=(profile.path()+"/browser").toStdString();
  CefString(&settings.browser_subprocess_path)=(runtime+"/obs-plugins/64bit/obs-browser-page.exe").toStdString();
  settings.log_severity=LOGSEVERITY_DISABLE;
  if(!CefInitialize(args,settings,new App,nullptr))return 4;
  std::cout<<"Isolated Chromium initialized\n";
  int result=5;
  {
    QFile controllerFile(QFileInfo(QString::fromLocal8Bit(argv[3])).dir().filePath("../watch-controller.js"));
    if(!controllerFile.open(QIODevice::ReadOnly))return 11;
    const QString controller=QString::fromUtf8(controllerFile.readAll());int phase=0;
    FilteredBrowser browser(nullptr,"https://www.youtube.com/watch?v=member-fixture",true);
    browser.setAttribute(Qt::WA_DontShowOnScreen);browser.resize(640,360);
    QObject::connect(&browser,&FilteredBrowser::filterStatus,[](const QString &message){std::cout<<message.toStdString()<<"\n";});
    QObject::connect(&browser,&FilteredBrowser::titleChanged,[&](const QString &title){
      const auto send=[&](int generation,bool pause,double position,bool transport=false){
        const QJsonObject command{{"nonce","fixture"},{"generation",generation},{"videoId","member-fixture"},
          {"position",position},{"paused",pause},{"voting",false},{"transportOnly",transport},{"volume",65},{"muted",false},{"locked",true},{"blockAdRequests",true}};
        auto code=controller;code.replace("__PLAYBACK_COMMAND__",QString::fromUtf8(QJsonDocument(command).toJson(QJsonDocument::Compact)));browser.executeJavaScript(code.toStdString());
      };
      if(title.startsWith("fixture:")){
        std::cout<<title.toStdString()<<"\n";
        if(title!="fixture:passed"){result=6;app.quit();return;}
        phase=1;send(1,true,84);return;
      }
      if(title.startsWith("premium:")){
        if(title!="premium:passed"){result=12;app.quit();return;}
        std::cout<<"Premium promotion hidden; full-window player restored\n";phase=4;send(3,true,120);return;
      }
      if(!title.startsWith("fPlayback:fixture:"))return;
      const auto report=QJsonDocument::fromJson(title.mid(18).toUtf8()).object();
      if(!report.contains("position"))return;
      if(phase==1&&report["generation"].toInt()==1&&report["status"]=="Paused"&&report["position"].toDouble()==84){phase=2;send(2,false,84,true);}
      else if(phase==2&&report["generation"].toInt()==2&&report["status"]=="Playing"&&report["position"].toDouble()==84){
        phase=3;
        browser.executeJavaScript("var promo=document.createElement('tp-yt-paper-dialog');promo.id='premium-fixture';promo.textContent='YouTube Premium Get YouTube without the ads No thanks 1 month free';document.body.appendChild(promo);document.querySelector('#movie_player').style.cssText='position:relative;width:50vw;height:50vh';");
        send(2,false,84,true);
        browser.executeJavaScript("requestAnimationFrame(()=>{var p=document.querySelector('#movie_player').getBoundingClientRect();document.title=getComputedStyle(document.querySelector('#premium-fixture')).display==='none'&&Math.abs(p.width-innerWidth)<2&&Math.abs(p.height-innerHeight)<2?'premium:passed':'premium:failed';})");
      }else if(phase==4&&report["generation"].toInt()==3&&report["status"]=="Paused"&&report["position"].toDouble()==120){
        std::cout<<"Playback controller pause, resume and seek passed\n";result=0;app.quit();
      }
    });
    QTimer::singleShot(15000,&browser,[&](){std::cerr<<"CEF fixture timeout\n";app.quit();});
    browser.show();app.exec();
    QElapsedTimer elapsed;elapsed.start();browser.closeBrowser();
    if(elapsed.elapsed()>3000)result=7;
  }
  if(result==0){
    FilteredBrowser reopened(nullptr,"https://www.youtube.com/account-cookie-fixture",false);
    reopened.setAttribute(Qt::WA_DontShowOnScreen);reopened.resize(640,360);
    result=13;
    QObject::connect(&reopened,&FilteredBrowser::titleChanged,[&](const QString &title){if(title.startsWith("continuity:")){result=title=="continuity:passed"?0:13;app.quit();}});
    QTimer::singleShot(10000,&reopened,&QApplication::quit);reopened.show();app.exec();reopened.closeBrowser();
    if(result==0)std::cout<<"Browser reopen retained the existing global account-context cookie\n";
  }
  CefShutdown();
  server.terminate();if(!server.waitForFinished(2000)){server.kill();server.waitForFinished(2000);}
  if(result==0)std::cout<<"CEF interception, ad request blocking, cookie continuity, access response preservation and shutdown passed\n";
  return result;
}
