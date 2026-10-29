// SPDX-License-Identifier: GPL-2.0-or-later
#include <obs-module.h>
#include <obs-frontend-api.h>
#include <browser-panel.hpp>
#include <QApplication>
#include <QCloseEvent>
#include <QEvent>
#include <QCheckBox>
#include <QComboBox>
#include <QHBoxLayout>
#include <QDir>
#include <QDockWidget>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLabel>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QPushButton>
#include <QRegularExpression>
#include <QSpinBox>
#include <QSettings>
#include <QSignalBlocker>
#include <QScreen>
#include <QSet>
#include <QTimer>
#include <QUuid>
#include <QUrlQuery>
#include <QVBoxLayout>
#include <QWindow>
#include <functional>
#include <algorithm>
#include <cmath>
#include <windows.h>
#include <psapi.h>
#include <QElapsedTimer>
#include "recovery-policy.hpp"
#include "scene-setup.hpp"
#include "output-resolution.hpp"
#include "ad-output-guard.hpp"
#include "filtered-browser.hpp"

OBS_DECLARE_MODULE()
void playback_register_capture();
void playback_set_output_window(HWND window);
void playback_set_output_resolution(uint32_t width,uint32_t height);
uint64_t playback_begin_transition();
void playback_transition_ready(uint64_t ticket,bool ready,bool reveal);
void playback_cancel_transition();
void playback_set_ad_output_suppressed(bool suppressed);
const char *obs_module_description(void) { return "Playback queue controls for a signed-in YouTube watch window (experimental)"; }
const char *obs_module_name(void) { return "Playback YouTube Output"; }

class OutputWindow final : public QWidget {
  bool captureLocked = true;
  bool parked = false;
  bool wasMaximized = false;
  QRect previousGeometry;
  OutputResolution renderResolution;
  void sizeForResolution() {
    const auto logical=renderResolution.logical(devicePixelRatioF());
    const QSize size(int(logical.width),int(logical.height));
    if (captureLocked) setFixedSize(size);
    else resize(size);
    if (parked) {
      previousGeometry.setSize(size);
      SetWindowPos(reinterpret_cast<HWND>(winId()),HWND_BOTTOM,
        GetSystemMetrics(SM_XVIRTUALSCREEN)-frameGeometry().width()-64,
        GetSystemMetrics(SM_YVIRTUALSCREEN),0,0,SWP_NOSIZE|SWP_NOACTIVATE);
    }
  }
  void park() {
    if (parked) return;
    if (onPark) onPark();
    wasMaximized=isMaximized();
    previousGeometry=wasMaximized ? normalGeometry() : geometry();
    setAttribute(Qt::WA_ShowWithoutActivating,true);
    if (wasMaximized) showNormal();
    parked=true;
    // WGC needs an unminimized, painting HWND. Keep it entirely outside the
    // virtual desktop instead of restoring a visible window over the user.
    SetWindowPos(reinterpret_cast<HWND>(winId()),HWND_BOTTOM,
      GetSystemMetrics(SM_XVIRTUALSCREEN)-frameGeometry().width()-64,
      GetSystemMetrics(SM_YVIRTUALSCREEN),0,0,SWP_NOSIZE|SWP_NOACTIVATE);
  }
public:
  using QWidget::QWidget;
  std::function<void()> onClose;
  std::function<void()> onPark;
  void savePlacement(QSettings &settings) const {
    const QRect normal=parked ? previousGeometry : (isMaximized() ? normalGeometry() : geometry());
    settings.setValue("outputGeometry",normal);
    settings.setValue("outputParked",parked);
    settings.sync();
  }
  void restorePlacement(const QSettings &settings) {
    const auto saved=settings.value("outputGeometry").toRect();
    if (saved.isValid()) {
      // The locked render size comes from the resolution setting. Restore the
      // window position independently, without reviving obsolete monitor bounds.
      move(saved.topLeft());
      if (!captureLocked) resize(saved.size());
      const auto frame=frameGeometry();
      QScreen *screen=this->screen();
      int largestArea=0;
      for (auto *candidate:QApplication::screens()) {
        const auto overlap=frame.intersected(candidate->availableGeometry());
        const int area=overlap.width()*overlap.height();
        if (area>largestArea) {screen=candidate;largestArea=area;}
      }
      if (screen) {
        const auto available=screen->availableGeometry().adjusted(12,12,-12,-12);
        const QPoint safe(std::clamp(frame.x(),available.left(),std::max(available.left(),available.right()-frame.width()+1)),
                          std::clamp(frame.y(),available.top(),std::max(available.top(),available.bottom()-frame.height()+1)));
        if (safe!=frame.topLeft()) move(safe);
      }
    }
    if (settings.value("outputParked",false).toBool()) park();
  }
  void setRenderResolution(OutputResolution size) {
    if (!size.valid()) return;
    renderResolution=size; sizeForResolution();
  }
  void setCaptureLocked(bool locked) {
    captureLocked=locked;
    if (locked) {
      if (isMaximized()) showNormal();
      sizeForResolution();
    } else {
      setMinimumSize(640,360); setMaximumSize(QWIDGETSIZE_MAX,QWIDGETSIZE_MAX);
    }
  }
  void present() {
    if (parked) {
      parked=false;
      setGeometry(previousGeometry);
      if (wasMaximized) showMaximized();
    }
    show(); raise(); activateWindow();
  }
protected:
  bool nativeEvent(const QByteArray &type, void *message, qintptr *result) override {
    const auto *msg=static_cast<MSG *>(message);
    if (msg->message==WM_DPICHANGED && captureLocked)
      QTimer::singleShot(0,this,[this]() {sizeForResolution();});
    if (msg->message==WM_SYSCOMMAND) {
      const auto command=msg->wParam & 0xfff0;
      if (captureLocked && (command==SC_SIZE || command==SC_MAXIMIZE)) { *result=0; return true; }
      if (command==SC_MINIMIZE || (command==SC_RESTORE && parked)) {
        if (parked) present(); else park();
        *result=0; return true;
      }
    }
    return QWidget::nativeEvent(type,message,result);
  }
  void changeEvent(QEvent *event) override {
    QWidget::changeEvent(event);
    if (event->type()==QEvent::ActivationChange && isActiveWindow() && parked) {
      present();
    }
    if (event->type()==QEvent::WindowStateChange && isMinimized()) {
      // Fallback for programmatic minimization that bypasses WM_SYSCOMMAND.
      QTimer::singleShot(0,this,[this]() {
        if (!isMinimized()) return;
        setAttribute(Qt::WA_ShowWithoutActivating,true);
        setWindowState(windowState() & ~Qt::WindowMinimized);
        park();
      });
    }
  }
  void closeEvent(QCloseEvent *event) override {
    if (captureLocked) { park(); event->ignore(); return; }
    if (onClose) onClose();
    hide(); event->ignore();
  }
};

class Playback final : public QObject {
  Q_OBJECT
  QCef *cef = nullptr;
  FilteredBrowser *browser = nullptr;
  OutputWindow *output = nullptr;
  QWidget *dock = nullptr;
  QLabel *status = nullptr;
  QSpinBox *port = nullptr;
  QSettings *preferences = nullptr;
  QCheckBox *autoStart = nullptr;
  QCheckBox *outputLock = nullptr;
  QPushButton *interactButton = nullptr;
  bool interacting = false;
  QCheckBox *suppressAds = nullptr;
  QCheckBox *blockAds = nullptr;
  QLabel *filterStatus = nullptr;
  AdOutputGuard adOutputGuard;
  QComboBox *resolution = nullptr;
  OutputResolution renderResolution;
  QTimer timer;
  QNetworkAccessManager network;
  QSet<QNetworkReply *> requests;
  QString worker = QUuid::createUuid().toString(QUuid::WithoutBraces);
  QString nonce, loadedVideo, script;
  uint64_t fadeTicket=0;
  QJsonObject snapshot;
  bool running = false, busy = false, lease = false, endedSent = false;
  quint64 epoch = 0;
  int activePort = 4177;
  qint64 generation = -1;
  int initializationRetries = 0;
  QElapsedTimer watchdogClock;
  RecoveryPolicy recovery;
  bool watchdogHeld = false;
  bool rendererUnavailable = false, rebuildingBrowser = false, crashRetryPending = false;
  qint64 lastTelemetry = 0;
  qint64 lastResourceLog = -300000;
  void logResources() {
    const auto now=watchdogClock.elapsed();
    if(now-lastResourceLog<300000)return;
    lastResourceLog=now;
    PROCESS_MEMORY_COUNTERS_EX memory{};DWORD handles=0;
    if(GetProcessMemoryInfo(GetCurrentProcess(),reinterpret_cast<PROCESS_MEMORY_COUNTERS *>(&memory),sizeof(memory))&&GetProcessHandleCount(GetCurrentProcess(),&handles))
      blog(LOG_INFO,"[fplayback-resources] OBS process uptime_ms=%lld private_mb=%llu working_mb=%llu handles=%lu pending_http=%d",now,
        static_cast<unsigned long long>(memory.PrivateUsage/(1024*1024)),static_cast<unsigned long long>(memory.WorkingSetSize/(1024*1024)),handles,int(requests.size()));
  }

  void updateAdOutput() { playback_set_ad_output_suppressed(adOutputGuard.suppressed()); }
  void configureAdMask(){
    const bool permitted=!blockAds->isChecked();
    suppressAds->setEnabled(permitted);
    adOutputGuard.configure(permitted&&suppressAds->isChecked(),running);updateAdOutput();
  }
  void holdAdOutputForNavigation() { adOutputGuard.beginNavigation(); updateAdOutput(); }
  void setStatus(const QString &message) { status->setText(message); }
  void request(const QString &path, const QJsonObject *body,
               std::function<void(int, QJsonObject)> done) {
    QNetworkRequest req(QUrl(QString("http://127.0.0.1:%1%2").arg(activePort).arg(path)));
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
    req.setTransferTimeout(3000);
    QNetworkReply *reply;
    if (body) {
      req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
      reply = network.post(req, QJsonDocument(*body).toJson(QJsonDocument::Compact));
    } else reply = network.get(req);
    requests.insert(reply);
    connect(reply, &QNetworkReply::finished, this, [this, reply, done]() {
      requests.remove(reply);
      const int code = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
      const auto bytes = reply->read(1024 * 1024);
      const auto result = QJsonDocument::fromJson(bytes).object();
      reply->deleteLater(); done(code, result);
    });
  }
  void cancelRequests() {
    const auto pending=requests;requests.clear();
    for(auto *reply:pending) {disconnect(reply,nullptr,this,nullptr);reply->abort();reply->deleteLater();}
    busy=false;
  }
  void closeOutput() {
    rendererUnavailable=false;crashRetryPending=false;
    setInteracting(false);
    playback_set_output_window(nullptr);
    adOutputGuard.stop(); updateAdOutput();
    if (!output) return;
    output->savePlacement(*preferences);
    output->onClose={};
    if(browser) {disconnect(browser,nullptr,this,nullptr);browser->closeBrowser();browser=nullptr;}
    delete output;output=nullptr;
    loadedVideo.clear();generation=-1;
  }
  void pausePage() {
    if (browser) browser->executeJavaScript("if(location.origin==='https://www.youtube.com'&&location.pathname==='/watch')document.querySelector('video')?.pause()");
  }
  void applyOutputLock() {
    const bool locked=outputLock->isChecked();
    if (output) output->setCaptureLocked(locked);
    if (browser) {
      browser->setEnabled(!locked || interacting);
      EnableWindow(reinterpret_cast<HWND>(browser->winId()),!locked || interacting);
    }
    if (running && browser) apply();
  }
  void setInteracting(bool enabled) {
    interacting=enabled;
    if (interactButton) {
      const QSignalBlocker blocker(interactButton);
      interactButton->setChecked(enabled);
      interactButton->setText(enabled ? "Finish interaction" : "Interact with output");
    }
    applyOutputLock();
    if (enabled && output && browser) {
      output->present(); browser->setFocus(Qt::OtherFocusReason);
    }
  }
  bool applyResolution() {
    const auto choice=resolution->currentData().toString();
    OutputResolution size;
    if (choice=="canvas") {
      obs_video_info video{};
      if (!obs_get_video_info(&video)) {setStatus("Cannot read the OBS canvas size."); return false;}
      size={video.base_width,video.base_height};
    } else if (choice=="1080p") size={1920,1080};
    else if (choice=="1440p") size={2560,1440};
    else if (choice=="2160p") size={3840,2160};
    if (!size.valid()) {setStatus("Unsupported output resolution. Choose a smaller OBS canvas or preset."); return false;}
    renderResolution=size;
    preferences->setValue("resolution",choice);
    playback_set_output_resolution(size.width,size.height);
    if (output) output->setRenderResolution(size);
    return true;
  }
  void apply() {
    if(rebuildingBrowser)return;
    if(rendererUnavailable){setStatus(watchdogHeld ? "Browser crash recovery stopped after 3 attempts. Check OBS log, then Start queue / retry." : "Browser renderer stopped — waiting to recover the saved queue position…");return;}
    const auto current = snapshot.value("current").toObject();
    const auto video = current.value("videoId").toString();
    const auto nextGeneration = snapshot.value("generation").toInteger(-1);
    static const QRegularExpression validVideo("^[A-Za-z0-9_-]{11}$");
    if (!validVideo.match(video).hasMatch()) {
      playback_cancel_transition(); fadeTicket=0;
      pausePage();
      setStatus("Queue empty — add a video in Playback."); return;
    }
    if (generation != nextGeneration || loadedVideo != video) {
      generation = nextGeneration; nonce = QUuid::createUuid().toString(QUuid::WithoutBraces);
      endedSent = false;
      watchdogHeld = false;
      lastTelemetry = watchdogClock.elapsed();
    }
    if (loadedVideo != video) {
      if (!loadedVideo.isEmpty()) fadeTicket=playback_begin_transition();
      recovery.reset();
      loadedVideo = video;
      const double position=std::max(0.0,current.value("position").toDouble());
      holdAdOutputForNavigation();
      browser->setURL(("https://www.youtube.com/watch?v=" + video + "&t=" + QString::number(position,'f',3) + "s").toStdString());
      setStatus("Loading YouTube watch page…"); return;
    }
    if (watchdogHeld) { pausePage(); setStatus("Automatic recovery stopped after 3 reloads. Check YouTube, then Start queue / retry."); return; }
    if (watchdogClock.elapsed()-lastTelemetry > 20000)
      setStatus("YouTube is not responding or needs sign-in/navigation. Open the output window, then retry.");
    // OBS urlChanged includes subframe navigations. The script checks the real
    // main-frame location before applying controls; telemetry validates it again.
    const auto audio = snapshot.value("audio").toObject();
    QJsonObject command{{"nonce", nonce}, {"generation", generation}, {"videoId", video},
      {"transportOnly", snapshot.value("transportOnly").toBool()},
      {"position", current.value("position").toDouble()}, {"paused", current.value("paused").toBool()},
      {"voting", snapshot.value("vote").isObject()},
      {"locked", outputLock->isChecked()}, {"suppressAdOutput", suppressAds->isChecked()&&!blockAds->isChecked()},
      {"interacting",interacting},
      {"blockAdRequests",blockAds->isChecked()},
      {"volume", audio.value("volume").toInt(50)}, {"muted", audio.value("muted").toBool()}};
    auto code = script;
    code.replace("__PLAYBACK_COMMAND__", QString::fromUtf8(QJsonDocument(command).toJson(QJsonDocument::Compact)));
    browser->executeJavaScript(code.toStdString());
  }
  void poll() {
    if (!running || busy || rebuildingBrowser) return;
    logResources();
    busy = true; const auto turn = epoch;
    QJsonObject claim{{"workerId", worker}};
    request("/api/worker/claim", &claim, [this, turn](int code, QJsonObject) {
      if (turn != epoch || !running) { busy = false; return; }
      lease = code == 200;
      if (!lease) {
        busy = false;
        pausePage();
        setStatus(code == 409 ? "Another output owns playback. Close its /player source, then retry." : "Playback unavailable. Start the station and check the port."); return;
      }
      request("/api/public?compact=1", nullptr, [this, turn](int statusCode, QJsonObject data) {
        busy = false;
        if (turn != epoch || !running) return;
        if (statusCode != 200) { setStatus("Cannot read the Playback queue."); return; }
        snapshot = data; apply();
      });
    });
  }
private slots:
  void telemetry(const QString &title) {
    if (!running || !lease) return;
    const auto prefix = "fPlayback:" + nonce + ":";
    if (!title.startsWith(prefix) || title.size() > 4096) return;
    const auto result = QJsonDocument::fromJson(title.mid(prefix.size()).toUtf8()).object();
    if (result.value("generation").toInteger(-2) != generation || result.value("videoId").toString() != loadedVideo) return;
    const QUrl location(result.value("href").toString());
    if (location.scheme() != "https" || location.host() != "www.youtube.com" ||
        location.path() != "/watch" || QUrlQuery(location).queryItemValue("v") != loadedVideo) return;
    lastTelemetry = watchdogClock.elapsed();
    adOutputGuard.observe(result.value("advertisement").toBool(), result.value("displayReady").toBool(), result.value("revealDisplay").toBool());
    updateAdOutput();
    if (fadeTicket && (result.contains("displayReady") || result.value("revealDisplay").toBool()))
      playback_transition_ready(fadeTicket,result.value("displayReady").toBool(),result.value("revealDisplay").toBool());
    if (result.contains("recover")) {
      const auto reason = result.value("recover").toString();
      if (reason != "startup" && reason != "buffering" && reason != "stalled" && reason != "player-error") return;
      if (watchdogHeld || snapshot.value("vote").isObject() || snapshot.value("current").toObject().value("paused").toBool()) return;
      const auto decision = recovery.request(watchdogClock.elapsed());
      if (decision == RecoveryDecision::Cooldown) { setStatus("Waiting before retrying stalled YouTube playback…"); return; }
      if (decision == RecoveryDecision::Hold) {
        watchdogHeld=true; pausePage();
        setStatus("Automatic recovery stopped after 3 reloads. Check YouTube, then Start queue / retry."); return;
      }
      nonce=QUuid::createUuid().toString(QUuid::WithoutBraces); endedSent=false;
      holdAdOutputForNavigation();
      setStatus("Reloading YouTube at the saved queue position…"); browser->reloadPage(); return;
    }
    setStatus(result.value("status").toString().left(240));
    QJsonObject body{{"workerId", worker}, {"generation", generation}};
    const auto turn = epoch;
    if (result.value("ended").toBool() && !endedSent) {
      endedSent = true;
      request("/api/worker/ended", &body, [this, turn](int code, QJsonObject data) {
        if (turn == epoch && (code != 200 || !data.value("accepted").toBool())) endedSent = false;
      });
    } else if (result.value("position").isDouble() && result.value("duration").isDouble()) {
      const double position = result.value("position").toDouble(), duration = result.value("duration").toDouble();
      if (!std::isfinite(position) || !std::isfinite(duration) || position < 0 || duration <= 0 || duration > 86400) return;
      body.insert("position", position); body.insert("duration", duration); body.insert("videoId", loadedVideo);
      request("/api/worker/progress", &body, [](int, QJsonObject) {});
    }
  }
public:
  void start() {
    if(rendererUnavailable&&browser){stop();closeOutput();}
    if (!ensureBrowser()) {
      if (cef && !cef->initialized() && initializationRetries++ < 20) {
        const auto turn = epoch;
        QTimer::singleShot(500,this,[this,turn]() { if (epoch == turn) start(); });
      }
      return;
    }
    initializationRetries = 0;
    if (running) stop();
    rendererUnavailable=false;crashRetryPending=false;
    setInteracting(false);
    activePort = port->value(); worker = QUuid::createUuid().toString(QUuid::WithoutBraces);
    ++epoch; running = true;timer.start();port->setEnabled(false);
    outputLock->setChecked(true); applyOutputLock();
    recovery.reset(); watchdogHeld=false; lastTelemetry=watchdogClock.elapsed();
    preferences->setValue("port", activePort);
    loadedVideo.clear(); generation = -1;
    holdAdOutputForNavigation();
    output->show(); poll();
  }
  explicit Playback(QObject *parent) : QObject(parent) {
    watchdogClock.start();
    BPtr<char> configPath(obs_module_config_path("settings.ini"));
    QDir().mkpath(QFileInfo(QString::fromUtf8(configPath.Get())).absolutePath());
    preferences = new QSettings(QString::fromUtf8(configPath.Get()), QSettings::IniFormat, this);
    dock = new QWidget;
    auto *layout = new QVBoxLayout(dock);
    port = new QSpinBox; port->setRange(1, 65535); port->setValue(preferences->value("port",4177).toInt()); port->setPrefix("Station port: "); layout->addWidget(port);
    autoStart = new QCheckBox("Start this output when OBS opens");
    autoStart->setChecked(preferences->value("autoStart",false).toBool()); layout->addWidget(autoStart);
    connect(autoStart, &QCheckBox::toggled, this, [this](bool enabled) { preferences->setValue("autoStart", enabled); });
    outputLock=new QCheckBox("Lock output (size + controls)");
    outputLock->setChecked(true); layout->addWidget(outputLock);
    connect(outputLock,&QCheckBox::toggled,this,[this](bool) { applyOutputLock(); });
    blockAds=new QCheckBox("Block ads before playback (experimental)");
    blockAds->setToolTip("Filters ad delivery and player ad-placement data in Playback's browser, using the existing signed-in OBS account. No ad wait is added; results require live verification.");
    blockAds->setChecked(preferences->value("blockAdRequests",true).toBool());layout->addWidget(blockAds);
    connect(blockAds,&QCheckBox::toggled,this,[this](bool enabled){
      preferences->setValue("blockAdRequests",enabled);
      configureAdMask();
      if(browser)browser->setAdBlocking(enabled);
    });
    filterStatus=new QLabel("Experimental request filtering starts with the output");filterStatus->setWordWrap(true);layout->addWidget(filterStatus);
    suppressAds = new QCheckBox("Hide ad video + mute ad audio");
    suppressAds->setToolTip("Masks detected YouTube ads in the native OBS source. Ads may still run in the output window; this does not remove ad waiting time.");
    suppressAds->setChecked(preferences->value("suppressAdOutput",false).toBool());
    configureAdMask();
    layout->addWidget(suppressAds);
    connect(suppressAds,&QCheckBox::toggled,this,[this](bool enabled) {
      preferences->setValue("suppressAdOutput",enabled);
      configureAdMask();
      if (running && browser) apply();
    });
    status = new QLabel("Stopped"); status->setWordWrap(true); layout->addWidget(status);
    layout->addWidget(new QLabel("Output resolution"));
    auto *resolutionRow=new QHBoxLayout;
    resolution=new QComboBox;
    resolution->addItem("1280 x 720 (720p)","720p");
    resolution->addItem("1920 x 1080 (1080p)","1080p");
    resolution->addItem("2560 x 1440 (1440p)","1440p");
    resolution->addItem("3840 x 2160 (4K)","2160p");
    resolution->addItem("Match OBS canvas","canvas");
    const int savedResolution=resolution->findData(preferences->value("resolution","720p").toString());
    resolution->setCurrentIndex(savedResolution<0?0:savedResolution);
    resolutionRow->addWidget(resolution);
    auto *applyResolutionButton=new QPushButton("Apply"); resolutionRow->addWidget(applyResolutionButton);
    layout->addLayout(resolutionRow);
    connect(applyResolutionButton,&QPushButton::clicked,this,[this]() {
      if (applyResolution()) setStatus("Output resolution applied. YouTube stream quality remains automatic.");
    });
    const auto button = [this, layout](const QString &text, auto handler) {
      auto *b = new QPushButton(text); layout->addWidget(b); connect(b, &QPushButton::clicked, this, handler);
    };
    button("Sign in / manage YouTube account", [this]() {
      stop(); closeOutput(); if (!ensureBrowser()) return;
      outputLock->setChecked(false);
      browser->setURL("https://www.youtube.com/"); output->present();
      setStatus("Sign in inside this window, then choose Start queue. Google may restrict embedded browser sign-in.");
    });
    button("Start queue / retry", [this]() { start(); });
    button("Show output window", [this]() { if (ensureBrowser()) output->present(); });
    interactButton=new QPushButton("Interact with output");
    interactButton->setCheckable(true);
    interactButton->setToolTip("Temporarily enable YouTube mouse and keyboard controls. The output size stays locked. Finish interaction to hide controls again.");
    layout->addWidget(interactButton);
    connect(interactButton,&QPushButton::toggled,this,[this](bool enabled) {
      if (enabled && !ensureBrowser()) {setInteracting(false);return;}
      setInteracting(enabled);
    });
    button("Add Playback source to current scene", [this]() {
      if (!ensureBrowser()) return;
      output->show();
      obs_source_t *sceneSource = obs_frontend_get_current_scene();
      obs_scene_t *scene = sceneSource ? obs_scene_from_source(sceneSource) : nullptr;
      if (!scene) { if (sceneSource) obs_source_release(sceneSource); setStatus("Select an OBS scene first."); return; }
      obs_video_info video{};
      const char *error = obs_get_video_info(&video)
        ? playback_setup_scene(scene,port->value(),video.base_width,video.base_height)
        : "Cannot read the OBS canvas size.";
      obs_source_release(sceneSource);
      setStatus(error ? error : "Playback video and overlay are ready. Check the Playback source audio meter.");
    });
    button("Stop output", [this]() { stop(); closeOutput(); });
    layout->addStretch();
    QFile file(":/fplayback/watch-controller.js");
    if (file.open(QIODevice::ReadOnly)) script = QString::fromUtf8(file.readAll());
    timer.setInterval(1000); connect(&timer, &QTimer::timeout, this, [this]() { poll(); });
    obs_frontend_add_dock_by_id("fplayback-youtube", "fKey Playback", dock);
  }
  void finishedLoading() {
    // OBS can restore a floating dock with its title bar outside the desktop.
    // Run after Qt has applied the restored layout and native window frame.
    QTimer::singleShot(0,this,[this]() {
      auto *panel=qobject_cast<QDockWidget *>(dock->parentWidget());
      if (!panel || !panel->isFloating() || !panel->isVisible()) return;
      const auto frame=panel->frameGeometry();
      QScreen *screen=panel->screen();
      int largestArea=0;
      for (auto *candidate:QApplication::screens()) {
        const auto overlap=frame.intersected(candidate->availableGeometry());
        const int area=overlap.width()*overlap.height();
        if (area>largestArea) {screen=candidate;largestArea=area;}
      }
      if (!screen) return;
      const auto available=screen->availableGeometry().adjusted(12,12,-12,-12);
      const auto border=frame.size()-panel->size();
      if (frame.width()>available.width() || frame.height()>available.height())
        panel->resize(panel->size().boundedTo(available.size()-border));
      const auto size=panel->frameGeometry().size();
      const QPoint position(std::clamp(frame.x(),available.left(),std::max(available.left(),available.right()-size.width()+1)),
                            std::clamp(frame.y(),available.top(),std::max(available.top(),available.bottom()-size.height()+1)));
      if (position!=frame.topLeft()) panel->move(position);
    });
    applyResolution();
    if (autoStart->isChecked()) {
      const auto turn=epoch;
      QTimer::singleShot(1500,this,[this,turn]() {if(epoch==turn)start();});
    }
  }
  bool ensureBrowser() {
    if (browser) return true;
    if (script.isEmpty() || obs_browser_qcef_version() != 3) {
      setStatus("OBS browser panel API version 3 is required."); return false;
    }
    if (!cef) cef = obs_browser_init_panel();
    if (!cef) { setStatus("OBS Browser is unavailable."); return false; }
    if (!cef->init_browser()) { setStatus("Initializing OBS browser…"); return false; }
    if(!FilteredBrowser::runtimeCompatible()){
      const auto diagnostic=FilteredBrowser::runtimeCompatibilityError();
      blog(LOG_ERROR,"[fplayback-browser] %s",diagnostic.toUtf8().constData());
      setStatus(diagnostic);return false;
    }
    output = new OutputWindow;
    output->setWindowTitle("Playback YouTube Output"); output->resize(1280, 720);
    output->setRenderResolution(renderResolution);
    // Like OBS projectors, this dedicated output is explicitly intended for capture.
    // Keep the main OBS window's existing capture privacy preference intact.
    const auto outputHandle = reinterpret_cast<HWND>(output->winId());
    output->windowHandle()->setProperty("isOBSProjectorWindow",true);
    SetWindowDisplayAffinity(outputHandle,WDA_NONE);
    auto *layout = new QVBoxLayout(output); layout->setContentsMargins(0, 0, 0, 0);
    attachBrowser("https://www.youtube.com/");
    if (!browser) { delete output; output = nullptr; setStatus("OBS could not create the YouTube browser."); return false; }
    browser->allowAllPopups(false);
    applyOutputLock();
    output->restorePlacement(*preferences);
    playback_set_output_window(outputHandle);
    output->onClose = [this]() {
      stop();
      QTimer::singleShot(0,this,[this]() {if(!running)closeOutput();});
    };
    output->onPark = [this]() {setInteracting(false);};
    return true;
  }
  void attachBrowser(const std::string &url) {
    browser=new FilteredBrowser(output,url,blockAds->isChecked());
    output->layout()->addWidget(browser);
    connect(browser,&FilteredBrowser::titleChanged,this,&Playback::telemetry);
    connect(browser,&FilteredBrowser::filterStatus,this,[this](const QString &message){filterStatus->setText(message);});
    auto *created=browser;
    connect(browser,&FilteredBrowser::rendererCrashed,this,[this,created](int termination,int error){
      if(browser==created)handleRendererCrash(termination,error);
    });
  }
  void handleRendererCrash(int termination,int error) {
    blog(LOG_WARNING,"[fplayback-browser] Renderer terminated: status=%d error=%d uptime_ms=%lld",termination,error,watchdogClock.elapsed());
    rendererUnavailable=true;
    nonce=QUuid::createUuid().toString(QUuid::WithoutBraces);
    if(!running||!output){setStatus("Browser renderer stopped. Start queue / retry when ready.");return;}
    if(watchdogHeld||crashRetryPending)return;
    const auto decision=recovery.request(watchdogClock.elapsed());
    if(decision==RecoveryDecision::Hold){watchdogHeld=true;setStatus("Browser crash recovery stopped after 3 attempts. Check OBS log, then Start queue / retry.");return;}
    if(decision==RecoveryDecision::Cooldown){
      crashRetryPending=true;const auto turn=epoch;
      QTimer::singleShot(15000,this,[this,turn,termination,error](){
        if(turn!=epoch||!running)return;
        crashRetryPending=false;handleRendererCrash(termination,error);
      });return;
    }
    // Keep the capture HWND, size, placement and global account context. Replace
    // only this dead browser, never the OBS process or another browser source.
    rebuildingBrowser=true;
    nonce=QUuid::createUuid().toString(QUuid::WithoutBraces);
    auto *failed=browser;browser=nullptr;
    disconnect(failed,nullptr,this,nullptr);failed->closeBrowser();delete failed;
    const auto current=snapshot.value("current").toObject();
    const auto video=current.value("videoId").toString();
    static const QRegularExpression valid("^[A-Za-z0-9_-]{11}$");
    const auto url=valid.match(video).hasMatch() ? QString("https://www.youtube.com/watch?v=%1&t=%2s").arg(video).arg(std::max(0.0,current.value("position").toDouble()),0,'f',3) : QString("https://www.youtube.com/");
    attachBrowser(url.toStdString());
    generation=-1;endedSent=false;rendererUnavailable=false;rebuildingBrowser=false;
    fadeTicket=playback_begin_transition();applyOutputLock();browser->show();
    setStatus("Browser restarted at the saved queue position.");
  }
  void stop() {
    crashRetryPending=false;
    setInteracting(false);
    playback_cancel_transition(); fadeTicket=0;
    running = false; ++epoch; timer.stop();cancelRequests();port->setEnabled(true);
    pausePage();
    if (browser) browser->executeJavaScript("window.__fPlaybackWatch?.detachAdGuard?.()");
    holdAdOutputForNavigation();
    if (lease) {
      QJsonObject body{{"workerId", worker}};
      request("/api/worker/release", &body, [](int, QJsonObject) {});
    }
    lease = false; setStatus("Stopped");
  }
  ~Playback() override {
    timer.stop(); stop();
    closeOutput();cancelRequests();
    delete cef;
    obs_frontend_remove_dock("fplayback-youtube");
  }
};

static Playback *playback = nullptr;
static void frontendEvent(enum obs_frontend_event event, void *) {
  if (event == OBS_FRONTEND_EVENT_FINISHED_LOADING && playback)
    playback->finishedLoading();
  if (event == OBS_FRONTEND_EVENT_SCRIPTING_SHUTDOWN || event == OBS_FRONTEND_EVENT_EXIT) { delete playback; playback = nullptr; }
}
bool obs_module_load(void) {
  playback_register_capture();
  // Register before OBS restores its saved dock layout, including visibility,
  // position, floating state and tab groups. Start playback only after loading.
  playback = new Playback(static_cast<QWidget *>(obs_frontend_get_main_window()));
  obs_frontend_add_event_callback(frontendEvent, nullptr);
  return true;
}
void obs_module_unload(void) { obs_frontend_remove_event_callback(frontendEvent, nullptr);delete playback;playback=nullptr; }
#include "plugin.moc"
