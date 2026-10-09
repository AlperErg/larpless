# WS-D status: UI

> Updated by the WS-D agent after every task. The orchestrator reads this at each checkpoint.

**Current:** Sprint 1 + Sprint 2 done (D1–D11); stopped before integration/polish · **Sprint:** 2 · **Last commit:** see `git log --oneline ws/d-ui`

## Done

- D1 `src/ui/theme.ts`: light palette (+ `faint`, `active`, `accentHover`, `backdrop`, `code*`), 9 tag tones, heatmap greens, fonts (PostScript names verified with `mdls`), `space`, `radius`, `motion`, `layout`, `kindColor`. Tokens grouped under `schemes.light` so a `dark` set can slot in later.
- D2 primitives in `src/ui/components/`: Text (+ inline `Strong`/`Muted`), Tag, Button, Callout, ToggleList, BreakdownBar, SerifTimer, StatusDot, PrivacyBadge, Heatmap, PageHeader, EditableTable, Segmented, plus Switch and CodeBlock. `mac.ts` re-types View/Pressable/TextInput with the react-native-macos props (TS resolves core RN types, which lack them).
- D3 layout in `src/ui/layout/`: Sidebar (workspace header, ⌘K search row, nav items with hover/active, live session dot, Dev tools item, Ollama status line that re-checks on click), Page (scroll + full-width cover + centred 900 px column), AppLayout (200 ms fade + 8 px slide per route), ErrorBoundary per page.
- D4 Session page (`src/ui/pages/SessionPage.tsx`): header with subject-coloured cover (cross-fades), start time + Pomodoro chip; rolling SerifTimer; status line with pulsing dot; "Last check" callout ticking every second; live BreakdownBar + legend; webcam / sound (click cycles) / privacy row; Pause/Resume, End, Skip break; red alert callout at level ≥ 2; idle and ended states.
- App.tsx: boot routing (load → onboarding/home), status-driven routing, native menu commands, Dev tools page (fixture switcher, palette button, nav shortcuts, store snapshot, HarnessA/B) kept mounted on every route like the Phase 0 shell.
- D5 Onboarding: progress line + 3 steps. Modules table pre-filled with "Biology / green / cell, mitosis" (≥1 valid module to continue → `saveModules`); permissions checklist (Screen Recording with relaunch note + Relaunch button, Camera, Notifications) polling `permissions.status()` every 2 s; Ollama card (green ready / red with copyable `open -a Ollama` + `ollama pull <model>` and Retry → `refreshOllama`); Finish → `updateSettings({onboarded:true})` → Home. Dev-only "Skip onboarding" link.
- D6 Home: greeting, big Start (⌥-click → `start({pomodoro, demo:true})`), Pomodoro preset chips (→ `settings.pomodoroDefault`), live-session callout, no-modules callout, 🔥 streak + week total, 12-week heatmap, recent sessions toggle list (date · duration · focus % · mini bar → "Open summary").
- D7 Summary: date + time range, serif stats (duration, focus %, pomodoros), breakdown + legend, privacy badge, "Timeline (N checks)" toggle with per-chunk rows (time, label tag, activity, app · source); expanding shows relabel chips → `relabelChunk`, with an optimistic overlay so the bar and focus % update instantly. Opens `params.sessionId` (from Home/History, chunks via `getChunks`) or `lastSummary`.
- D8 History: total, per-subject totals (Tag + hours), heatmap, sessions grouped by week (Mon–Sun) with week totals.
- D9 Modules: same EditableTable with debounced (600 ms) autosave + save on blur/colour/delete, duplicate-name warning, empty state.
- D10 Settings: model + Ollama URL inputs (commit on blur/enter), Ollama status + Retry, strictness 2/5/10, Pomodoro default, Demo fast / Webcam / Sounds switches, default sound chips, 10-step volume bar with −/+ (also `setVolume` when a session is live), Developer → Dev tools / re-run onboarding.
- D11 ⌘K palette: overlay (560 px, top 20%, dimmed backdrop, scale-in), autofocused input, substring filter, grouped commands (Start / Start demo / Pause / Resume / Skip break / End, Go to Home/Session/History/Modules/Settings/last summary/Dev tools, Toggle demo fast mode), ↑/↓/↵/Esc via `keyDownEvents` + `onKeyDown` on the TextInput (verified supported by Fabric's RCTTextInputComponentView), Esc on the card, backdrop click closes.

## Acceptance checklist

Sprint 1
- [x] The app shows the sidebar and the Session page. The Dev tools fixture switcher toggles idle / running / distracted / break / summary, and the Session page reacts. (Verified in the running app with `__FL.ui.fixture(x)` + `__FL.ui.text('page-session')`; Jest `__tests__/ui/session.test.tsx`.)
- [x] The timer rolls smoothly, the breakdown bar springs when the fixture changes, and the status dot pulses. (Timer label ticks 0:17:23 → 0:17:25 and committed digit offsets follow the label; segment widths spring 53.3% → 75% on running → distracted. Pulse loop runs on the native driver; can't be seen headlessly.)
- [x] `grep -rn "#[0-9A-Fa-f]\{3,8\}" src/ui | grep -v theme.ts` is empty.
- [x] No overflow / render errors for session + dev routes × running/distracted/break at 900×600, 1440×900 and the native 1100×720 (`__FL.ui.viewport(w,h)` + `__FL.ui.overflow()`).

Sprint 2
- [~] With an empty store, the full onboarding → Home → Start (mocks) → Session → End → Summary → relabel → Home flow works. **UI side done, real E2E blocked on WS-C** (store actions are still no-ops in this branch). Verified: (a) Jest `pages.test.tsx` runs the whole flow with stand-in actions (saveModules/updateSettings/start/end/relabelChunk) and asserts each route + the relabel updating the bar (Distracted 11% → 9%); (b) in the running app, onboarding → Home works with `__FL.ui.type/press`, and relabel on the summary fixture updates the bar/focus %.
- [x] Every page renders in every fixture state with no layout breakage at 900×600 and 1440×900. In the running app: 8 routes × 5 fixtures × {900×600, 1440×900, native 1100×720} = 120 combinations, 0 views overflowing horizontally, 0 caught render errors, no console warnings. Also Jest renders every route × fixture at both sizes. (Overflow check is horizontal-only; text clipping isn't detectable headlessly.)
- [~] The palette opens from the ⌘K menu item (in mock mode, also from a Dev tools button). Dev tools button ✓ and sidebar "Search ⌘K" row ✓ (app + Jest); filter/run/close verified in the app; ↑/↓/↵/Esc handler logic verified in Jest. The menu item path (`native.appShell.onMenuCommand('commandPalette')`) is wired but the mock never emits, so it needs WS-B's FLAppShell to verify. Real keyboard events can't be sent headlessly.

## Deviations from the plan

- **The app runs Fabric + bridgeless**, not the legacy bridge (`typeof nativeFabricUIManager !== 'undefined'` → true, `RN$Bridgeless` → true). On Fabric, native-driven Animated values are **not** committed back to the shadow tree: after the page fade the committed props stayed at `opacity: 0, translateY: 8`, so any later re-commit would blank the page. All animations whose end state matters (page fade, timer roll, toggles, switch, cover cross-fade, breakdown springs) therefore use `useNativeDriver: false`; only the StatusDot pulse loop uses the native driver (its resting props are harmless).
- `Dimensions.get('window')` returns the **screen** size (1512×982) on react-native-macos, not the window. The root view's `onLayout` feeds `src/ui/lib/viewport.ts`, which the gutter logic and the overflow check use instead.
- Content gutter is 48 px, or 32 px when the window is narrower than 1000 px (the 900 px minimum leaves a 660 px content area).
- `lookModule` falls back to a readable name for ids like `mod_maths` when the module list is empty (the fixtures for running/distracted/break don't load modules into `useAppStore`), so the Session page still says "Studying Maths" (in gray) after a bare `__FL.applyFixture('running')`.
- Added Switch, CodeBlock and SessionRow components (Settings, Onboarding, Home/History), plus a `secondary` Button variant (bordered).
- Home, Settings and Summary keep a small local mirror of what they send to the store (Pomodoro preset, settings, relabels) so controls respond even while the store actions are no-ops; the store stays the source of truth once WS-C lands. Onboarding does not write store state directly; it only calls `saveModules`/`updateSettings`.
- The Summary timeline is one outer toggle "Timeline (N checks)" (open by default) containing a toggle row per chunk.

## Requests to the orchestrator

- After merging WS-C, please re-run the flow in the app (or I can at integration): onboarding → Home → Start → Session → End → Summary → relabel → Home. The UI expects `saveModules`/`updateSettings` to update the store state, `start` to set `status:'running'` (navigation follows status), `end` to set `status:'ended'` + `lastSummary`, and `relabelChunk` to update `chunks`/`lastSummary`.
- After merging WS-B, check ⌘K from the native menu opens the palette and ⌘↩ / ⌘. start/end (App.tsx subscribes to `native.appShell.onMenuCommand`).
- NEEDS HUMAN (optional): a visual pass of the pages; I verified text, layout frames and committed animation values headlessly but can't see the screen (fonts, emoji rendering, pulse loop).
- (optional) Make `applyFixture(name)` also set `useAppStore` `modules` (and `sessions`) for every fixture, not only `summary`, so bare `__FL.applyFixture('running')` shows subject names and colours. Workaround in place: `__FL.ui.fixture(name)` and the Dev tools buttons do this.
- FYI for PLAN.md §2 / CLAUDE.md: the app is on Fabric + bridgeless, not the legacy bridge (see Deviations); WS-A/WS-B may want to know for their legacy-style modules (they work through the interop layer).

## Notes for integration

Headless UI introspection (dev only, installed on `__FL.ui` by `src/ui/pages/DevToolsPage.tsx`):

```bash
node scripts/js-eval.mjs 8081 "__FL.ui.state()"                 # route, status, counts, render errors
node scripts/js-eval.mjs 8081 "__FL.ui.fixture('running')"      # fixture + fixture modules/history
node scripts/js-eval.mjs 8081 "__FL.ui.go('history')"
node scripts/js-eval.mjs 8081 "__FL.ui.text('page-session')"    # visible text under a testID
node scripts/js-eval.mjs 8081 "__FL.ui.label('session-timer')"  # h:mm:ss
node scripts/js-eval.mjs 8081 "__FL.ui.viewport(900, 600)"      # pin the root size; no args resets
node scripts/js-eval.mjs 8081 "__FL.ui.overflow()"              # views sticking out horizontally
node scripts/js-eval.mjs 8081 "__FL.ui.palette(true)"
node scripts/js-eval.mjs 8081 "__FL.ui.press('start-session', true)"   # onPress of a testID (true = ⌥)
node scripts/js-eval.mjs 8081 "__FL.ui.type('module-name', 'Maths', 0)"
node scripts/js-eval.mjs 8081 "__FL.ui.style('content')"           # committed style of a host view
```

Useful testIDs: `page-<route>`, `nav-<route>`, `nav-search`, `start-session`, `end-session`, `pause-resume`, `session-timer`, `session-status`, `last-check`, `session-breakdown`, `segment-<key>`, `privacy-badge`, `summary-stats`, `summary-breakdown`, `toggle-<chunkId>`, `relabel-<chunkId>-<moduleId|distracted|away>`, `summary-done`, `onboarding-next`, `onboarding-finish`, `palette`, `palette-input`, `palette-cmd-<id>`, `dev-open-palette`, `fixture-<name>`, `settings-*`.

- After a Fast Refresh `__FL.ui` can be stale; do a full reload (`__FL.NativeModules.DevSettings.reload()`).
- Dev tools (HarnessA/B) stays mounted, hidden, on every route (including onboarding) so `registerHarness` runs at launch, as in Phase 0.
- The UI only reads `useSessionStore` / `useAppStore` and calls their actions; navigation follows `status` (idle/ended → running|paused|break ⇒ session, → ended ⇒ summary).
