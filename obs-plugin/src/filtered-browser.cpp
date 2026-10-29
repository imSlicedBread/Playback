// SPDX-License-Identifier: GPL-2.0-or-later
#include "filtered-browser.hpp"
#include "ad-response-policy.hpp"
#include "include/cef_browser.h"
#include "include/cef_client.h"
#include "include/cef_request_handler.h"
#include "include/cef_task.h"
#include "include/cef_parser.h"
#include "include/cef_version.h"
#if CEF_VERSION_MAJOR >= 150
#include "include/cef_version_info.h"
#endif
#include "include/cef_api_hash.h"
#include "include/cef_devtools_message_observer.h"
#include "include/cef_request_context.h"
#include <QCoreApplication>
#include <QEventLoop>
#include <QPointer>
#include <QResizeEvent>
#include <QShowEvent>
#include <QTimer>
#include <atomic>
#include <functional>
#include <map>
#include <set>
#include <cstring>

namespace {
const char *runtimeApiHash(){
  if(cef_version_info(0)!=CEF_VERSION_MAJOR)return nullptr;
#if CEF_VERSION_MAJOR >= 150
  return cef_api_hash(CEF_API_VERSION,0);
#else
  return cef_api_hash(0);
#endif
}
class Task : public CefTask {
  std::function<void()> work;
public:
  explicit Task(std::function<void()> value):work(std::move(value)){}
  void Execute() override {work();}
  IMPLEMENT_REFCOUNTING(Task);
};
void post(std::function<void()> work){CefPostTask(TID_UI,new Task(std::move(work)));}
using Result=std::function<void(bool,QJsonObject)>;
class Client final : public CefClient,public CefLifeSpanHandler,public CefDisplayHandler,public CefLoadHandler,public CefRequestHandler,public CefDevToolsMessageObserver {
  QPointer<FilteredBrowser> receiver;
  CefRefPtr<CefBrowser> browser;
  CefRefPtr<CefRegistration> observer;
  std::map<int,Result> callbacks;
  std::set<QString> paused;
  int sequence=0,configEpoch=0;
  bool ready=false,enabled=false;
  QString destination;
  void notify(std::function<void(FilteredBrowser *)> callback){
    const auto guard=receiver;
    if(guard)QMetaObject::invokeMethod(guard.data(),[guard,callback](){if(guard)callback(guard);},Qt::QueuedConnection);
  }
  void status(const QString &text){notify([text](auto *widget){emit widget->filterStatus(text);});}
  void later(std::function<void()> work,int ms){
    // Qt owns/cancels these timers with the widget. No delayed task retains
    // plugin callbacks inside CEF after the output/module is destroyed.
    CefRefPtr<Client> self=this;
    notify([self,work=std::move(work),ms](auto *widget){QTimer::singleShot(ms,widget,[self,work](){if(!self->closing&&!self->closed)post(work);});});
  }
  void command(const char *method,const QJsonObject &params,Result result={}){
    if(!browser||closed)return;
    const int id=++sequence;
    if(result)callbacks[id]=std::move(result);
    const auto raw=QJsonDocument(params).toJson(QJsonDocument::Compact);
    const auto value=CefParseJSON(raw.toStdString(),JSON_PARSER_RFC);
    CefRefPtr<Client> self=this;const std::string name=method;
    // Leave the DevTools observer stack before continuing/fulfilling requests.
    // Synchronous dispatch here can reenter Chromium's paused-loader teardown.
    post([self,id,name,value](){
      if(!self->browser||self->closed)return;
      const int accepted=self->browser->GetHost()->ExecuteDevToolsMethod(id,name,value?value->GetDictionary():nullptr);
      if(!accepted){
        auto it=self->callbacks.find(id);if(it!=self->callbacks.end()){
          auto done=std::move(it->second);self->callbacks.erase(it);done(false,{});
        }
      }
    });
    if(callbacks.count(id)){
      later([self,id](){
        auto it=self->callbacks.find(id);if(it==self->callbacks.end())return;
        auto done=std::move(it->second);self->callbacks.erase(it);done(false,{});
      },4000);
    }
  }
  void resume(const QString &request){
    if(!paused.erase(request))return;
    command("Fetch.continueResponse",{{"requestId",request}},[this,request](bool ok,QJsonObject){
      if(!ok)command("Fetch.continueRequest",{{"requestId",request}});
    });
  }
  void configureStep(int epoch,int step){
    if(epoch!=configEpoch||!browser||closing)return;
    if(step==4){
      ready=true;status(enabled?"Experimental request filtering active":"Ad request filtering off");
      browser->GetMainFrame()->LoadURL(destination.toStdString());return;
    }
    const char *method=nullptr;QJsonObject params;
    if(step==0){method="Network.enable";params={{"maxTotalBufferSize",1024*1024},{"maxResourceBufferSize",1024*1024},{"maxPostDataSize",0}};}
    if(step==1){method="Network.setBypassServiceWorker";params={{"bypass",enabled}};}
    if(step==2){
      method="Network.setBlockedURLs";QJsonArray urls;
      if(enabled)for(const auto *url:{"https://googleads.g.doubleclick.net/*","https://pubads.g.doubleclick.net/*",
          "https://www.googleadservices.com/*","https://www.youtube.com/pagead/*","https://www.youtube.com/api/stats/ads*"})urls.append(url);
      params={{"urls",urls}};
    }
    if(step==3){
      method=enabled?"Fetch.enable":"Fetch.disable";
      if(enabled){
        QJsonArray patterns;
        for(const auto *url:{"https://www.youtube.com/watch?*","https://www.youtube.com/playlist?*",
            "https://www.youtube.com/youtubei/v1/player*","https://www.youtube.com/youtubei/v1/next*"})
          patterns.append(QJsonObject{{"urlPattern",url},{"requestStage","Response"}});
        params={{"patterns",patterns},{"handleAuthRequests",false}};
      }
    }
    command(method,params,[this,epoch,step](bool ok,QJsonObject){
      if(epoch!=configEpoch)return;
      if(!ok){configurationFailed(epoch);return;}
      configureStep(epoch,step+1);
    });
  }
  void configurationFailed(int epoch){
    if(epoch!=configEpoch||ready||closing)return;
    ++configEpoch;enabled=false;ready=true;
    command("Fetch.disable",{});command("Network.setBlockedURLs",{{"urls",QJsonArray{}}});
    command("Network.setBypassServiceWorker",{{"bypass",false}});
    callbacks.clear();paused.clear();
    status("Request filtering unavailable; normal playback retained");
    if(browser)browser->GetMainFrame()->LoadURL(destination.toStdString());
  }
public:
  std::atomic<bool> closed{false},closing{false};
  bool requested=false;
  explicit Client(FilteredBrowser *widget,QString url,bool block):receiver(widget),destination(std::move(url)),requested(block){}
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override{return this;}
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override{return this;}
  CefRefPtr<CefLoadHandler> GetLoadHandler() override{return this;}
  CefRefPtr<CefRequestHandler> GetRequestHandler() override{return this;}
  void OnRenderProcessTerminated(CefRefPtr<CefBrowser>,TerminationStatus termination,int error,const CefString &) override{
    if(closing||closed)return;
    ready=false;++configEpoch;callbacks.clear();paused.clear();
    notify([termination,error](auto *widget){emit widget->rendererCrashed(int(termination),error);});
  }
  void OnLoadStart(CefRefPtr<CefBrowser>,CefRefPtr<CefFrame> frame,TransitionType) override{
    if(frame->IsMain())frame->ExecuteJavaScript("window.close=()=>{}",frame->GetURL(),0);
  }
  void OnLoadError(CefRefPtr<CefBrowser>,CefRefPtr<CefFrame> frame,ErrorCode code,const CefString &,const CefString &) override{
    if(frame->IsMain()&&code!=ERR_ABORTED)status(QString("Browser load failed (%1); account profile preserved").arg(int(code)));
  }
  void OnAfterCreated(CefRefPtr<CefBrowser> value) override{
    browser=value;
    if(closing){browser->GetHost()->CloseBrowser(true);return;}
    observer=browser->GetHost()->AddDevToolsMessageObserver(this);
    configure(requested);
  }
  void configure(bool block){
    requested=block;if(!browser||closing)return;
    for(const auto &request:std::set<QString>(paused))resume(request);
    ready=false;enabled=block;const int epoch=++configEpoch;
    configureStep(epoch,0);
    CefRefPtr<Client> self=this;
    later([self,epoch](){self->configurationFailed(epoch);},4000);
  }
  void navigate(QString url){destination=std::move(url);if(browser&&ready&&!closing)browser->GetMainFrame()->LoadURL(destination.toStdString());}
  void javascript(const std::string &code){if(browser&&!closing)browser->GetMainFrame()->ExecuteJavaScript(code,browser->GetMainFrame()->GetURL(),0);}
  void resize(int width,int height){
    if(browser&&!closing)SetWindowPos(browser->GetHost()->GetWindowHandle(),nullptr,0,0,width,height,SWP_NOZORDER|SWP_NOACTIVATE);
  }
  void close(){
    closing=true;
    if(browser){
      const auto host=browser->GetHost();const auto handle=host->GetWindowHandle();
      if(handle){ShowWindow(handle,SW_HIDE);SetParent(handle,nullptr);}
      host->CloseBrowser(true);
    }else closed=true;
  }
  void OnBeforeClose(CefRefPtr<CefBrowser>) override{
    callbacks.clear();paused.clear();observer=nullptr;browser=nullptr;closed=true;
  }
  bool OnBeforePopup(CefRefPtr<CefBrowser>,CefRefPtr<CefFrame>,
#if CEF_VERSION_MAJOR >= 150
      int,
#endif
      const CefString &,const CefString &,
      CefLifeSpanHandler::WindowOpenDisposition,bool,const CefPopupFeatures &,CefWindowInfo &,CefRefPtr<CefClient> &,
      CefBrowserSettings &,CefRefPtr<CefDictionaryValue> &,bool *) override{return true;}
  void OnTitleChange(CefRefPtr<CefBrowser>,const CefString &title) override{
    const auto value=QString::fromStdString(title.ToString());notify([value](auto *widget){emit widget->titleChanged(value);});
  }
  void OnAddressChange(CefRefPtr<CefBrowser>,CefRefPtr<CefFrame> frame,const CefString &url) override{
    if(!frame->IsMain())return;
    const auto value=QString::fromStdString(url.ToString());
    if(value!="about:blank")destination=value;
    notify([value](auto *widget){emit widget->urlChanged(value);});
  }
  void OnDevToolsMethodResult(CefRefPtr<CefBrowser>,int id,bool success,const void *raw,size_t size) override{
    auto it=callbacks.find(id);if(it==callbacks.end())return;
    auto done=std::move(it->second);callbacks.erase(it);
    done(success,QJsonDocument::fromJson(QByteArray(static_cast<const char *>(raw),int(size))).object());
  }
  void OnDevToolsEvent(CefRefPtr<CefBrowser>,const CefString &method,const void *raw,size_t size) override{
    if(method!="Fetch.requestPaused")return;
    const auto event=QJsonDocument::fromJson(QByteArray(static_cast<const char *>(raw),int(size))).object();
    const auto request=event.value("requestId").toString();if(request.isEmpty())return;
    status("Player response intercepted");
    paused.insert(request);
    const auto url=QUrl(event.value("request").toObject().value("url").toString());
    if(!enabled||closing||paused.size()>8||event.value("responseStatusCode").toInt()!=200||!PlaybackAdFilter::playerResponse(url)){resume(request);return;}
    QString mime;const auto headers=event.value("responseHeaders").toArray();
    for(const auto &entry:headers){const auto header=entry.toObject();if(header.value("name").toString().compare("content-type",Qt::CaseInsensitive)==0)mime=header.value("value").toString();}
    const bool html=mime.startsWith("text/html",Qt::CaseInsensitive);
    if(!html&&!mime.contains("json",Qt::CaseInsensitive)){resume(request);return;}
    CefRefPtr<Client> self=this;
    // A missed body/result must never leave a request (or the queue) hung.
    later([self,request](){self->resume(request);},3000);
    command("Fetch.getResponseBody",{{"requestId",request}},[this,request,headers,html](bool ok,QJsonObject response){
      if(!paused.count(request))return;
      if(!ok||!enabled||closing){status("Player response body unavailable; original response retained");resume(request);return;}
      auto body=response.value("body").toString().toUtf8();
      if(body.size()>24*1024*1024){resume(request);return;}
      if(response.value("base64Encoded").toBool())body=QByteArray::fromBase64(body);
      const auto filtered=PlaybackAdFilter::rewrite(body,html);
      if(filtered==body){status("Player response contained no recognized ad fields");resume(request);return;}
      QJsonArray outputHeaders;
      for(const auto &entry:headers){
        const auto name=entry.toObject().value("name").toString().toLower();
        if(name!="content-length"&&name!="content-encoding"&&name!="transfer-encoding"&&name!="content-md5"&&name!="etag")outputHeaders.append(entry);
      }
      command("Fetch.fulfillRequest",{{"requestId",request},{"responseCode",200},{"responseHeaders",outputHeaders},
          {"body",QString::fromLatin1(filtered.toBase64())}},[this,request](bool fulfilled,QJsonObject){
        if(fulfilled){paused.erase(request);status("Player ad data filtered");}else{status("Player response rewrite rejected; original retained");resume(request);}
      });
    });
  }
  IMPLEMENT_REFCOUNTING(Client);
};
}

struct FilteredBrowser::Impl {CefRefPtr<Client> client;bool started=false;};
bool FilteredBrowser::runtimeCompatible(){
  return cef_version_info(0)==CEF_VERSION_MAJOR&&cef_version_info(1)==CEF_VERSION_MINOR&&
    cef_version_info(2)==CEF_VERSION_PATCH&&runtimeApiHash()&&std::strcmp(runtimeApiHash(),CEF_API_HASH_PLATFORM)==0;
}
QString FilteredBrowser::runtimeCompatibilityError(){
  const auto actual=QString("%1.%2.%3").arg(cef_version_info(0)).arg(cef_version_info(1)).arg(cef_version_info(2));
  const auto expected=QString("%1.%2.%3").arg(CEF_VERSION_MAJOR).arg(CEF_VERSION_MINOR).arg(CEF_VERSION_PATCH);
  const auto *hash=runtimeApiHash();
  return QString("Browser runtime mismatch: detected CEF %1; this plugin build requires CEF %2. API compatibility: %3. Install the matching OBS 32 or OBS 33 plugin build. Send Help > Log Files > Upload Current Log File to support. Account data was not changed.")
    .arg(actual,expected,hash&&std::strcmp(hash,CEF_API_HASH_PLATFORM)==0?"matched":"mismatched");
}
FilteredBrowser::FilteredBrowser(QWidget *parent,const std::string &url,bool block):QWidget(parent),impl(std::make_unique<Impl>()){
  setAttribute(Qt::WA_NativeWindow);setFocusPolicy(Qt::StrongFocus);
  impl->client=new Client(this,QString::fromStdString(url),block);
}
FilteredBrowser::~FilteredBrowser(){closeBrowser();}
void FilteredBrowser::showEvent(QShowEvent *event){
  QWidget::showEvent(event);if(impl->started)return;impl->started=true;
  const auto handle=reinterpret_cast<HWND>(winId());const auto pixels=size()*devicePixelRatioF();const auto client=impl->client;
  post([handle,pixels,client](){
    if(client->closing){client->closed=true;return;}
    CefWindowInfo info;info.SetAsChild(handle,CefRect(0,0,pixels.width(),pixels.height()));
    info.runtime_style=CEF_RUNTIME_STYLE_ALLOY;
    CefBrowserSettings settings;
    if(!CefBrowserHost::CreateBrowserSync(info,client,"about:blank",settings,nullptr,CefRequestContext::GetGlobalContext()))client->closed=true;
  });
}
void FilteredBrowser::resizeEvent(QResizeEvent *event){QWidget::resizeEvent(event);const auto pixels=size()*devicePixelRatioF();const auto client=impl->client;post([client,pixels](){client->resize(pixels.width(),pixels.height());});}
void FilteredBrowser::setURL(const std::string &url){const auto client=impl->client;post([client,url](){client->navigate(QString::fromStdString(url));});}
void FilteredBrowser::executeJavaScript(const std::string &code){const auto client=impl->client;post([client,code](){client->javascript(code);});}
void FilteredBrowser::reloadPage(){executeJavaScript("location.reload()");}
void FilteredBrowser::setAdBlocking(bool enabled){const auto client=impl->client;post([client,enabled](){client->configure(enabled);});}
void FilteredBrowser::closeBrowser(){
  if(!impl->started)return;
  const auto client=impl->client;post([client](){client->close();});
  // Destroy the CEF client while this module and the OBS runtime are still live.
  // The frontend's SCRIPTING_SHUTDOWN callback runs before browser teardown.
  while(!client->closed){QCoreApplication::processEvents(QEventLoop::ExcludeUserInputEvents,10);Sleep(1);}
  impl->started=false;
}
