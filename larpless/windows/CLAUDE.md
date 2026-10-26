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
powershell -ExecutionPolicy Bypass -File scripts\run-windows.ps1           # bundle JS into the app, build/deploy/launch (works from Start with no Metro)
powershell -ExecutionPolicy Bypass -File scripts\run-windows.ps1 -Metro    # load JS from Metro :8081 while developing
powershell -ExecutionPolicy Bypass -File scripts\launch-windows.ps1        # Metro + launch (only for -Metro installs)
Get-Process LarpLess -EA SilentlyContinue | Stop-Process; npx @react-native-community/cli run-windows --no-packager --logging *> .logs\build-windows.log   # rebuild only
```

Default installs embed `windows/LarpLess/Bundle/index.windows.bundle` (`EmbedJsBundle=true` → `BUNDLE` in `LarpLess.cpp`). Re-run `run-windows.ps1` after JS changes. `src/social/env.ts` is read at bundle time, so recreate the bundle when those keys change.

- Stop the running app before rebuilding. A first build takes several minutes; incremental ones about one.
- **`run-windows.ps1` deletes the downloaded screen model.** It removes the installed package, and that deletes its `LocalState` (`%LOCALAPPDATA%\Packages\LarpLess_96wyba02c09cm\LocalState\Models`, ~460 MB). Use the rebuild-only command instead, which keeps the package: with `--msbuildprops EmbedJsBundle=true` after `scripts\bundle-windows.ps1` for an embedded install, without it for a Metro one. On a Metro install, JS-only changes need no rebuild: start Metro (`npx react-native start --port 8081`) and relaunch the installed build (command below). An embedded install ignores Metro, so it needs the bundle + rebuild.
- **The installed build has to come from a branch with `FLScreenModel`** (`add-embeddings` and branches off it; `main` doesn't have it yet). A build from `main` has no `NativeModules.FLScreenModel`, so `native/index.ts` silently swaps in the mock, which always reports "not installed" even with the files in `LocalState\Models`: every check goes to Ollama, and `'embed'` mode turns every chunk into `unknown`. Check with `js-eval "__FL.NativeModules.FLScreenModel"` (null = wrong build) and rebuild after switching branches.
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
| FLScreenCapture | foreground window → pid → FileDescription; GDI StretchBlt of the foreground window's monitor → WIC JPEG in an `HGlobal` stream; own window hidden with `WDA_EXCLUDEFROMCAPTURE` during capture | `bundleId` is the exe name; Screen Recording is always `granted` |
| FLKeychain | DPAPI (current user) encrypted file per key under `%LOCALAPPDATA%\LarpLess\Secrets` | no per-app Keychain on Windows: protects against copied disks and backups, not other processes running as the user |
| FLPermissions | camera via `AppCapability("webcam")`; `openSettings` → `ms-settings:privacy-webcam`; `relaunch` → `AppInstance::Restart` | no screen permission on Windows |
| FLSound | XAudio2 port of the Swift engine (xorshift white, Kellet pink, brown; equal-power ramps; chimes) | — |
| FLWebcam | MediaCapture + MediaFrameReader (BGRA), YOLO11n via ONNX Runtime | — (same `person` / `cell phone` thresholds as Mac) |
| FLScreenModel | on-device screen classifier: GDI capture to BGRA (`FLScreenCapture::CaptureBgra`), `Windows.Media.Ocr`, SigLIP 2 vision tower + all-MiniLM-L6-v2 (C++ WordPiece in `FLWordPiece.h`) via ONNX Runtime; returns scores only, `core/screenModel.ts` fuses them. Models (~460 MB, pinned HF commits + SHA-256) download at onboarding into `LocalFolder\Models`; the fixed SigLIP prompt embeddings ship as `Assets/Models/FLScreenModelPrompts.json` (`scripts/embed_bench/export_prompts.py`) | Windows only: the Swift module is a stub that reports `supported: false`, so the Mac keeps using Ollama |
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

### Benchmarking the classifier

Windows Defender (AMSI) blocks PowerShell scripts that capture the screen, base64 it and POST it, even to localhost. Don't try to evade it: benchmark with a **generated** test image (System.Drawing text on a bitmap, never a real screenshot) posted to `/api/chat` with the app's options (`think: false`, the empty `<think>` prefill, `num_ctx: 4096`), or measure through the app, where `[ollama] <model> <ms> → <verdict>` lines show up in `js-eval --console`.

## On-device screen model (FLScreenModel)

Branch `add-embeddings` (2026-10-12). Goal: stop needing Ollama for most screen checks on CPU-only PCs, where a qwen3-vl check takes 25–30 s.

### The plan and why

An LLM council compared the current generative VLM with a small "decision" model (one that scores fixed options instead of writing JSON). Decisions:

- **laya-vision (thaitea/laya-vision) rejected.** Its weights are CC BY-NC-SA (not shippable in a distributed app), it runs only in PyTorch, and it was trained on game frames rather than screens. Copy the idea, not the artifact.
- **Option 1, embeddings + OCR (built):** SigLIP 2 image embeddings answer "study or distraction" (zero-shot against text prompts), and Windows OCR + MiniLM text embeddings + keyword hits answer "which subject". No training needed, Apache-2.0 models. SigLIP was chosen over CLIP: its sigmoid gives each label an independent score (it can say "none of these"), it was more accurate on the bench, and SigLIP 2 is multilingual.
- **Option 2, option scoring with a small VLM (benched, not adopted):** SmolVLM (Apache-2.0) used as a decision model: score each module name as an answer instead of generating. Meant as the backup if Option 1 isn't accurate enough; it lost clearly on the current set (see "Option 2 results").
- Wherever the model is unsure, Ollama still answers, so nothing regresses (the default `'hybrid'` mode). The `'embed'` mode drops Ollama entirely (see "Classifier modes").

### What was built

- `scripts/embed_bench/` (Python 3.12 venv; setup in `requirements.txt`): `bench.py` scores `larpless/bench/` screenshots with image / text / keyword / fused methods and reports accuracy, confidence curves and latency; `--courses` adds sidecar `"course"` names as custom courses; `--onnx` times the image tower in ONNX Runtime; `--dump-scores` + `parity.mjs` check that `src/core/screenModel.ts` gives identical answers to the bench. `export_prompts.py` builds `Assets/Models/FLScreenModelPrompts.json` (fixed SigLIP prompt embeddings) and checks the pinned ONNX files and the C++ resize against PyTorch.
- `Native/FLScreenModel.h`: capture to BGRA (`FLScreenCapture::CaptureBgra`), `Windows.Media.Ocr`, SigLIP 2 vision tower (PIL-style tent resize to 224, cosine 0.9999 to the official processor) and all-MiniLM-L6-v2 (`FLWordPiece.h`, matches Hugging Face's tokenizer on the test cases in `wordpiece_cases.json`) through ONNX Runtime, plus whole-word keyword counts. Returns numbers only. Downloads the models (pinned HF commits, SHA-256 checked) into `LocalFolder\Models`.
- JS: contract `ScreenModelApi` (`src/contracts/native.ts`), `src/core/screenModel.ts` (fusion, files, step), a step in `runVlm` in `src/core/classifier.ts` before the Ollama screenshot (source `'embed'`), `src/store/screenModelStore.ts`, `ScreenModelDownload` on onboarding's AI-model step and in Settings → Local AI (Windows only). macOS has a stub module reporting `supported: false`.

### Classifier modes

`Settings.classifierMode`, picked in Settings → Local AI → **Screen check** (Windows only; `isEmbedOnly()` in `sessionStore.ts` is false on other platforms whatever is saved). The classifier reads it through its `screenModelOnly()` dep on every check, so a change applies from the next check without a restart.

| | `'hybrid'` (default, "On-device + Ollama") | `'embed'` ("On-device only") |
| --- | --- | --- |
| Study verdict | final at ≥ `MIN_CONFIDENCE` 0.2, else Ollama | always final (`isFinalAlone`) |
| "Not study" verdict | final at ≥ `MIN_NOT_STUDY_CONFIDENCE` 0.7, else Ollama | final at ≥ `EMBED_NOT_STUDY_CONFIDENCE` 0.6, else `unknown` with no error |
| No verdict (not installed, error, timeout) | Ollama; an unsure verdict ≥ `FALLBACK_CONFIDENCE` if Ollama can't answer | `unknown` (`error: 'vlm'`) |
| Ollama | opened at boot/session start (`prepare`), warmed up, asked | never opened, warmed up or asked; still unloaded at session end in case the mode changed mid-session |
| Sidebar status | Ollama / qwen status | `screenModelLine()`: on-device classifier ready / not downloaded |

Why the two bars differ: in hybrid mode a threshold means "answer here or ask Ollama"; in embed mode there's no one to ask, so it means "worth an alert". Study calls have no bar because the subject guess is right 15/16 even when unsure. The 0.6 "not study" cutoff comes from P(study) on the 39-screenshot bench (2026-10-17, `bench.py --dump-scores` + a gate replay): distractions reach P(study) ≤ 0.317 (confidence ≥ 0.683), study screens ≥ 0.605, so 0.6 still flags 19/19 distractions and turns only P(study) 0.4–0.5 into `unknown`. Re-pick it with the other thresholds when the bench grows. The fusion weights (`FUSION`) are shared by both modes: they were already fitted for top-1 over every screen, which is what embed mode needs.
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

On the 44-subject library (2026-10-14) the same set gave 95% with library subjects and 85% with 3 custom courses. The one extra miss comes from the new subject: Information Management pulls in an Algorithms screen, and one Information Management screen goes to Sociology. All 3 library misses are unsure (confidence 0.05–0.15), so hybrid mode sends them to Ollama; `parity.mjs` 39/39 identical.

**54 after batch 2** (2026-10-26, 15 of the planned 20): 30 study / 24 not study. Added: Computer Architecture slides (Blackboard ALU) and Obsidian notes, Information Management UML in Google Docs and XML slides, Systems Programming C in VS Code and a Makefile lab page, ChatGPT on mitosis and on a student-managed fund (Finance), a YouTube physics lecture and a **full-screen** chemistry lecture; Instagram Reels, TikTok For You, a YouTube travel vlog, the Disney+ landing page (Spanish) and a WhatsApp self-chat. Titles come from `scripts/embed_bench/save-title.ps1` (full foreground title, no truncation).

| 54 screenshots | image only | text only | keywords only | fused, leave-one-out | app params |
| --- | --- | --- | --- | --- | --- |
| library subjects only | 72% | 67% | 41% | **94%** (85–98) | 93% (50/54) |
| + Systems Programming (name only) | 65% | 67% | 41% | **87%** (76–94) | 87% |
| + its 9 keywords (below) | 65% | 74% | 46% | **94%** (85–98) | 96% (52/54) |
| study vs distraction | 54/54 | | | 54/54 | |

- Every new hard case is right: the full-screen lecture, both AI chats, the travel vlog and the Spanish Disney+ page. `parity.mjs` 54/54. The remaining library misses are unsure (≤ 0.19): an Algorithms Blackboard page → Information Management, a batch-1 Information Management screen → Sociology, a Coding screen → Probability, a Systems Programming PDF → Computer Architecture.
- Thresholds hold, unchanged: study at 0.2 answers 14 of 30, all right (the one wrong study answer above 0.15 sits at 0.19); "not study" at 0.7 answers 21 of 24, all right; embed mode's 0.6 flags all 24.
- **User keywords, measured:** the user's own Systems Programming list (`pointer, malloc, C, free(), Linux, Unix, Structure, shell, command`) scored the same top-1 (96% app) but `C` voted Systems Programming on 21 of the 49 other screens (drive letters, single-letter labels, Desmos, physics notes); `free()` never matches (code shows `free(s)`), and `Linux`/`Unix`/`shell` hit none of the user's screens. A list picked by counting each word's hits on the course's screens vs every other screen (`CSU22014, malloc, pointer, struct, Makefile, gcc, gdb, sizeof, segmentation fault`) keeps 96% and cuts wrong-course votes from 20 to 1 (the course name in an Obsidian sidebar). Top-1 hides keyword harm until a weak image flips an answer, so judge keywords by own vs other hits; this is what a course-keyword UI should warn about (single letters, punctuation, words never on screen).

- Shipped parameters (`FUSION` in `screenModel.ts` = `APP_PARAMS` in `bench.py`): alpha 0.25, tImg 1, tTxt 0.05, gImg 0.5, gTxt 0, beta 0.5, tKw 0.5. On 46 subjects the all-image fit prefers beta 1 (as it already did with custom courses), within noise on 39 images, so unchanged.
- The gate separates cleanly: study screens have P(study) ≥ 0.6 and distractions ≤ 0.32, so no study screen (not even the YouTube lecture) is called a distraction.
- Confidence sits low because P(subject) is spread over 46+ subjects. `MIN_CONFIDENCE` 0.2 answers 9 of 20 study screens, all right (on 46 subjects nothing wrong reaches 0.15); the rest go to Ollama. `FALLBACK_CONFIDENCE` 0.05 is used when Ollama can't answer.
- "Not study" has its own bar, `MIN_NOT_STUDY_CONFIDENCE` 0.7 (`isConfident` in `screenModel.ts`). Its confidence is 1 − P(study), which never drops below 0.5, so under the study bar every distraction call skipped Ollama, and a wrong "distracted" fires alerts. At 0.7 it answers 17 of 19 distractions, all right; the two YouTube Shorts (0.68 / 0.69) get an Ollama check.
- Keyword hits are noisy on distractions (7 of them hit Statistics, 2 Political Science), most likely from the Chrome tab strip, which shows the same study tabs in every screenshot. That's real for this user, and keywords only weigh in the subject choice, not the gate.
- Speed on the Ryzen 5 7545U: ~0.3–0.6 s per check once loaded (capture ~55 ms, OCR ~100 ms, image ~150 ms, text ~30 ms), ~1.5 s for the first check of a session (loading). About 1 GB RAM while loaded; unloaded at session end. Download ~460 MB.
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
- Side finding: Option 1's low-confidence answers are mostly right (10/11 below 0.15 on 18 images; 9/11 below 0.2 on 39). Ollama only adds value there if it beats that, which is worth measuring in the app (`[embed]` vs `[ollama]` lines) before lowering `MIN_CONFIDENCE`.

### To do (from the plan)

1. ~~**Option 2**~~: benched 2026-10-13, not adopted (above).
2. **Spanish** (`--lang es`): multilingual MiniLM (`paraphrase-multilingual-MiniLM-L12-v2`), `es-ES` OCR (installed), Spanish prompt templates; SigLIP 2 is already multilingual.
3. **macOS**: replace the Swift stub with CoreML (SigLIP vision + MiniLM) + Vision OCR.
4. ~~A Settings entry for the download~~ (Settings → Local AI, with the classifier mode). Still to do: hosting/mirroring of the model files before a real release.
5. Pin down the `hermes.dll` crash above.

### How to keep improving Option 1

- **More real screenshots** in `larpless/bench/`, in batches: batch 1 = 16 distractions (feeds, chat, non-study video, games, shopping, news, 2–3 each) + 6 study (non-CS, plus hard cases like a YouTube lecture or ChatGPT); batch 2 = ~20 aimed at batch 1's misses (15 in so far); then a frozen 12-image holdout in `bench/holdout/`, scored once with `--dir holdout` and never tuned on. About 60/40 study/not. Name `<prefix>__<desc>.png` (prefix = correct answer); sidecar `{"windowTitle": "...", "kind": "social", "accept": [...], "course": "..."}` with `windowTitle` always, `accept` only for genuinely right alternatives, `course` only for the user's own courses. Save the title with `powershell -ExecutionPolicy Bypass -File scripts\embed_bench\save-title.ps1 <name>` (click into the window within 5 s; writes `<name>.txt` with the full title). The format and report helpers live in `benchdata.py`; the report prints Wilson 95% intervals, per-verdict curves and misses by `kind`. Own material only, chats and notifications closed.
- **Keywords for custom courses**: every remaining custom-course miss is a near-miss to a library subject with keywords (Systems Programming → Coding, and Computer Architecture → Digital Logic before it joined the library). 8 keywords per course lifted accuracy with custom courses from 82% to 90% on 39 screenshots with 3 custom courses, and from 87% to 92% with Systems Programming alone (`bench.py --courses --course-keywords`), so prompt users for keywords when they add a course. Guidance for choosing them (also what the UI hint should say):
  - **6–10 per course, about 8.** Each distinct keyword found counts as one vote (`softmax(hits / 0.5)`), so a couple of extra hits decide clearly; generic words only add wrong votes.
  - **Distinctive jargon, named concepts and tools** that actually appear on the screen while studying it (slide titles, assignment and file names, tools): `malloc`, `fork`, `segmentation fault`, `Makefile` rather than `memory` or `program`. Multi-word phrases are fine and often better (`ER diagram`, `primary key`).
  - **No short or common words.** Matching is whole-word and case-insensitive: the library's `R` fired on 12 of 39 screens, and `table`, `function`, `analysis`, `model`, `series` all voted for wrong subjects.
  - **Nothing shared with the user's other courses** (it splits the vote): what makes this course different, e.g. `pipeline`, `cache` for Computer Architecture rather than `logic gate`.
  - **A course code only with its number** (`CS2010`, not `CS`); the course name already counts, so don't repeat it.
  - Test per word: would it show up on another course's screen, or on Reddit/YouTube? Then drop it.
- **Re-fit and re-check** after adding images: run `bench.py` (and `--courses`), update `APP_PARAMS` and `FUSION` together, then `--dump-scores` + `node scripts/embed_bench/parity.mjs <file>` must print `parity N/N identical`.
- **Confidence**: the 0.2 / 0.7 thresholds are from 39 images (batch 1), re-checked on 54 (batch 2). With more data, pick each from the per-verdict curve, compare with the top-1 vs runner-up confidence, or fit a temperature on the fused score so the cut-off means a target accuracy.
- **Prompts**: change templates or distraction prompts in `scripts/embed_bench/prompts.py`, then rerun `export_prompts.py` to rebuild `FLScreenModelPrompts.json` (and rebuild the app). **Also rerun it whenever `subjectLibrary.ts` changes** (a new subject, or new first three keywords, which go into the prompt text): a library subject missing from the file silently gets no image score, like a custom course, and no test catches it.
- int8 quantisation of the vision tower cut its size 4× (94 MB) and halved latency but dropped image-only accuracy on the synthetic set (10/10 → 8/10); re-test on real screenshots before using it.

## Tips for working from PowerShell

- `Get-Content -Raw` / `Set-Content` in Windows PowerShell 5.1 read BOM-less UTF-8 as ANSI and will mangle non-ASCII text. Edit with the Edit tool, or use `[IO.File]::ReadAllText/WriteAllText` with `UTF8Encoding($false)`.
- Pass `[NullString]::Value`, not `$null`, to .NET `string` parameters (PowerShell turns `$null` into `""`).
- Multi-line git commit messages: write a file and `git commit -F file`; here-strings with quotes get split into pathspecs.
