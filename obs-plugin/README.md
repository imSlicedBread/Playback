# Playback YouTube Output — experimental Windows OBS plugin

This native plugin opens a **normal YouTube watch page**, using OBS Browser's
default browser context. It does not use an iframe or a Chrome extension. Sign
in manually in its output window with the account that owns the membership.
The dashboard and whitelisted chat commands continue to control the same station.

**Members-only playback is not yet verified.** Successful sign-in or seeing a
private playlist does not prove that a restricted video will play. YouTube may
reject sign-in from an embedded browser or restrict playback for other reasons.
The plugin cannot grant membership access. Test a real entitled video before
using this for a broadcast. Account/age/content confirmations remain manual.

## Install and test

Built for **Windows x64, OBS 32.2.2 with Qt 6.11.1**, OBS Browser panel API 3.
Other OBS/Qt versions have not been tested. The plugin provides a dock, a watch
window and a native **Playback YouTube Output** video source. Its native source
uses OBS's Windows Graphics Capture library directly: ordinary Window Capture
excludes windows owned by OBS itself.

1. Close OBS. Back up your OBS scene collection/profile.
2. In the built ZIP, copy `obs-plugins/64bit/fplayback-youtube.dll` into
   `C:\Program Files\obs-studio\obs-plugins\64bit`. Administrator access may be
   required. Do not replace OBS's own Qt/browser DLLs.
3. Start Playback and OBS. Open **Docks → Playback YouTube**.
4. Disable/remove the station's existing `/player` Browser Source. It competes
   for the same playback lease; there can be only one playback controller.
5. Choose **Sign in / manage YouTube account**. Complete sign-in yourself in
   this window. Existing OBS Browser sign-in may already be available because
   the plugin uses its default context. This does not share Chrome's login.
6. Choose **Start queue / retry**, then **Add Playback source to current scene**.
   Fit the added `Playback YouTube Output` source to the scene. Keep the output
   window open and unminimized. Disable the old `Playback YouTube Capture` Window
   Capture source if you installed an earlier prototype.
7. The same **Playback YouTube Output** source now includes browser audio in the
   OBS mixer. Its first upgrade from the video-only prototype enables Track 1.
   Check the source is unmuted and your recording/stream uses that track. Keep
   audio monitoring off to avoid duplicate sound from the browser and OBS.
   Audio is limited to active sessions owned by this OBS instance's
   `obs-browser-page.exe` children; Chrome, Discord, microphones and general
   desktop audio are not targeted. Other audible OBS browser panels sharing
   the captured browser process may also be included, so mute unused panels.
8. Optional: add a transparent Browser Source above the Playback YouTube Output source, URL
   `http://127.0.0.1:4177/overlay`, at the same canvas size, for the existing
   lower third and voting screen. `/overlay` never claims playback.
9. Optional: enable **Start this output when OBS opens**. Playback must also
   start with Windows using the station's existing startup setup. A stopped
   station is retried once a second after the queue is started.

YouTube access errors hold the current entry. Inspect the window, resolve access
manually, then choose **Start queue / retry**. There are no automatic clicks on
membership, age verification, content confirmation, consent, or sign-in dialogs.
Ads hold queue reporting and are not skipped or hidden by the controller.
Normal watch-page navigation, ads, and YouTube controls may be visible in capture.
The page layout/selectors can change and need future maintenance.

Test pause/resume, seek, replay, previous, force skip, audio, Play Next, Play Now
and interrupted-video resumption, plus a complete voting round. Then test a
members-only video using an entitled account. Check access still works after
restarting OBS. These live checks are not replaced by the automated tests.

## Playback watchdog

While the queue is running, the controller checks once a second. After 10 seconds
without playhead movement, or 30 seconds without a ready video, it requests a
reload of the same watch page. The station's saved position, audio and current
entry are reapplied. Recovery never skips, quarantines or deletes a video.
Intentional pauses, voting, advertisements, visible access/confirmation dialogs
and blocked autoplay suspend recovery. Sign-in and other pages are left alone.

Reloads have a 15-second cooldown and a maximum of three in five minutes. At the
limit, the output pauses and the dock asks you to inspect YouTube, then choose
**Start queue / retry**. That button resets the retry limit; changing to another
video also resets it. A completely unresponsive browser script, or navigation
away from the expected watch page, produces a dock notice after 20 seconds and
requires manual inspection/retry instead of a blind reload during sign-in.

Uninstall with OBS closed by removing only `fplayback-youtube.dll`. Restore the
regular `/player` source. OBS Browser manages the account session; the plugin
does not export, import, log, or copy Google cookies or account tokens.

## Build

Install CMake ≥3.28 and Visual Studio 2026's Desktop development with C++ workload.
From PowerShell run `./obs-plugin/build-windows.ps1`. The script downloads pinned,
SHA-256 verified official OBS headers and OBS's Qt SDK, and verifies the vendored browser panel header.
It generates import libraries from the locally installed OBS DLL exports and
creates `obs-plugin/package/obs-plugins/64bit/fplayback-youtube.dll`.
Build caches and binary packages are ignored by Git. No installation is performed.

Run `npm test` and `npm run check` from the station directory. The watch-page
controller has simulated DOM tests and a real localhost worker-lease test.
Compilation does not verify rendering, Google login, or membership access in OBS.

Local live testing on OBS 32.2.2 confirmed reuse of the signed-in YouTube session,
public-video playback through the native video source, restart startup, pause,
seek, resume, automatic end-of-video advancement and changing progress/duration heartbeats. An age-restricted video
played on its normal watch page after the user manually accepted YouTube's
confirmation. Native browser audio was observed as non-silent PCM and a moving
OBS mixer meter. Actual members-only access remains unverified.

Plugin code in this directory is GPL-2.0-or-later (see LICENSE), consistent with
OBS's plugin API. The rest of the station retains its existing license. The
downloaded OBS/Qt SDKs retain their respective licenses. The browser panel header
is from obsproject/obs-browser commit
`23075aaed66df030d553d9ef603136e72127bffd`. Redistributing the binary requires
providing its corresponding plugin source and applicable license notices.
