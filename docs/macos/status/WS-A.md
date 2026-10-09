# WS-A status: Native Capture

> Updated by the WS-A agent after every task. The orchestrator reads this at each checkpoint.

**Current:** A1 done, A2/A3 next · **Sprint:** 1 · **Last commit:** WS-A: A1 FLPermissions

## Done

- A1 FLPermissions: `status` / `request` / `openSettings` / `relaunch` (`Native/Capture/FLPermissions.swift` + `.m`), plus `FLCaptureLog` (public `Logger` helper, see Deviations).

## Acceptance checklist

### Sprint 1
- [x] Permissions show the right status. After granting + `relaunch()`, screen shows `granted`.
  - Before: `{"screen":"notDetermined","camera":"notDetermined"}`. `request('screen')` and `request('camera')` were each called once; the human granted both. `relaunch()` (via `__FL.NativeModules.FLPermissions.relaunch()`) started a new instance and quit the old one (one process afterwards); the new instance reports `{"screen":"granted","camera":"granted"}`.
- [ ] With Safari in front: `appName: "Safari"` and the page title. With Preview: the PDF name.
- [ ] `capture` returns a JPEG ~1280 px wide in < 300 ms (warm), with no Focusline windows in the image.
- [ ] No files are created during capture.

### Sprint 2
- [ ] Sitting in front of the camera → `personPresent:true`. Leaving the frame → false within 2 s.
- [ ] Phone held up in view → `phoneVisible:true` within 2 s; phone down → false.
- [ ] CPU stays reasonable at 1 fps (Activity Monitor < 15% on the M4 Pro).
- [ ] Repeated start/stop doesn't crash, and the camera light turns off after `stop()`.

## Deviations from the plan

- **Native logging:** `NSLog` lines appear as `<private>` in `log show`, so Capture code logs through `FLCaptureLog.log(...)` (an `os.Logger`, subsystem `com.focusline.app`, category `capture`, public interpolation, `notice` level). Lines still start with `[FLxxx]`, so `log show --last 3m --style compact --predicate 'process == "Focusline" AND eventMessage CONTAINS "[FL"'` finds them. Only sizes/counts/timings are logged. (Note for CLAUDE.md: the same `<private>` problem applies to every agent using `NSLog`.)
- `relaunch()` rejection code is `E_NOT_RUNNING` (no better code in the list); `openSettings` failure is `E_INVALID_ARG`.

## Requests to the orchestrator

- (none yet)

## Notes for integration

- Harness runners (Metro 8082): `node scripts/js-eval.mjs 8082 "__FL.harness.A()"` (full suite), `"__FL.harness['A.perm']()"`.
- Permissions on the demo Mac are granted for `com.focusline.app` (Screen Recording + Camera) as of 15:15.
