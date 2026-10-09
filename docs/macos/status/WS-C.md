# WS-C status: Core logic

> Updated by the WS-C agent after every task. The orchestrator reads this at each checkpoint.

**Current:** C2 ollama client · **Sprint:** 1 · **Last commit:** C1 prompt

## Done

- C1 `src/core/prompt.ts`: `SYSTEM`, `buildSchema`, `buildUserText`, `buildMessages`, `parseVerdict` (type-only imports; Node 26 imports it directly).

## Acceptance checklist

### Sprint 1
- [ ] `npm test` is green, and the bench results are in your status file.
- [ ] Bench accuracy is ≥ 8/10 with the chosen model; latency is recorded.
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
