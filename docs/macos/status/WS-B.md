# WS-B status: Native Shell

> Updated by the WS-B agent after every task. The orchestrator reads this at each checkpoint.

**Current:** done: B1–B8 all acceptance items pass, plus B10 (partial polish). · **Sprint:** 2 done · **Last commit:** WS-B: notifications verified after permission grant

Environment check: app launches on Metro 8083; `node scripts/js-eval.mjs 8083 "__FL.pingRoundTrip()"` → `{"result":"pong","event":{...}}`.

**One-shot verification:** `node scripts/js-eval.mjs 8083 "__FL.harness.B()"` (~40 s) → panel / sound / shell / notifications `pass: true`. It leaves the panel hidden, sound off (speakers muted during the run), and hands focus back.

## Done

- B1 NotionColors: `Native/Shell/NotionColors.swift`: `Color(flHex:)` / `NSColor(flHex:)`, `FLNotionColors` base + tag tokens (`tag(name)` lookup), `FLNotionFonts` PostScript names, `typealias NotionColors = FLNotionColors` for WS-E.
- B2 FLFloatingPanel: `FLFloatingPanel.swift/.m` (RCTEventEmitter, `FLPanelAction`), `FLShellPanelController` (lazy main-thread singleton NSPanel, top-right of `visibleFrame` inset 16, remembers user drags for the run), `FLShellPanelState` (tolerant dict parsing: missing keys keep the previous value, `null` clears), `FLShellPanelModel` (ObservableObject; hover hub with 600 ms hide delay; flash once per change to `backOnTrack`; every control goes through `perform()` → `FLPanelAction`).
- B3 PanelView: `FLShellPanelView.swift`: compact view (Instrument Serif 44 timer via an aligned 1 s `TimelineView`, status pill, subtitle, Pomodoro dots + "Round x of y · m:ss left"), tint bg animated 0.3 s, pulse (0.6↔1 opacity, 1.2 s each way, plus a tinted border), flash overlay "Back on track ✓" 1.2 s, hover hub (Pomodoro toggle/skip/25-5/50-10, sound chips, custom volume slider, Pause/Resume, End, Open).
- B4 FLNotifications: `FLNotifications.swift/.m`: `requestPermission` (alert+sound), `post` (nil trigger, `.default` sound when asked), singleton `UNUserNotificationCenterDelegate` (`willPresent` → banner+sound+list; click → bring main window back).
- B5 HarnessB: buttons (show/hide, cycle 5 states, flash, notification post/permission/status, run-all), `FLPanelAction` log, headless runners.
- B6 FLSound: `FLShellSoundEngine.swift` + `FLSound.swift/.m`: one lazily started `AVAudioEngine`; white/pink (Paul Kellet)/brown `AVAudioSourceNode` voices (stereo-decorrelated, ARC-free render blocks), each into its own `AVAudioMixerNode`; 60 Hz `DispatchSourceTimer` equal-power crossfades; `'off'` fades out then pauses the engine; `setVolume`/`duck` retarget the active voice; rain/cafe use `FLShellRain.m4a`/`FLShellCafe.m4a` if bundled, else brown noise (none bundled); bell-like synthesized chimes (soft 660→880, phase 523→659→784, back 784→1046 Hz; 3 ms attack, exp decay) on a separate player node; engine restarts after audio-device changes.
- B7 FLAppShell: `FLAppShell.swift/.m`: `beginSessionActivity` holds a `[.userInitiated, .idleSystemSleepDisabled]` activity (idempotent; verified as the OS assertion `PreventUserIdleSystemSleep "Focus session"` in `pmset -g assertions`, removed on end); "Session" menu inserted before Window (⌘K Command Palette…, ⌘↩ Start Session, ⌘. End Session → `FLMenuCommand`; idempotent across reloads); `bringToFront` (unhide + activate + main window key).
- B8 Harness: sound chips, volume ±, duck 0.3/1, 3 chimes, sound state; app shell begin/end activity, bring-to-front, drift tests with results listed in the UI and the event log (menu commands logged too). Headless runners below.
- B10 (partial polish): Pomodoro countdown ring next to the timer (phase start inferred from `phaseEndsAtMs` changes), spring animation for the hover hub. Skipped: the hover cursor (cursor changes don't apply while Focusline is in the background) and B9 (needs contract fields).

Headless runners (`node scripts/js-eval.mjs 8083 "__FL.harness.<name>()"`): `B` (all quick checks), `Bpanel`, `Bnotif`, `BnotifRequest`, `Bsound`, `Bshell`, `BtimerStart`/`BtimerCheck` (≥ 60 s apart), `BdriftBaselineStart` (30 s), `BdriftStart` (2 min, activity), `BdriftControlStart` (2 min, no activity), `BdriftCheck`. Ad hoc: `globalThis.__FLB`.

## Acceptance checklist

Sprint 1 (`__FL.harness.Bpanel()` → `pass: true`, all 13 checks):
- [x] The panel floats above other apps, including a full-screen Safari window and every Space, and can be dragged.
  - Verified: visible, `level == .floating`, `canJoinAllSpaces` + `fullScreenAuxiliary`, non-activating, `hidesOnDeactivate == false`, `canHide == false`, occlusion visible, default top-right position; the drag handler moves the panel by exactly (dx, dy) and the position is kept across hide/show.
  - Not verifiable headlessly: the look over a full-screen Safari Space and a real mouse drag (see Requests: optional human glance).
- [x] Clicking hub buttons while another app is focused emits `FLPanelAction` **without** bringing Focusline to the front.
  - Synthesized mouse down/up events posted to the app's event queue (so hit testing + `acceptsFirstMouse` + SwiftUI `Button` are exercised) on all 10 hub controls while Focusline is inactive: each emitted exactly one correct action; `NSApp.isActive` stayed false after every click.
- [x] The timer keeps counting with no `update()` calls for 60 s, and is still correct afterwards.
  - `BtimerStart` → 65 s → `BtimerCheck`: 0 updates, rendered `01:05`, OCR of the live panel `01:05`, last render 31 ms old.
- [x] Tint changes animate; pulse and flash work.
  - Pixel samples of the live view: green→red passes through intermediate colours over ~300 ms; pulse varies the bg over time; flash visible (OCR "Back on track") then gone after 1.2 s; fires once per change to `backOnTrack`, again after `null` → `backOnTrack`.
- [x] A notification banner appears both while Focusline is in front and while it's in the background.
  - After the human allowed notifications: `__FL.harness.Bnotif()` → `pass: true`. Foreground (Focusline active): delivered and `willPresent` fired once for that id (→ banner + sound). Background (Focusline inactive): delivered by the system without `willPresent`. Note: the current System Settings style for Focusline is **Alerts** (stay on screen until dismissed); switch it to Banners if the persistent style is unwanted in the demo.

Sprint 2 (`__FL.harness.Bsound()` → `pass: true`, 8 checks; `__FL.harness.Bshell()` → `pass: true`, 4 checks). Sound checks run with the speakers muted (main mixer at 0) and meter each voice through taps:
- [x] All three noises play with no clicks or pops; switching crossfades over ~400 ms.
  - white/pink/brown plateau RMS 0.087 / 0.093 / 0.101 at volume 0.5 (balanced); crossfade envelopes reach 90 % / fall to 10 % in 350–550 ms (meter rows are ~100 ms); the largest per-tick gain step of any fade is 0.068 of its span (a pop would be 1.0).
- [x] Sound keeps playing when Focusline is in the background. (App inactive: engine running, brown RMS 0.096.)
- [x] `duck(0.3)` / `duck(1)` works; chimes are audible and pleasant.
  - Ducked/base RMS 0.29–0.30, restored 0.89–1.10. Three distinct chime bursts (peak RMS 0.12–0.14), max sample step ≤ 0.056 (click-free). "Pleasant" needs a human ear: Harness B › Sound (audible) › Chime soft/phase/back.
- [x] ⌘K / ⌘↩ / ⌘. emit `FLMenuCommand` while the main window is focused.
  - Synthesized ⌘-key events posted to the app with the main window key → exactly one `commandPalette` / `startSession` / `endSession` each.
- [x] While `beginSessionActivity()` is active, a JS `setInterval(1000)` stays on time with the app in the background for 2 minutes. Log the drift in HarnessB.
  - App hidden (`NSApp.hide`), activity on, 120 s: 0 gaps > 1.1 s, max gap 1076 ms, avg period 1047 ms; logged in Harness B › App shell and the event log.
  - Context: the 30 s foreground baseline averages 1001 ms. A 2 min control run **without** the activity gave avg 1058 / max 1101 ms, so App Nap didn't engage within 2 min in this dev setup; the extra ~50 ms/tick while hidden is RN's own timer path (repeating timers re-arm from the fire time and the display link slows while the window is hidden), not App Nap. Core logic should keep deriving time from timestamps (it does per the plan).

## Deviations from the plan

- The hex helper is `Color(flHex:)` (not `Color(hex:)`) so it can't collide with another file's extension in the shared app target. Type is `FLNotionColors`, with a `NotionColors` typealias.
- Panel window is **borderless** + `.nonactivatingPanel` (not `.titled + .fullSizeContentView`): no hidden titlebar strip stealing clicks from the hub's top row, and the 10 pt corner radius + hairline border are drawn exactly. `canBecomeKey`/`canBecomeMain` are false. `canHide = false` so ⌘H on Focusline hides the main window but keeps the timer.
- Hover uses an `NSTrackingArea` with `.activeAlways` (owner = small responder) instead of SwiftUI `.onHover`, so the hub works while Focusline is in the background.
- Window drag: a SwiftUI `DragGesture` on non-control areas moves the panel using `NSEvent.mouseLocation` (`isMovableByWindowBackground = true` is also set as in the brief). The volume slider is SwiftUI-drawn (not `NSSlider`) so first-mouse drags always land.
- Compact timer is 44 pt (brief: 40) to fill the 300×170 card; the hub uses 4 rows (sound chips and the volume slider don't fit on one 300 pt row).
- Crossfades use equal-power curves (sin in / cos out) on the 60 Hz timer instead of linear ramps (no loudness dip mid-crossfade).
- `notifications.post` **resolves** even when the system refuses the notification (e.g. permission denied); the reason is logged. A denied permission must never break the session loop or spam LogBox. `sound.play` rejects only for an unknown id (`E_INVALID_ARG`); engine failures are logged, not thrown.
- Extra dev-only helpers: `panelDebug`, `notificationsDebug`, `soundDebug`, `appShellDebug` (exported next to the facades in `src/native/{panel,notifications,sound,appShell}.ts`) call `debug*` methods on the Swift modules. They are not part of the contract and the app doesn't use them.

## Requests to the orchestrator

- Done: notifications were allowed by the human and verified (`Bnotif` pass). Optional: set the Focusline notification style to Banners (currently Alerts).
- **NEEDS HUMAN (optional, 1 min):** Harness B › Show, then put Safari in full screen and check the timer floats over it; drag it; hover it; click a sound chip; Harness B › Sound (audible) › chimes to judge "pleasant".
- FYI for all agents: on this macOS, `NSLog` text appears as `<private>` in `log show`. WS-B logs through `os.Logger` with `privacy: .public` (`flShellLog`, subsystem `com.focusline.app`, category `shell`): `/usr/bin/log show --last 5m --style compact --predicate 'subsystem == "com.focusline.app"'`. zsh has a `log` builtin, so call `/usr/bin/log`.
- FYI: with `USE_MOCK_NATIVE = true`, WS-D's `native.appShell.onMenuCommand` subscribes to the mock, so ⌘K/⌘↩/⌘. reach only Harness B's listener until the flag flips (the native menu exists either way).

## Notes for integration

- Panel: call `panel.update(state)` whenever the state changes (it's cheap); the panel ticks its own clock and Pomodoro countdown from `timer.runningSinceMs` / `pomodoro.phaseEndsAtMs`. `flash` only needs to be set to `'backOnTrack'` (set it back to `null` in a later update so the next recovery flashes again). Pill text is derived natively: studying → "Studying · {title}", distracted → "Distracted · {subtitle}", break → "Break · m:ss left" (or "Long break"), away/paused fixed; `subtitle` shows as a muted line (except for distracted, and except when it equals the "Round x of y" footer).
- Hub actions arrive as `FLPanelAction` exactly per the contract (`volume` is throttled to ≥ 0.02 steps while dragging, plus the final value). Preset chips have no selected state (`PanelState` doesn't carry the preset).
- A bridge reload (Metro reload) hides the panel (`invalidate`).
- Sound: `play(id)` is safe to call repeatedly (same id → no-op retarget); `duck(0.3)` on breaks and `duck(1)` after; chimes are independent of the noise volume (fixed level). Rain/cafe currently = brown noise (cut item 1: drop CC0 `FLShellRain.m4a` / `FLShellCafe.m4a` into `Native/Shell/` to enable loops).
- App shell: `beginSessionActivity`/`endSessionActivity` are idempotent. The Session menu is installed at bridge start (module is eagerly created on main).
- Harness B runners leave the panel hidden and the sound off. `Bshell` briefly activates Focusline (⌘-key test needs the main window key) and then hands focus back; the drift runners hide Focusline for 2 min and unhide it without activating.
