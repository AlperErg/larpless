# CLAUDE.md — Windows build

Guidance for Claude Code when working on the Windows target. Read the root `CLAUDE.md` first; this file only covers what differs on Windows and what was learnt getting it running.

The Windows app is **react-native-windows 0.81.36** (cpp-app template: C++/WinRT, Fabric, bridgeless, WinAppSDK 1.8, prebuilt NuGet via `UseExperimentalNuget`). It runs the same TypeScript as the Mac app and implements the same JS ↔ native contract (`src/contracts/native.ts`): every Swift module has a C++ counterpart with the **same module name, methods, events, payloads and error codes**, so `src/native/*.ts` facades are shared. Never change the contract for Windows alone.

## Toolchain

- Visual Studio 2026 Community 18.x (toolset **v145**) with Desktop C++, WinUI app development (`Microsoft.VisualStudio.ComponentGroup.UWP.VC`), MSIX Packaging Tools and **Windows 11 SDK 10.0.22621**. Install with explicit `--add` workloads; a partial install leaves missing `WindowsXaml…Cpp.targets` / `DesktopBridge.props`.
- .NET SDK 10, Node 22+, Developer Mode on, long paths on.
- `larpless/dotnet-tools.json` pins **PowerShell 7** as a local .NET tool: the RNW deploy step needs `pwsh.exe` (`dotnet tool restore`).
- `larpless/Directory.Build.props` patches `ReactNativeAsyncStorage`: disables the WinAppSDK transitive-dependency check (false positive from its stale `packages.config`) and force-imports `windows/AsyncStorageToolset.props` so it builds with the installed toolset instead of the missing v143.
- `larpless/NuGet.config` maps `Microsoft.ML.OnnxRuntime*` to nuget.org only: the `react-native` Azure feed answers **401** for packages it doesn't mirror, and one failing source fails the whole restore (NU1301). The `packages.lock.json` files must come from a nuget.org restore; a lock written from another source has different content hashes (NU1403). Regenerate with `MSBuild windows\LarpLess.sln -t:Restore -p:RestoreForceEvaluate=true -p:Platform=x64`.

## Commands

Run from `larpless/` (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run-windows.ps1     # Metro on 8081 if needed + tool restore + build/deploy/launch
Get-Process LarpLess -EA SilentlyContinue | Stop-Process; npx @react-native-community/cli run-windows --no-packager --logging *> .logs\build-windows.log   # rebuild only
```

- Stop the running app before rebuilding. A first build takes several minutes; incremental ones about one.
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
| FLFloatingPanel | layered `WS_EX_TOPMOST\|TOOLWINDOW\|NOACTIVATE` popup drawn with Direct2D (DC render target on a DIB + `UpdateLayeredWindow`) and DirectWrite with the bundled Inter + Instrument Serif; `setColorScheme` swaps to a dark palette taken from `NotionColors.swift` | — (same size, states, hub and payloads); the light palette is still the older `FFFFFF`/`37352F`, not the Mac's current one |
| FLOllama | install dir from `FOLDERID_UserProgramFiles\Ollama` (fallback: HKCU Uninstall); `server` = owner of the port-11434 listener (`GetExtendedTcpTable`), `'app'` when its parent is `ollama app.exe`; `promptCache` read from the server's environment through its PEB; `launch`/`restart` start `ollama app.exe` with `LLAMA_ARG_CACHE_RAM=0` via `cmd /c start` with the desktop-app **breakaway** policy, so Ollama has no package identity (verified with `GetPackageFullName`) and survives redeploys | restart terminates the tray app, its server and the runners (Mac sends SIGTERM); the tray icon can linger until hovered |

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
- **Brace-init narrowing is an error** (C2397) with this toolset: `const float v{someByte}` needs `static_cast<float>`.
- **Manifest capabilities live in specific schema namespaces**: `globalMediaControl` (FLNowPlaying) is `uap7:Capability`; under `uap3` the package fails validation (APPX0501). Check `Windows Kits\10\Include\<sdk>\winrt\AppxManifestTypes.xsd` for the right `ST_Capability_*` type.
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

## Ollama on Windows: title-first classification

Measured on the dev PC (Ryzen 5 7545U, Radeon 740M iGPU, 15 GB RAM), Ollama 0.40.2:

- Ollama runs **CPU only**: it drops the integrated GPU ("set `OLLAMA_IGPU_ENABLE=1`" in `%LOCALAPPDATA%\Ollama\server.log`) and ROCm has no kernels for gfx1103.
- The image always costs **~1,436 prompt tokens** whether the capture is 1280 or 640 px wide (Ollama resizes it), so shrinking `CAPTURE.maxWidth` doesn't speed up the check. `qwen3-vl:2b` reads ~50 tok/s ⇒ **~28–30 s per check**. (On Apple silicon the same check is ~3 s.)
- **iGPU tried 2026-10-11, doesn't work yet**: `OLLAMA_IGPU_ENABLE=1` makes Ollama load `qwen3-vl:2b` 100% on the 740M through **Vulkan**, but every image request crashes `llama-server.exe` inside `amdvlk64.dll` (`0xc0000409`, AMD driver 32.0.11020.24001, July 2025; Ollama logs "AMD driver is too old") and text-only requests hang for minutes. Reverted. Worth retrying only after an AMD driver update.
- The 4B model takes ~4.4 GB (`llama-server`); with other apps open, free RAM fell below 1 GB.

**Decision (2026-10-11): Windows answers from the window title first.** `sessionStore` builds the classifier with `TITLE_FIRST: Platform.OS === 'windows'`. After the distraction rules and the cache, `core/titleMatch.ts` looks for a module name or keyword in the window title as a **whole word** (≥ 3 word characters; 6+ letter keywords also match their stem, so "integral" matches "Integration"; your own modules beat library subjects; still ambiguous → no match). A hit labels the chunk at once with source `'title'`, no screenshot and an empty `activity` (titles are never stored); no hit goes to the VLM as before. Library subjects match as whole words too, so a song called "Rock …" can read as Earth Science: accepted **because this PC has no usable GPU**. **The goal is still the Mac's VLM-first logic**: turn `TITLE_FIRST` off once Windows inference is fast (e.g. a working iGPU after a driver update). The Mac never sets the flag; a test pins that.

A/B on the dev PC, 4-minute real session, medium profile (main's power profiles; both stepped down to eco after the first timeout), foreground rotating every 40 s between a study title, a neutral title and a YouTube title:

| | main's logic | title-first |
| --- | --- | --- |
| chunks | 9 | 10 |
| labelled | 0 (0 %) | 4 (40 %): the study window and an RStudio window → Statistics |
| unknown | 100 % | 60 % |
| VLM checks that finished | 0 of 4 | 0 of 3 |

Every VLM check took **~29.9 s and hit the 30 s ceiling** (`CLASSIFY_TIMEOUT_MS`, which includes the capture), so on this PC windows without a module keyword stay `unknown`.

### Eco ceiling: 45 s on Windows

**Decision (2026-10-12):** on Windows, eco's ceiling is `WINDOWS_ECO_TIMEOUT_MS` = **45 s** (`core/powerProfile.ts` `platformProfile()`, applied in `sessionStore` with `Platform.OS`). Medium and high keep 30 s, and so does every profile on the Mac; a test pins both. Medium always steps down to eco after its first check on this PC (> 15 s is "slow"), so eco is the one that matters.

Measured with `qwen3-vl:2b`, `LLAMA_ARG_CACHE_RAM=0`, ~1.9 GB RAM free, a 120 s ceiling so nothing was cut off (in-app `[ollama]` lines, matching the `[GIN]` lines in `server.log`):

- loaded model: **25.7–28.1 s** over 9 checks (almost all ~25.8 s);
- first check of a cold session (warm-up had failed at its own 30 s limit): **38.8 s**; warm-up with the model files still in the OS cache: ~11 s.

45 s rather than 60 s: it covers the loaded case with ~60 % headroom and the one cold check observed. A cold check that still misses costs one chunk, because Ollama finishes loading anyway and the next check is warm. And a hung Ollama blocks the single vision slot for 1.5 eco chunks instead of 2 (plus the one-chunk hold after a timeout).

A/B with the same protocol as above (4 min, medium start, 40 s rotation, webcam off), 30 s vs 45 s: **no difference that day**. Both arms finished 5 of 5 checks (25.7–26.9 s) and labelled the same 12 chunks, because the 2B checks happened to fit under 30 s with ~3 s to spare. The 30 s ceiling still failed in the first A/B (~29.9 s) and would have failed the cold first check (38.8 s); one warm check took 29.4 s, 0.6 s short of it. So 45 s is the margin for those cases, not a speed-up. An A/B under load (other apps open, the 4B model, low free RAM) would show the gap; not run.

### Unresolved crash

LarpLess crashed in `hermes.dll` with `0xc0000005` at offset `0x1c59d0`:

- twice while screenshot checks were timing out with the 4B model loaded and < 1 GB RAM free;
- once (2026-10-11 23:14:47) one second after `prepareOllama` restarted Ollama through `FLOllama.restart()` on app launch.

Not reproduced by: aborting a fetch whose response arrives later; a local server dropping the connection (FIN or RST) mid-request, with or without an `AbortController` abort before, during or after the drop, including 300 KB bodies; `FLOllama.restart()` while the app is idle. Something else must be in flight during the launch-time restart (look at what `ollamaStore`/`prepareOllama` and the health check are doing then).

### Benchmarking the classifier

Windows Defender (AMSI) blocks PowerShell scripts that capture the screen, base64 it and POST it, even to localhost. Don't try to evade it: benchmark with a **generated** test image (System.Drawing text on a bitmap, never a real screenshot) posted to `/api/chat` with the app's options (`think: false`, the empty `<think>` prefill, `num_ctx: 4096`), or measure through the app, where `[ollama] <model> <ms> → <verdict>` lines show up in `js-eval --console`.

## Tips for working from PowerShell

- `Get-Content -Raw` / `Set-Content` in Windows PowerShell 5.1 read BOM-less UTF-8 as ANSI and will mangle non-ASCII text. Edit with the Edit tool, or use `[IO.File]::ReadAllText/WriteAllText` with `UTF8Encoding($false)`.
- Pass `[NullString]::Value`, not `$null`, to .NET `string` parameters (PowerShell turns `$null` into `""`).
- Multi-line git commit messages: write a file and `git commit -F file`; here-strings with quotes get split into pathspecs.
