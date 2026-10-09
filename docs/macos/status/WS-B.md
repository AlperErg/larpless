# WS-B status: Native Shell

> Updated by the WS-B agent after every task. The orchestrator reads this at each checkpoint.

**Current:** Sprint 2 (B6 FLSound) · **Sprint:** 2 · **Last commit:** WS-B: B2-B5 floating panel, PanelView, notifications, HarnessB

Environment check: app launches on Metro 8083; `node scripts/js-eval.mjs 8083 "__FL.pingRoundTrip()"` → `{"result":"pong","event":{...}}`.

## Done

- B1 NotionColors: `Native/Shell/NotionColors.swift`: `Color(flHex:)` / `NSColor(flHex:)`, `FLNotionColors` base + tag tokens (`tag(name)` lookup), `FLNotionFonts` PostScript names, `typealias NotionColors = FLNotionColors` for WS-E.
- B2 FLFloatingPanel: `FLFloatingPanel.swift/.m` (RCTEventEmitter, `FLPanelAction`), `FLShellPanelController` (lazy main-thread singleton NSPanel, top-right of `visibleFrame` inset 16, remembers user drags for the run), `FLShellPanelState` (tolerant dict parsing: missing keys keep the previous value, `null` clears), `FLShellPanelModel` (ObservableObject; hover hub with 600 ms hide delay; flash once per change to `backOnTrack`; every control goes through `perform()` → `FLPanelAction`).
- B3 PanelView: `FLShellPanelView.swift`: compact view (Instrument Serif 44 timer via an aligned 1 s `TimelineView`, status pill, subtitle, Pomodoro dots + "Round x of y · m:ss left"), tint bg animated 0.3 s, pulse (0.6↔1 opacity, 1.2 s each way, plus a tinted border), flash overlay "Back on track ✓" 1.2 s, hover hub (Pomodoro toggle/skip/25-5/50-10, sound chips, custom volume slider, Pause/Resume, End, Open).
- B4 FLNotifications: `FLNotifications.swift/.m`: `requestPermission` (alert+sound), `post` (nil trigger, `.default` sound when asked), singleton `UNUserNotificationCenterDelegate` (`willPresent` → banner+sound+list; click → bring main window back).
- B5 HarnessB: buttons (show/hide, cycle 5 states, flash, notification post/permission/status, run-all), `FLPanelAction` log, headless runners `B`, `Bpanel`, `Bnotif`, `BnotifRequest`, `BtimerStart`/`BtimerCheck`.

## Acceptance checklist

Sprint 1 (verified headlessly via `__FL.harness.Bpanel()` → `pass: true`, all 13 checks):
- [x] The panel floats above other apps, including a full-screen Safari window and every Space, and can be dragged.
  - Verified: visible, `level == .floating`, `canJoinAllSpaces` + `fullScreenAuxiliary`, non-activating, `hidesOnDeactivate == false`, `canHide == false`, occlusion visible, default top-right position; drag handler moves the panel by exactly (dx, dy) and the position is kept across hide/show.
  - Not verifiable headlessly: the actual look over a full-screen Safari Space and a real mouse drag (needs a human glance).
- [x] Clicking hub buttons while another app is focused emits `FLPanelAction` **without** bringing Focusline to the front.
  - Verified with synthesized mouse down/up events (posted to the app's event queue, so hit testing + `acceptsFirstMouse` + SwiftUI `Button` are exercised) on all 10 hub controls after `NSApp.deactivate()`: each emitted exactly one correct action; `NSApp.isActive` stayed false after every click.
- [x] The timer keeps counting with no `update()` calls for 60 s, and is still correct afterwards.
  - `BtimerStart` → 65 s → `BtimerCheck`: 0 updates, rendered `01:05`, OCR of the live panel `01:05`, last render 31 ms old.
- [x] Tint changes animate; pulse and flash work.
  - Background pixel samples of the live view: green→red passes through intermediate colours over ~300 ms; pulse varies the bg over time; flash visible (OCR "Back on track") then gone after 1.2 s, fires once per change to `backOnTrack` and again after `null` → `backOnTrack`.
- [ ] A notification banner appears both while Focusline is in front and while it's in the background. **blocked: permission**
  - `requestPermission()` was called once; authorization is now `denied` (prompt dismissed or still pending). Code path verified: delegate installed, `post` accepted by the system (`deliveredIds` contains the id). `__FL.harness.Bnotif()` re-runs the foreground (willPresent) and background checks once allowed.

Sprint 2:
- [ ] All three noises play with no clicks or pops; switching crossfades over ~400 ms.
- [ ] Sound keeps playing when Focusline is in the background.
- [ ] `duck(0.3)` / `duck(1)` works; chimes are audible and pleasant.
- [ ] ⌘K / ⌘↩ / ⌘. emit `FLMenuCommand` while the main window is focused.
- [ ] While `beginSessionActivity()` is active, a JS `setInterval(1000)` stays on time with the app in the background for 2 minutes. Log the drift in HarnessB.

## Deviations from the plan

- The hex helper is `Color(flHex:)` (not `Color(hex:)`) so it can't collide with another file's extension in the shared app target. Type is `FLNotionColors`, with a `NotionColors` typealias.
- Panel window is **borderless** + `.nonactivatingPanel` (not `.titled + .fullSizeContentView`): no hidden titlebar strip stealing clicks from the hub's top row, and the 10 pt corner radius + hairline border are drawn exactly. `canBecomeKey`/`canBecomeMain` are false. `canHide = false` so ⌘H on Focusline hides the main window but keeps the timer.
- Hover uses an `NSTrackingArea` with `.activeAlways` (owner = small responder) instead of SwiftUI `.onHover`, so the hub works while Focusline is in the background.
- Window drag: a SwiftUI `DragGesture` on non-control areas moves the panel using `NSEvent.mouseLocation` (`isMovableByWindowBackground = true` is also set as in the brief). The volume slider is a SwiftUI-drawn slider (not `NSSlider`) so first-mouse drags always land.
- `notifications.post` **resolves** even when the system refuses the notification (e.g. permission denied); the reason is logged. A denied permission must never break the session loop or spam LogBox.
- Extra dev-only helpers: `panelDebug` (in `src/native/panel.ts`) and `notificationsDebug` (in `src/native/notifications.ts`) call `debug*` methods on the Swift modules. They are not part of the contract and the app doesn't use them.

## Requests to the orchestrator

- **NEEDS HUMAN: allow notifications for Focusline** (System Settings › Notifications › Focusline › Allow, banner style). Then run `node scripts/js-eval.mjs 8083 "__FL.harness.Bnotif()"` (or click "Run all (B)" in Harness B).
- **NEEDS HUMAN (30 s glance, optional):** show the panel (Harness B › Show), open Safari full screen, check the timer floats over it, drag it, hover it. Everything else was verified headlessly.
- FYI for all agents: on this macOS, `NSLog` text appears as `<private>` in `log show`. WS-B logs through `os.Logger` with `privacy: .public` (`flShellLog`, subsystem `com.focusline.app`, category `shell`): `/usr/bin/log show --last 5m --style compact --predicate 'subsystem == "com.focusline.app"'`. Also note zsh has a `log` builtin: call `/usr/bin/log`.

## Notes for integration

- Panel: call `panel.update(state)` whenever the state changes (it's cheap); the panel ticks its own clock and Pomodoro countdown from `timer.runningSinceMs` / `pomodoro.phaseEndsAtMs`. `flash` only needs to be set to `'backOnTrack'` (set it back to `null` in a later update so the next recovery flashes again). Pill text is derived natively: studying → "Studying · {title}", distracted → "Distracted · {subtitle}", break → "Break · m:ss left" (or "Long break"), away/paused fixed; `subtitle` shows as a muted line (except for distracted, and except when it equals the "Round x of y" footer).
- Hub actions arrive as `FLPanelAction` exactly per the contract (`volume` is throttled to ≥ 0.02 steps while dragging plus the final value).
- A bridge reload (Metro reload) hides the panel (`invalidate`).
- Harness B runners leave the panel hidden. `__FL.harness.Bpanel()` takes ~15 s.
