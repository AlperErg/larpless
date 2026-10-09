# WS-B status: Native Shell

> Updated by the WS-B agent after every task. The orchestrator reads this at each checkpoint.

**Current:** B2 FLFloatingPanel · **Sprint:** 1 · **Last commit:** WS-B: B1 NotionColors

Environment check: app launches on Metro 8083; `node scripts/js-eval.mjs 8083 "__FL.pingRoundTrip()"` → `{"result":"pong","event":{...}}`.

## Done

- B1 NotionColors: `Native/Shell/NotionColors.swift`: `Color(flHex:)` / `NSColor(flHex:)`, `FLNotionColors` base + tag tokens (`tag(name)` lookup), `FLNotionFonts` PostScript names, `typealias NotionColors = FLNotionColors` for WS-E.

## Acceptance checklist

Sprint 1:
- [ ] The panel floats above other apps, including a full-screen Safari window and every Space, and can be dragged.
- [ ] Clicking hub buttons while another app is focused emits `FLPanelAction` **without** bringing Focusline to the front.
- [ ] The timer keeps counting with no `update()` calls for 60 s, and is still correct afterwards.
- [ ] Tint changes animate; pulse and flash work.
- [ ] A notification banner appears both while Focusline is in front and while it's in the background.

Sprint 2:
- [ ] All three noises play with no clicks or pops; switching crossfades over ~400 ms.
- [ ] Sound keeps playing when Focusline is in the background.
- [ ] `duck(0.3)` / `duck(1)` works; chimes are audible and pleasant.
- [ ] ⌘K / ⌘↩ / ⌘. emit `FLMenuCommand` while the main window is focused.
- [ ] While `beginSessionActivity()` is active, a JS `setInterval(1000)` stays on time with the app in the background for 2 minutes. Log the drift in HarnessB.

## Deviations from the plan

- The hex helper is `Color(flHex:)` (not `Color(hex:)`) so it can't collide with another file's extension in the shared app target. Type is `FLNotionColors`, with a `NotionColors` typealias.

## Requests to the orchestrator

- (none yet)

## Notes for integration

- (filled in as tasks land)
