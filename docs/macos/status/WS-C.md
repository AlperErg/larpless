# WS-C status: Core logic

> Updated by the WS-C agent after every task. The orchestrator reads this at each checkpoint.

**Current:** C5 classifier · **Sprint:** 1 · **Last commit:** C4 rules

## Done

- C1 `src/core/prompt.ts`: `SYSTEM`, `buildSchema`, `buildUserText`, `buildMessages`, `parseVerdict` (type-only imports; Node 26 imports it directly).
- C2 `src/core/ollama.ts`: `createOllama({baseUrl, model, fetchImpl, timeoutMs})` → `checkHealth()` (ok | down | modelMissing, `:latest`-tolerant) and `classify(snapshot, modules)` (never throws; null on timeout/HTTP/parse error; logs latency + verdict only). `baseUrl`/`model` may be getters so Settings changes apply live.
- C3 `scripts/bench-classifier.ts` + prompt tuning. Results below. `ollama.classify` now sends the empty-think assistant prefill (as benched) and parses the reply with `extractJson` (Ollama stops enforcing `format` once a prefill is present). Synthetic images in `focusline/bench/` deleted.

- C4 `src/core/rules.ts`: `DISTRACTION_RULES` (14 rules, word-boundary regexes so "netflix.com" is not "x.com" and "mainstream" is not "steam"; also matches `youtube.com/shorts`) and `matchDistraction(appName, windowTitle)`.
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
- [ ] The classifier takes a screenshot **only** on the VLM path (asserted in tests).

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
