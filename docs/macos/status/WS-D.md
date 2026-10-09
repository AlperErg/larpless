# WS-D status: UI

> Updated by the WS-D agent after every task. The orchestrator reads this at each checkpoint.

**Current:** Sprint 1 done (D1–D4), starting Sprint 2 · **Sprint:** 1 · **Last commit:** see `git log --oneline ws/d-ui`

## Done

- D1 `src/ui/theme.ts`: light palette (+ `faint`, `active`, `accentHover`, `backdrop`, `code*`), 9 tag tones, heatmap greens, fonts (PostScript names verified with `mdls`), `space`, `radius`, `motion`, `layout`, `kindColor`. Tokens grouped under `schemes.light` so a `dark` set can slot in later.
- D2 primitives in `src/ui/components/`: Text (+ inline `Strong`/`Muted`), Tag, Button, Callout, ToggleList, BreakdownBar, SerifTimer, StatusDot, PrivacyBadge, Heatmap, PageHeader, EditableTable, Segmented, plus Switch and CodeBlock. `mac.ts` re-types View/Pressable/TextInput with the react-native-macos props (TS resolves core RN types, which lack them).
- D3 layout in `src/ui/layout/`: Sidebar (workspace header, ⌘K search row, nav items with hover/active, live session dot, Dev tools item, Ollama status line that re-checks on click), Page (scroll + full-width cover + centred 900 px column), AppLayout (200 ms fade + 8 px slide per route), ErrorBoundary per page.
- D4 Session page (`src/ui/pages/SessionPage.tsx`): header with subject-coloured cover (cross-fades), start time + Pomodoro chip; rolling SerifTimer; status line with pulsing dot; "Last check" callout ticking every second; live BreakdownBar + legend; webcam / sound (click cycles) / privacy row; Pause/Resume, End, Skip break; red alert callout at level ≥ 2; idle and ended states.
- App.tsx: boot routing (load → onboarding/home), status-driven routing, native menu commands, Dev tools page (fixture switcher, palette button, nav shortcuts, store snapshot, HarnessA/B) kept mounted on every route like the Phase 0 shell. Sprint 2 pages are stubs for now.

## Acceptance checklist

Sprint 1
- [x] The app shows the sidebar and the Session page. The Dev tools fixture switcher toggles idle / running / distracted / break / summary, and the Session page reacts. (Verified in the running app with `__FL.ui.fixture(x)` + `__FL.ui.text('page-session')`; Jest `__tests__/ui/session.test.tsx`.)
- [x] The timer rolls smoothly, the breakdown bar springs when the fixture changes, and the status dot pulses. (Timer label ticks 0:17:23 → 0:17:25 and committed digit offsets follow the label; segment widths spring 53.3% → 75% on running → distracted. Pulse loop runs on the native driver; can't be seen headlessly.)
- [x] `grep -rn "#[0-9A-Fa-f]\{3,8\}" src/ui | grep -v theme.ts` is empty.
- [x] No overflow / render errors for session + dev routes × running/distracted/break at 900×600, 1440×900 and the native 1100×720 (`__FL.ui.viewport(w,h)` + `__FL.ui.overflow()`).

Sprint 2
- [ ] With an empty store, the full onboarding → Home → Start (mocks) → Session → End → Summary → relabel → Home flow works.
- [ ] Every page renders in every fixture state with no layout breakage at 900×600 and 1440×900.
- [ ] The palette opens from the ⌘K menu item (in mock mode, also from a Dev tools button).

## Deviations from the plan

- **The app runs Fabric + bridgeless**, not the legacy bridge (`typeof nativeFabricUIManager !== 'undefined'` → true, `RN$Bridgeless` → true). On Fabric, native-driven Animated values are **not** committed back to the shadow tree: after the page fade the committed props stayed at `opacity: 0, translateY: 8`, so any later re-commit would blank the page. All animations whose end state matters (page fade, timer roll, toggles, switch, cover cross-fade, breakdown springs) therefore use `useNativeDriver: false`; only the StatusDot pulse loop uses the native driver (its resting props are harmless).
- `Dimensions.get('window')` returns the **screen** size (1512×982) on react-native-macos, not the window. The root view's `onLayout` feeds `src/ui/lib/viewport.ts`, which the gutter logic and the overflow check use instead.
- Content gutter is 48 px, or 32 px when the window is narrower than 1000 px (the 900 px minimum leaves a 660 px content area).
- `lookModule` falls back to a readable name for ids like `mod_maths` when the module list is empty (the fixtures for running/distracted/break don't load modules into `useAppStore`), so the Session page still says "Studying Maths" (in gray) after a bare `__FL.applyFixture('running')`.
- Added Switch and CodeBlock primitives (needed by Settings and Onboarding), plus a `secondary` Button variant (bordered).

## Requests to the orchestrator

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
```

- After a Fast Refresh `__FL.ui` can be stale; do a full reload (`__FL.NativeModules.DevSettings.reload()`).
- Dev tools (HarnessA/B) stays mounted, hidden, on every route (including onboarding) so `registerHarness` runs at launch, as in Phase 0.
- The UI only reads `useSessionStore` / `useAppStore` and calls their actions; navigation follows `status` (idle/ended → running|paused|break ⇒ session, → ended ⇒ summary).
