# Playback YouTube Output — experimental Windows OBS plugin

This native plugin opens a **normal YouTube watch page**, using OBS Browser's
default browser context. It does not use an iframe or a Chrome extension. Sign
in manually in its output window with the account that owns the membership.
The dashboard and whitelisted chat commands continue to control the same station.

**Members-only playback was verified by the user on October 20, 2026**, using
an entitled YouTube account signed in inside the native OBS plugin. This confirms
actual members-only video playback, beyond sign-in or private-playlist visibility.
The result applies to the tested account and video. The plugin uses the account's
existing access; account/age/content confirmations remain manual. The separate
Browser Source embedded-player workflow has not been verified for members-only playback.

## Install and test

Built for **Windows x64, OBS 32.2.2 with Qt 6.11.1**, OBS Browser panel API 3.
Other OBS/Qt versions have not been tested. The plugin provides a dock, a watch
window and a native **Playback YouTube Output** video source. Its native source
uses OBS's Windows Graphics Capture library directly: ordinary Window Capture
excludes windows owned by OBS itself.

1. Close OBS. Back up your OBS scene collection/profile.
2. Double-click **fKey-Playback-OBS-Plugin-Setup-0.1.2.exe**, approve the Windows
   administrator prompt, and click **Install / Update**. The installer detects
   the usual OBS installation; use **Browse** for a custom or portable folder.
   It checks OBS 32.2.2 / Qt 6.11.1 before installing. Start OBS from your usual
   shortcut after installation. No PowerShell commands or .NET install is needed.
   Manual installation remains available: copy `obs-plugins/64bit/fplayback-youtube.dll`
   from the ZIP into your OBS `obs-plugins/64bit` folder with OBS closed.
3. Start Playback and OBS. Open **Docks → fKey Playback**.
4. Disable/remove the station's existing `/player` Browser Source. It competes
   for the same playback lease; there can be only one playback controller.
5. Choose **Sign in / manage YouTube account**. Complete sign-in yourself in
   this window. Existing OBS Browser sign-in may already be available because
   the plugin uses its default context. This does not share Chrome's login.
6. Choose **Start queue / retry**, then **Add Playback source to current scene**.
   The plugin adds the video and a transparent `Playback Overlay`, sizes both
   to the OBS canvas, and puts the overlay above the video. Clicking again
   repairs a missing overlay and reuses existing sources without duplicates.
   Existing video transforms are preserved. Disable the old `Playback YouTube
   Capture` Window Capture source if you installed an earlier prototype.
7. The same **Playback YouTube Output** source now includes browser audio in the
   OBS mixer. Its first upgrade from the video-only prototype enables Track 1.
   Check the source is unmuted and your recording/stream uses that track. Keep
   audio monitoring off to avoid duplicate sound from the browser and OBS.
   Audio is limited to active sessions owned by this OBS instance's
   `obs-browser-page.exe` children; Chrome, Discord, microphones and general
   desktop audio are not targeted. Other audible OBS browser panels sharing
   the captured browser process may also be included, so mute unused panels.
8. Lower thirds and votes use the automatically added `/overlay` Browser
   Source. It never claims playback. Manual overlays using the configured
   station URL are reused, even when renamed. The button updates the managed
   overlay to the current station port and canvas size.
9. Optional: enable **Start this output when OBS opens**. Playback must also
   start with Windows using the station's existing startup setup. A stopped
   station is retried once a second after the queue is started.

Playback starts with **Lock output (size + controls)** enabled. The output uses
the selected output resolution (720p by default), ignores mouse/keyboard input, and hides ordinary
YouTube player controls to keep hovering or accidental clicks out of the OBS
picture. Minimize and Close park the locked window rather than stopping the queue.
To handle a YouTube prompt, uncheck the lock and choose **Show output window**;
interaction is visible in OBS while unlocked. Recheck the lock when finished.
**Sign in / manage YouTube account** unlocks it automatically; **Start queue / retry**
locks it again. Ads and access/confirmation dialogs are not hidden or accepted.

Keep the output window open. Windows stops painting genuinely minimized windows,
so its minimize action parks it entirely outside the virtual desktop instead
of restoring it visibly over OBS. Playback stays rendered; **Show output window** brings
it forward when you need to interact with YouTube. This does not enable capture
of a closed output or a locked Windows desktop.

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

## Output resolution

Choose **Output resolution** in the fKey Playback dock and click **Apply**.
Presets are 1280×720, 1920×1080, 2560×1440 and 3840×2160, or choose **Match OBS
canvas** to use the current canvas dimensions, including portrait canvases.
The applied choice is saved for the next OBS restart. Existing installations
default to 720p. Click Apply again after changing the OBS canvas size.

This controls the native source's rendered pixel dimensions, with DPI-aware
window sizing. The size lock uses the selected resolution; you do not need to
unlock playback to change it. YouTube stream quality remains automatic and may
be lower than the selected render resolution. The overlay continues to use the
OBS canvas size. Sources added by the plugin fit to the canvas automatically;
if you manually transformed an older source, use OBS's Fit to Screen as needed.

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

## Windows installer

The standalone installer includes the plugin DLL, corresponding source ZIP and
GPL license. It installs only those three files, leaves OBS's own DLLs, scenes,
settings and browser sessions alone, and refuses to update while OBS is open.
Existing plugin/source/license files are backed up under
`data/obs-plugins/fplayback-youtube/backups` inside the OBS installation.
It verifies staged files before replacing anything and restores previous files
if replacement fails. The installed source is available at
`data/obs-plugins/fplayback-youtube/source.zip` for rebuilding or redistribution.

The plugin ZIP also includes the installer and uncompressed source. Both the
installer and ZIP have SHA-256 checksum files. The installer is built with the
static C++ runtime and uses Windows APIs; it needs neither the Qt SDK nor .NET
on the user's computer. It does not install OBS or start a stream/recording.

## Build

Install CMake ≥3.28 and Visual Studio 2026's Desktop development with C++ workload.
From PowerShell run `./obs-plugin/build-windows.ps1`. The script downloads pinned,
SHA-256 verified official OBS headers and OBS's Qt SDK, and verifies the vendored browser panel header.
It generates import libraries from the locally installed OBS DLL exports and
creates `obs-plugin/package/obs-plugins/64bit/fplayback-youtube.dll`.
Build caches and binary packages are ignored by Git. No installation is performed.

Run `npm test` and `npm run check` from the station directory. The watch-page
controller has simulated DOM tests and a real localhost worker-lease test.
The build also runs installer tests for fresh installs, backups, rollback,
locked files, folder validation and embedded resources, plus native recovery-policy and scene-setup tests against libobs
with test video/browser sources, covering reuse, stacking, canvas size, port
changes and unrelated sources.
Compilation does not verify rendering, Google login, or membership access in OBS.

Local live testing on OBS 32.2.2 confirmed reuse of the signed-in YouTube session,
public-video playback through the native video source, restart startup, pause,
seek, resume, automatic end-of-video advancement and changing progress/duration heartbeats. An age-restricted video
played on its normal watch page after the user manually accepted YouTube's
confirmation. Native browser audio was observed as non-silent PCM and a moving
OBS mixer meter. On October 20, 2026, the user also confirmed actual members-only
video playback through the native plugin with the signed-in, entitled account.

Plugin code in this directory is GPL-2.0-or-later (see LICENSE), consistent with
OBS's plugin API. The rest of the station retains its existing license. The
downloaded OBS/Qt SDKs retain their respective licenses. The browser panel header
is from obsproject/obs-browser commit
`23075aaed66df030d553d9ef603136e72127bffd`. Redistributing the binary requires
providing its corresponding plugin source and applicable license notices.
