// LarpLess.cpp : Defines the entry point for the application.
//

#include "pch.h"
#include "LarpLess.h"

#include "AutolinkedNativeModules.g.h"

#include "NativeModules.h"

// LarpLess native modules (same names and JS contract as the Swift modules in macos/Focusline-macOS/Native).
// Including them here registers them with AddAttributedModules below.
#include "Native/FLAppShell.h"
#include "Native/FLFloatingPanel.h"
#include "Native/FLKeychain.h"
#include "Native/FLNowPlaying.h"
#include "Native/FLNotifications.h"
#include "Native/FLOllama.h"
#include "Native/FLPermissions.h"
#include "Native/FLPing.h"
#include "Native/FLScreenCapture.h"
#include "Native/FLSound.h"
#include "Native/FLWebcam.h"
#include "Native/FLWindow.h"

#include <winrt/Windows.UI.ViewManagement.h>

namespace {

// Same canvases as src/ui/theme.ts and macos/Focusline-macOS/AppDelegate.mm (fl_syncWindowBackground).
void SyncMainWindowCanvas(HWND hwnd) {
  if (!hwnd) {
    return;
  }
  winrt::Windows::UI::ViewManagement::UISettings ui;
  const auto bg = ui.GetColorValue(winrt::Windows::UI::ViewManagement::UIColorType::Background);
  const bool dark = bg.R < 128;
  const COLORREF canvas = dark ? RGB(16, 17, 15) : RGB(243, 245, 248);
  const HBRUSH brush = CreateSolidBrush(canvas);
  if (brush) {
    SetClassLongPtrW(hwnd, GCLP_HBRBACKGROUND, reinterpret_cast<LONG_PTR>(brush));
    InvalidateRect(hwnd, nullptr, TRUE);
  }
}

} // namespace

// A PackageProvider containing any turbo modules you define within this app project
struct CompReactPackageProvider
    : winrt::implements<CompReactPackageProvider, winrt::Microsoft::ReactNative::IReactPackageProvider> {
 public: // IReactPackageProvider
  void CreatePackage(winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
    AddAttributedModules(packageBuilder, true);
  }
};

// The entry point of the Win32 application
_Use_decl_annotations_ int CALLBACK WinMain(HINSTANCE instance, HINSTANCE, PSTR /* commandLine */, int showCmd) {
  // Initialize WinRT
  winrt::init_apartment(winrt::apartment_type::single_threaded);

  // Enable per monitor DPI scaling
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  // Find the path hosting the app exe file
  WCHAR appDirectory[MAX_PATH];
  GetModuleFileNameW(NULL, appDirectory, MAX_PATH);
  PathCchRemoveFileSpec(appDirectory, MAX_PATH);

  // Create a ReactNativeWin32App with the ReactNativeAppBuilder
  auto reactNativeWin32App{winrt::Microsoft::ReactNative::ReactNativeAppBuilder().Build()};

  // Configure the initial InstanceSettings for the app's ReactNativeHost
  auto settings{reactNativeWin32App.ReactNativeHost().InstanceSettings()};
  // Register any autolinked native modules
  RegisterAutolinkedNativeModulePackages(settings.PackageProviders());
  // Register any native modules defined within this app project
  settings.PackageProviders().Append(winrt::make<CompReactPackageProvider>());

    // When loading the JS bundle from a file (not Metro):
  // Set the path (on disk) where the .bundle file is located
  settings.BundleRootPath(std::wstring(L"file://").append(appDirectory).append(L"\\Bundle\\").c_str());

  // Set the name of the bundle file (without the .bundle extension)
  settings.JavaScriptBundleFile(L"index.windows");

  // JS Entry file to use when loading from Metro:
  settings.DebugBundlePath(L"index");

#if BUNDLE
  // Disable hot reload - bundle will be loaded from prebuilt bundle file.
  settings.UseFastRefresh(false);
#else
  // Enable hot reload - load the JS bundle from Metro
  settings.UseFastRefresh(true);
#endif
#if _DEBUG
  // For Debug builds
  // Direct debugger + Metro still work; js-eval and Fast Refresh do not need the dev menu.
  settings.UseDirectDebugger(true);
  // RNW draws a green "Loading" bar while the bundle loads when this is true (not our BootScreen).
  settings.UseDeveloperSupport(false);
#else
  // For Release builds:
  // Disable Direct Debugging of JS
  settings.UseDirectDebugger(false);
  // Disable the Developer Menu
  settings.UseDeveloperSupport(false);
#endif

  // Get the AppWindow so we can configure its initial title and size.
  // Mirrors macos/Focusline-macOS/AppDelegate.mm: 1100x720 content, centred, minimum 900x600.
  // AppWindow sizes are in physical pixels, so scale the macOS point sizes by the window's DPI.
  auto appWindow{reactNativeWin32App.AppWindow()};
  appWindow.Title(L"LarpLess");
  const HWND hwnd{winrt::Microsoft::UI::GetWindowFromWindowId(appWindow.Id())};
  LarpLess::MainWindow() = hwnd;
  SyncMainWindowCanvas(hwnd);
  const UINT dpi{GetDpiForWindow(hwnd)};
  // Title bar / Alt+Tab icon from the exe's icon resource (LarpLess.ico); AppWindow doesn't pick it up by itself.
  const int iconSize{GetSystemMetricsForDpi(SM_CXICON, dpi)};
  if (const auto icon{static_cast<HICON>(
          LoadImageW(instance, MAKEINTRESOURCEW(IDI_ICON1), IMAGE_ICON, iconSize, iconSize, LR_SHARED))}) {
    appWindow.SetIcon(winrt::Microsoft::UI::GetIconIdFromIcon(icon));
  }
  const double scale{dpi / 96.0};
  const auto px = [scale](int dip) { return static_cast<int32_t>(dip * scale); };
  appWindow.ResizeClient({px(1100), px(720)});
  if (auto presenter{appWindow.Presenter().try_as<winrt::Microsoft::UI::Windowing::OverlappedPresenter>()}) {
    presenter.PreferredMinimumWidth(px(900));
    presenter.PreferredMinimumHeight(px(600));
  }
  const auto workArea{winrt::Microsoft::UI::Windowing::DisplayArea::GetFromWindowId(
                          appWindow.Id(), winrt::Microsoft::UI::Windowing::DisplayAreaFallback::Primary)
                          .WorkArea()};
  const auto size{appWindow.Size()};
  appWindow.Move({workArea.X + (workArea.Width - size.Width) / 2, workArea.Y + (workArea.Height - size.Height) / 2});
  // Closing the window quits the process. JS may already be gone, so quit Ollama here too, including the
  // llama-server runner that holds the model: Windows doesn't end child processes with their parent.
  // Skip the full quit if a launch/restart holds the lock rather than block the close on it.
  appWindow.Closing([](auto&&, auto&&) {
    try {
      std::unique_lock lock{LarpLess::OllamaHost::g_busy, std::try_to_lock};
      if (lock.owns_lock()) LarpLess::OllamaHost::QuitApp();
    } catch (...) {
    }
    LarpLess::StopLocalOllama();
  });

  // Get the ReactViewOptions so we can set the initial RN component to load
  auto viewOptions{reactNativeWin32App.ReactViewOptions()};
  viewOptions.ComponentName(L"LarpLess");

  // Start the app
  reactNativeWin32App.Start();
}
