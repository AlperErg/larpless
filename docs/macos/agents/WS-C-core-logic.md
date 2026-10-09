# WS-C: Core logic (pure TypeScript + Jest)

**Mission:** own Focusline's brain: classification (rules → cache → Ollama VLM), chunk fusion, focus metrics, Pomodoro, alerts, persistence, and the session controller that wires the native facades to the store.

Everything you write in `src/core` is **pure TS** (no `react-native` imports) and covered by Jest with fake timers.

**No Metro needed.** Work with `npm test` and `npm run typecheck`. The orchestrator runs the app at checkpoints.

## You own

- `focusline/src/core/**`
- `focusline/src/store/sessionStore.ts` and `appStore.ts`: action implementations and wiring. Keep the state shape from CONTRACTS.md §3.
- `focusline/__tests__/core/**`
- `focusline/scripts/bench-classifier.ts`
- `docs/macos/status/WS-C.md`

Read: [PLAN.md §6–8](../PLAN.md) (runtime loop, classification, thresholds) and [CONTRACTS.md](../CONTRACTS.md) (all of it).

## Tasks (in order)

### Sprint 1 (2:50–3:30)

**C1. `src/core/prompt.ts`.** It may contain **only** `import type` imports, and no `enum` / `namespace` / parameter properties, so Node 26 can run it with type stripping.
- `buildSchema(moduleNames: string[])` → a JSON schema with `studying: boolean`, `subject: {type:'string', enum:[...moduleNames, 'Not study']}`, `activity: string`, `confidence: number`, all required.
- `buildMessages({appName, windowTitle, modules, imageBase64})` → `[{role:'system', content: SYSTEM}, {role:'user', content: <text>, images:[imageBase64]}]`.
- `parseVerdict(raw: unknown, modules)` → `ScreenVerdict | null`.
  - Map `subject` to the module's `id` (exact match, then case-insensitive).
  - `"Not study"` → `studying:false, moduleId:null`.
  - Clamp `confidence` to 0..1. Truncate `activity` to 60 characters.
- `SYSTEM` (start from this, then tune with the bench):

  > You label what a student is doing on their Mac for a study tracker. You get a screenshot of the main display, the frontmost app name, and its window title. Decide whether the visible content is studying for one of the student's modules.
  > - Judge the content, not the app: a lecture on YouTube, slides in Preview, notes in Notion, a problem set in a browser or an IDE exercise all count as studying if they match a module.
  > - Social media, messaging, games, shopping, entertainment video and unrelated news are "Not study".
  > - Use the module keywords to pick the subject. If it's clearly study content but matches no module, pick the closest module and lower your confidence.
  > - The window title is a strong hint; if it conflicts with the screenshot, trust the screenshot.
  > - "activity": at most 6 words describing what is visible, e.g. "Reading cell division slides", "Scrolling Instagram feed".
  > - "confidence": 0 to 1.
  >
  > Reply with JSON only, matching the schema.

- User text:

  ```
  Frontmost app: ${appName ?? 'unknown'}
  Window title: ${windowTitle ?? 'unknown'}
  Modules:
  - ${name}: ${keywords.join(', ')}
  ```

**C2. `src/core/ollama.ts`:**
- `createOllama({ baseUrl, model, fetchImpl = fetch, timeoutMs })` returning:
  - `checkHealth()`: `GET /api/tags`, then check `models[].name` (match on name with or without a `:latest` tag). Returns `'ok' | 'down' | 'modelMissing'`.
  - `classify(snapshot, modules)`: `POST /api/chat` with:

    ```js
    {model, stream:false, think:false, keep_alive:'30m', options:{temperature:0}, format: buildSchema(...), messages: buildMessages(...)}
    ```

    - Parse `message.content` as JSON, then `parseVerdict`.
    - On a timeout (`AbortController`), HTTP error or parse error → return `null`. Never throw.
- **Privacy:** never log `snapshot` or the request body. Log only latency and the verdict.

**C3. `scripts/bench-classifier.ts`** (run with `node scripts/bench-classifier.ts --model qwen3-vl:4b`):
- Import `../src/core/prompt.ts` with the explicit `.ts` extension.
- Read `bench/*.png|jpg`. The expected label is the filename prefix before `__` (`notstudy` means "Not study").
- **If `bench/` is empty (no human screenshots yet), make 10 synthetic ones.** Never capture the real screen.
  - Write small local HTML mock-ups of: lecture slides (Biology), a PDF-style problem set (Maths), a history essay in a notes app, an Instagram-like feed, a YouTube lecture page, a YouTube music video, a shopping page, a chat app, a code editor, and an online game page.
  - Render each with headless Chrome:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --window-size=1440,900 --screenshot=bench/<label>__<desc>.png file:///abs/path.html
```

  - Mark the results "synthetic" in your status file.
- Model: `qwen3-vl:4b` only. Never use `qwen3-vl:8b` in this project (decided 2026-10-09). Run `ollama stop qwen3-vl:4b` after benching to free memory.
- Downscale first with the built-in `sips`, into a temp dir under `bench/.tmp/` (deleted at the end):

```bash
sips -s format jpeg -s formatOptions 70 --resampleWidth 1280 in --out out
```

- Fixture modules: Biology, Maths, History (as in `src/fixtures`).
- Print a table: file | expected | got | confidence | ms. Then accuracy and p50/p90 latency.
- Run it for `qwen3-vl:4b`.
- Write the results in `status/WS-C.md`. The model is fixed to `qwen3-vl:4b`.
- Tune `SYSTEM` until accuracy is ≥ 8/10, then **delete `bench/`** screenshots.
- Also confirm that `think:false` + `format` + `images` work together on Ollama 0.30.7. If `think` is rejected, drop it and note that.

**C4. `src/core/rules.ts`:**
- `matchDistraction(appName, windowTitle): { activity: string } | null`, using the list in PLAN.md §7. It's case-insensitive on `appName + ' ' + windowTitle`.
- `activity` is a nicely cased site name ("Instagram").
- Export `DISTRACTION_RULES` so Settings can show it later.

**C5. `src/core/classifier.ts`:**
- `createClassifier({ native, ollama, now, config })` → `classifyCurrent(modules, ctx): Promise<{ verdict: ScreenVerdict | null; tookScreenshot: boolean; appName: string | null }>`. It implements PLAN.md §6 steps 2–5:
  1. `isSelf` → the previous verdict.
  2. Rules.
  3. Cache: same app and title as the last VLM verdict, within `CACHE_TTL_MS`.
  4. Single-flight VLM call.
- **Release:** `let snap: ScreenSnapshot | null = await native.screen.capture(...)`, and in `finally { snap = null }`.
- `config.USE_MOCK_CLASSIFIER` → skip Ollama and derive the verdict from the window title: match a module keyword, else `studying:false`. The UI demo then works without Ollama.

**C6. `src/core/chunkFuser.ts`:**
- `fuseChunk({ sessionId, index, startedAt, durationS, samples: WebcamSample[], verdict, verdictSource, appName }): Chunk`, with the rules in PLAN.md §6/§8 in this order:
  1. away
  2. phone
  3. unknown
  4. distracted
  5. subject
- With no samples (webcam off), skip away/phone.
- `source`:
  - `webcam` for away and phone
  - the verdict's source otherwise
  - `none` for unknown

**C7. `src/core/focus.ts`:**
- `computeSummary(session, chunks, modules, pomodoros): SessionSummary`
- `focusPct(chunks)`
- `breakdown(chunks, modules)`: subjects in module order, then distracted. Percentages of subject + distracted.
- `streak(sessions, today)`: plan.md rule, a qualifying session has `totalS ≥ 900`.
- `heatmap(sessions, today, weeks = 12): { date: 'YYYY-MM-DD'; minutes: number }[]`
- Use `date-fns` for local-day bucketing.

**C8. Tests** (`__tests__/core/`): rules, prompt.parseVerdict, ollama (mocked fetch: ok, timeout, bad JSON), classifier (each path; screenshot taken only on a VLM call), chunkFuser (every rule plus edge counts with 10-sample demo chunks), focus (pct, breakdown, streak across midnight, heatmap length).

**Sprint 1 acceptance:**
- [ ] `npm test` is green, and the bench results are in your status file.
- [ ] Bench accuracy is ≥ 8/10 with the chosen model; latency is recorded.
- [ ] The classifier takes a screenshot **only** on the VLM path (asserted in tests).

### Sprint 2 (3:30–4:00)

**C9. `src/core/pomodoro.ts`** (a pure reducer):
- `initPomodoro(preset, now)`, and `tick(state, now): { state, event: null | { from: PomodoroPhase; to: PomodoroPhase } }`.
- Also `skip(state, now)` and `toggle`.
- Presets in PLAN.md §8. Always compute from `phaseEndsAtMs`; never count ticks.

**C10. `src/core/alerts.ts`** (pure):
- `evaluate(prev: AlertState, chunk: Chunk, settings, now): { next: AlertState; effects: AlertEffect[] }`.
- Effects are `{type:'tint', tint}`, `{type:'notify', title, body}`, `{type:'chime', kind}`, `{type:'pulse', on}` and `{type:'flash'}`.
- Levels and thresholds come from PLAN.md §8 (demoFast uses 20 s / 50 s).
- Notification copy: "You've been on {activity} for {n} min" / "Back to {lastSubjectName}?".
- `away` and `unknown` don't advance or reset the escalation. Breaks are never evaluated.

**C11. `src/core/db.ts`:**
- `createDb(kv: KeyValue)` with:
  - `loadModules`, `saveModules`
  - `loadSettings` (merged over `DEFAULT_SETTINGS`), `saveSettings`
  - `listSessions`, `saveSession`
  - `appendChunk`, `getChunks`, `updateChunk`
- Keys are in CONTRACTS.md §8. Chunks only, never images.

**C12. `src/core/sessionController.ts`:**
- Implement PLAN.md §6 exactly. `createSessionController({ native, db, store, getModules, getSettings, classifier, ollama, now })` returns the `SessionStoreActions` implementations.
- **Timers:** keep `setInterval` handles and clear all of them on end. Chunk boundaries are computed from `startedAt + n*chunkS`, so there's no drift.
- **Panel:** build `PanelState` with a pure function `toPanelState(storeState, modules)` (unit-tested), and push it only when it changes (shallow compare).
- **Panel actions:**
  - `pause`, `resume`, `end`, `pomodoroToggle`, `pomodoroSkip`, `pomodoroPreset`, `sound`, `volume` → the matching store actions.
  - `openMain` → `native.appShell.bringToFront()`.
- **Errors:**
  - `webcam.start` rejects → set `webcam.enabled = false` and carry on.
  - `capture` rejects with `E_PERMISSION` → the chunk is `unknown`, plus a one-time notification "Screen Recording permission needed".
- `refreshOllama()` runs `checkHealth`, then updates `store.ollama`.

**C13. Wire the stores:**
- `sessionStore.ts`: create the zustand store with the initial state from Phase 0, and replace the no-op actions with the controller.
- `appStore.ts`: `load()` reads the db through AsyncStorage (`@react-native-async-storage/async-storage`, injected here in the store layer, **not** in core).
- If there are no modules after `load()`, keep `settings.onboarded = false`.

**C14. `src/core/demoMode.ts`:**
- `startDemo()` replays `fixtureChunks` (imported from `src/fixtures/data.ts`, never `apply.ts`) through the **same** store updates, alerts and `panel.update()`: one chunk per 2 s, with the timer advancing 30 s per chunk.
- It never touches the screen or webcam.
- Triggered by `start({ pomodoro, demo: true })`. The UI passes `demo: true` on ⌥-click or when the Settings toggle is on.

**C15. Tests:** pomodoro (phase transitions, long break after 4), alerts (escalation and recovery, no alerts on break or away), db (round trip with a Map), sessionController (with mock native and fake timers):
- A 3-minute run produces 6 chunks.
- Pause stops chunks.
- A break stops capture.
- End saves a summary.

**Sprint 2 acceptance:**
- [ ] `npm test` is green.
- [ ] A full session (start → chunks → alert → break → end → summary) passes against the mock native APIs in tests.
- [ ] `framesAnalysed` doesn't increase during breaks or on rule/cache paths (asserted).

### Integration (after 4:00)

You're the integration partner. Fix wiring bugs found in the real end-to-end run, and tune the thresholds and the prompt live. If idle and the E2E run is green, take WS-E.

## Gotchas

- RN's `fetch` supports `AbortController` (`signal`).
- With large base64 bodies, build the body string once and don't keep it around.
- `Date.now()` should come through the injected `now`, so tests can control time.
- The zustand v5 API is `create<T>()((set, get) => ({...}))`.
