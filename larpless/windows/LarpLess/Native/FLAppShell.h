// FLAppShell: the twin of Native/Shell/FLAppShell.swift.
// - begin/endSessionActivity: a system-required power request + opting out of power throttling (EcoQoS), the
//   Windows equivalents of macOS's "user-initiated activity" that stops App Nap and idle sleep.
// - bringToFront: restore and focus the main window.
// - Ctrl+K / Ctrl+Enter / Ctrl+. emit FLMenuCommand ('commandPalette' | 'startSession' | 'endSession'), like the
//   macOS Session menu's ⌘K / ⌘↩ / ⌘. key equivalents.
#pragma once

#include <NativeModules.h>

#include <atomic>
#include <mutex>
#include <vector>

#include "FLWindow.h"

#include <TlHelp32.h>

namespace LarpLess {

// Quits the local Ollama tray app and its server. The loaded model lives in that process, so this
// is what frees the weights when the session ends or the app closes. No-op when Ollama isn't running.
inline void StopLocalOllama() noexcept {
  const HANDLE snap{CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)};
  if (snap == INVALID_HANDLE_VALUE) return;
  std::vector<DWORD> apps, servers;
  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);
  if (Process32FirstW(snap, &entry)) {
    do {
      // The tray app restarts ollama.exe, so it has to go first.
      if (_wcsicmp(entry.szExeFile, L"ollama app.exe") == 0) apps.push_back(entry.th32ProcessID);
      else if (_wcsicmp(entry.szExeFile, L"ollama.exe") == 0) servers.push_back(entry.th32ProcessID);
    } while (Process32NextW(snap, &entry));
  }
  CloseHandle(snap);
  const auto kill = [](DWORD pid) noexcept {
    const HANDLE process{OpenProcess(PROCESS_TERMINATE, FALSE, pid)};
    if (!process) return;
    TerminateProcess(process, 0);
    CloseHandle(process);
  };
  for (const DWORD pid : apps) kill(pid);
  for (const DWORD pid : servers) kill(pid);
}

REACT_MODULE(FLAppShell)
struct FLAppShell {
  using ReactContext = winrt::Microsoft::ReactNative::ReactContext;

  ~FLAppShell() noexcept {
    {
      std::lock_guard lock{s_mutex};
      if (s_current == this) {
        s_current = nullptr;
      }
    }
    EndSessionActivity();
  }

  REACT_INIT(Initialize)
  void Initialize(ReactContext const &reactContext) noexcept {
    m_context = reactContext;
    {
      std::lock_guard lock{s_mutex};
      s_current = this;
    }
    // The keyboard hook must live on the UI thread (it sees the keys the window's message loop receives).
    // It's installed once per process and outlives JS reloads; it routes to whichever module is current.
    m_context.UIDispatcher().Post([] {
      static HHOOK hook{SetWindowsHookExW(WH_KEYBOARD, &KeyboardProc, nullptr, GetCurrentThreadId())};
      s_hookInstalled = hook != nullptr;
      s_hookThread = GetCurrentThreadId();
    });
  }

  // Dev diagnostics (HarnessB-style): is the shortcut hook alive and seeing keys?
  REACT_METHOD(DebugInfo, L"debugInfo")
  void DebugInfo(winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    const HWND main{MainWindow()};
    result.Resolve(winrt::Microsoft::ReactNative::JSValue{winrt::Microsoft::ReactNative::JSValueObject{
        {"hookInstalled", s_hookInstalled.load()},
        {"hookThread", static_cast<double>(s_hookThread.load())},
        {"windowThread", static_cast<double>(main ? GetWindowThreadProcessId(main, nullptr) : 0)},
        {"hookCalls", static_cast<double>(s_hookCalls.load())},
        {"shortcutMatches", static_cast<double>(s_matches.load())},
        {"listeners", m_listeners.load()},
        {"jsDispatcher", static_cast<bool>(m_context.JSDispatcher())},
        {"sessionActivity", m_powerRequest != nullptr}}});
  }

  // Dev: emit a command as if its shortcut was pressed (tests the JS side without the keyboard).
  REACT_METHOD(DebugKey, L"debugKey")
  void DebugKey(std::string &&command) noexcept {
    if (command == "commandPalette" || command == "startSession" || command == "endSession") {
      MenuCommand(command);
    }
  }

  REACT_METHOD(BeginSessionActivity, L"beginSessionActivity")
  void BeginSessionActivity() noexcept {
    if (m_powerRequest) {
      return; // idempotent, like the macOS activity token
    }
    REASON_CONTEXT reason{POWER_REQUEST_CONTEXT_VERSION, POWER_REQUEST_CONTEXT_SIMPLE_STRING};
    reason.Reason.SimpleReasonString = const_cast<LPWSTR>(L"Focus session");
    const HANDLE request{PowerCreateRequest(&reason)};
    if (request == INVALID_HANDLE_VALUE) {
      return;
    }
    PowerSetRequest(request, PowerRequestSystemRequired);
    m_powerRequest = request;
    SetPowerThrottling(false);
  }

  REACT_METHOD(EndSessionActivity, L"endSessionActivity")
  void EndSessionActivity() noexcept {
    if (!m_powerRequest) {
      return;
    }
    PowerClearRequest(m_powerRequest, PowerRequestSystemRequired);
    CloseHandle(m_powerRequest);
    m_powerRequest = nullptr;
    SetPowerThrottling(true);
  }

  REACT_METHOD(BringToFront, L"bringToFront")
  void BringToFront() noexcept {
    BringMainWindowToFront(m_context);
  }

  REACT_METHOD(StopOllama, L"stopOllama")
  void StopOllama() noexcept {
    StopLocalOllama();
  }

  // NativeEventEmitter bookkeeping: only emit while JS listens.
  REACT_METHOD(AddListener, L"addListener")
  void AddListener(std::string && /*eventName*/) noexcept {
    ++m_listeners;
  }

  REACT_METHOD(RemoveListeners, L"removeListeners")
  void RemoveListeners(double count) noexcept {
    m_listeners = (std::max)(0, m_listeners.load() - static_cast<int>(count));
  }

  REACT_EVENT(MenuCommand, L"FLMenuCommand")
  std::function<void(std::string const &)> MenuCommand;

 private:
  // Let Windows throttle the process again (true) or keep it at full speed during a session (false).
  static void SetPowerThrottling(bool allow) noexcept {
    PROCESS_POWER_THROTTLING_STATE state{};
    state.Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION;
    state.ControlMask = allow ? 0 : PROCESS_POWER_THROTTLING_EXECUTION_SPEED;
    state.StateMask = 0;
    SetProcessInformation(GetCurrentProcess(), ProcessPowerThrottling, &state, sizeof(state));
  }

  void Emit(char const *command) noexcept {
    if (m_listeners <= 0) {
      return; // dropped when JS isn't listening, like macOS
    }
    // REACT_EVENT emission is thread-safe (it queues the call to JS itself). Don't hop via JSDispatcher(): in
    // the bridgeless/new-architecture runtime it's empty and posts to it are silently dropped.
    MenuCommand(command);
  }

  static LRESULT CALLBACK KeyboardProc(int code, WPARAM wParam, LPARAM lParam) noexcept {
    // lParam bit 31 = key released, bit 30 = key was already down (auto-repeat): act on the first key-down only.
    const bool keyDown{(lParam & (1LL << 31)) == 0};
    const bool repeat{(lParam & (1LL << 30)) != 0};
    if (code == HC_ACTION) {
      ++s_hookCalls;
    }
    // Physical modifier state: with WinAppSDK's lifted input the thread key state (GetKeyState) isn't updated.
    const auto down = [](int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; };
    if (code == HC_ACTION && keyDown && !repeat && down(VK_CONTROL) && !down(VK_MENU) && !down(VK_SHIFT)) {
      char const *command{nullptr};
      switch (wParam) {
        case 'K': command = "commandPalette"; break;
        case VK_RETURN: command = "startSession"; break;
        case VK_OEM_PERIOD: command = "endSession"; break;
      }
      if (command) {
        ++s_matches;
        std::lock_guard lock{s_mutex};
        if (s_current) {
          s_current->Emit(command);
          return 1; // handled, like a menu key equivalent (the key doesn't also reach a text field)
        }
      }
    }
    return CallNextHookEx(nullptr, code, wParam, lParam);
  }

  ReactContext m_context;
  HANDLE m_powerRequest{nullptr};
  std::atomic<int> m_listeners{0};

  static inline std::mutex s_mutex;
  static inline FLAppShell *s_current{nullptr};
  static inline std::atomic<bool> s_hookInstalled{false};
  static inline std::atomic<DWORD> s_hookThread{0};
  static inline std::atomic<long> s_hookCalls{0};
  static inline std::atomic<long> s_matches{0};
};

} // namespace LarpLess
