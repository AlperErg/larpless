// FLWebcam: the twin of Native/Capture/FLWebcam.swift.
// start({fps}) opens the camera and emits FLWebcamSample { t, personPresent, phoneVisible, phoneScore } about fps
// times a second. Presence and phone both come from bundled YOLO11n (ONNX Runtime, nms=True, 640):
// person score > 0.5 => personPresent, best cell phone score => phoneScore, > 0.4 => phoneVisible.
// Until the model has loaded, and if it fails to load, nothing is emitted (a missing person would read as away).
// PRIVACY: frames and tensors stay in memory, are dropped right after analysis, and are never logged or written to disk.
#pragma once

#include <NativeModules.h>
#include <onnxruntime_cxx_api.h>
#include <winrt/Windows.Devices.Enumeration.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Media.Capture.Frames.h>
#include <winrt/Windows.Media.Capture.h>
#include <winrt/Windows.Media.MediaProperties.h>
#include <winrt/Windows.Security.Authorization.AppCapabilityAccess.h>
#include <winrt/Windows.Storage.Streams.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "FLUtil.h"

// Classic COM view of an IMemoryBuffer. Not in the C++/WinRT projection.
struct __declspec(uuid("5b0d3235-4dba-4d44-865e-8f1d0e4fd04d")) IMemoryBufferByteAccess : IUnknown {
  virtual HRESULT STDMETHODCALLTYPE GetBuffer(uint8_t **value, uint32_t *capacity) = 0;
};

namespace LarpLess {

REACT_MODULE(FLWebcam)
struct FLWebcam {
  using JSValue = winrt::Microsoft::ReactNative::JSValue;
  using JSValueObject = winrt::Microsoft::ReactNative::JSValueObject;
  using ReactError = winrt::Microsoft::ReactNative::ReactError;
  template <typename T>
  using ReactPromise = winrt::Microsoft::ReactNative::ReactPromise<T>;

  ~FLWebcam() noexcept {
    m_stopping = true;
    m_wantCamera = false;
    {
      std::lock_guard lock{m_mutex};
      StopLocked();
    }
    while (m_busy.load()) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    std::thread loader;
    std::thread retry;
    {
      std::lock_guard lock{m_threadMutex};
      loader = std::move(m_loader);
      retry = std::move(m_retry);
    }
    if (loader.joinable()) loader.join();
    if (retry.joinable()) retry.join();
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
    m_wantCamera = true;
    LoadModelIfNeeded();
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
    m_wantCamera = false;
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
  // receiving samples, like macOS). A Stop() or teardown sets m_wantCamera false so a late retry cannot reopen it.
  void OnCaptureFailed() noexcept {
    std::lock_guard lock{m_threadMutex};
    if (m_stopping.load() || !m_wantCamera.load()) return;
    if (m_retry.joinable()) {
      if (m_retryRunning.load()) return;
      m_retry.join();
    }
    m_retryRunning = true;
    m_retry = std::thread([this]() noexcept {
      struct Clear {
        std::atomic<bool> *flag;
        ~Clear() { flag->store(false); }
      } clear{&m_retryRunning};
      winrt::init_apartment(winrt::apartment_type::multi_threaded);
      for (int attempt{0}; attempt < 3; ++attempt) {
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
        if (m_stopping.load() || !m_wantCamera.load()) return;
        std::lock_guard camera{m_mutex};
        if (m_stopping.load() || !m_wantCamera.load()) return;
        StopLocked();
        try {
          StartLocked();
          // Stop() may have landed while StartLocked held the camera lock.
          if (m_stopping.load() || !m_wantCamera.load()) StopLocked();
          return;
        } catch (...) {
          StopLocked();
        }
      }
    });
  }

  void OnFrame(winrt::Windows::Media::Capture::Frames::MediaFrameReader const &sender,
               winrt::Windows::Media::Capture::Frames::MediaFrameArrivedEventArgs const &) noexcept {
    using namespace winrt::Windows::Graphics::Imaging;
    if (m_stopping.load() || !m_modelReady.load()) return;
    const double now{std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count()};
    if (now - m_lastFrameMs < m_intervalMs || m_busy.exchange(true)) {
      return;
    }
    const auto t0{std::chrono::steady_clock::now()};
    try {
      if (auto ref{sender.TryAcquireLatestFrame()}) {
        if (auto video{ref.VideoMediaFrame()}; video && video.SoftwareBitmap()) {
          m_lastFrameMs = now;
          SoftwareBitmap bitmap{video.SoftwareBitmap()};
          if (bitmap.BitmapPixelFormat() != BitmapPixelFormat::Bgra8) {
            bitmap = SoftwareBitmap::Convert(bitmap, BitmapPixelFormat::Bgra8, BitmapAlphaMode::Ignore);
          }
          const auto buffer{bitmap.LockBuffer(BitmapBufferAccessMode::Read)};
          const auto plane{buffer.GetPlaneDescription(0)};
          uint8_t *bytes{nullptr};
          uint32_t capacity{0};
          winrt::check_hresult(buffer.CreateReference().as<IMemoryBufferByteAccess>()->GetBuffer(&bytes, &capacity));
          float person{0};
          float phone{0};
          if (Detect(bytes + plane.StartIndex, static_cast<int>(plane.Width), static_cast<int>(plane.Height),
                     static_cast<int>(plane.Stride), plane.StartIndex, capacity, person, phone) &&
              m_listeners > 0) {
            Sample(JSValueObject{{"t", EpochMs()},
                                 {"personPresent", person > kPersonThreshold},
                                 {"phoneVisible", phone > kPhoneThreshold},
                                 {"phoneScore", static_cast<double>(phone)}});
          }
          if (m_timingLogsLeft > 0) {
            --m_timingLogsLeft;
            char line[96];
            std::snprintf(line, sizeof line, "[FLWebcam] frame analysed in %.0f ms\n",
                          std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count());
            OutputDebugStringA(line);
          }
        }
      }
    } catch (...) {
    }
    m_busy = false;
  }

  // No-op once a load has started. Runs off the UI thread; samples stay silent until it succeeds.
  void LoadModelIfNeeded() noexcept {
    int expected{0};
    if (!m_modelState.compare_exchange_strong(expected, 1)) return;
    std::lock_guard lock{m_threadMutex};
    if (m_stopping.load()) {
      m_modelState.store(3);
      return;
    }
    m_loader = std::thread([this]() noexcept {
      winrt::init_apartment(winrt::apartment_type::multi_threaded);
      const auto t0{std::chrono::steady_clock::now()};
      try {
        const auto path{ModelPath()};
        if (path.empty()) throw std::runtime_error("yolo11n.onnx was not found");
        Ort::SessionOptions options;
        options.SetIntraOpNumThreads(1);
        options.SetInterOpNumThreads(1);
        options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
        auto env{std::make_unique<Ort::Env>(ORT_LOGGING_LEVEL_ERROR, "FLWebcam")};
        auto session{std::make_unique<Ort::Session>(*env, path.c_str(), options)};
        Ort::AllocatorWithDefaultOptions allocator;
        const std::string input{session->GetInputNameAllocated(0, allocator).get()};
        const std::string output{session->GetOutputNameAllocated(0, allocator).get()};
        int person{-1};
        int phone{-1};
        ReadClassIndices(*session, person, phone);
        if (person < 0 || phone < 0) throw std::runtime_error("model metadata is missing person or cell phone");
        {
          std::lock_guard lock{m_modelMutex};
          m_env = std::move(env);
          m_session = std::move(session);
          m_inputName = input;
          m_outputName = output;
          m_personClass = person;
          m_phoneClass = phone;
        }
        char line[128];
        std::snprintf(line, sizeof line, "[FLWebcam] YOLO loaded in %.0f ms; person=%d cell phone=%d\n",
                      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count(), person,
                      phone);
        OutputDebugStringA(line);
        m_modelReady.store(true);
        m_modelState.store(2);
      } catch (std::exception const &error) {
        char line[320];
        std::snprintf(line, sizeof line, "[FLWebcam] YOLO load failed, webcam samples disabled: %s\n", error.what());
        OutputDebugStringA(line);
        m_modelState.store(3);
      } catch (...) {
        OutputDebugStringA("[FLWebcam] YOLO load failed, webcam samples disabled\n");
        m_modelState.store(3);
      }
    });
  }

  // Single file lands next to the exe; a wildcard asset lands one directory up, at the package root.
  static std::wstring ModelPath() {
    wchar_t exe[MAX_PATH]{};
    GetModuleFileNameW(nullptr, exe, MAX_PATH);
    const auto exeDir{std::filesystem::path{exe}.parent_path()};
    const auto nextToExe{exeDir / L"Assets" / L"Models" / L"yolo11n.onnx"};
    std::error_code ec;
    if (std::filesystem::is_regular_file(nextToExe, ec)) return nextToExe.wstring();
    const auto packageRoot{exeDir.parent_path() / L"Assets" / L"Models" / L"yolo11n.onnx"};
    if (std::filesystem::is_regular_file(packageRoot, ec)) return packageRoot.wstring();
    return {};
  }

  static void ReadClassIndices(Ort::Session &session, int &person, int &phone) {
    Ort::AllocatorWithDefaultOptions allocator;
    const auto names{session.GetModelMetadata().LookupCustomMetadataMapAllocated("names", allocator)};
    if (!names) throw std::runtime_error("model has no class names");
    const std::string text{names.get()};
    person = ClassIndex(text, "person");
    phone = ClassIndex(text, "cell phone");
  }

  // Ultralytics writes names as `{0: 'person', 1: 'bicycle', ...}`.
  static int ClassIndex(std::string const &names, char const *label) {
    const std::string quoted{std::string{"'"} + label + "'"};
    auto pos{names.find(quoted)};
    if (pos == std::string::npos) pos = names.find(std::string{"\""} + label + "\"");
    if (pos == std::string::npos) return -1;
    const auto colon{names.rfind(':', pos)};
    if (colon == std::string::npos) return -1;
    auto start{colon};
    while (start > 0 && std::isdigit(static_cast<unsigned char>(names[start - 1]))) --start;
    if (start == colon) return -1;
    return std::atoi(names.c_str() + start);
  }

  // False when the model output is not the NMS layout, in which case the caller emits nothing.
  bool Detect(uint8_t const *bgra, int width, int height, int stride, int start, uint32_t capacity, float &person,
              float &phone) {
    if (width <= 0 || height <= 0 || stride <= 0 || static_cast<int64_t>(stride) < static_cast<int64_t>(width) * 4) return false;
    const uint64_t need{uint64_t(start) + uint64_t(height - 1) * uint64_t(stride) + uint64_t(width) * 4};
    if (start < 0 || need > capacity) return false;
    Letterbox(bgra, width, height, stride);
    std::array<int64_t, 4> shape{1, 3, kInput, kInput};
    auto memory{Ort::MemoryInfo::CreateCpu(OrtDeviceAllocator, OrtMemTypeCPU)};
    Ort::Value input{Ort::Value::CreateTensor<float>(memory, m_input.data(), m_input.size(), shape.data(), shape.size())};
    const char *inputNames[]{m_inputName.c_str()};
    const char *outputNames[]{m_outputName.c_str()};
    auto outputs{m_session->Run(Ort::RunOptions{nullptr}, inputNames, &input, 1, outputNames, 1)};
    const auto dims{outputs[0].GetTensorTypeAndShapeInfo().GetShape()};
    if (dims.size() < 2 || dims.back() != 6) {
      if (!m_loggedShape) {
        m_loggedShape = true;
        OutputDebugStringA("[FLWebcam] YOLO output is not [N, 6], webcam samples disabled\n");
      }
      return false;
    }
    const int64_t cols{dims.back()};
    const int64_t rows{dims[dims.size() - 2]};
    const float *data{outputs[0].GetTensorData<float>()};
    person = 0;
    phone = 0;
    for (int64_t i{0}; i < rows; ++i) {
      const float score{data[i * cols + 4]};
      const int cls{static_cast<int>(std::lround(data[i * cols + 5]))};
      if (cls == m_personClass) person = (std::max)(person, score);
      else if (cls == m_phoneClass) phone = (std::max)(phone, score);
    }
    return true;
  }

  // Fit the frame inside 640x640, RGB float CHW, padded with 114/255 like Ultralytics.
  void Letterbox(uint8_t const *bgra, int width, int height, int stride) {
    constexpr int n{kInput * kInput};
    if (static_cast<int>(m_input.size()) != 3 * n) m_input.assign(3 * n, kPad);
    else std::fill(m_input.begin(), m_input.end(), kPad);
    const float longSide{static_cast<float>((std::max)(width, height))};
    const float scale{kInput / longSide};
    const int fitW{(std::min)(kInput, (std::max)(1, static_cast<int>(std::lround(width * scale))))};
    const int fitH{(std::min)(kInput, (std::max)(1, static_cast<int>(std::lround(height * scale))))};
    const int padX{(kInput - fitW) / 2};
    const int padY{(kInput - fitH) / 2};
    for (int y{0}; y < fitH; ++y) {
      const float sy{(std::max)(0.f, (std::min)((y + 0.5f) * height / fitH - 0.5f, static_cast<float>(height - 1)))};
      const int y0{static_cast<int>(sy)};
      const int y1{(std::min)(y0 + 1, height - 1)};
      const float fy{sy - y0};
      for (int x{0}; x < fitW; ++x) {
        const float sx{(std::max)(0.f, (std::min)((x + 0.5f) * width / fitW - 0.5f, static_cast<float>(width - 1)))};
        const int x0{static_cast<int>(sx)};
        const int x1{(std::min)(x0 + 1, width - 1)};
        const float fx{sx - x0};
        const int dst{(y + padY) * kInput + (x + padX)};
        for (int c{0}; c < 3; ++c) {
          // BGRA byte order, written out as RGB planes.
          const int byte{2 - c};
          const float v00{static_cast<float>(bgra[y0 * stride + x0 * 4 + byte])};
          const float v10{static_cast<float>(bgra[y0 * stride + x1 * 4 + byte])};
          const float v01{static_cast<float>(bgra[y1 * stride + x0 * 4 + byte])};
          const float v11{static_cast<float>(bgra[y1 * stride + x1 * 4 + byte])};
          const float value{v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy};
          m_input[c * n + dst] = value / 255.f;
        }
      }
    }
  }

  static constexpr int kInput{640};
  static constexpr float kPad{114.f / 255.f};
  static constexpr float kPersonThreshold{0.5f};
  static constexpr float kPhoneThreshold{0.4f};

  std::mutex m_mutex;
  std::mutex m_modelMutex;
  std::mutex m_threadMutex;
  std::thread m_loader;
  std::thread m_retry;
  std::atomic<bool> m_retryRunning{false};
  winrt::Windows::Media::Capture::MediaCapture m_capture{nullptr};
  winrt::Windows::Media::Capture::Frames::MediaFrameReader m_reader{nullptr};
  winrt::event_token m_frameToken{};
  winrt::event_token m_failedToken{};
  std::unique_ptr<Ort::Env> m_env;
  std::unique_ptr<Ort::Session> m_session;
  std::string m_inputName;
  std::string m_outputName;
  std::vector<float> m_input;
  int m_personClass{-1};
  int m_phoneClass{-1};
  std::atomic<double> m_intervalMs{1000.0 * 0.97};
  std::atomic<double> m_lastFrameMs{0};
  std::atomic<bool> m_busy{false};
  std::atomic<bool> m_stopping{false};
  std::atomic<bool> m_wantCamera{false};
  std::atomic<bool> m_modelReady{false};
  std::atomic<int> m_modelState{0}; // 0 idle, 1 loading, 2 loaded, 3 failed
  std::atomic<int> m_listeners{0};
  int m_timingLogsLeft{3};
  bool m_loggedShape{false};
};

} // namespace LarpLess
