// FLWebcam: the twin of Native/Capture/FLWebcam.swift.
// start({fps}) opens the camera and emits FLWebcamSample { t, personPresent, phoneVisible, phoneScore } about fps
// times a second. Presence uses Windows' built-in FaceDetector (macOS: Vision upper-body + YOLO "person").
// Phone detection (YOLO11n "cell phone") isn't wired up on Windows yet: phoneVisible=false, phoneScore=0, which
// the JS side treats like macOS with the model failed to load.
// PRIVACY: frames stay in memory, are dropped right after analysis, and are never logged or written to disk.
#pragma once

#include <NativeModules.h>
#include <winrt/Windows.Devices.Enumeration.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Media.Capture.Frames.h>
#include <winrt/Windows.Media.Capture.h>
#include <winrt/Windows.Media.FaceAnalysis.h>
#include <winrt/Windows.Media.MediaProperties.h>
#include <winrt/Windows.Security.Authorization.AppCapabilityAccess.h>
#include <winrt/Windows.Storage.Streams.h>

#include <atomic>
#include <chrono>
#include <mutex>
#include <thread>

#include "FLUtil.h"

namespace LarpLess {

REACT_MODULE(FLWebcam)
struct FLWebcam {
  using JSValue = winrt::Microsoft::ReactNative::JSValue;
  using JSValueObject = winrt::Microsoft::ReactNative::JSValueObject;
  using ReactError = winrt::Microsoft::ReactNative::ReactError;
  template <typename T>
  using ReactPromise = winrt::Microsoft::ReactNative::ReactPromise<T>;

  ~FLWebcam() noexcept {
    std::lock_guard lock{m_mutex};
    StopLocked();
  }

  // Rejects E_INVALID_ARG (fps outside (0, 30]), E_PERMISSION (camera denied) or E_CAMERA (no / busy camera).
  // Calling it again while running only changes the fps.
  REACT_METHOD(Start, L"start")
  void Start(JSValueObject &&opts, ReactPromise<void> &&result) noexcept {
    const auto it{opts.find("fps")};
    const double fps{it == opts.end() || it->second.IsNull() ? 1.0 : it->second.AsDouble()};
    if (!(fps > 0 && fps <= 30)) {
      result.Reject(ReactError{"E_INVALID_ARG", "fps must be in (0, 30]", {}});
      return;
    }
    m_intervalMs = 1000.0 / fps * 0.97;
    // MediaCapture's async calls are awaited off the JS thread (.get() isn't allowed on an STA thread).
    std::thread([this, result = std::move(result)]() mutable noexcept {
      winrt::init_apartment(winrt::apartment_type::multi_threaded);
      std::lock_guard lock{m_mutex};
      if (m_reader) {
        result.Resolve(); // already running: the new fps applies from the next frame
        return;
      }
      if (CameraDenied()) {
        result.Reject(ReactError{"E_PERMISSION", "camera access is denied in Windows Settings", {}});
        return;
      }
      try {
        StartLocked();
        result.Resolve();
      } catch (winrt::hresult_access_denied const &) {
        StopLocked();
        result.Reject(ReactError{"E_PERMISSION", "camera access was denied", {}});
      } catch (...) {
        StopLocked();
        result.Reject(ReactError{"E_CAMERA", "no camera available, or it's in use by another app", {}});
      }
    }).detach();
  }

  // Harmless when not running or called twice.
  REACT_METHOD(Stop, L"stop")
  void Stop(ReactPromise<void> &&result) noexcept {
    std::thread([this, result = std::move(result)]() mutable noexcept {
      winrt::init_apartment(winrt::apartment_type::multi_threaded);
      std::lock_guard lock{m_mutex};
      StopLocked();
      result.Resolve();
    }).detach();
  }

  // Phase 2 (live photo): the latest frame as an in-memory JPEG (max 1280 wide, quality 0.8). Needs start() first.
  REACT_METHOD(CapturePhoto, L"capturePhoto")
  void CapturePhoto(ReactPromise<JSValue> &&result) noexcept {
    std::thread([this, result = std::move(result)]() mutable noexcept {
      winrt::init_apartment(winrt::apartment_type::multi_threaded);
      using namespace winrt::Windows::Graphics::Imaging;
      try {
        SoftwareBitmap frame{nullptr};
        {
          std::lock_guard lock{m_mutex};
          if (m_reader) {
            if (auto ref{m_reader.TryAcquireLatestFrame()}) {
              if (auto video{ref.VideoMediaFrame()}) frame = video.SoftwareBitmap();
            }
          }
        }
        if (!frame) {
          result.Reject(ReactError{"E_CAMERA", "the camera isn't running", {}});
          return;
        }
        frame = SoftwareBitmap::Convert(frame, BitmapPixelFormat::Bgra8, BitmapAlphaMode::Premultiplied);
        winrt::Windows::Storage::Streams::InMemoryRandomAccessStream stream; // memory only, never a file
        BitmapPropertySet options;
        options.Insert(L"ImageQuality", BitmapTypedValue{winrt::box_value(0.8f), winrt::Windows::Foundation::PropertyType::Single});
        auto encoder{BitmapEncoder::CreateAsync(BitmapEncoder::JpegEncoderId(), stream, options).get()};
        encoder.SetSoftwareBitmap(frame);
        const uint32_t width{static_cast<uint32_t>(frame.PixelWidth())};
        const uint32_t height{static_cast<uint32_t>(frame.PixelHeight())};
        uint32_t outW{width}, outH{height};
        if (width > 1280) {
          outW = 1280;
          outH = static_cast<uint32_t>(height * 1280.0 / width);
          encoder.BitmapTransform().ScaledWidth(outW);
          encoder.BitmapTransform().ScaledHeight(outH);
        }
        encoder.FlushAsync().get();
        std::vector<uint8_t> bytes(static_cast<size_t>(stream.Size()));
        winrt::Windows::Storage::Streams::DataReader reader{stream.GetInputStreamAt(0)};
        reader.LoadAsync(static_cast<uint32_t>(bytes.size())).get();
        reader.ReadBytes(bytes);
        result.Resolve(JSValue{JSValueObject{{"jpegBase64", Base64(bytes)}, {"width", outW}, {"height", outH}}});
      } catch (...) {
        result.Reject(ReactError{"E_CAMERA", "photo capture failed", {}});
      }
    }).detach();
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

  REACT_EVENT(Sample, L"FLWebcamSample")
  std::function<void(JSValueObject const &)> Sample;

 private:
  static bool CameraDenied() noexcept {
    using namespace winrt::Windows::Security::Authorization::AppCapabilityAccess;
    try {
      const auto status{AppCapability::Create(L"webcam").CheckAccess()};
      return status == AppCapabilityAccessStatus::DeniedByUser || status == AppCapabilityAccessStatus::DeniedBySystem;
    } catch (...) {
      return false;
    }
  }

  // Prefers the built-in (front panel) camera, like macOS avoids a Continuity Camera phone. Throws on failure.
  void StartLocked() {
    using namespace winrt::Windows::Media::Capture;
    using namespace winrt::Windows::Media::Capture::Frames;

    if (!m_detector) {
      m_detector = winrt::Windows::Media::FaceAnalysis::FaceDetector::CreateAsync().get();
    }
    MediaFrameSourceGroup group{nullptr};
    MediaFrameSourceInfo info{nullptr};
    for (auto const &candidate : MediaFrameSourceGroup::FindAllAsync().get()) {
      for (auto const &source : candidate.SourceInfos()) {
        if (source.SourceKind() != MediaFrameSourceKind::Color) continue;
        const auto device{source.DeviceInformation()};
        const bool builtIn{device && device.EnclosureLocation() &&
                           device.EnclosureLocation().Panel() == winrt::Windows::Devices::Enumeration::Panel::Front};
        if (!group || builtIn) {
          group = candidate;
          info = source;
        }
        break;
      }
    }
    if (!group) {
      throw winrt::hresult_error{E_FAIL}; // no camera -> E_CAMERA
    }

    MediaCaptureInitializationSettings settings;
    settings.SourceGroup(group);
    settings.StreamingCaptureMode(StreamingCaptureMode::Video); // video only, never the microphone
    settings.MemoryPreference(MediaCaptureMemoryPreference::Cpu);
    settings.SharingMode(MediaCaptureSharingMode::ExclusiveControl);
    m_capture = MediaCapture{};
    try {
      m_capture.InitializeAsync(settings).get();
    } catch (winrt::hresult_access_denied const &) {
      throw;
    } catch (...) {
      // Another app holds the camera exclusively: share it read-only instead.
      settings.SharingMode(MediaCaptureSharingMode::SharedReadOnly);
      m_capture = MediaCapture{};
      m_capture.InitializeAsync(settings).get();
    }

    const MediaFrameSource source{m_capture.FrameSources().Lookup(info.Id())};
    // VGA is plenty at 1 fps (macOS uses 640x480); keep the camera's default if it can't be changed.
    try {
      MediaFrameFormat best{nullptr};
      for (auto const &format : source.SupportedFormats()) {
        const uint32_t w{format.VideoFormat().Width()};
        if (w >= 640 && (!best || w < best.VideoFormat().Width())) best = format;
      }
      if (best) source.SetFormatAsync(best).get();
    } catch (...) {
    }

    m_reader = m_capture.CreateFrameReaderAsync(source, winrt::Windows::Media::MediaProperties::MediaEncodingSubtypes::Bgra8()).get();
    m_reader.AcquisitionMode(MediaFrameReaderAcquisitionMode::Realtime); // latest frame only, late frames dropped
    m_frameToken = m_reader.FrameArrived({this, &FLWebcam::OnFrame});
    if (m_reader.StartAsync().get() != MediaFrameReaderStartStatus::Success) {
      throw winrt::hresult_error{E_FAIL}; // busy / unavailable -> E_CAMERA
    }
    m_failedToken = m_capture.Failed([this](auto &&, auto &&) { OnCaptureFailed(); });
    m_retries = 0;
  }

  void StopLocked() noexcept {
    try {
      if (m_reader) {
        m_reader.FrameArrived(m_frameToken);
        m_reader.StopAsync().get();
        m_reader.Close();
      }
    } catch (...) {
    }
    m_reader = nullptr;
    try {
      if (m_capture) {
        m_capture.Failed(m_failedToken);
        m_capture.Close();
      }
    } catch (...) {
    }
    m_capture = nullptr;
  }

  // The camera was taken by another app or unplugged: retry 3 times, 0.5 s apart, then release it (JS just stops
  // receiving samples, like macOS).
  void OnCaptureFailed() noexcept {
    std::thread([this]() noexcept {
      winrt::init_apartment(winrt::apartment_type::multi_threaded);
      std::lock_guard lock{m_mutex};
      StopLocked();
      while (m_retries < 3) {
        ++m_retries;
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
        try {
          StartLocked();
          return;
        } catch (...) {
          StopLocked();
        }
      }
    }).detach();
  }

  void OnFrame(winrt::Windows::Media::Capture::Frames::MediaFrameReader const &sender,
               winrt::Windows::Media::Capture::Frames::MediaFrameArrivedEventArgs const &) noexcept {
    using namespace winrt::Windows::Graphics::Imaging;
    const double now{std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count()};
    if (now - m_lastFrameMs < m_intervalMs || m_busy.exchange(true)) {
      return;
    }
    try {
      if (auto ref{sender.TryAcquireLatestFrame()}) {
        if (auto video{ref.VideoMediaFrame()}; video && video.SoftwareBitmap()) {
          m_lastFrameMs = now;
          const SoftwareBitmap gray{SoftwareBitmap::Convert(video.SoftwareBitmap(), BitmapPixelFormat::Gray8)};
          const bool present{m_detector.DetectFacesAsync(gray).get().Size() > 0};
          if (m_listeners > 0) {
            Sample(JSValueObject{{"t", EpochMs()}, {"personPresent", present}, {"phoneVisible", false}, {"phoneScore", 0.0}});
          }
        }
      }
    } catch (...) {
    }
    m_busy = false;
  }

  std::mutex m_mutex;
  winrt::Windows::Media::Capture::MediaCapture m_capture{nullptr};
  winrt::Windows::Media::Capture::Frames::MediaFrameReader m_reader{nullptr};
  winrt::Windows::Media::FaceAnalysis::FaceDetector m_detector{nullptr};
  winrt::event_token m_frameToken{};
  winrt::event_token m_failedToken{};
  std::atomic<double> m_intervalMs{1000.0 * 0.97};
  std::atomic<double> m_lastFrameMs{0};
  std::atomic<bool> m_busy{false};
  std::atomic<int> m_listeners{0};
  int m_retries{0};
};

} // namespace LarpLess
