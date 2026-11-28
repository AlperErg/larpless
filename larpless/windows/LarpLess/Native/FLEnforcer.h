// FLEnforcer: the twin of Native/Enforcer (EnforcerApi).
// Closes the distracting app on Windows via taskkill.
// SAFETY: never closes LarpLess itself, Explorer, or Windows.
// Brave is the main one: YouTube / Instagram / TikTok run inside Brave,
// so closing brave.exe closes the distraction.
#pragma once

#include <NativeModules.h>

#include <string>
#include <thread>
#include <algorithm>

namespace LarpLess {

inline std::wstring EnforcerExeForApp(std::string appName) {
  // lowercase it
  std::transform(appName.begin(), appName.end(), appName.begin(),
                 [](unsigned char c) { return (char)std::tolower(c); });

  // NEVER kill these
  if (appName.find("larpless") != std::string::npos) return L"";
  if (appName.find("larp less") != std::string::npos) return L"";
  if (appName.find("explorer") != std::string::npos) return L"";
  if (appName.find("windows") != std::string::npos) return L"";

  // Browsers - Brave first, since you use Brave
  if (appName.find("brave") != std::string::npos) return L"brave.exe";
  if (appName.find("chrome") != std::string::npos) return L"chrome.exe";
  if (appName.find("edge") != std::string::npos) return L"msedge.exe";
  if (appName.find("firefox") != std::string::npos) return L"firefox.exe";
  if (appName.find("opera") != std::string::npos) return L"opera.exe";
  if (appName.find("arc") != std::string::npos) return L"Arc.exe";

  // Apps
  if (appName.find("discord") != std::string::npos) return L"Discord.exe";
  if (appName.find("spotify") != std::string::npos) return L"Spotify.exe";
  if (appName.find("steam") != std::string::npos) return L"steam.exe";
  if (appName.find("telegram") != std::string::npos) return L"Telegram.exe";
  if (appName.find("whatsapp") != std::string::npos) return L"WhatsApp.exe";
  if (appName.find("tiktok") != std::string::npos) return L"brave.exe";
  if (appName.find("youtube") != std::string::npos) return L"brave.exe";
  if (appName.find("instagram") != std::string::npos) return L"brave.exe";
  if (appName.find("twitter") != std::string::npos) return L"brave.exe";
  if (appName.find("x.com") != std::string::npos) return L"brave.exe";
  if (appName.find("reddit") != std::string::npos) return L"brave.exe";

  // Unknown: if it already looks like an exe, use it, otherwise don't guess
  if (appName.size() > 4 && appName.substr(appName.size() - 4) == ".exe") {
    return std::wstring(appName.begin(), appName.end());
  }
  return L"";
}

REACT_MODULE(FLEnforcer)
struct FLEnforcer {
  using JSValue = winrt::Microsoft::ReactNative::JSValue;
  using ReactError = winrt::Microsoft::ReactNative::ReactError;
  template <typename T>
  using ReactPromise = winrt::Microsoft::ReactNative::ReactPromise<T>;

  // JS calls: closeDistractingApp("Brave")
  REACT_METHOD(CloseDistractingApp, L"closeDistractingApp")
  void CloseDistractingApp(std::string &&appName, ReactPromise<void> &&result) noexcept {
    std::thread([appName = std::move(appName), result = std::move(result)]() mutable noexcept {
      if (appName.empty()) {
        result.Resolve();
        return;
      }
      const std::wstring exe = EnforcerExeForApp(appName);
      if (exe.empty()) {
        // Unknown / protected app - don't kill, just resolve
        result.Resolve();
        return;
      }
      // taskkill /F /IM brave.exe
      std::wstring cmd = L"taskkill /F /IM " + exe + L" >nul 2>&1";
      // _wsystem runs it without a console window popping up
      _wsystem(cmd.c_str());
      result.Resolve();
    }).detach();
  }
};

} // namespace LarpLess