// FLNotifications: Windows toast notifications, the twin of Native/Shell/FLNotifications.swift.
// post() always resolves (a failed toast must never break the session loop); clicking a toast brings the main
// window to the front. Never logs titles or bodies.
#pragma once

#include <NativeModules.h>
#include <winrt/Windows.Data.Xml.Dom.h>
#include <winrt/Windows.UI.Notifications.h>

#include <filesystem>
#include <string>

#include "FLWindow.h"

namespace LarpLess {

REACT_MODULE(FLNotifications)
struct FLNotifications {
  using ReactContext = winrt::Microsoft::ReactNative::ReactContext;
  using JSValueObject = winrt::Microsoft::ReactNative::JSValueObject;
  template <typename T>
  using ReactPromise = winrt::Microsoft::ReactNative::ReactPromise<T>;

  REACT_INIT(Initialize)
  void Initialize(ReactContext const &reactContext) noexcept {
    m_context = reactContext;
  }

  // 'granted' when toasts are enabled for LarpLess in Windows Settings, otherwise 'denied'. Never rejects.
  REACT_METHOD(RequestPermission, L"requestPermission")
  void RequestPermission(ReactPromise<std::string> &&result) noexcept {
    try {
      const auto setting{winrt::Windows::UI::Notifications::ToastNotificationManager::CreateToastNotifier().Setting()};
      result.Resolve(setting == winrt::Windows::UI::Notifications::NotificationSetting::Enabled ? "granted" : "denied");
    } catch (...) {
      result.Resolve("denied");
    }
  }

  // n = { id, title, body, sound }. Rejects E_INVALID_ARG without a title; otherwise always resolves.
  REACT_METHOD(Post, L"post")
  void Post(JSValueObject &&n, ReactPromise<void> &&result) noexcept {
    const std::string title{Str(n, "title")};
    if (title.empty()) {
      result.Reject(winrt::Microsoft::ReactNative::ReactError{"E_INVALID_ARG", "title is required", {}});
      return;
    }
    const std::string body{Str(n, "body")};
    const std::string id{Str(n, "id")};
    const auto soundIt{n.find("sound")};
    const bool sound{soundIt != n.end() && soundIt->second.AsBoolean()};

    try {
      std::wstring xml{L"<toast><visual><binding template=\"ToastGeneric\"><text>"};
      xml += Escape(winrt::to_hstring(title).c_str());
      xml += L"</text><text>";
      xml += Escape(winrt::to_hstring(body).c_str());
      xml += L"</text>";
      const std::wstring icon{IconUri()};
      if (!icon.empty()) {
        xml += L"<image placement=\"appLogoOverride\" src=\"" + Escape(icon) + L"\"/>";
      }
      xml += L"</binding></visual>";
      if (!sound) {
        xml += L"<audio silent=\"true\"/>";
      }
      xml += L"</toast>";

      winrt::Windows::Data::Xml::Dom::XmlDocument doc;
      doc.LoadXml(xml);
      winrt::Windows::UI::Notifications::ToastNotification toast{doc};
      if (!id.empty()) {
        // Tags are limited to 64 characters; ids look like fl-alert-<sessionId>-<chunkIndex>.
        toast.Tag(winrt::to_hstring(id.substr(0, 64)));
        toast.Group(L"larpless");
      }
      toast.Activated([context = m_context](auto &&, auto &&) { BringMainWindowToFront(context); });
      winrt::Windows::UI::Notifications::ToastNotificationManager::CreateToastNotifier().Show(toast);
    } catch (...) {
      // Delivery failures (notifications off, no package identity) are ignored, like on macOS.
    }
    result.Resolve();
  }

 private:
  // A string field, or "" when missing / not a string (JSValue::AsString would turn null into "null").
  static std::string Str(JSValueObject const &obj, char const *key) {
    const auto it{obj.find(key)};
    if (it == obj.end()) {
      return {};
    }
    const std::string *s{it->second.TryGetString()};
    return s ? *s : std::string{};
  }

  static std::wstring Escape(std::wstring_view text) {
    std::wstring out;
    out.reserve(text.size());
    for (const wchar_t c : text) {
      switch (c) {
        case L'&': out += L"&amp;"; break;
        case L'<': out += L"&lt;"; break;
        case L'>': out += L"&gt;"; break;
        case L'"': out += L"&quot;"; break;
        case L'\'': out += L"&apos;"; break;
        default: out += c;
      }
    }
    return out;
  }

  // file:/// URI of the bundled logo next to the exe, or empty when it isn't deployed.
  static std::wstring IconUri() {
    wchar_t exe[MAX_PATH]{};
    GetModuleFileNameW(nullptr, exe, MAX_PATH);
    const std::filesystem::path icon{std::filesystem::path{exe}.parent_path() / L"Assets" / L"FLNotificationIcon.png"};
    std::error_code ec;
    if (!std::filesystem::exists(icon, ec)) {
      return {};
    }
    std::wstring uri{L"file:///" + icon.wstring()};
    for (auto &c : uri) {
      if (c == L'\\') c = L'/';
    }
    return uri;
  }

  ReactContext m_context;
};

} // namespace LarpLess
