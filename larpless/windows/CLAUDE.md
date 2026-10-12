# CLAUDE.md — Windows build

Guidance for Claude Code when working on the Windows target. Read the root `CLAUDE.md` first; this file only covers what differs on Windows and what was learnt getting it running.

The Windows app is **react-native-windows 0.81.36** (cpp-app template: C++/WinRT, Fabric, bridgeless, WinAppSDK 1.8, prebuilt NuGet via `UseExperimentalNuget`). It runs the same TypeScript as the Mac app and implements the same JS ↔ native contract (`src/contracts/native.ts`): every Swift module has a C++ counterpart with the **same module name, methods, events, payloads and error codes**, so `src/native/*.ts` facades are shared. Never change the contract for Windows alone.

## Toolchain

- Visual Studio 2026 Community 18.x (toolset **v145**) with Desktop C++, WinUI app development (`Microsoft.VisualStudio.ComponentGroup.UWP.VC`), MSIX Packaging Tools and **Windows 11 SDK 10.0.22621**. Install with explicit `--add` workloads; a partial install leaves missing `WindowsXaml…Cpp.targets` / `DesktopBridge.props`.
- .NET SDK 10, Node 22+, Developer Mode on, long paths on.
- `larpless/dotnet-tools.json` pins **PowerShell 7** as a local .NET tool: the RNW deploy step needs `pwsh.exe` (`dotnet tool restore`).
- `larpless/Directory.Build.props` patches autolinked native modules (`ReactNativeAsyncStorage`, `RNSVG`): WinAppSDK false positive on AsyncStorage, v143 toolset override, and Composition desktop settings for RNSVG. After `npm ci`, `node scripts/patch-rnsvg-windows.mjs` pins RNSVG's SDK to 10.0.22621 (also run from `scripts/run-windows.ps1`).

## Commands

Run from `larpless/` (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run-windows.ps1     # stops old LarpLess, removes sideloaded AppX, Metro, patch RNSVG, build/deploy/launch
Get-Process LarpLess -EA SilentlyContinue | Stop-Process; npx @react-native-community/cli run-windows --no-packager --logging *> .logs\build-windows.log   # rebuild only
```

- Stop the running app before rebuilding. A first build takes several minutes; incremental ones about one.
- Debug builds set `UseDeveloperSupport(false)` so RNW does not paint its green Metro **Loading** bar (that is not `BootScreen`). Themed launch is `BootScreen.tsx` after JS loads. `LarpLess.cpp` also sets the Win32 window canvas to match `theme.ts` before React paints.
- Compile errors: the newest `windows\msbuild_*.err`. The build log written with `*>` is UTF-16 — read it with `Get-Content`.
- Relaunch the installed build without rebuilding: `Start-Process "shell:AppsFolder\$((Get-AppxPackage *LarpLess*).PackageFamilyName)!App"`.
- App icons (`LarpLess\LarpLess.ico`, `LarpLess.Package\Images\*.png`) are generated from `brand/larpless-logo.png`: `powershell -ExecutionPolicy Bypass -File scripts\make-windows-icons.ps1`. Windows caches tile/taskbar icons, so an updated logo may only show after unpinning/repinning or a sign-out.
- Packaged layout: exe at `windows\LarpLess.Package\bin\x64\Debug\AppX\LarpLess\LarpLess.exe`.
- Crashes: `Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000; StartTime=(Get-Date).AddHours(-1)} | ? Message -match LarpLess`.
- `scripts/js-eval.mjs` works as on the Mac (`__FL`). Exit code **9** with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` is a harmless libuv teardown assert (output is still valid); exit code **2** + "no debuggable app" means the app is not running (or crashed).
- Full JS reload: `node scripts/js-eval.mjs 8081 "__FL.NativeModules.DevSettings.reload()"`. Editing source files makes Metro hot-reload too; calls sent during a reload are lost.

## Native modules (`windows/LarpLess/Native/`)

Each module is **one header** (`REACT_MODULE` / `REACT_METHOD` / `REACT_EVENT` / `REACT_INIT` from Microsoft.ReactNative.Cxx), included in `LarpLess.cpp` (registered by `AddAttributedModules`) and listed as a `ClInclude` in `LarpLess.vcxproj`. Facades use `new NativeEventEmitter(M)`, so every module with events has `addListener` / `removeListeners` that keep a listener count, and events are emitted only while it is > 0.

| Module | Windows implementation | Deviation from Mac |
| --- | --- | --- |
| FLPing | smoke test | — |
| FLNotifications | toast XML (`Windows.UI.Notifications`), logo from `Assets\FLNotificationIcon.png`, silent unless `sound`; click brings the main window forward | — |
| FLAppShell | `PowerCreateRequest` + EcoQoS opt-out; `WH_KEYBOARD` thread hook for Ctrl+K / Ctrl+Enter / Ctrl+. → `FLMenuCommand` | Ctrl instead of ⌘ |
| FLScreenCapture | foreground window → pid → FileDescription; GDI StretchBlt of the primary screen → WIC JPEG in an `HGlobal` stream; own window hidden with `WDA_EXCLUDEFROMCAPTURE` during capture | `bundleId` is the exe name; Screen Recording is always `granted` |
| FLPermissions | camera via `AppCapability("webcam")`; `openSettings` → `ms-settings:privacy-webcam`; `relaunch` → `AppInstance::Restart` | no screen permission on Windows |
| FLSound | XAudio2 port of the Swift engine (xorshift white, Kellet pink, brown; equal-power ramps; chimes) | — |
| FLWebcam | MediaCapture + MediaFrameReader (BGRA), YOLO11n via ONNX Runtime | — (same `person` / `cell phone` thresholds as Mac) |
| FLFloatingPanel | layered `WS_EX_TOPMOST\|TOOLWINDOW\|NOACTIVATE` popup drawn with Direct2D (DC render target on a DIB + `UpdateLayeredWindow`) and DirectWrite with the bundled Inter + Instrument Serif | — (same size, states, hub and payloads) |

Closing the main window quits the app (Windows convention) instead of keeping it in the background.

### Gotchas (each one cost real debugging time)

- **`ReactContext::JSDispatcher()` is empty in bridgeless mode.** Posting to it silently drops work. Emit `REACT_EVENT`s directly; that is thread-safe. `UIDispatcher()` works.
- **No blocking `.get()` on WinRT async from the UI (STA) thread.** Run it on a `std::thread` with `winrt::init_apartment(mta)`.
- **WinAppSDK input doesn't update the thread key state**: use `GetAsyncKeyState`, not `GetKeyState`, in the keyboard hook.
- **Packaging assets**: only `<None Include="…"><DeploymentContent>true</DeploymentContent></None>` gets files into the package (`Content` / `CopyFileToFolders` don't). A single file lands next to the exe (`AppX\LarpLess\Assets`), but a **wildcard** item lands at the package root (`AppX\Assets`), so code that loads assets must check both (see `LoadFonts` in FLFloatingPanel).
- **Source encoding**: MSVC here has no `/utf-8`, so keep headers ASCII and write non-ASCII literals as `\uXXXX` (`L"·"`, MDL2 glyphs like `L""`).
- **`JSValue::AsString()` turns null into `"null"`**: use `TryGetString()`. Wrap string literals in `std::string{}` inside `JSValueObject` initializers.
- **`SetTimer` re-arms instead of queueing.** Re-arming a 16 ms animation timer on every `WM_MOUSEMOVE` means it never fires while the mouse moves (the panel hub used to appear only once the mouse stopped). Input paths call `Schedule(false)`, which leaves a running fast timer alone. Cache DirectWrite text formats and reuse one brush; creating them per frame is visibly slow.
- `winrt::com_ptr` has no `reset()`: assign `nullptr`.
- Link system libs from the header with `#pragma comment(lib, "…")` (gdi32, dwmapi, version, windowscodecs, d2d1, dwrite, Shcore, xaudio2).

### Panel debugging

The panel is excluded from screen capture. For screenshots call `__FL.NativeModules.FLFloatingPanel.debugSetCapturable(true)` (it is remembered until the window exists), then copy its rect from the screen. `debugInfo()` returns position, scale, fontsLoaded, hover and status. The panel is a remote control: buttons only emit `FLPanelAction`; nothing changes until `sessionController` answers with `update()`, so test controls inside a (demo) session.

## JS side

- `src/ui/platform.ts`: `IS_WINDOWS`, `MOD` (`Ctrl+` / `⌘`), `ALT`, `DEVICE` (`PC` / `Mac`), `ANIMATE`, `MotionView`. Every Windows difference in the UI goes through these; the Mac output must stay identical.
- **`Animated.View` loses its painted content after a re-render on RNW Fabric** (pages went blank after navigating). On Windows `ANIMATE` is false and `MotionView` is a plain `View` with static styles. Don't reintroduce `Animated.View` in shared UI without the guard.
- `src/ui/components/mac.ts` `handledKeys()` maps `{key}` (macOS) to RNW's `{code}` (`KeyK`, `Escape`, …).
- Fonts: RNW Fabric can't load bundled fonts yet, so `theme.ts` uses Segoe UI / Segoe UI Semibold / Georgia / Consolas on Windows. The floating panel draws its own text and keeps Inter + Instrument Serif.
- Jest runs as `ios`; `__tests__/ui/platform.test.ts` covers macos / ios / windows via `jest.replaceProperty(Platform, 'OS', …)`.

## Webcam model

Presence and phone both come from bundled YOLO11n (`Assets/Models/yolo11n.onnx`, NuGet `Microsoft.ML.OnnxRuntime` 1.22.1, CPU, one intra-op thread). Thresholds match the Mac CoreML model: NMS confidence 0.2 and IoU 0.6 (baked in at export), `person` > 0.5 means `personPresent`, best `cell phone` score is `phoneScore`, and > 0.4 means `phoneVisible`. No samples are emitted until the model has loaded, or at all if it fails to load.

Re-export (Python + ultralytics) and replace the file:

```bash
yolo export model=yolo11n.pt format=onnx nms=True imgsz=640 conf=0.2 iou=0.6
```

## Ollama on Windows (open issue)

Measured on the dev PC (Ryzen 5 7545U, Radeon 740M iGPU, 15 GB RAM), Ollama 0.40.2:

- Ollama runs **CPU only**: it drops the integrated GPU ("set `OLLAMA_IGPU_ENABLE=1`" in `%LOCALAPPDATA%\Ollama\server.log`) and ROCm has no kernels for gfx1103.
- `qwen3-vl:2b` processes the prompt at ~36 tokens/s; a 640 px screenshot + prompt is ~1,100 tokens ⇒ **≥ 30 s per check**. `qwen3-vl:4b` at 640 px timed out at 30 s. With the default 8 s `CLASSIFY_TIMEOUT_MS` every chunk becomes `unknown`. (On Apple silicon the same check is ~3 s.)
- Smaller screenshots + a longer limit alone don't fix it, so that change was **not** committed.
- Options still to decide: enable the iGPU (`OLLAMA_IGPU_ENABLE=1` user env var, restart Ollama, re-measure); window-title-only classification on Windows; or slow checks (≈90 s limit, 448 px, 2B model).
- The 4B model takes ~4.4 GB (`llama-server`); with other apps open, free RAM fell below 1 GB.

### Unresolved crash

LarpLess crashed twice in `hermes.dll` with `0xc0000005` at offset `0x1c59d0`, both while screenshot checks were timing out with the 4B model loaded and < 1 GB RAM free. A repro of "abort a fetch, the response arrives later" (local server answering after 5 s) did **not** crash, so that alone isn't the cause; memory pressure is the main suspect. Re-check once the classifier is fast enough not to time out.

### Benchmarking the classifier

Windows Defender (AMSI) blocks PowerShell scripts that capture the screen, base64 it and POST it, even to localhost. Don't try to evade it: benchmark with a **generated** test image (System.Drawing text on a bitmap, never a real screenshot) posted to `/api/chat` with the app's options (`think: false`, the empty `<think>` prefill, `num_ctx: 4096`), or measure through the app, where `[ollama] <model> <ms> → <verdict>` lines show up in `js-eval --console`.

## Tips for working from PowerShell

- `Get-Content -Raw` / `Set-Content` in Windows PowerShell 5.1 read BOM-less UTF-8 as ANSI and will mangle non-ASCII text. Edit with the Edit tool, or use `[IO.File]::ReadAllText/WriteAllText` with `UTF8Encoding($false)`.
- Pass `[NullString]::Value`, not `$null`, to .NET `string` parameters (PowerShell turns `$null` into `""`).
- Multi-line git commit messages: write a file and `git commit -F file`; here-strings with quotes get split into pathspecs.
