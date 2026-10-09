# WS-A status: Native Capture

> Updated by the WS-A agent after every task. The orchestrator reads this at each checkpoint.

**Current:** A1–A9 done (A10 skipped, cut item 2); remaining acceptance items need a human in front of the camera · **Sprint:** Integration · **Last commit:** WS-A: A8+A9 webcam robustness + capturePhoto

## Done

- A1 FLPermissions: `status` / `request` / `openSettings` / `relaunch` (`Native/Capture/FLPermissions.swift` + `.m`), plus `FLCaptureLog` (public `Logger` helper, see Deviations).
- A2 `FLScreenCapture.getActiveWindow()`: `NSWorkspace.frontmostApplication` + first named layer-0 window of that pid from `CGWindowListCopyWindowInfo`. Native 0.3 ms avg / 2.6 ms max (50 runs), JS round trip 0.5 ms avg.
- A3 `FLScreenCapture.capture()`: ScreenCaptureKit `SCScreenshotManager.captureImage`, main display, own app excluded, no cursor, in-memory JPEG (ImageIO) → base64. 1280×831, ~250 KB, cold 81 ms, warm ~25 ms.
- A4 `src/dev/HarnessA.tsx`: buttons for permissions (status/request/settings/relaunch), active window ×10 over 10 s, Capture (320 px preview, cleared on next press), webcam start/stop + live readout, 5× start/stop. Calls the real facades (`src/native/{screen,permissions,webcam}`) directly and shows a warning while `USE_MOCK_NATIVE` is true. Headless runners registered: `A`, `A.perm`, `A.window10`, `A.capture`, `A.webcam`, `A.webcamCycle` (results carry sizes/counts/timings only).
- A5 `FLWebcam` (`RCTEventEmitter`, event `FLWebcamSample`): `AVCaptureSession` (VGA preset, built-in camera preferred), `AVCaptureVideoDataOutput` (BGRA, discards late frames) on a private serial queue, 1/fps gate (frames outside the gate are dropped at once), one `perform([...])` with `VNDetectHumanRectanglesRequest(upperBodyOnly)` + YOLO `VNCoreMLRequest`. `stop()` stops, detaches the delegate, removes inputs/outputs and releases the session (idempotent). Bridge `invalidate()` also tears the camera down. `capturePhoto()` is a stub that rejects `E_NOT_RUNNING` (A9, Phase 2).
- A6 YOLO: `FLWebcamModel` loads `yolo11n(configuration:)` (`computeUnits = .all`) once, on a background queue when `start()` is first called (≈1.2 s); frames before it's ready are presence-only. Labels checked: 80 COCO labels, `'cell phone'` at index 67 (full list logged once in Debug). The NMS pipeline's `iouThreshold`/`confidenceThreshold` inputs are supplied via `VNCoreMLModel.featureProvider` (0.6 / 0.2).
- A7 Harness webcam section (was built in A4): Start/Stop webcam with live readout (`present`, `phone`, `score`, samples/s over the last 5 s), 5× start/stop button; headless runners `A.webcam` (8 s summary), `A.webcamCycle`, and `A.webcamWatch` (20 s per-sample timeline `P/F/./f` + transition times, for the human checks below). Sample run: `{"timeline":"PPPPPPPPPPPPPPPPPPPP","samples":20,"perSec":1,"meanGapMs":994,"phoneCount":0}`.
- A8 Robustness:
  - Reject codes: `E_INVALID_ARG` (bad `maxWidth`/`jpegQuality`/`fps`/permission kind), `E_PERMISSION` (Screen Recording preflight false, `SCStreamError.userDeclined`, camera not authorized), `E_CAPTURE` (SCK/encode failure, no display), `E_CAMERA` (no camera, input/output failure, session didn't start, photo timeout).
  - Display changes: `SCShareableContent` is fetched on every capture and falls back to the first display if `CGMainDisplayID()` is gone.
  - `getActiveWindow` returns all-null + `isSelf:false` when there's no frontmost app.
  - Webcam: `AVCaptureSessionRuntimeError` (camera taken/unplugged) → up to 3 restarts 0.5 s apart, then the camera is released (JS just stops getting samples). Bridge reload (`invalidate`) releases the camera: verified, ControlCenter logged `[:]` 15 ms after the reload while the webcam was running.
- A9 `capturePhoto()` (Phase 2): one frame → in-memory JPEG (CoreImage, q 0.8) ≤ 1280 px wide. Camera idle: short-lived 720p session, skips 10 frames for exposure, 1.35 s, 1280×720, ~113 KB. While the 1 fps session runs: preset bumped to 720p, 5 frames skipped, 0.62 s, then the preset and analysis delegate are restored (3 samples arrived in the 2.5 s after). 4 s timeout → `E_CAMERA`. Camera released afterwards (ControlCenter `[:]`). Harness runner `A.photo` (sizes only).
- A10 (camera preview view): **skipped**, cut item 2 and it would need a new contract component.

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
- [~] Sitting in front of the camera → `personPresent:true`. Leaving the frame → false within 2 s.
  - `A.webcam` (8 s): `{"samples":8,"perSec":1,"meanGapMs":922,"presentCount":8,"phoneCount":0}`: present in 8/8 samples with the user at the desk. Start 416 ms (cold) / ~25 ms (warm); per-frame Vision + YOLO 14 ms (first frame 500 ms while YOLO warms up). **Human check for "leave → false within 2 s":** run `node scripts/js-eval.mjs 8082 "__FL.harness['A.webcamWatch']()"`, step out of frame after ~5 s and back after ~12 s; `changes[].atS` shows when `present` flipped. Or use Harness A → Start webcam and watch `present`.
- [ ] Phone held up in view → `phoneVisible:true` within 2 s; phone down → false. **Needs human:** run `A.webcamWatch`, hold a phone up (screen or back towards the camera) for ~5 s, then put it down; the timeline should show `F` then `P` again, and `maxPhoneScore` > 0.4. With no phone in view: `phoneCount 0`, `maxPhoneScore 0`.
- [x] CPU stays reasonable at 1 fps (Activity Monitor < 15% on the M4 Pro).
  - `top -pid` every 2 s: app idle 0–1.6 %; webcam at 1 fps 6.8–9.9 % (avg ≈ 8.6 %).
- [x] Repeated start/stop doesn't crash, and the camera light turns off after `stop()`.
  - `A.webcamCycle`: 5× (start, 1.5 s, stop, 0.3 s) + 2 extra stops → `{"ok":true,"cycles":5,"events":9,"errors":[]}`, process still alive. Start ~25 ms warm, stop 43–83 ms.
  - Camera released: after every stop, ControlCenter logs `Frame publisher cameras changed to [:]` (the camera-in-use indicator source) within ~25 ms (`log show --predicate 'process == "ControlCenter" AND eventMessage CONTAINS "Frame publisher cameras changed"'`).

## Deviations from the plan

- **Native logging:** `NSLog` lines appear as `<private>` in `log show`, so Capture code logs through `FLCaptureLog.log(...)` (an `os.Logger`, subsystem `com.focusline.app`, category `capture`, public interpolation, `notice` level). Lines still start with `[FLxxx]`, so `log show --last 3m --style compact --predicate 'process == "Focusline" AND eventMessage CONTAINS "[FL"'` finds them. Only sizes/counts/timings are logged. (Note for CLAUDE.md: the same `<private>` problem applies to every agent using `NSLog`.)
- **Camera choice:** `FLWebcam` prefers the built-in camera (`.builtInWideAngleCamera`) and only falls back to `AVCaptureDevice.default(for: .video)`. This Mac also exposes a Continuity Camera (iPhone); using the phone as the webcam would defeat phone detection.
- **Presence fallback:** besides `VNDetectHumanRectanglesRequest(upperBodyOnly)` > 0.5, a YOLO `person` detection > 0.5 also counts as present (helps when the upper-body detector misses at odd angles). Absence still needs both to miss.
- **YOLO crop:** `imageCropAndScaleOption = .scaleFit` (letterbox, matches YOLO training) rather than stretching 4:3 → 1:1.
- **JPEG encoding** uses ImageIO (`CGImageDestinationCreateWithData` into `NSMutableData`) instead of `NSBitmapImageRep`; still in memory only, encode ≈ 4 ms.
- `relaunch()` rejection code is `E_NOT_RUNNING` (no better code in the list); `openSettings` failure is `E_INVALID_ARG`.

## Requests to the orchestrator

- (none yet)

## Notes for integration

- Harness runners (Metro 8082): `node scripts/js-eval.mjs 8082 "__FL.harness.A()"` (full suite: permissions, active-window timing, 3 captures if screen is granted, 5 s webcam run if camera is granted). Single checks: `A.perm`, `A.window10` (10 samples, 1 s apart), `A.capture`, `A.webcam` (8 s), `A.webcamCycle` (5× start/stop).
- `FLScreenCapture.benchActiveWindow(n)` is an extra dev-only native method (not in the contract, not in the facade) used by the harness for native timing.
- `webcam.capturePhoto()` works (A9); the JS countdown is the caller's job. It returns `{jpegBase64, width, height}` and must be treated like a screenshot (memory only).
- If the camera fails mid-session (taken by another app/unplugged), samples simply stop. WS-C: a chunk with **zero** webcam samples should not be judged `away`.
- Error codes: invalid args → `E_INVALID_ARG` (checked: `capture({maxWidth:0})`, `request('nope')`); no Screen Recording → `E_PERMISSION` (preflight before any SCK call, so no surprise prompt); other SCK/encode failures → `E_CAPTURE`.
- Permissions on the demo Mac are granted for `com.focusline.app` (Screen Recording + Camera) as of 15:15.
