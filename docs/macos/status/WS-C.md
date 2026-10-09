# WS-C status: Core logic

> Updated by the WS-C agent after every task. The orchestrator reads this at each checkpoint.

**Current:** C12 sessionController · **Sprint:** 2 · **Last commit:** C11 db

## Done

- C1 `src/core/prompt.ts`: `SYSTEM`, `buildSchema`, `buildUserText`, `buildMessages`, `parseVerdict` (type-only imports; Node 26 imports it directly).
- C2 `src/core/ollama.ts`: `createOllama({baseUrl, model, fetchImpl, timeoutMs})` → `checkHealth()` (ok | down | modelMissing, `:latest`-tolerant) and `classify(snapshot, modules)` (never throws; null on timeout/HTTP/parse error; logs latency + verdict only). `baseUrl`/`model` may be getters so Settings changes apply live.
- C3 `scripts/bench-classifier.ts` + prompt tuning. Results below. `ollama.classify` now sends the empty-think assistant prefill (as benched) and parses the reply with `extractJson` (Ollama stops enforcing `format` once a prefill is present). Synthetic images in `focusline/bench/` deleted.
- C4 `src/core/rules.ts`: `DISTRACTION_RULES` (14 rules, word-boundary regexes so "netflix.com" is not "x.com" and "mainstream" is not "steam"; also matches `youtube.com/shorts`) and `matchDistraction(appName, windowTitle)`.
- C5 `src/core/classifier.ts`: `createClassifier({native, ollama, now, config})` → `classifyCurrent(modules, ctx?)` returns `{verdict, tookScreenshot, appName, error?}` (isSelf → previous verdict as `cache`; rules; cache keyed on app+title within `CACHE_TTL_MS`, never with a null title; single-flight VLM). Extra `error: permission|capture|busy|vlm` so the controller can post the one-time permission notification. `reset()` per session. Mock classifier still goes through `capture` (so the privacy counter behaves the same) but derives the verdict from the title (name/keyword/stem match) instead of Ollama.
- C6 `src/core/chunkFuser.ts` (+ `src/core/ids.ts`): `fuseChunk(...)`, order away → phone → unknown → distracted → subject; zero samples = presence unknown (skips away/phone, covers the camera dying mid-session per WS-A); deterministic chunk ids `chk_<session>_<nnn>`; `awayStats`/`phoneStats` exported for the controller (away is decided before the screenshot).
- C7 `src/core/focus.ts`: `computeSummary(session, chunks, modules, pomodoros, totalS?, endedAt?)`, `focusPct`, `breakdown` (module order, then an "Other module" bucket for deleted modules, then Distracted), `streak(sessions, today)` (local start day, ≥ 900 s, ending today or yesterday), `heatmap(sessions, today, weeks=12)` (weeks×7 days, oldest first). Matches the fixture summary numbers.
- C8 tests (`__tests__/core/`): rules, prompt (parseVerdict), ollama (mocked fetch only: ok body incl. prefill, code fences, timeout with and without signal support, bad JSON/HTTP/network, health), classifier (every path; screenshot only on the VLM path; single flight; capture errors; privacy: no image data logged), chunkFuser (every rule, 10- and 30-sample thresholds, zero samples), focus (pct, breakdown, fixture parity, streak across midnight, heatmap length). 62 tests green.
- C9 `src/core/pomodoro.ts`: `initPomodoro`, `tick` (drift-free from `phaseEndsAtMs`, catches up after sleep, event spans the jump), `skip` (skipped focus is not counted as completed), `toggle(state|null, now, fallbackPreset)` (disable keeps counters; enable starts a fresh focus), `remainingMs`/`resumeWith` for pause. Presets 25/5/15, 50/10 (no long break), demo 2/1/1; long break after round 4, then round 1.
- C10 `src/core/alerts.ts`: `evaluate(prev, chunk, settings, now, modules?)` → `{next, effects}`. `AlertState` adds `lastSubjectName` (the store keeps only `{level, distractedSinceMs}`). Effects: tint / notify (with `level`) / chime / pulse / flash. Away/unknown chunks shift `distractedSinceMs` forward, so their time is not counted towards the next level. Copy: "You've been on {activity|your phone} for {n min|n s}" / "Back to {subject}?" (falls back to "Back to studying?"). Seconds are shown under a minute, so demoFast doesn't say "0 min". Chimes only when `soundsEnabled`.
- C11 `src/core/db.ts`: `createDb(kv)` with load/save modules, `loadSettings` (merged over `DEFAULT_SETTINGS`, corrupt → defaults)/`saveSettings`, `listSessions` (newest first)/`saveSession` (upsert), `appendChunk`/`getChunks`/`updateChunk(chunk)`. Read-modify-write ops are serialised. Chunks are whitelisted to the `Chunk` fields before writing. `createMemoryKv()` for tests.

## C3 bench results (synthetic screenshots, 4b only; 8b/gemma4 skipped to save memory)

10 synthetic 1440×900 mock-ups rendered with headless Chrome (Biology slides, Maths problem set, Maths YouTube lecture, Maths code editor, History essay notes; Instagram feed, YouTube music, shopping, chat, online game), downscaled to 1280 px JPEG q70, with window titles.

| model | prefill | accuracy | p50 | p90 |
|---|---|---|---|---|
| qwen3-vl:4b | empty `<think>` assistant prefill | **10/10** | **3.2 s** | **3.3 s** |

- Without the prefill Qwen3-VL ignores `think:false` and reasons first (2–30 s per call). `think:false` + `format` + `images` are accepted by Ollama 0.30.7 (no error), but `think:false` has no effect on Qwen3-VL; the prefill is what makes it fast.
- One correct "Not study" reply came back with confidence 0.00 (the model read confidence as "probability of studying"). The SYSTEM prompt now says confidence is certainty in the chosen label, not the probability of studying. **This wording change was not re-benched**: the orchestrator later allowed one 4b re-run, but the command (`node scripts/bench-classifier.ts --model qwen3-vl:4b`) was blocked by the session's permission classifier, so it was not run.
- **Decision: `qwen3-vl:4b`** (the default). qwen3-vl:8b is not used anywhere in this project.
- To re-run: `node scripts/bench-classifier.ts --model qwen3-vl:4b --clean` (regenerates the synthetic images if `bench/` is empty, deletes them with `--clean`), then `ollama stop qwen3-vl:4b`.

## Acceptance checklist

### Sprint 1
- [x] `npm test` is green, and the bench results are in your status file.
- [x] Bench accuracy is ≥ 8/10 with the chosen model; latency is recorded. (10/10 synthetic, 4b; before the confidence-wording tweak)
- [x] The classifier takes a screenshot **only** on the VLM path (asserted in tests).

### Sprint 2
- [ ] `npm test` is green.
- [ ] A full session (start → chunks → alert → break → end → summary) passes against the mock native APIs in tests.
- [ ] `framesAnalysed` doesn't increase during breaks or on rule/cache paths (asserted).

## Deviations from the plan

- `parseVerdict` also accepts a JSON string, and treats a module subject with `studying:false` as not studying (moduleId null). An unknown subject (not in the enum) returns null → `unknown` chunk.

## Requests to the orchestrator

- (none yet)

## Notes for integration

- (filled in as tasks land)
