# OBS 33 compatibility — October 28, 2026

## Build targets

Playback v1.7.12 ships plugin 0.1.10 with independent builds for OBS 32.2.2 / CEF 127.145.7 and OBS 33.0.0 / CEF 150.0.20 (both Windows x64 / Qt 6.11.1). The default installer targets OBS 32; the `-OBS33` installer targets OBS 33. Unsupported OBS/Qt/CEF combinations are rejected before replacement. API-hash checks remain enabled in the running plugin. Future OBS 33 patch releases are not automatically claimed as tested.

The OBS 33 source is the official `33.0.0` tag, browser submodule revision `85c7f2668936679b43329a9ee9f1e269d9bac812`. Its browser-panel header has the same pinned hash as the existing panel ABI. The build adapts Chromium 150's API-hash signature, version-information header and popup callback while keeping the shared request-filtering and Playback controller code. Build and package outputs are separate. The installer uses the core browser module's new location but installs this third-party plugin in OBS 33's supported legacy plugin folder.

## Login preservation

Both variants create their filtered browser with OBS's existing global CEF request context. They never initialize another browser runtime, export/import cookies, clear browser data, or create a new account store in production. The installer replaces the plugin and corresponding source/license only. OBS itself owns account/profile migration during an OBS upgrade. This was visible in the supplied OBS 33 user log.

Real Chromium acceptance uses a synthetic account-context cookie, preserved across browser destruction/recreation and an actual renderer crash. This verifies shared context continuity, not a live Google login or entitled members-only access. A live members-only test on OBS 33 remains outstanding.

## Validation

All ten native tests passed against each runtime, including filtering of initial HTML and API ad fields, ad-delivery blocking, unchanged media/access data, pause/resume/seek, Premium layout recovery, renderer crash detection and recreation, fifty browser lifecycle cycles, child-process cleanup, capture/fade GPU policy and installer validation. The app suite passed: 194 tests, one platform-specific check skipped locally; syntax checks passed.

A portable OBS 33.0.0 runtime was downloaded from the official release and SHA-256 verified, without modifying the installed OBS 32 instance. A new portable profile and separate Playback test station on port 47818 were used. The actual OBS 33 plugin loaded against Chromium 150 and reported live progress for `uWTzrV7Qpmw`. Pause held position at 93.962301 seconds across samples, seek landed at 120 seconds while paused, and resume advanced to 121.949219 seconds. Browser hardware acceleration was enabled in this host test.

The desktop capture tool could not activate the hidden test output reliably, so no visual capture/overlay or audible output claim is made from that host test. Native capture/audio routing code is shared with the OBS 32 implementation; GPU/scene fixtures passed for both builds. The portable test host was stopped after testing; no direct test child processes remained. The separate station was stopped. No live user queue, scenes, browser account or installed plugin was modified.

## Artifacts and remaining work

Both build variants are packaged for Playback v1.7.12. Use the `-OBS33` installer only with OBS 33.0.0, with OBS closed. Validate the user's signed-in account, entitled members-only playback, audio, OBS source/overlay and a sustained YouTube run before describing OBS 33 account playback or long-duration ad coverage as live-verified. No extension, remote debugging port or membership/age/content bypass is introduced.
