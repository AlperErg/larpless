// Shared helpers for the LarpLess Windows modules: the main window handle and bringing it to the front
// (the Windows equivalent of the macOS "activate app + show main window").
#pragma once

#include <NativeModules.h>

namespace LarpLess {

// Set once in WinMain (LarpLess.cpp) from the ReactNativeWin32App's AppWindow.
inline HWND &MainWindow() noexcept {
  static HWND hwnd{nullptr};
  return hwnd;
}

// Restores and focuses the main window. Call on the UI thread.
inline void BringMainWindowToFront() noexcept {
  const HWND hwnd{MainWindow()};
  if (!hwnd) {
    return;
  }
  ShowWindow(hwnd, IsIconic(hwnd) ? SW_RESTORE : SW_SHOW);
  // Windows only lets the foreground process change focus; briefly sharing input with it lifts that lock.
  const HWND foreground{GetForegroundWindow()};
  const DWORD foregroundThread{foreground ? GetWindowThreadProcessId(foreground, nullptr) : 0};
  const DWORD thisThread{GetCurrentThreadId()};
  const bool attached{foregroundThread != 0 && foregroundThread != thisThread &&
                      AttachThreadInput(thisThread, foregroundThread, TRUE) != FALSE};
  SetForegroundWindow(hwnd);
  BringWindowToTop(hwnd);
  if (attached) {
    AttachThreadInput(thisThread, foregroundThread, FALSE);
  }
}

// Runs BringMainWindowToFront on the UI thread.
inline void BringMainWindowToFront(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
  context.UIDispatcher().Post([] { BringMainWindowToFront(); });
}

} // namespace LarpLess
