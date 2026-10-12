// FLPing: JS <-> C++ round-trip smoke test, the Windows twin of Native/Shared/FLPing.swift.
// ping() resolves "pong", then emits FLPingEvent { t: epoch ms } (used by __FL.pingRoundTrip()).
#pragma once

#include <NativeModules.h>

#include <chrono>

namespace LarpLess {

REACT_MODULE(FLPing)
struct FLPing {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &reactContext) noexcept {
    m_context = reactContext;
  }

  REACT_METHOD(Ping, L"ping")
  void Ping(winrt::Microsoft::ReactNative::ReactPromise<std::string> &&result) noexcept {
    result.Resolve("pong");
    if (m_listeners > 0) {
      const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
                           std::chrono::system_clock::now().time_since_epoch())
                           .count();
      PingEvent(winrt::Microsoft::ReactNative::JSValueObject{{"t", static_cast<double>(now)}});
    }
  }

  // NativeEventEmitter bookkeeping: like the Swift modules, only emit while JS listens.
  REACT_METHOD(AddListener, L"addListener")
  void AddListener(std::string && /*eventName*/) noexcept {
    ++m_listeners;
  }

  REACT_METHOD(RemoveListeners, L"removeListeners")
  void RemoveListeners(double count) noexcept {
    m_listeners = (std::max)(0, m_listeners - static_cast<int>(count));
  }

  REACT_EVENT(PingEvent, L"FLPingEvent")
  std::function<void(winrt::Microsoft::ReactNative::JSValueObject const &)> PingEvent;

 private:
  winrt::Microsoft::ReactNative::ReactContext m_context;
  int m_listeners{0};
};

} // namespace LarpLess
