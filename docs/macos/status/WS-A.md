# WS-A status: Native Capture

> Updated by the WS-A agent after every task. The orchestrator reads this at each checkpoint.

**Current:** A1–A3 done, A4 next · **Sprint:** 1 · **Last commit:** WS-A: A2+A3 FLScreenCapture

## Done

- A1 FLPermissions: `status` / `request` / `openSettings` / `relaunch` (`Native/Capture/FLPermissions.swift` + `.m`), plus `FLCaptureLog` (public `Logger` helper, see Deviations).
- A2 `FLScreenCapture.getActiveWindow()`: `NSWorkspace.frontmostApplication` + first named layer-0 window of that pid from `CGWindowListCopyWindowInfo`. Native 0.3 ms avg / 2.6 ms max (50 runs), JS round trip 0.5 ms avg.
- A3 `FLScreenCapture.capture()`: ScreenCaptureKit `SCScreenshotManager.captureImage`, main display, own app excluded, no cursor, in-memory JPEG (ImageIO) → base64. 1280×831, ~250 KB, cold 81 ms, warm ~25 ms.

## Acceptance checklist

### Sprint 1
- [x] Permissions show the right status. After granting + `relaunch()`, screen shows `granted`.
  - Before: `{"screen":"notDetermined","camera":"notDetermined"}`. `request('screen')` and `request('camera')` were each called once; the human granted both. `relaunch()` (via `__FL.NativeModules.FLPermissions.relaunch()`) started a new instance and quit the old one (one process afterwards); the new instance reports `{"screen":"granted","camera":"granted"}`.
- [~] With Safari in front: `appName: "Safari"` and the page title. With Preview: the PDF name.
  - Verified generically: with the Claude app in front → `{"appName":"Claude","bundleId":"com.anthropic.claudefordesktop","title":"Claude","isSelf":false}`; titles are read once Screen Recording is granted. I did not steal focus to bring Safari/Preview forward on the shared machine. **Human check:** run `node scripts/js-eval.mjs 8082 "__FL.harness['A.window10']()"` and switch to Safari, then Preview, during the 10 s.
- [x] `capture` returns a JPEG ~1280 px wide in < 300 ms (warm), with no Focusline windows in the image.
  - 1280×831 (display 1512×982 pt), ~250 KB JPEG at q 0.7. Native: cold 80 ms (content 16 + shot 61 + encode 4), warm 24–25 ms. JS round trip warm ~25 ms.
  - Own app excluded: the native log shows `excludedApps=1` (Focusline's `SCRunningApplication` found and passed to `SCContentFilter(display:excludingApplications:)`). I can't view the image headlessly (and must not write it to disk), so a visual check of the preview in Harness A → Capture is left to the human.
- [x] No files are created during capture.
  - `touch marker` → 9 captures → `find ~/Library -newer marker -type f | grep -iE 'focusline|\.jpe?g$|\.heic$'` empty; `find` on Caches/Containers/Application Support/HTTPStorages/Group Containers/`$TMPDIR`/`/tmp`/`/private/var/tmp` for `focusline|jpe?g|png|heic` empty; `lsof -p <pid>` shows no image/tmp files open for writing. (`sudo fs_usage` not available headlessly.)

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
