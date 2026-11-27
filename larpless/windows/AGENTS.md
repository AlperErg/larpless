# AGENTS.md — Windows build

Guidance for coding agents when working on the Windows target. Read the root `AGENTS.md` first; this file only covers what differs on Windows and what was learnt getting it running.

The Windows app is **react-native-windows 0.81.36** (cpp-app template: C++/WinRT, Fabric, bridgeless, WinAppSDK 1.8, prebuilt NuGet via `UseExperimentalNuget`). It runs the same TypeScript as the Mac app and implements the same JS ↔ native contract (`src/contracts/native.ts`): every Swift module has a C++ counterpart with the **same module name, methods, events, payloads and error codes**, so `src/native/*.ts` facades are shared. Never change the contract for Windows alone.

## Toolchain

- Visual Studio 2026 Community 18.x (toolset **v145**) with Desktop C++, WinUI app development (`Microsoft.VisualStudio.ComponentGroup.UWP.VC`), MSIX Packaging Tools and **Windows 11 SDK 10.0.22621**. Install with explicit `--add` workloads; a partial install leaves missing `WindowsXaml…Cpp.targets` / `DesktopBridge.props`.
- .NET SDK 10, Node 22+, Developer Mode on, long paths on.
- `larpless/dotnet-tools.json` pins **PowerShell 7** as a local .NET tool: the RNW deploy step needs `pwsh.exe` (`dotnet tool restore`).
- `larpless/Directory.Build.props` patches autolinked native modules (`ReactNativeAsyncStorage`, `RNSVG`): WinAppSDK false positive on AsyncStorage, v143 toolset override, and Composition desktop settings for RNSVG. After `npm ci`, `node scripts/patch-rnsvg-windows.mjs` pins RNSVG's SDK to 10.0.22621 (also run from `scripts/run-windows.ps1`).

## Commands

Run from `larpless/` (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run-windows.ps1           # bundle JS into the app, build/deploy/launch (works from Start with no Metro)
powershell -ExecutionPolicy Bypass -File scripts\run-windows.ps1 -Metro    # load JS from Metro :8081 while developing
powershell -ExecutionPolicy Bypass -File scripts\launch-windows.ps1        # Metro + launch (only for -Metro installs)
Get-Process LarpLess -EA SilentlyContinue | Stop-Process; npx @react-native-community/cli run-windows --no-packager --logging *> .logs\build-windows.log   # rebuild only
powershell -ExecutionPolicy Bypass -File scripts\release-windows.ps1 -CertificateThumbprint <sha1>   # Release x64 + ARM64 .msixbundle, signed (-Store adds the .msixupload, -NoSign only builds)
```

Default installs embed `windows/LarpLess/Bundle/index.windows.bundle` (`EmbedJsBundle=true` → `BUNDLE` in `LarpLess.cpp`). Re-run `run-windows.ps1` after JS changes.

- Stop the running app before rebuilding. A first build takes several minutes; incremental ones about one.
- **`run-windows.ps1` deletes the downloaded screen model.** It removes the installed package, and that deletes its `LocalState` (`%LOCALAPPDATA%\Packages\LarpLess_96wyba02c09cm\LocalState\Models`, ~505 MB). Use the rebuild-only command instead, which keeps the package **as long as the manifest identity hasn't changed**: when the installed package has a different `Name`/`Publisher` (e.g. a build from a branch with the Microsoft Store identity), the deploy removes it (`removePackageList` in the AppXDeploymentServer log) and its `LocalState` (settings, session history and the screen model) is deleted with it. Check `(Get-AppxPackage *LarpLess*).PackageFamilyName` first, and back up `LocalState` if it differs. Otherwise: with `--msbuildprops EmbedJsBundle=true` after `scripts\bundle-windows.ps1` for an embedded install, without it for a Metro one. On a Metro install, JS-only changes need no rebuild: start Metro (`npx react-native start --port 8081`) and relaunch the installed build (command below). An embedded install ignores Metro, so it needs the bundle + rebuild.
- **The installed build has to come from a commit with `FLScreenModel`** (`main` and `add-embeddings` both have it now; older branches don't). A build without it has no `NativeModules.FLScreenModel`, so `native/index.ts` silently swaps in the mock, which always reports "not installed" even with the files in `LocalState\Models`: the `'classifier'` mode turns every chunk into `unknown`. Check with `js-eval "__FL.NativeModules.FLScreenModel"` (null = wrong build) and rebuild after switching branches.
- Debug builds set `UseDeveloperSupport(false)` so RNW does not paint its green Metro **Loading** bar (that is not `BootScreen`). Themed launch is `BootScreen.tsx` after JS loads. `LarpLess.cpp` also sets the Win32 window canvas to match `theme.ts` before React paints.
- Compile errors: the newest `windows\msbuild_*.err`. The build log written with `*>` is UTF-16 — read it with `Get-Content`.
- Relaunch the installed build without rebuilding: `Start-Process "shell:AppsFolder\$((Get-AppxPackage *LarpLess*).PackageFamilyName)!App"`.
- App icons (`LarpLess\LarpLess.ico`, `LarpLess.Package\Images\*.png`) are generated from `brand/larpless-icon.png`: `powershell -ExecutionPolicy Bypass -File scripts\make-windows-icons.ps1`. Windows caches tile/taskbar icons, so an updated logo may only show after unpinning/repinning or a sign-out.
- Packaged layout: exe at `windows\LarpLess.Package\bin\x64\Debug\AppX\LarpLess\LarpLess.exe`.
- Crashes: `Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000; StartTime=(Get-Date).AddHours(-1)} | ? Message -match LarpLess`.
- `scripts/js-eval.mjs` works as on the Mac (`__FL`). Exit code **9** with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` is a harmless libuv teardown assert (output is still valid); exit code **2** + "no debuggable app" means the app is not running (or crashed).
- Full JS reload: `node scripts/js-eval.mjs 8081 "__FL.NativeModules.DevSettings.reload()"`. Editing source files makes Metro hot-reload too; calls sent during a reload are lost.

## Release packages (`scripts/release-windows.ps1`)

- Output in `windows\build\release\` (gitignored): `LarpLess-<version>.msixbundle` and, with `-Store`, `LarpLess-<version>.msixupload` (Partner Center signs that one), plus `msbuild.log` / `msbuild-errors.log`. The manifest version must be `<package.json version>.0`.
- Release builds bundle the JS themselves: RNW's `Bundle.props` sets `UseBundle=true`, runs the bundler into `LarpLess\Bundle\` and compiles it to Hermes bytecode with the `hermes.exe` from the same NuGet package as the engine. So the script doesn't call `bundle-windows.ps1` (a `--dev true` bundle for Debug installs), and the static `Bundle\**\*` item in `LarpLess.vcxproj` is skipped when `UseBundle` is true, or the files would be packaged twice. RNW's bundle step has `ContinueOnError`, so the script empties `Bundle\` first and fails unless the result starts with the Hermes bytecode magic.
- Signing: `-CertificateThumbprint` (cert store) or Azure Artifact Signing (`-SigningMetadata metadata.json -SigningDlib Azure.CodeSigning.Dlib.dll`), also read from `LARPLESS_SIGN_THUMBPRINT` / `LARPLESS_SIGN_METADATA` / `LARPLESS_SIGN_DLIB`. The certificate subject must equal `Publisher` in `Package.appxmanifest`. That is now the Microsoft Store identity from Partner Center (`Name` `GarciaIgelmo.LarpLess`, `Publisher` `CN=C46A4420-229A-4946-9836-AB6A1014CE96`, display name `Garcia Igelmo`; package family `GarciaIgelmo.LarpLess_14gnd5vrm993g`), which only the Store can sign for, so releases go out as the `-Store -NoSign` `.msixupload`. A signed sideload `.msixbundle` would need its own Publisher, and with it a different package family. Before 0.1.1 the identity was the dev `LarpLess` / `CN=ggige` (`LarpLess_96wyba02c09cm`): Windows treats that as another app, so a dev install made before the change doesn't upgrade in place and its `LocalState` (the downloaded screen model) isn't carried over.
- The manifest targets `Windows.Desktop` only, `MinVersion` 10.0.19041 (Windows 10 2004), the first build with `WDA_EXCLUDEFROMCAPTURE`.
- CI: `.github/workflows/windows-build.yml` runs `release-windows.ps1 -Platforms x64 -NoSign` on `windows-2025` (VS 2026) for PRs into `main`, adding missing VS components (SDK 22621, UWP C++, MSIX packaging) first.

## Native modules (`windows/LarpLess/Native/`)

Each module is **one header** (`REACT_MODULE` / `REACT_METHOD` / `REACT_EVENT` / `REACT_INIT` from Microsoft.ReactNative.Cxx), included in `LarpLess.cpp` (registered by `AddAttributedModules`) and listed as a `ClInclude` in `LarpLess.vcxproj`. Facades use `new NativeEventEmitter(M)`, so every module with events has `addListener` / `removeListeners` that keep a listener count, and events are emitted only while it is > 0.

| Module | Windows implementation | Deviation from Mac |
| --- | --- | --- |
| FLPing | smoke test | — |
| FLNotifications | toast XML (`Windows.UI.Notifications`), logo from `Assets\FLNotificationIcon.png`, silent unless `sound`; click brings the main window forward | — |
| FLAppShell | `PowerCreateRequest` + EcoQoS opt-out; `WH_KEYBOARD` thread hook for Ctrl+K / Ctrl+Enter / Ctrl+. → `FLMenuCommand` | Ctrl instead of ⌘ |
| FLScreenCapture | foreground window → pid → FileDescription; GDI StretchBlt of the foreground window's monitor → WIC JPEG in an `HGlobal` stream; own window hidden with `WDA_EXCLUDEFROMCAPTURE` during capture | `bundleId` is the exe name; Screen Recording is always `granted` |
| FLKeychain | DPAPI (current user) encrypted file per key under `%LOCALAPPDATA%\LarpLess\Secrets` | no per-app Keychain on Windows: protects against copied disks and backups, not other processes running as the user |
| FLPermissions | camera via `AppCapability("webcam")`; `openSettings` → `ms-settings:privacy-webcam`; `relaunch` → `AppInstance::Restart` | no screen permission on Windows |
| FLSound | XAudio2 port of the Swift engine (xorshift white, Kellet pink, brown; equal-power ramps; chimes) | — |
| FLWebcam | MediaCapture + MediaFrameReader (BGRA), YOLO11n via ONNX Runtime | — (same `person` / `cell phone` thresholds as Mac) |
| FLScreenModel | on-device screen classifier: GDI capture to BGRA (`FLScreenCapture::CaptureBgra`), `Windows.Media.Ocr`, SigLIP 2 vision tower + the int8 paraphrase-multilingual-MiniLM-L12-v2 for every language (C++ Unigram in `FLUnigram.h`; its vocabulary downloads as `unigram.json` and `FLUnigramVocab.h` converts it once) via ONNX Runtime; returns scores only, `core/screenModel.ts` fuses them. Models (~505 MB, pinned HF commits + SHA-256) download at onboarding into `LocalFolder\Models`; the fixed SigLIP prompt embeddings ship as `Assets/Models/FLScreenModelPrompts.json` (`scripts/embed_bench/export_prompts.py`) | — (the Mac's `Native/ScreenModel/FLScreenModel.swift` runs the same ONNX files through the `onnxruntime-objc` pod, with Apple Vision OCR) |
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

Presence and phone both come from bundled YOLO11n (`Assets/Models/yolo11n.onnx`, NuGet `Microsoft.ML.OnnxRuntime` 1.22.1, CPU, one intra-op thread). Thresholds match the Mac CoreML model: NMS confidence 0.2 and IoU 0.6 (baked in at export), `person` > 0.5 means `personPresent`, best `cell phone` score is `phoneScore`, and > 0.4 means `phoneVisible`. No samples are emitted until the model has loaded, or at all if it fails to load. A camera that is open but sends no frames for 3 s (a closed privacy shutter on the HP EliteBook: the driver stops streaming instead of sending black frames, and `Failed` never fires) gets `personPresent: false` samples from a watchdog thread, so it reads as away; without them JS would see no samples, which means "presence unknown" and never away.

Re-export (Python + ultralytics) and replace the file:

```bash
yolo export model=yolo11n.pt format=onnx nms=True imgsz=640 conf=0.2 iou=0.6
```

## Ollama on Windows

Ollama skips integrated GPUs unless the **`OLLAMA_IGPU_ENABLE=1`** user environment variable is set (restart Ollama after setting it). With it, AMD iGPUs run through **Vulkan**; check `%LOCALAPPDATA%\Ollama\server.log` for `inference compute … library=Vulkan` and `offloaded N/N layers to GPU`.

Current dev PC (Framework 13, Ryzen AI 7 350, Radeon 860M = gfx1152, 24 GB RAM), Ollama 0.40.3, `qwen3-vl:2b`, all layers and the vision encoder on Vulkan:

- Screenshot check: **~3–7 s**. Title-only request: ~0.9 s. That's close to Apple silicon, so Windows uses the normal screenshot path (`config.TITLE_CHECK` is off).
- **ROCm doesn't work on gfx1152**: Ollama drops it (no rocBLAS kernels), and forcing `HSA_OVERRIDE_GFX_VERSION=11.5.0` loads the model, then crashes with `device kernel image is invalid`. Leave it on Vulkan.
- **The NPU is unused**: Ollama has no NPU backend. AMD's Lemonade Server can use it, but it speaks an OpenAI-style API and has limited vision-model support, so it isn't wired in.

CPU-only PCs are much slower. On a Ryzen 5 7545U (Radeon 740M = gfx1103, no Vulkan offload at the time) a 640 px screenshot check took **≥ 30 s** and the 4B model timed out. For machines like that, `TITLE_CHECK: true` asks the model about the window title first and only accepts a confident *studying* answer; anything else still takes a screenshot, because the title can't show what's on the page.

### Unresolved crash

On the old CPU-only PC, LarpLess crashed twice in `hermes.dll` with `0xc0000005` at offset `0x1c59d0`, both while screenshot checks were timing out with the 4B model loaded and < 1 GB RAM free. A repro of "abort a fetch, the response arrives later" (local server answering after 5 s) did **not** crash, so that alone isn't the cause; memory pressure is the main suspect. Re-check once the classifier is fast enough not to time out.

Seen again on 2026-10-12 (Ryzen 5 7545U, 15 GB, ~3 GB free) during the screen-model work: two crashes at the same offset in the first study sessions after launch with FLScreenModel installed, ~20–40 s after `start()` (Ollama warm-up and the first on-device check overlap there). A session with the screen model switched off at runtime ran 70 s without a crash, and a later session with it on ran 3+ min without one, so it's intermittent and not pinned to FLScreenModel yet. To narrow it down: several sessions each way, and watch free RAM while Ollama (2B) and FLScreenModel (~1 GB) are both loaded.

Seen again on 2026-11-27 (Framework 13, 24 GB, `'classifier'` mode, so **no Ollama loaded**, webcam off, multilingual text model): 3 crashes at the same offset within ~5 s of `start()` sent through `js-eval` (first launch after a rebuild, then right after relaunching), in English and Spanish alike; the 4th session (started 4 s after a `js-eval --console` client connected) ran fine and classified normally. Direct `native.screenModel.classify` calls never crashed: 3 × 5 texts and 3 × the full 52-text session input, back to back. So it is neither memory pressure nor Ollama nor the screen model's inference; suspects are the session start itself on a freshly launched app (panel, sound, power request, the first `FLScreenCapture` ticks) or the inspector connection. Next: start sessions from the UI (no `js-eval`) right after launch, and from js-eval after waiting, to split those two.

### Benchmarking the classifier

Windows Defender (AMSI) blocks PowerShell scripts that capture the screen, base64 it and POST it, even to localhost. Don't try to evade it: benchmark with a **generated** test image (System.Drawing text on a bitmap, never a real screenshot) posted to `/api/chat` with the app's options (`think: false`, the empty `<think>` prefill, `num_ctx: 4096`), or measure through the app, where `[ollama] <model> <ms> → <verdict>` lines show up in `js-eval --console`.

## On-device screen model (FLScreenModel)

Started on branch `add-embeddings` (2026-10-12), now merged into `main`. Goal: stop needing Ollama for most screen checks on CPU-only PCs, where a qwen3-vl check takes 25–30 s.

### The plan and why

An LLM council compared the current generative VLM with a small "decision" model (one that scores fixed options instead of writing JSON). Decisions:

- **laya-vision (thaitea/laya-vision) rejected.** Its weights are CC BY-NC-SA (not shippable in a distributed app), it runs only in PyTorch, and it was trained on game frames rather than screens. Copy the idea, not the artifact.
- **Option 1, embeddings + OCR (built):** SigLIP 2 image embeddings answer "study or distraction" (zero-shot against text prompts), and Windows OCR + MiniLM text embeddings + keyword hits answer "which subject". No training needed, Apache-2.0 models. SigLIP was chosen over CLIP: its sigmoid gives each label an independent score (it can say "none of these"), it was more accurate on the bench, and SigLIP 2 is multilingual.
- **Option 2, option scoring with a small VLM (benched, not adopted):** SmolVLM (Apache-2.0) used as a decision model: score each module name as an answer instead of generating. Meant as the backup if Option 1 isn't accurate enough; it lost clearly on the current set (see "Option 2 results").
- First shipped as a hybrid (the screen model answered when sure, Ollama the rest). Since 2026-10-26 the user picks one model per PC instead: Ollama's vision LLM for powerful PCs, or the on-device classifier alone (see "Classifier modes").

### What was built

- `scripts/embed_bench/` (Python 3.12 venv; setup in `requirements.txt`): `bench.py` scores `larpless/bench/` screenshots with image / text / keyword / fused methods and reports accuracy, confidence curves and latency; `--courses` adds sidecar `"course"` names as custom courses; `--onnx` times the image tower in ONNX Runtime; `--dump-scores` + `parity.mjs` check that `src/core/screenModel.ts` gives identical answers to the bench. `export_prompts.py` builds `Assets/Models/FLScreenModelPrompts.json` (fixed SigLIP prompt embeddings) and checks the pinned ONNX files and the C++ resize against PyTorch.
- `Native/FLScreenModel.h`: capture to BGRA (`FLScreenCapture::CaptureBgra`), `Windows.Media.Ocr`, SigLIP 2 vision tower (PIL-style tent resize to 224, cosine 0.9999 to the official processor) and the int8 paraphrase-multilingual-MiniLM-L12-v2 (`FLUnigram.h`, matches Hugging Face's tokenizer on `unigram_cases.json`; all-MiniLM-L6-v2 with `FLWordPiece.h` until 2026-11-27) through ONNX Runtime, plus whole-word keyword counts. Returns numbers only. Downloads the models (pinned HF commits, SHA-256 checked) into `LocalFolder\Models`.
- JS: contract `ScreenModelApi` (`src/contracts/native.ts`), `src/core/screenModel.ts` (fusion, files, step), `runScreenModel` in `src/core/classifier.ts`, which replaces the Ollama screenshot in the `'classifier'` mode (source `'embed'`), `src/store/screenModelStore.ts`, `ScreenModelDownload` on onboarding's classifier step and in Settings → Local AI.
- macOS (2026-11-01): `macos/Focusline-macOS/Native/ScreenModel/` is a Swift port of the header (same methods, payloads and error codes): `FLScreenCapture.screenshot` → BGRA, Vision OCR (`.accurate`, lines top to bottom; warmed up in the background once per launch by `warmUp()`, which the Sidebar calls only in the `'classifier'` mode with the model installed (a no-op on Windows): the first use by a new build of the app takes 30–60 s, later launches ~0.1 s), the same tent weights applied as two `vDSP_mmul`s per channel (within 5e-7 of the loop), SigLIP 2 + MiniLM through the `onnxruntime-objc` 1.30.0 pod (CPU, 4 threads), `FLScreenModelWordPiece.swift` (checked by `scripts/embed_bench/wordpiece-check-mac.sh`). Models go to `~/Library/Application Support/com.larpless.app/Models`. Image scores should match Windows; text scores differ with the OCR engine, so the bench needs a Mac run with Vision OCR before trusting the fusion parameters there.

### Multilingual text model: Unigram tokenizer (Spanish work, 2026-11-27)

**One text model for every screen language** (decided 2026-11-27): the **int8** `paraphrase-multilingual-MiniLM-L12-v2`, downloaded as `minilm-ml.onnx`. It replaces all-MiniLM-L6-v2 for English too. It uses XLM-R's SentencePiece **Unigram** tokenizer instead of WordPiece.

- **Results:**
  - Spanish: 13/14, with the text channel going from 64% to 79%.
  - English dev set: app 50/54, and 51/54 with subjects chosen; grouped 93%.
  - English holdout: 10/11 → 9/11. That loss was accepted.
- **Why one model:** in ONNX Runtime it runs at the same speed as L6, for ~+50 MB RAM and +43 MB download (model +28 MB, vocabulary 15 MB). In exchange, students who study in both languages need no second download.
- **Engine** (`FLScreenModel.h`):
  - It loads `siglip2-vision.onnx` + `minilm-ml.onnx`, tokenized by `FLUnigram.h` with `minilm-ml-vocab.txt` from the same Models folder.
  - **The vocabulary is downloaded, then converted.** The Xenova repo has no plain-text vocabulary, only `tokenizer.json` (17 MB) and `unigram.json` (15 MB, the tokenizers library's saved Unigram model: `{"type","unk_id","vocab":[[piece, score], …]}`). `SCREEN_MODEL_FILES` lists `minilm-ml-vocab.txt` with the URL, size and SHA-256 of the pinned `unigram.json`. `download()` saves it as `unigram.json`, then `DeriveVocab` converts it with `FLUnigramVocab.h` (a strict, standard-library-only JSON reader that copies each score's text verbatim), checks the result against `kVocabBytes`/`kVocabSha256` (= `ML_VOCAB_SHA256`), moves it into place and deletes the JSON. `status()` checks that file against `kVocabBytes`, not the listed download size.
  - Until 2026-11-27 the converted file was committed and packaged in `Assets/Models` (250,002 lines). The on-device conversion gives the same bytes.
  - `download()` accepts only those three names, and `minilm-ml-vocab.txt` only from a URL ending in `/unigram.json`.
  - The ONNX gets `input_ids`, `attention_mask` (1s) and `token_type_ids` (0s), followed by mean pooling + L2.
  - `unload()` also frees the vocabulary (~250k pieces).
  - `FLWordPiece.h` is gone.
- **Leftovers:** installs from before keep `minilm.onnx` + `minilm-vocab.txt` (~90 MB) in `LocalFolder\Models`. The first `status()` call after launch deletes them, best-effort.
- **Mac:** it still runs L6 with `FLScreenModelWordPiece.swift` until Part B ports `FLUnigram.h`. That's why `export_prompts.py --text-model minilm` and `wordpiece_cases.json` remain.
- **Keyword matching** (`Fold` + `ContainsWord`) matches `bench.py`'s `fold()` and `BEFORE`/`AFTER`:
  - Both the text and the keyword are lowercased, put through NFD, and stripped of code points with a non-zero combining class.
  - Word characters are Unicode letters plus anything with a numeric value (`[^\W_]`), not only `a-z0-9`.
  - So `"funcion"` matches "la función de onda" but not "funcionar", and `"nino"` matches "niño".

- **Pinned export:** `Xenova/paraphrase-multilingual-MiniLM-L12-v2@2c4055b12046f11709e9df2c122e59ffbdc2f900`.

  | File | Bytes | SHA-256 |
  | --- | --- | --- |
  | `onnx/model.onnx` | 470268510 | `185ae63f…6856ca113` |
  | `onnx/model_int8.onnx` (ships as `minilm-ml.onnx`) | 118054609 | `d6ea442f…f34bbcf4c8` |
  | `tokenizer.json` | 17082913 | `b60b6b43…3686fa441` |

  Full hashes are in `MINILM_ML_FILES` in `export_prompts.py`.
  - Both ONNX files take `input_ids`, `attention_mask` **and `token_type_ids`**, all int64 `[batch, seq]`. The model is a BERT architecture, so feed zeros for `token_type_ids`.
  - Both return `last_hidden_state [batch, seq, 384]`; the app mean-pools and L2-normalises it.
- **What `tokenizer.json` does:**
  - Normalizer: `Precompiled` only, the SentencePiece nmt_nfkc charsmap, with no space collapsing.
  - Pre-tokenizer: `WhitespaceSplit` → `Metaspace("▁", add_prefix_space)`.
  - Post-processor: `<s> $A </s>`.
  - Model: `Unigram` with `unk_id` 3 and no byte fallback.
  - Special tokens: `<s>` 0, `<pad>` 1, `</s>` 2, `<unk>` 3, and `<mask>` 250001 (`lstrip`). They are matched on the raw text.
  - The file sets truncation to 128; the app uses 256.
  - The ids match the `sentence-transformers` repo's tokenizer, which is what `bench.py` measures. **Don't load the Xenova repo with `AutoTokenizer`**: transformers 5 builds a `BertTokenizer` from its `config.json` and gives unrelated ids.
- **Exporting the vocabulary and cases:** `scripts\embed_bench\.venv\Scripts\python -I scripts\embed_bench\export_prompts.py --text-model minilm-ml --text-only`. `--text-only` skips SigLIP, so the prompt JSONs aren't rewritten. `minilm-ml` is the default text model; `--text-model minilm` is the old L6/WordPiece path, kept for the Mac's check. The run:
  - hash-checks `tokenizer.json` and `unigram.json`, and fails unless `unigram.json` holds exactly `tokenizer.json`'s vocabulary;
  - writes `scripts/embed_bench/minilm-ml-vocab.txt` (gitignored; the default `-Vocab` of the parity check) and fails if its SHA-256 isn't `ML_VOCAB_SHA256`. The file is `piece<TAB>score` per line, id = line number: 250,002 lines, 7,763,089 bytes with LF line endings, SHA-256 `62fce312…539e449f92`. The app's own conversion must give the same bytes (below);
  - checks the normalisation rule against the charsmap;
  - writes `unigram_cases.json`: 22 fixed strings, namely the 4 WordPiece ones, Spanish/¿¡/ñ, decomposed accents, full-width forms and ligatures, whitespace and control characters, the special tokens, charsmap quirks, and a long OCR-like page truncated at 256.
- **How the charsmap behaves.** The export script decoded and measured it; `FLUnigram.h` mirrors this:
  - **Per code point:** NFKC, except that C0 controls are removed, odd whitespace (tab, LF, ZWSP, LS, U+2581, BOM, U+FFFD…) becomes a space, and 11 ranges are left alone. Those are U+FF5E plus code points newer than the charsmap's Unicode version.
  - **Per grapheme:** tokenizers applies the charsmap one grapheme at a time. A grapheme under 6 UTF-8 bytes is replaced **whole** by the entry of its shortest prefix that has one, so `ｏ` + U+031A becomes `o` and the mark is dropped.
  - **Multi-code-point keys** are exactly the sequences that NFKC composes into one code point X and whose code points, each NFKC-mapped to one code point, spell NFD(X). Under that rule `Ḷ` + U+0304 is *not* a key and stays uncomposed. The rule is exact on all 219,874 keys.
- **Conversion check:** `scripts/embed_bench/unigram-vocab-check.sh [unigram.json]` (macOS or Linux, from `larpless/`; downloads the pinned file when no path is given) builds `unigram_vocab_check.cpp` with `FLUnigramVocab.h` on its own (`-Wall -Wextra -Wpedantic -Werror`), runs 16 edge cases (escapes, surrogate pairs, skipped keys, malformed input) and checks the converted file's SHA-256. It must print `vocab OK`. Result on 2026-11-27: 250,002 pieces, byte-identical to the file that used to be committed.
- **Parity check:** `powershell -ExecutionPolicy Bypass -File scripts\embed_bench\unigram-check-windows.ps1`, from `larpless/`. It compiles `unigram_check.cpp` with the header on its own (vswhere → vcvarsall → `cl /W4 /WX`, no app build) and must print `unigram 22/22 identical`. `-Vocab` (default: the shipped asset) and `-Cases` take other files.
  - Result on 2026-11-27: 22/22, plus 20,000/20,000 random short mixed-script strings and 4,000/4,000 long fuzz strings. The fuzz files lived in a scratch folder and aren't committed.
  - Speed: the vocabulary loads in ~100 ms, and a 1,500-character page encodes in ~0.3 ms.
  - The Mac port (`FLScreenModelUnigram.swift` + `unigram-check-mac.sh`) must pass the same file, and must derive the vocabulary from the same `unigram.json` (porting `FLUnigramVocab.h`, or `JSONSerialization` plus the same SHA-256 check) rather than ship it.

### Classifier modes

`Settings.classifierMode`, picked in Settings → Local AI → **Screen check** (`isClassifierMode()` in `sessionStore.ts`). The classifier reads it through its `screenModelOnly()` dep on every check, so a change applies from the next check without a restart. A change during a session also calls `readerChanged()` on the controller (subscribed in `sessionStore.ts`): it opens and warms up the reader now in use (Ollama for `'vlm'`) and unloads the other one (`unloadUnused()`). Exactly one model reads the screen:

| | `'vlm'` (default, "Vision LLM (Ollama)") | `'classifier'` ("On-device classifier") |
| --- | --- | --- |
| For | powerful PCs (GPU or fast iGPU): ~3–7 s per check | any PC: ~0.3–0.6 s per check, ~1 GB RAM while loaded |
| Reads the screen | Ollama's vision LLM on a JPEG, as on the Mac; the screen model is never run | the screen model alone (`runScreenModel`), no JPEG |
| Study verdict | Ollama's answer (`guessStudy` turns an unsure "not study" into a subject) | always final (`isFinalAlone`) |
| "Not study" verdict | Ollama's answer | final at ≥ `EMBED_NOT_STUDY_CONFIDENCE` 0.6, else `unknown` with no error, marked `unsure`: an answer, not a failed live check, so the same window isn't captured and read again every settle period |
| No verdict (not installed, error, timeout) | `unknown` (`error: 'vlm'`) | `unknown` (`error: 'vlm'`) |
| Ollama | opened at boot/session start (`prepare`), warmed up, asked | never opened, warmed up or asked; both models are still unloaded at session end in case the mode changed mid-session (the screen-model unload is awaited at most `UNLOAD_WAIT_MS` 3 s) |
| Sidebar status | Ollama / model status | `screenModelLine()`: on-device classifier ready / not downloaded |

Onboarding starts with **Your PC** / **Your Mac** (`PcStep` in `OnboardingPage.tsx`): two cards explain each model, what computer it suits, its speed and download, and the answer sets `classifierMode`. `AppShellApi.hardware()` (memory, chip, and on Windows the DXGI adapter with the most dedicated video memory) feeds `recommendClassifierMode` in `core/hardware.ts`, which preselects a card and shows "This PC: …": the vision LLM needs 15 GiB of RAM plus Apple silicon other than a base M1/M2/M3 (`isSlowAppleChip`; Pro/Max/Ultra and M4 on qualify) on the Mac, or a dedicated GPU with ≥ 4 GiB on Windows, otherwise the classifier; unreadable hardware preselects nothing. "On-device classifier" (recommended when unsure) replaces the Ollama and AI-model steps with its own download step; "Vision LLM" keeps them. `onboardingSteps()` builds the list. Settings disables "On-device classifier" until the model is downloaded (onboarding may pick it first, then downloads it). Older saves migrate in `cleanSettings` (`core/db.ts`): `'embed'` → `'classifier'`, the removed `'hybrid'` → `'vlm'`.

Study calls have no bar because the subject guess is mostly right even when unsure. The 0.6 "not study" cutoff comes from P(study) on the bench: on 54 screenshots every distraction reaches confidence ≥ 0.6 and no study screen is called a distraction, so 0.6 flags 24/24 and turns only P(study) 0.4–0.5 into `unknown`. Re-pick it when the bench grows. The fusion weights (`FUSION`) were fitted for top-1 over every screen, which is what this mode needs. The study/not-study gate in `fuseScores` uses every library subject's image prompt (`lib_*`), not only the subjects the user has on, as the bench's default run does, so a switched-off subject can't turn study screens into confident distractions. `bench.py --my-subjects` still gates on the selected subjects only, so with that flag the bench no longer matches the app.
- Privacy: frame, OCR text and embeddings stay in native memory; JS gets scores and the OCR character count; logs carry timings and labels. The bench writes no images or text and prints character counts only.

### How well it works

Real screenshots, 39 after batch 1 (2026-10-14): 20 study screens (CS courses on PDF / VS Code / Blackboard, plus calculus exercises, an economics book on Google Books, Desmos, IB physics notes, a YouTube probability lecture, Claude explaining C structs) and 19 distractions (Netflix, TV, 2 YouTube Shorts, YouTube home and a music video, TikTok, Twitch, Instagram, Reddit, Pinterest, Discord, chess.com, a Steam promo page, Amazon, Nike, BBC, a football report, Spotify). Batch 1 sidecars have `windowTitle` and `kind`; the first 18 have no titles.

Re-run 2026-10-26 after main added **Computer Architecture** and **Information Management** to the library (46 subjects, prompts regenerated). The user's screenshots of those two courses are now library cases (prefixes `computer_architecture` / `information_management`, the old stand-in subject in `accept`), so only Systems Programming is still a custom course:

| | image only | text only | keywords only | fused, leave-one-out |
| --- | --- | --- | --- | --- |
| library subjects only | 77% | 62% | 36% | **92%** (36/39, 95% CI 80–97) |
| + Systems Programming as a custom course (name only) | 69% | 62% | 36% | **87%** (73–94) |
| + its 8 keywords (`--course-keywords`) | 69% | 67% | 38% | **92%** (80–97); 95% with the shipped params |
| study vs distraction | 39/39 | | | 39/39 |

On the 44-subject library (2026-10-14) the same set gave 95% with library subjects and 85% with 3 custom courses. The one extra miss comes from the new subject: Information Management pulls in an Algorithms screen, and one Information Management screen goes to Sociology. All 3 library misses are unsure (confidence 0.05–0.15); `parity.mjs` 39/39 identical.

**54 after batch 2** (2026-10-26, 15 of the planned 20): 30 study / 24 not study. Added: Computer Architecture slides (Blackboard ALU) and Obsidian notes, Information Management UML in Google Docs and XML slides, Systems Programming C in VS Code and a Makefile lab page, ChatGPT on mitosis and on a student-managed fund (Finance), a YouTube physics lecture and a **full-screen** chemistry lecture; Instagram Reels, TikTok For You, a YouTube travel vlog, the Disney+ landing page (Spanish) and a WhatsApp self-chat. Titles come from `scripts/embed_bench/save-title.ps1` (full foreground title, no truncation).

| 54 screenshots | image only | text only | keywords only | fused, leave-one-out | app params |
| --- | --- | --- | --- | --- | --- |
| library subjects only | 72% | 67% | 41% | **94%** (85–98) | 93% (50/54) |
| + Systems Programming (name only) | 65% | 67% | 41% | **87%** (76–94) | 87% |
| + its 9 keywords (below) | 65% | 74% | 46% | **94%** (85–98) | 96% (52/54) |
| study vs distraction | 54/54 | | | 54/54 | |

- Every new hard case is right: the full-screen lecture, both AI chats, the travel vlog and the Spanish Disney+ page. `parity.mjs` 54/54 (re-checked 2026-11-01 after the all-library gate in `fuseScores`: same numbers, app 50/54). The remaining library misses are unsure (≤ 0.19): an Algorithms Blackboard page → Information Management, a batch-1 Information Management screen → Sociology, a Coding screen → Probability, a Systems Programming PDF → Computer Architecture.
- The classifier mode's "not study" bar (0.6) flags all 24 distractions. For the record, the removed hybrid bars also held: study at 0.2 answered 14 of 30, all right (a wrong one sat at 0.19), "not study" at 0.7 answered 21 of 24, all right.
- **User keywords, measured:** the user's own Systems Programming list (`pointer, malloc, C, free(), Linux, Unix, Structure, shell, command`) scored the same top-1 (96% app) but `C` voted Systems Programming on 21 of the 49 other screens (drive letters, single-letter labels, Desmos, physics notes); `free()` never matches (code shows `free(s)`), and `Linux`/`Unix`/`shell` hit none of the user's screens. A list picked by counting each word's hits on the course's screens vs every other screen (`CSU22014, malloc, pointer, struct, Makefile, gcc, gdb, sizeof, segmentation fault`) keeps 96% and cuts wrong-course votes from 20 to 1 (the course name in an Obsidian sidebar). Top-1 hides keyword harm until a weak image flips an answer, so judge keywords by own vs other hits; this is what a course-keyword UI should warn about (single letters, punctuation, words never on screen).

- Shipped parameters (`FUSION` in `screenModel.ts` = `APP_PARAMS` in `bench.py`): alpha 0.25, tImg 1, tTxt 0.05, gImg 0.5, gTxt 0, beta 0.5, tKw 0.5. On 46 subjects the all-image fit prefers beta 1 (as it already did with custom courses), within noise on 39 images, so unchanged.
- The gate separates cleanly: study screens have P(study) ≥ 0.6 and distractions ≤ 0.32, so no study screen (not even the YouTube lecture) is called a distraction.
- Confidence sits low because P(subject) is spread over 46+ subjects, so study calls have no bar: in the classifier mode the top subject is used whatever its confidence (most wrong ones are below 0.2). Until 2026-10-26 the hybrid mode sent study calls below 0.2 (`MIN_CONFIDENCE`) and "not study" below 0.7 to Ollama; those bars are gone with it.
- "Not study" confidence is 1 − P(study), which never drops below 0.5, and a wrong "distracted" fires alerts, so it has its own bar (`EMBED_NOT_STUDY_CONFIDENCE` 0.6, above).
- Keyword hits are noisy on distractions (7 of them hit Statistics, 2 Political Science), most likely from the Chrome tab strip, which shows the same study tabs in every screenshot. That's real for this user, and keywords only weigh in the subject choice, not the gate.
- Speed on the Ryzen 5 7545U: ~0.3–0.6 s per check once loaded (capture ~55 ms, OCR ~100 ms, image ~150 ms, text ~30 ms), ~1.5 s for the first check of a session (loading). About 1 GB RAM while loaded; unloaded at session end. Download ~460 MB at the time (~505 MB with the multilingual text model and its vocabulary).
- Synthetic mock screens score 10/10; they're too clean to tune on.

### Option 2 results (2026-10-13)

`scripts/embed_bench/option_bench.py` scores every option (" <name><end_of_utterance>", summed token log-probs) after the screenshot + question, prefix run once and options batched on copies of its KV cache. Flags: `--edge 0|1024` (one 512 px image = 64 image tokens, or 512 px tiles of a 1024 px screen ≈ 192–320), `--calibrate` (subtract each option's score on a blank grey screen: contextual calibration, removes the model's favourite answers), `--norm mean`, `--list-options`, `--courses`, `--rerank-from <bench.py --dump-scores file>` (only Option 1's top-5 + "Not study", and the simulated pipeline "Option 1 when sure, else Option 2"). Same 18 images, no window titles, Ryzen 5 7545U:

| | top-1 | per check | peak RAM |
| --- | --- | --- | --- |
| Option 1 (fused, app params) | **17/18 (94%)** | ~0.5 s | ~1 GB in-app |
| 256M, 512 px, raw / listed options / 1024 px tiles | 3/18 (17%) each | 1.7 / 2.4 / 5.3 s | 1.7–2.0 GB |
| 256M, 512 px, calibrated (sum or mean) | 8/18 (44%) | 1.6–2.2 s | 1.7 GB |
| 256M, 512 px, calibrated, rerank top-5 | 8/18 (44%) | 1.2 s | 1.6 GB |
| 500M, 512 px, raw / calibrated | 5/18 / 6/18 | 3.1–3.2 s | 2.8 GB |
| 500M, 512 px, calibrated, rerank top-5 | 10/18 (56%) | 2.1 s | 2.7 GB |

- On the 11 screens Option 1 is unsure of (< 0.15, Ollama's share), Option 1's own guess is right 10/11; the best Option 2 gets 6/11. Every pipeline variant scores below Option 1 alone. Custom courses don't rescue it either (256M rerank with `--courses`: 6/18 vs Option 1's 12/18).
- Raw option scores have strong priors (Algorithms, Chemistry, Psychology, Business win regardless of the screen); calibration roughly doubles accuracy but not enough. More image tokens (tiles) made it slower without helping.
- Re-run on the 39 images after batch 1 (2026-10-14), it does worse: 256M calibrated 9/39 (23%), 500M calibrated rerank 14/39 (36%). It can't tell distractions apart (0 right on shopping, social, games, news, music; it picks Business, Web Development or Digital Logic for them), while Option 1 gets all 19. On the 16 screens Option 1 is unsure of, Option 1's guess is right 15/16 and Option 2's 7/16.
- **Verdict: not adopted.** It misses the bar on accuracy (needed ≥ Option 1 + 10 points) and on RAM (≤ ~600 MB extra). Revisit only with a stronger small VLM, or after the larger bench if Option 1 drops a lot on non-CS subjects.
- Side finding: Option 1's low-confidence answers are mostly right (10/11 below 0.15 on 18 images; 9/11 below 0.2 on 39). That's part of why the classifier mode uses every study call as it is.

### To do (from the plan)

1. ~~**Option 2**~~: benched 2026-10-13, not adopted (above).
2. **Spanish** (`--lang es`): multilingual MiniLM (`paraphrase-multilingual-MiniLM-L12-v2`), `es-ES` OCR (installed), Spanish prompt templates; SigLIP 2 is already multilingual.
3. ~~**macOS**~~: done 2026-11-01 with ONNX Runtime (same files) + Vision OCR. Still to do: a bench run with Vision OCR on the Mac; optionally try the CoreML execution provider.
4. ~~A Settings entry for the download~~ (Settings → Local AI, with the classifier mode). Still to do: hosting/mirroring of the model files before a real release.
5. Pin down the `hermes.dll` crash above.

### How to keep improving Option 1

- **More real screenshots** in `larpless/bench/`, in batches: batch 1 = 16 distractions (feeds, chat, non-study video, games, shopping, news, 2–3 each) + 6 study (non-CS, plus hard cases like a YouTube lecture or ChatGPT); batch 2 = ~20 aimed at batch 1's misses (15 in so far); the holdout is done: 11 images in `bench/holdout/`, frozen 2026-11-19, scored with `--dir holdout` once per shipped change set and never tuned on (add new screenshots to the dev set, not there). About 60/40 study/not. Name `<prefix>__<desc>.png` (prefix = correct answer); sidecar `{"windowTitle": "...", "kind": "social", "accept": [...], "course": "..."}` with `windowTitle` always, `accept` only for genuinely right alternatives, `course` only for the user's own courses. Save the title with `powershell -ExecutionPolicy Bypass -File scripts\embed_bench\save-title.ps1 <name>` (click into the window within 5 s; writes `<name>.txt` with the full title). The format and report helpers live in `benchdata.py`; the report prints Wilson 95% intervals, per-verdict curves and misses by `kind`. Own material only, chats and notifications closed.
- **Keywords for custom courses**: every remaining custom-course miss is a near-miss to a library subject with keywords (Systems Programming → Coding, and Computer Architecture → Digital Logic before it joined the library). 8 keywords per course lifted accuracy with custom courses from 82% to 90% on 39 screenshots with 3 custom courses, and from 87% to 92% with Systems Programming alone (`bench.py --courses --course-keywords`), so prompt users for keywords when they add a course. Guidance for choosing them (also what the UI hint should say):
  - **6–10 per course, about 8.** Each distinct keyword found counts as one vote (`softmax(hits / 0.5)`), so a couple of extra hits decide clearly; generic words only add wrong votes.
  - **Distinctive jargon, named concepts and tools** that actually appear on the screen while studying it (slide titles, assignment and file names, tools): `malloc`, `fork`, `segmentation fault`, `Makefile` rather than `memory` or `program`. Multi-word phrases are fine and often better (`ER diagram`, `primary key`).
  - **No short or common words.** Matching is whole-word and case-insensitive: the library's `R` fired on 12 of 39 screens, and `table`, `function`, `analysis`, `model`, `series` all voted for wrong subjects.
  - **Nothing shared with the user's other courses** (it splits the vote): what makes this course different, e.g. `pipeline`, `cache` for Computer Architecture rather than `logic gate`.
  - **A course code only with its number** (`CS2010`, not `CS`); the course name already counts, so don't repeat it.
  - Test per word: would it show up on another course's screen, or on Reddit/YouTube? Then drop it.
- **Reports beyond overall top-1** (all in memory, no images or text written): every run prints top-1 and the "right at ≥ 0.2" share **per subject area** (`SUBJECT_GROUPS`, exported by `export_subjects.mjs`) plus a **coverage** list of library subjects with no screenshot. `--subjects-n 3,5,8,15,46` (`--draws`, `--seed`) re-scores every study screen with only N candidate subjects (random draws plus a same-area "hard" draw), as for a user with few modules; `--ablation` adds top-1 per channel combination; `--composite [names]` pastes not-study screenshots (default Spotify, Discord, YouTube home) beside (`split`, right 40%) or over (`pip`) every study screen and reports gate losses, flips against the plain screen and keyword effect (#28).
  - First run (2026-11-06, 54 images): only 16/46 subjects covered (no Engineering, Humanities, Health or Arts screens). Fewer candidates help: random top-1 94% / 92% / 90% / 86% / 87% at N = 3 / 5 / 8 / 15 / 46, and right-at-≥0.2 94% → 47%. Keywords never hurt in the simulation (they turn ~1–4 answers right). Text is the strongest single channel (63–89%), image alone the weakest (50–72%). Composites: 77% (139/180) vs 87% on the plain study screens; `split` 62/90, `pip` 77/90; **6/180 study screens called "not study"** (all `split`); flips go to Music Theory (`MUSIC`), Law and Statistics (`R`). In-sample fits prefer `t_txt 0.1` and `beta 1` at every N (not adopted: in-sample).
- **Core subjects and roll-up** (#35, 2026-11-10, 54 images): `bench.py --rollup` turns optional subjects off and scores every study screen against where it should land (its own subject if on, else its group's general subject). "drop" removes the off subjects from the candidates; "hidden" keeps those with a general subject as candidates and relabels a win (what the app does: `candidateSubjects` + `rollUpSubject`). Screens whose subject is off: Computing specifics off 8/11 drop vs 10/11 hidden; Maths specifics off 3/4 vs 4/4; only the eight core subjects on 13/19 vs 18/19 (overall 23/29 vs 27/29). Dropped CS screens drift to Electrical Engineering, Linguistics, Maths or Literature. Hidden has one cost: with only core subjects on, the 14 hidden Maths/Computing candidates outnumber the rest, and one finance chat goes to Computer Science instead of Economics. Renaming Coding to Computer Science (same id `lib_coding`, keywords plus "coding", "programming") left the all-on result unchanged: app 50/54 with the same four misses, study vs distraction 54/54, `parity.mjs` 54/54. Sidecars that accept "Coding" still count (`RENAMED` in `benchdata.py`). Not measured: the VLM path (no qwen3-vl on the bench machine).
- **Overfitting guard** (2026-11-19): every run also prints `grouped`, the fused score with whole sources held out per fold (all of a subject's screens, or all distractions of one `kind`), so a sibling screenshot of the same course or site can't vouch for the parameters. On main after #52: leave-one-out 87% (47/54), grouped 89% (48/54), app params 91% (49/54). Grouped ≈ leave-one-out, so the parameter fit isn't leaning on near-duplicates; the app being above both is the in-sample edge of params picked on this bench, so quote ~87–89% as the honest figure. CV only guards fitted parameters, not hand edits (keywords, prompts, renames), which is what the holdout is for. Rule: a change ships only if `grouped` doesn't drop and the gain is ≥ 2 images on 54; in-sample fits are never adopted; the holdout is scored once per shipped change set and logged here, never used to choose between options.
- **Holdout v1** (`bench/holdout/`, 2026-11-19, scored once on main `131f423`, nothing tuned): 9 of the planned 12, all from areas the dev set never covered and with no window titles (harder than the app, which has one): Anatomy (Britannica diagram), Languages (worksheet), Law (case-law page), Mechanical Engineering (full-screen YouTube statics problem; Physics accepted), Music Theory (Scribd sheet music), Psychology (ChatGPT); distractions: an off-topic ChatGPT chat (phones), a recipe blog, Spanish Wikipedia on a footballer. **App 9/9** (95% CI 70–100), study vs distraction 9/9. The torque video came out as Physics (accepted; the problem is a physics textbook one). Image alone missed Law (→ Finance); text alone called all three distractions study (Design, Business, Statistics), so the image gate is what catches look-alike reading. Those three "not study" confidences were 0.63 / 0.63 / 0.67, just above the 0.6 bar (dev-set distractions mostly 0.7–0.98): **don't raise `EMBED_NOT_STUDY_CONFIDENCE`**; hard distractions would become `unknown`. Then two more, and the holdout is **frozen at 11** (no X/LinkedIn feed): History (Google Books, Weimar/Nazi Germany) and Skyscanner (Spanish). Scored once on the same code: **app 10/11 (91%, 95% CI 62–98)**, study vs distraction 11/11, fused leave-one-out and grouped 10/11. The one miss is History → Political Science at confidence 0.15 (image said Literature, text Sociology: a humanities book page is spread over neighbouring subjects; History has no screenshot in the dev set). Skyscanner's "not study" 0.74. This agrees with the dev set's honest ~87–89%; never tune on these 11, and score them again only once per shipped change set.
- **Screen language + multilingual text model** (#79, 2026-11-27, Windows OCR). The Spanish set is `bench/es/`: 14 screens (11 study, 3 not), the user's own, with no separate Spanish holdout, so it is test-only and nothing was tuned on it. Each language was run against its "today" baseline (English OCR and keywords, `all-MiniLM-L6-v2`):

  | | app params | fused LOO | grouped | text alone | text p50 |
  | --- | --- | --- | --- | --- | --- |
  | Spanish, today | 7/14 | 57% | 57% | 50% | 22 ms |
  | Spanish, es OCR + es keywords, L6 | 11/14 | 71% | 71% | 64% | 20 ms |
  | Spanish, + multilingual fp32 | 12/14 | 79% | 79% | 79% | 52 ms |
  | **Spanish, multilingual int8, es+en keywords minus course codes (shipped)** | **13/14 (93%, CI 69–99)** | 93% | 93% | 64% | 23 ms |
  | English dev 54, L6 (old) | 49/54 | 87% | 89% | 72% | 34 ms |
  | **English dev 54, multilingual int8 (shipped)** | **50/54** | 89% | 87% | 65% | 31 ms |
  | English dev 54, int8 + `--my-subjects` | 51/54 | 93% | 93% | 69% | 22 ms |
  | English dev 54, L6 + `--my-subjects` | 49/54 | 83% | 85% | 87% | 33 ms |
  | **English holdout 11, int8 (scored once)** | **9/11** (was 10/11) | 73% | 73% | 55% | 36 ms |

  - **Spanish gains** come mostly from OCR language + Spanish keywords (7 → 11); the multilingual model adds the rest. The remaining Spanish miss is a law page called "not study".
  - **Keyword fixes from `--keyword-report`.** Languages' Spanish name isn't "Idiomas", because Spanish Wikipedia's "N idiomas" menu is on every page. English course codes (LAW, MUSIC, ISA…) are left out in Spanish; they fired on a Python tutorial and YouTube.
  - **The accent-folding matcher** changes nothing on English (identical 49/54 with `--ascii-keywords`; one fewer distraction keyword hit).
  - **English holdout:** the new miss is Music Theory → Languages. It was accepted for one model that serves both languages. The user chose that over a model per language, because bilingual students would otherwise need a second download.
  - **Cost** (ONNX Runtime, 4 threads, 256 tokens; `bench.py --text-onnx` runs the app's path):

    | | file | RAM | per page |
    | --- | --- | --- | --- |
    | L6 fp32 | 90 MB | +113 MB | 45 ms |
    | multilingual int8 | 118 MB | +162 MB | 43 ms |

  - **In the app (Windows):** a real session on Spanish biology notes gave Biology 0.76, at ~0.3 s per check.
- **Re-fit and re-check** after adding images: run `bench.py` (and `--courses`), update `APP_PARAMS` and `FUSION` together, then `--dump-scores` + `node scripts/embed_bench/parity.mjs <file>` must print `parity N/N identical`.
- **Confidence**: the 0.6 "not study" bar was picked on 39 images and re-checked on 54. With more data, pick it from the per-verdict curve (`bench.py` prints it), compare with the top-1 vs runner-up confidence, or fit a temperature on the fused score so the cut-off means a target accuracy.
- **Prompts**: change templates or distraction prompts in `scripts/embed_bench/prompts.py`, then rerun `export_prompts.py` to rebuild `FLScreenModelPrompts.json` (both copies: Windows and macOS; rebuild both apps). **Also rerun it whenever `subjectLibrary.ts` changes** (a new subject, or new first three keywords, which go into the prompt text): a library subject missing from the file gets no image score, like a custom course; `__tests__/core/screenModelPrompts.test.ts` catches a missing subject (not changed keywords).
- int8 quantisation of the vision tower cut its size 4× (94 MB) and halved latency but dropped image-only accuracy on the synthetic set (10/10 → 8/10); re-test on real screenshots before using it.

## Tips for working from PowerShell

- `Get-Content -Raw` / `Set-Content` in Windows PowerShell 5.1 read BOM-less UTF-8 as ANSI and will mangle non-ASCII text. Edit with the Edit tool, or use `[IO.File]::ReadAllText/WriteAllText` with `UTF8Encoding($false)`.
- Pass `[NullString]::Value`, not `$null`, to .NET `string` parameters (PowerShell turns `$null` into `""`).
- Multi-line git commit messages: write a file and `git commit -F file`; here-strings with quotes get split into pathspecs.
