# WS-A: Native Capture (Swift)

**Mission:** give JS fast, privacy-safe access to what's on screen, which app is in front, and whether a person (and a phone) is in front of the camera. All frames stay in memory and are released straight after use.

**Metro port:** 8082 (`scripts/run-mac.sh 8082`). If the port override fails (see ORCHESTRATOR.md §2e), use build-only checks:

```bash
xcodebuild -workspace macos/Focusline.xcworkspace -scheme Focusline-macOS build
```

## You own

- `larpless/macos/Focusline-macOS/Native/Capture/**` (Swift, `.m` extern files, `Models/`)
- `larpless/src/native/screen.ts`, `permissions.ts`, `webcam.ts` (Phase 0 wrote them; you fix them as needed)
- `larpless/src/dev/HarnessA.tsx` (your manual test screen; Phase 0 `App.tsx` has a "Harness A" tab)
- `docs/macos/status/WS-A.md`

Contracts: `ScreenCaptureApi`, `PermissionsApi` and `WebcamApi` in [CONTRACTS.md §2](../CONTRACTS.md). Swift/JS conventions: CONTRACTS.md §7.

## Tasks (in order)

### Sprint 1 (2:50–3:30)

**A1. `FLPermissions`** (`Native/Capture/FLPermissions.swift` + `.m`):
- `status()`:
  - `screen` comes from `CGPreflightScreenCaptureAccess()`. It returns `granted` or `notDetermined`; macOS doesn't expose `denied`, so treat false as `notDetermined`.
  - `camera` comes from `AVCaptureDevice.authorizationStatus(for: .video)`.
- `request('screen')` calls `CGRequestScreenCaptureAccess()` and resolves with the new preflight value. `request('camera')` calls `AVCaptureDevice.requestAccess`.
- `openSettings(kind)` opens one of these URLs:
  - `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`
  - `…?Privacy_Camera`
- `relaunch()`: `NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: cfg)` with `cfg.createsNewApplicationInstance = true`, then `NSApp.terminate(nil)` on the main thread.

**A2. `FLScreenCapture.getActiveWindow()`:**
- `NSWorkspace.shared.frontmostApplication` → `localizedName`, `bundleIdentifier`, and `isSelf = app.processIdentifier == ProcessInfo.processInfo.processIdentifier`.
- Title: walk `CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)`. Take the first entry with `kCGWindowOwnerPID == pid` and `kCGWindowLayer == 0`, then read its `kCGWindowName`.
- Without Screen Recording the title is nil. Return `NSNull()`.
- Must take under 5 ms. No image work.

**A3. `FLScreenCapture.capture({maxWidth, jpegQuality})`:**
- Run inside `Task {}`:
  1. `let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)`
  2. `display = content.displays.first { $0.displayID == CGMainDisplayID() }`
  3. Exclude our app: `content.applications.filter { $0.processID == getpid() }`
  4. `SCContentFilter(display:, excludingApplications:, exceptingWindows: [])`
- `SCStreamConfiguration`:
  - `width = min(maxWidth, display.width)`, `height` scaled to keep the aspect ratio
  - `showsCursor = false`
  - `capturesAudio = false`
- `let cg = try await SCScreenshotManager.captureImage(contentFilter:configuration:)`
- Encode: `NSBitmapImageRep(cgImage: cg).representation(using: .jpeg, properties: [.compressionFactor: jpegQuality])` → `base64EncodedString()`.
- Resolve `ScreenSnapshot`, including the same fields as `getActiveWindow()`.
- **Privacy:** never write a file. Keep no references in properties. Don't log image data (sizes and milliseconds only).
- Errors:
  - Permission errors (`SCStreamError.userDeclined`, or preflight false) → reject `E_PERMISSION`.
  - Anything else → reject `E_CAPTURE`.

**A4. `HarnessA.tsx`:**
- Buttons:
  - Permissions status / request / open settings / relaunch.
  - "Active window ×10 over 10 s", printing app and title.
  - "Capture": prints width×height, base64 length and time taken, and shows the image in a 320-px `<Image source={{uri: 'data:image/jpeg;base64,…'}}>`. Dev only; clear it on the next press.
- Uses the facades from `src/native` (not the mocks; check `config.USE_MOCK_NATIVE` and show a warning if it's true).

**Sprint 1 acceptance:**
- [ ] Permissions show the right status. After granting + `relaunch()`, screen shows `granted`.
- [ ] With Safari in front: `appName: "Safari"` and the page title. With Preview: the PDF name.
- [ ] `capture` returns a JPEG ~1280 px wide in < 300 ms (warm), with no LarpLess windows in the image.
- [ ] No files are created during capture. Check with `sudo fs_usage -w -f filesys <pid> | grep -i -E 'jpe?g|png|tmp'` for 30 s, or a `find` with `-newer`.

### Sprint 2 (3:30–4:00)

**A5. `FLWebcam`** (`RCTEventEmitter`, event `FLWebcamSample`):
- `start({fps})`:
  - Check the camera permission (reject `E_PERMISSION`).
  - `AVCaptureSession` with `sessionPreset = .vga640x480` and the default video device.
  - `AVCaptureVideoDataOutput` with `alwaysDiscardsLateVideoFrames = true` and the sample buffer delegate on a private serial queue.
  - Run `startRunning()` off the main thread.
- **Gate:** process a frame only if `now - lastProcessed >= 1/fps`. Drop all other frames at once.
- **Per processed frame**, using `VNImageRequestHandler(cvPixelBuffer:orientation:.up)`:
  - `VNDetectHumanRectanglesRequest` with `upperBodyOnly = true` → `personPresent = results.contains { $0.confidence > 0.5 }`.
  - The YOLO `VNCoreMLRequest` (A6) → the best `VNRecognizedObjectObservation` whose top label is `"cell phone"` → `phoneScore`, with `phoneVisible = phoneScore > 0.4`.
  - Run both in one `perform([...])` call.
- `sendEvent("FLWebcamSample", {t, personPresent, phoneVisible, phoneScore})`, only if `hasListeners`.
- `stop()`: `stopRunning()`, remove the output, release the session.
- Never keep a `CVPixelBuffer` past the delegate callback.

**A6. YOLO model:**
- **Already done in Phase 0:** `Native/Capture/Models/yolo11n.mlpackage` (YOLO11n, `nms=True`, 640 px, COCO labels) is in place. Xcode compiles it to `yolo11n.mlmodelc` and generates the Swift class `yolo11n`. Don't re-export it.
- Load it once, lazily: `VNCoreMLModel(for: yolo11n(configuration: MLModelConfiguration()).model)`, with `computeUnits = .all`.
- If loading fails → log once and set `phoneVisible:false` (presence keeps working). Note it in your status file.
- Check the class labels: COCO calls it `"cell phone"`. Print the model's labels once in debug.

**A7. Harness:** a webcam section with start/stop and a live readout (`present`, `phone`, `score`, samples per second).

**Sprint 2 acceptance:**
- [ ] Sitting in front of the camera → `personPresent:true`. Leaving the frame → false within 2 s.
- [ ] Phone held up in view → `phoneVisible:true` within 2 s; phone down → false.
- [ ] CPU stays reasonable at 1 fps (Activity Monitor < 15% on the M4 Pro).
- [ ] Repeated start/stop doesn't crash, and the camera light turns off after `stop()`.

### Integration / stretch (after 4:00)

- **A8. Robustness:**
  - Capture or permission errors give clear reject codes.
  - Handle display changes (the main display gets unplugged).
  - `getActiveWindow` handles a nil frontmost app.
- **A9.** `capturePhoto()` (Phase 2): grab the next frame after a 3-second countdown is handled in JS, then JPEG base64 at 1280 px. Never written to disk.
- **A10 (stretch, cut item 2).** `FLCameraPreview` legacy view manager (an `NSView` with an `AVCaptureVideoPreviewLayer`, rounded 8-pt corners) that shares the same session.
  - Only if the interop layer renders legacy view managers on this RN version. Otherwise skip it.
  - It's a new component, so add a request in your status file to have the contract updated.

## Gotchas

- **Screen Recording** permission only takes effect after a relaunch. Under ad-hoc signing it resets on every build: if prompts keep coming back, tell the orchestrator (the signing team must be set).
- `SCShareableContent` itself throws when permission is missing. Map that error to `E_PERMISSION`.
- Don't use the deprecated `CGWindowListCreateImage`.
- Use Swift 5 mode. Mark the delegate class `@unchecked Sendable` if Xcode complains, rather than restructuring.
- Window titles of some apps are empty strings. Return `NSNull()` for empty strings too.
