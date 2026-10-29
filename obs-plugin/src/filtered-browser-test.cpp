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
#include <QEventLoop>
#include <QFile>
#include <QProcess>
#include <QFileInfo>
#include <QDir>
#include <QJsonDocument>
#include <QJsonObject>
#include <atomic>
#include <iostream>
#include <cstring>
#include <psapi.h>
#include <tlhelp32.h>
#include <map>
#include <set>

namespace {
quint16 fixturePort=0;
struct Resources {uint64_t privateBytes=0;DWORD handles=0;unsigned processes=0;};
Resources resources(){
  std::map<DWORD,DWORD> parents;const auto snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);
  PROCESSENTRY32W entry{};entry.dwSize=sizeof(entry);
  if(snapshot!=INVALID_HANDLE_VALUE){
    if(Process32FirstW(snapshot,&entry))do{parents[entry.th32ProcessID]=entry.th32ParentProcessID;}while(Process32NextW(snapshot,&entry));
    CloseHandle(snapshot);
  }
  std::set<DWORD> owned{GetCurrentProcessId()};bool changed=true;
  while(changed){changed=false;for(const auto &[pid,parent]:parents)if(owned.count(parent)&&!owned.count(pid)){owned.insert(pid);changed=true;}}
  Resources result;
  for(const auto pid:owned){
    const auto process=OpenProcess(PROCESS_QUERY_INFORMATION|PROCESS_VM_READ,FALSE,pid);if(!process)continue;
    PROCESS_MEMORY_COUNTERS_EX info{};DWORD handles=0;
    if(GetProcessMemoryInfo(process,reinterpret_cast<PROCESS_MEMORY_COUNTERS *>(&info),sizeof(info)))result.privateBytes+=info.PrivateUsage;
    if(GetProcessHandleCount(process,&handles))result.handles+=handles;
    ++result.processes;CloseHandle(process);
  }return result;
}
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
  if(argc!=4&&argc!=5)return 2;
  const bool soak=argc==5&&std::string(argv[4])=="--soak";
  const QString runtime=QString::fromLocal8Bit(argv[1]);
  const QString browserRuntime=QFile::exists(runtime+"/core/obs-browser/libcef.dll") ? runtime+"/core/obs-browser" : runtime+"/obs-plugins/64bit";
  SetDllDirectoryW(reinterpret_cast<LPCWSTR>(browserRuntime.utf16()));
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
  CefString(&settings.browser_subprocess_path)=(browserRuntime+"/obs-browser-page.exe").toStdString();
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
    Resources baseline,final;
    const int cycles=soak?50:2;
    for(int cycle=0;cycle<cycles&&result==0;++cycle){
    FilteredBrowser reopened(nullptr,"https://www.youtube.com/account-cookie-fixture",false);
    reopened.setAttribute(Qt::WA_DontShowOnScreen);reopened.resize(640,360);
    result=13;
    bool crashed=false;
    QObject::connect(&reopened,&FilteredBrowser::rendererCrashed,[&](int,int){crashed=true;result=0;app.quit();});
    QObject::connect(&reopened,&FilteredBrowser::titleChanged,[&](const QString &title){if(title.startsWith("continuity:")){
      if(title!="continuity:passed"){result=13;app.quit();return;}
      if(cycle==0){reopened.setURL("chrome://crash");return;}
      result=0;app.quit();
    }});
    QTimer::singleShot(10000,&reopened,&QApplication::quit);reopened.show();app.exec();reopened.closeBrowser();
    if(cycle==0&&!crashed)result=14;
    if(result==0)std::cout<<"Browser cycle "<<cycle<<": cookie retained; "<<(crashed?"renderer crash detected":"clean shutdown")<<"\n";
    // Give exited renderer processes a chance to leave the process snapshot.
    QEventLoop idle;QTimer::singleShot(200,&idle,&QEventLoop::quit);idle.exec();
    const auto sample=resources();
    std::cout<<"resources,"<<cycle<<","<<sample.privateBytes<<","<<sample.handles<<","<<sample.processes<<"\n";
    if(cycle==5)baseline=sample;final=sample;
    }
    if(soak&&result==0){
      // Smoke-test budgets after warmup, not a claim of zero leaks or a real
      // multi-day YouTube/GPU soak. Includes this fixture's owned process tree.
      if(final.privateBytes>baseline.privateBytes+128ULL*1024*1024||final.handles>baseline.handles+128||final.processes>baseline.processes+2)result=15;
      std::cout<<"Warm baseline/final private bytes: "<<baseline.privateBytes<<"/"<<final.privateBytes<<" handles: "<<baseline.handles<<"/"<<final.handles<<" processes: "<<baseline.processes<<"/"<<final.processes<<"\n";
    }
  }
  CefShutdown();
  server.terminate();if(!server.waitForFinished(2000)){server.kill();server.waitForFinished(2000);}
  QElapsedTimer shutdownWait;shutdownWait.start();
  while(resources().processes>1&&shutdownWait.elapsed()<3000)Sleep(50);
  if(resources().processes>1){std::cerr<<"Owned child process remained after shutdown\n";result=16;}
  else std::cout<<"Owned child processes after shutdown: 0\n";
  if(result==0)std::cout<<"CEF interception, ad request blocking, cookie continuity, access response preservation and shutdown passed\n";
  return result;
}
