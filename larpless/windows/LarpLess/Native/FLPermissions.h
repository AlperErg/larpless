// FLPermissions: the twin of Native/Capture/FLPermissions.swift.
// Windows has no Screen Recording permission, so 'screen' is always granted. 'camera' follows the Windows camera
// privacy setting (Settings > Privacy & security > Camera).
#pragma once

#include <NativeModules.h>
#include <winrt/Microsoft.Windows.AppLifecycle.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Security.Authorization.AppCapabilityAccess.h>
#include <winrt/Windows.System.h>

#include <thread>

namespace LarpLess {

REACT_MODULE(FLPermissions)
struct FLPermissions {
  using JSValue = winrt::Microsoft::ReactNative::JSValue;
  using JSValueObject = winrt::Microsoft::ReactNative::JSValueObject;
  using ReactContext = winrt::Microsoft::ReactNative::ReactContext;
  using ReactError = winrt::Microsoft::ReactNative::ReactError;
  template <typename T>
  using ReactPromise = winrt::Microsoft::ReactNative::ReactPromise<T>;

  REACT_INIT(Initialize)
  void Initialize(ReactContext const &reactContext) noexcept {
    m_context = reactContext;
  }

  // { screen, camera }: 'granted' | 'denied' | 'notDetermined'.
  REACT_METHOD(Status, L"status")
  void Status(ReactPromise<JSValue> &&result) noexcept {
    result.Resolve(JSValue{JSValueObject{{"screen", std::string{"granted"}}, {"camera", CameraStatus()}}});
  }

  REACT_METHOD(Request, L"request")
  void Request(std::string &&kind, ReactPromise<std::string> &&result) noexcept {
    if (kind == "screen") {
      result.Resolve("granted");
      return;
    }
    if (kind != "camera") {
      result.Reject(ReactError{"E_INVALID_ARG", "kind must be 'screen' or 'camera'", {}});
      return;
    }
    if (std::string status{CameraStatus()}; status != "notDetermined") {
      result.Resolve(status); // already decided, like macOS
      return;
    }
    // Shows the Windows consent prompt; resolve once the user answers. Off the JS thread.
    std::thread([result = std::move(result)]() mutable noexcept {
      winrt::init_apartment(winrt::apartment_type::multi_threaded);
      try {
        Capability().RequestAccessAsync().get();
      } catch (...) {
      }
      result.Resolve(CameraStatus());
    }).detach();
  }

  REACT_METHOD(OpenSettings, L"openSettings")
  void OpenSettings(std::string &&kind, ReactPromise<void> &&result) noexcept {
    if (kind != "screen" && kind != "camera") {
      result.Reject(ReactError{"E_INVALID_ARG", "kind must be 'screen' or 'camera'", {}});
      return;
    }
    // There's no screen-capture privacy page on Windows; both open the camera page, the only one that applies.
    winrt::Windows::System::Launcher::LaunchUriAsync(winrt::Windows::Foundation::Uri{L"ms-settings:privacy-webcam"});
    result.Resolve();
  }

  // Restarts LarpLess (macOS needs this after Screen Recording is granted; kept for parity).
  REACT_METHOD(Relaunch, L"relaunch")
  void Relaunch(ReactPromise<void> &&result) noexcept {
    result.Resolve();
    m_context.UIDispatcher().Post([] {
      try {
        winrt::Microsoft::Windows::AppLifecycle::AppInstance::Restart(L"");
      } catch (...) {
      }
    });
  }

 private:
  static winrt::Windows::Security::Authorization::AppCapabilityAccess::AppCapability Capability() {
    return winrt::Windows::Security::Authorization::AppCapabilityAccess::AppCapability::Create(L"webcam");
  }

  static std::string CameraStatus() noexcept {
    using winrt::Windows::Security::Authorization::AppCapabilityAccess::AppCapabilityAccessStatus;
    try {
      switch (Capability().CheckAccess()) {
        case AppCapabilityAccessStatus::Allowed:
          return "granted";
        case AppCapabilityAccessStatus::UserPromptRequired:
          return "notDetermined";
        default: // DeniedByUser, DeniedBySystem, NotDeclaredByApp
          return "denied";
      }
    } catch (...) {
      return "denied";
    }
  }

  ReactContext m_context;
};

} // namespace LarpLess
