// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QWidget>
#include <memory>
#include <string>

// Owns one browser in the existing OBS CEF runtime/global request context.
// It never initializes another runtime or imports/exports account cookies.
class FilteredBrowser : public QWidget {
  Q_OBJECT
  struct Impl;
  std::unique_ptr<Impl> impl;
public:
  explicit FilteredBrowser(QWidget *parent,const std::string &url,bool blockAds);
  ~FilteredBrowser() override;
  static bool runtimeCompatible();
  static QString runtimeCompatibilityError();
  void setURL(const std::string &url);
  void executeJavaScript(const std::string &script);
  void reloadPage();
  void closeBrowser();
  void setAdBlocking(bool enabled);
  void allowAllPopups(bool) {} // Popups are always blocked, as in the old output.
signals:
  void titleChanged(QString title);
  void urlChanged(QString url);
  void filterStatus(QString status);
  void rendererCrashed(int terminationStatus,int errorCode);
protected:
  void showEvent(QShowEvent *event) override;
  void resizeEvent(QResizeEvent *event) override;
};
