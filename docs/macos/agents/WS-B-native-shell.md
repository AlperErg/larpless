# WS-B: Native Shell (Swift)

**Mission:** build the parts of LarpLess that live outside the main window:
- the always-on-top floating timer with its hover hub
- system notifications
- ambient sound and chimes
- App Nap prevention and menu commands

**Metro port:** 8083 (`scripts/run-mac.sh 8083`). If the port override fails, use build-only checks (`xcodebuild … build`).

## You own

- `larpless/macos/Focusline-macOS/Native/Shell/**` (Swift, SwiftUI, `.m` extern files, `Sounds/`)
- `larpless/src/native/panel.ts`, `notifications.ts`, `sound.ts`, `appShell.ts`
- `larpless/src/dev/HarnessB.tsx`
- `docs/macos/status/WS-B.md`

Contracts: `FloatingPanelApi`, `PanelState`, `PanelAction`, `NotificationsApi`, `SoundApi` and `AppShellApi` in [CONTRACTS.md §2](../CONTRACTS.md). Colours and fonts: CONTRACTS.md §9.

## Look of the panel (Notion-flavoured)

**Compact view** (default, 300×170):
- Left: a large serif timer, `Font.custom("InstrumentSerif-Regular", size: 40)`, `h:mm:ss` (or `mm:ss` under 1 h).
- Under the timer: a status pill, i.e. a tag-coloured capsule with a dot and text: "Studying · Biology", "Distracted · Instagram", "Away", "Break · 4:12 left", "Paused".
- Bottom: Pomodoro phase dots (filled = completed rounds, ring = current), only when `pomodoro != nil`.
- Whole background: the tint's tag `bg` colour (green, red, gray or blue), animated over 300 ms. Hairline border `#E9E9E7`, corner radius 10.
- `pulse == true` → the background opacity breathes (0.6 ↔ 1, 1.2 s).
- `flash == "backOnTrack"` → a green overlay reading "Back on track ✓" for 1.2 s.

**Hover hub** (`.onHover`; hides 600 ms after the mouse leaves) slides up over the timer within the same window:
- Row 1: play/pause Pomodoro, skip phase, preset chips `25/5` and `50/10`.
- Row 2: sound chips Off / White / Pink / Brown / Rain / Cafe (Notion tags, the selected one filled) + a volume slider.
- Row 3: Pause/Resume, End (red text), and "Open" (→ `openMain`).

## Tasks (in order)

### Sprint 1 (2:50–3:30)

**B1. `NotionColors.swift`:** a `Color(hex:)` helper plus the tag bg/text pairs and base tokens from CONTRACTS.md §9, as static constants.

**B2. `FLFloatingPanel`** (`RCTEventEmitter`, event `FLPanelAction`):

`FloatingPanelController` (singleton) creates the panel lazily on the main thread:

```swift
let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 300, height: 170),
                    styleMask: [.nonactivatingPanel, .titled, .fullSizeContentView],
                    backing: .buffered, defer: false)
panel.level = .floating
panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
panel.hidesOnDeactivate = false
panel.isMovableByWindowBackground = true
panel.titleVisibility = .hidden
panel.titlebarAppearsTransparent = true
[.closeButton, .miniaturizeButton, .zoomButton].forEach { panel.standardWindowButton($0)?.isHidden = true }
panel.becomesKeyOnlyIfNeeded = true
```

- **Position:** the top-right of `NSScreen.main!.visibleFrame`, inset by 16 pt. Remember a user drag for the rest of the run.
- **Content:** a `FirstMouseHostingView<PanelView>` subclass of `NSHostingView` with `override func acceptsFirstMouse(for:) -> Bool { true }`. This makes buttons work without activating the app.
- **`PanelModel: ObservableObject`** holds `@Published var state: PanelStateSwift`.
  - `update(_ dict: NSDictionary)` parses the dict (tolerate missing keys) and assigns on main.
  - `show()` / `hide()` call `orderFrontRegardless()` / `orderOut(nil)`.
- **Timer:** `TimelineView(.periodic(from: .now, by: 1))` computes the elapsed time from `timer.baseS` / `timer.runningSinceMs`. The Pomodoro countdown is computed the same way from `phaseEndsAtMs`. **No JS ticks needed.**
- **Actions:** buttons call `FLFloatingPanel.shared?.emit(["type": "pause"])` etc. Emit only if `hasListeners`.

**B3. `PanelView.swift`:** the compact view and hover hub described above. Use `withAnimation(.easeOut(duration: 0.2))` for the hub and `.animation(.easeInOut(duration: 0.3), value: tint)` for the background.

**B4. `FLNotifications`:**
- `requestPermission()` → `UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])`.
- `post({id, title, body, sound})` → `UNMutableNotificationContent`, with `.default` sound if `sound` is true and a nil trigger.
- Set a `UNUserNotificationCenterDelegate` (a singleton kept alive) whose `willPresent` returns `[.banner, .sound]`, so banners show while LarpLess is in front.

**B5. `HarnessB.tsx`:**
- Buttons:
  - Show/Hide panel.
  - Cycle states (studying green → distracted red with pulse → away gray → break blue with Pomodoro → paused).
  - `flash` back on track.
  - Post a notification.
- A log of the received `FLPanelAction` events.

**Sprint 1 acceptance:**
- [ ] The panel floats above other apps, including a full-screen Safari window and every Space, and can be dragged.
- [ ] Clicking hub buttons while another app is focused emits `FLPanelAction` **without** bringing LarpLess to the front.
- [ ] The timer keeps counting with no `update()` calls for 60 s, and is still correct afterwards.
- [ ] Tint changes animate; pulse and flash work.
- [ ] A notification banner appears both while LarpLess is in front and while it's in the background.

### Sprint 2 (3:30–4:00)

**B6. `FLSound`:**
- **Engine:** one `AVAudioEngine`, started lazily. Each noise colour is an `AVAudioSourceNode` with a render block generating float samples:
  - **white:** `Float.random(in: -1...1) * 0.3`
  - **pink:** the Paul Kellet filter (b0…b6 state)
  - **brown:** `last = (last + 0.02 * white) / 1.02; out = last * 3.5`
- Each source goes into its own `AVAudioMixerNode` (per-source gain), then into `mainMixerNode`.
- **Crossfade:** `play(id, fadeMs)` ramps the old source's gain to 0 and the new one to the volume. Use a 60 Hz `DispatchSourceTimer`, because mixer volume can't be ramped natively. `'off'` fades everything out, then pauses the engine.
- **Rain/cafe (cut item 1):** if `Sounds/rain.m4a` / `cafe.m4a` exist (CC0, < 1 MB), use `AVAudioPlayerNode` with a looping buffer. If not, fall back to brown noise.
- `setVolume(v)` and `duck(factor, fadeMs)` multiply the target gain.
- `chime(kind)`: a synthesized two-tone sine blip through a separate player node:
  - `soft`: 660 → 880 Hz, 120 ms each
  - `phase`: 523 → 659 → 784 Hz
  - `back`: 784 → 1046 Hz
  - Use an exponential decay envelope.

**B7. `FLAppShell`** (`RCTEventEmitter`, event `FLMenuCommand`):
- `beginSessionActivity()` keeps the token from `ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .idleSystemSleepDisabled], reason: "Focus session")`. `endSessionActivity()` calls `endActivity`.
- On init (main thread), insert a **"Session"** menu into `NSApp.mainMenu`:
  - "Command Palette…" ⌘K → `commandPalette`
  - "Start Session" ⌘↩ → `startSession`
  - "End Session" ⌘. → `endSession`
- `bringToFront()`: `NSApp.activate(ignoringOtherApps: true)` + `NSApp.windows.first { !($0 is NSPanel) }?.makeKeyAndOrderFront(nil)`.

**B8. Harness:** sound chips + volume + duck + the 3 chimes, plus a log of `FLMenuCommand` events.

**Sprint 2 acceptance:**
- [ ] All three noises play with no clicks or pops; switching crossfades over ~400 ms.
- [ ] Sound keeps playing when LarpLess is in the background.
- [ ] `duck(0.3)` / `duck(1)` works; chimes are audible and pleasant.
- [ ] ⌘K / ⌘↩ / ⌘. emit `FLMenuCommand` while the main window is focused.
- [ ] While `beginSessionActivity()` is active, a JS `setInterval(1000)` stays on time with the app in the background for 2 minutes. Log the drift in HarnessB.

### Integration / stretch (after 4:00)

- **B9 (cut item 3).** Hub "Expand" button → `panel.setFrame` to 360×420 with today's breakdown. This needs extra `PanelState` fields: request them first and skip if no time.
- **B10.** Polish: hover hub slide and spring, a Pomodoro ring countdown, a hover cursor (`.onHover { NSCursor.pointingHand.push() }`).
- **Phase 2:** the story card native renderer (`FLStoryCard`) belongs to WS-E, under `Native/Social/`. Don't build it here.

## Gotchas

- Do all AppKit/SwiftUI work on main. `RCT_EXTERN_METHOD` calls come in on a module queue: use `DispatchQueue.main.async`.
- Return `requiresMainQueueSetup() -> true` only for modules that touch AppKit in `init` (`FLAppShell`).
- Keep strong references to the panel, controller and notification delegate in static singletons, or they get deallocated.
- Fonts come from the app bundle (`ATSApplicationFontsPath`). If `Font.custom` falls back to the system font, check the PostScript names in CONTRACTS.md §9.
- Our own windows (including the panel) are excluded from screen capture by WS-A's filter. Nothing to do here.
