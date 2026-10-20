// SPDX-License-Identifier: GPL-2.0-or-later
#include <obs-module.h>
#include <obs-frontend-api.h>
#include <browser-panel.hpp>
#include <QApplication>
#include <QCloseEvent>
#include <QEvent>
#include <QCheckBox>
#include <QDir>
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
#include <QTimer>
#include <QUuid>
#include <QUrlQuery>
#include <QVBoxLayout>
#include <QWindow>
#include <functional>
#include <cmath>
#include <windows.h>
#include <QElapsedTimer>
#include "recovery-policy.hpp"
#include "scene-setup.hpp"

OBS_DECLARE_MODULE()
void playback_register_capture();
void playback_set_output_window(HWND window);
const char *obs_module_description(void) { return "Playback queue controls for a signed-in YouTube watch window (experimental)"; }
const char *obs_module_name(void) { return "Playback YouTube Output"; }

class OutputWindow final : public QWidget {
  bool captureLocked = true;
  bool parked = false;
  bool wasMaximized = false;
  QRect previousGeometry;
  void park() {
    if (parked) return;
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
  void setCaptureLocked(bool locked) {
    captureLocked=locked;
    if (locked) {
      if (isMaximized()) showNormal();
      setFixedSize(1280,720);
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
  QCefWidget *browser = nullptr;
  OutputWindow *output = nullptr;
  QWidget *dock = nullptr;
  QLabel *status = nullptr;
  QSpinBox *port = nullptr;
  QSettings *preferences = nullptr;
  QCheckBox *autoStart = nullptr;
  QCheckBox *outputLock = nullptr;
  QTimer timer;
  QNetworkAccessManager network;
  QString worker = QUuid::createUuid().toString(QUuid::WithoutBraces);
  QString nonce, loadedVideo, script;
  QJsonObject snapshot;
  bool running = false, busy = false, lease = false, endedSent = false;
  quint64 epoch = 0;
  int activePort = 4177;
  qint64 generation = -1;
  int initializationRetries = 0;
  QElapsedTimer watchdogClock;
  RecoveryPolicy recovery;
  bool watchdogHeld = false;
  qint64 lastTelemetry = 0;

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
    connect(reply, &QNetworkReply::finished, this, [reply, done]() {
      const int code = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
      const auto bytes = reply->read(1024 * 1024);
      const auto result = QJsonDocument::fromJson(bytes).object();
      reply->deleteLater(); done(code, result);
    });
  }
  void pausePage() {
    if (browser) browser->executeJavaScript("if(location.origin==='https://www.youtube.com'&&location.pathname==='/watch')document.querySelector('video')?.pause()");
  }
  void applyOutputLock() {
    const bool locked=outputLock->isChecked();
    if (output) output->setCaptureLocked(locked);
    if (browser) {
      browser->setEnabled(!locked);
      EnableWindow(reinterpret_cast<HWND>(browser->winId()),!locked);
    }
    if (running && browser) apply();
  }
  void apply() {
    const auto current = snapshot.value("current").toObject();
    const auto video = current.value("videoId").toString();
    const auto nextGeneration = snapshot.value("generation").toInteger(-1);
    static const QRegularExpression validVideo("^[A-Za-z0-9_-]{11}$");
    if (!validVideo.match(video).hasMatch()) {
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
      recovery.reset();
      loadedVideo = video;
      browser->setURL(("https://www.youtube.com/watch?v=" + video).toStdString());
      setStatus("Loading YouTube watch page…"); return;
    }
    if (watchdogHeld) { pausePage(); setStatus("Automatic recovery stopped after 3 reloads. Check YouTube, then Start queue / retry."); return; }
    if (watchdogClock.elapsed()-lastTelemetry > 20000)
      setStatus("YouTube is not responding or needs sign-in/navigation. Open the output window, then retry.");
    // OBS urlChanged includes subframe navigations. The script checks the real
    // main-frame location before applying controls; telemetry validates it again.
    const auto audio = snapshot.value("audio").toObject();
    QJsonObject command{{"nonce", nonce}, {"generation", generation}, {"videoId", video},
      {"position", current.value("position").toDouble()}, {"paused", current.value("paused").toBool()},
      {"voting", snapshot.value("vote").isObject()},
      {"locked", outputLock->isChecked()},
      {"volume", audio.value("volume").toInt(50)}, {"muted", audio.value("muted").toBool()}};
    auto code = script;
    code.replace("__PLAYBACK_COMMAND__", QString::fromUtf8(QJsonDocument(command).toJson(QJsonDocument::Compact)));
    browser->executeJavaScript(code.toStdString());
  }
  void poll() {
    if (!running || busy) return;
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
    if (result.contains("recover")) {
      const auto reason = result.value("recover").toString();
      if (reason != "startup" && reason != "buffering" && reason != "stalled") return;
      if (watchdogHeld || snapshot.value("vote").isObject() || snapshot.value("current").toObject().value("paused").toBool()) return;
      const auto decision = recovery.request(watchdogClock.elapsed());
      if (decision == RecoveryDecision::Cooldown) { setStatus("Waiting before retrying stalled YouTube playback…"); return; }
      if (decision == RecoveryDecision::Hold) {
        watchdogHeld=true; pausePage();
        setStatus("Automatic recovery stopped after 3 reloads. Check YouTube, then Start queue / retry."); return;
      }
      nonce=QUuid::createUuid().toString(QUuid::WithoutBraces); endedSent=false;
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
    if (!ensureBrowser()) {
      if (cef && !cef->initialized() && initializationRetries++ < 20) {
        const auto turn = epoch;
        QTimer::singleShot(500,this,[this,turn]() { if (epoch == turn) start(); });
      }
      return;
    }
    initializationRetries = 0;
    if (running) stop();
    activePort = port->value(); worker = QUuid::createUuid().toString(QUuid::WithoutBraces);
    ++epoch; running = true; port->setEnabled(false);
    outputLock->setChecked(true); applyOutputLock();
    recovery.reset(); watchdogHeld=false; lastTelemetry=watchdogClock.elapsed();
    preferences->setValue("port", activePort);
    loadedVideo.clear(); generation = -1;
    output->show(); poll();
  }
  explicit Playback(QObject *parent) : QObject(parent) {
    watchdogClock.start();
    BPtr<char> configPath(obs_module_config_path("settings.ini"));
    QDir().mkpath(QFileInfo(QString::fromUtf8(configPath.Get())).absolutePath());
    preferences = new QSettings(QString::fromUtf8(configPath.Get()), QSettings::IniFormat, this);
    dock = new QWidget;
    auto *layout = new QVBoxLayout(dock);
    auto *intro = new QLabel("Experimental YouTube watch-page output. Sign in manually with an account that has access, then add Playback video and overlay to your scene.");
    intro->setWordWrap(true); layout->addWidget(intro);
    port = new QSpinBox; port->setRange(1, 65535); port->setValue(preferences->value("port",4177).toInt()); port->setPrefix("Station port: "); layout->addWidget(port);
    autoStart = new QCheckBox("Start this output when OBS opens");
    autoStart->setChecked(preferences->value("autoStart",false).toBool()); layout->addWidget(autoStart);
    connect(autoStart, &QCheckBox::toggled, this, [this](bool enabled) { preferences->setValue("autoStart", enabled); });
    outputLock=new QCheckBox("Lock output (size + controls)");
    outputLock->setChecked(true); layout->addWidget(outputLock);
    connect(outputLock,&QCheckBox::toggled,this,[this](bool) { applyOutputLock(); });
    status = new QLabel("Stopped"); status->setWordWrap(true); layout->addWidget(status);
    const auto button = [this, layout](const QString &text, auto handler) {
      auto *b = new QPushButton(text); layout->addWidget(b); connect(b, &QPushButton::clicked, this, handler);
    };
    button("Sign in / manage YouTube account", [this]() {
      stop(); if (!ensureBrowser()) return;
      outputLock->setChecked(false);
      browser->setURL("https://www.youtube.com/"); output->present();
      setStatus("Sign in inside this window, then choose Start queue. Google may restrict embedded browser sign-in.");
    });
    button("Start queue / retry", [this]() { start(); });
    button("Show output window", [this]() { if (ensureBrowser()) output->present(); });
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
    button("Stop output", [this]() { stop(); });
    layout->addStretch();
    QFile file(":/fplayback/watch-controller.js");
    if (file.open(QIODevice::ReadOnly)) script = QString::fromUtf8(file.readAll());
    timer.setInterval(1000); connect(&timer, &QTimer::timeout, this, [this]() { poll(); }); timer.start();
    obs_frontend_add_dock_by_id("fplayback-youtube", "fKey Playback", dock);
    if (autoStart->isChecked()) QTimer::singleShot(1500,this,[this]() { start(); });
  }
  bool ensureBrowser() {
    if (browser) return true;
    if (script.isEmpty() || obs_browser_qcef_version() != 3) {
      setStatus("OBS browser panel API version 3 is required."); return false;
    }
    if (!cef) cef = obs_browser_init_panel();
    if (!cef) { setStatus("OBS Browser is unavailable."); return false; }
    if (!cef->init_browser()) { setStatus("Initializing OBS browser…"); return false; }
    output = new OutputWindow;
    output->setWindowTitle("Playback YouTube Output"); output->resize(1280, 720);
    // Like OBS projectors, this dedicated output is explicitly intended for capture.
    // Keep the main OBS window's existing capture privacy preference intact.
    const auto outputHandle = reinterpret_cast<HWND>(output->winId());
    output->windowHandle()->setProperty("isOBSProjectorWindow",true);
    SetWindowDisplayAffinity(outputHandle,WDA_NONE);
    auto *layout = new QVBoxLayout(output); layout->setContentsMargins(0, 0, 0, 0);
    browser = cef->create_widget(output, "https://www.youtube.com/", nullptr);
    if (!browser) { delete output; output = nullptr; setStatus("OBS could not create the YouTube browser."); return false; }
    browser->allowAllPopups(false); layout->addWidget(browser);
    applyOutputLock();
    playback_set_output_window(outputHandle);
    // QCefWidget's metaobject lives in obs-browser, not in this DLL.
    connect(browser, SIGNAL(titleChanged(QString)), this, SLOT(telemetry(QString)));
    output->onClose = [this]() { stop(); };
    return true;
  }
  void stop() {
    running = false; ++epoch; port->setEnabled(true);
    pausePage();
    if (lease) {
      QJsonObject body{{"workerId", worker}};
      request("/api/worker/release", &body, [](int, QJsonObject) {});
    }
    lease = false; setStatus("Stopped");
  }
  ~Playback() override {
    timer.stop(); stop();
    playback_set_output_window(nullptr);
    if (browser) { browser->closeBrowser(); browser = nullptr; }
    if (output) { output->onClose = {}; delete output; }
    delete cef;
    obs_frontend_remove_dock("fplayback-youtube");
  }
};

static Playback *playback = nullptr;
static void frontendEvent(enum obs_frontend_event event, void *) {
  if (event == OBS_FRONTEND_EVENT_FINISHED_LOADING && !playback)
    playback = new Playback(static_cast<QWidget *>(obs_frontend_get_main_window()));
  if (event == OBS_FRONTEND_EVENT_EXIT) { delete playback; playback = nullptr; }
}
bool obs_module_load(void) { playback_register_capture(); obs_frontend_add_event_callback(frontendEvent, nullptr); return true; }
void obs_module_unload(void) { obs_frontend_remove_event_callback(frontendEvent, nullptr); }
#include "plugin.moc"
