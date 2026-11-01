// FLScreenCapture: the twin of Native/Capture/FLScreenCapture.swift.
// getActiveWindow(): frontmost app + window title. capture(opts): primary display as an in-memory JPEG (base64),
// LarpLess's own windows excluded. PRIVACY: frames never touch disk and are never logged; window titles are
// never logged either.
#pragma once

#include <NativeModules.h>
#include <dwmapi.h>
#include <wincodec.h>
#include <wrl/client.h>

#include <chrono>
#include <filesystem>
#include <string>
#include <thread>
#include <vector>

#include "FLUtil.h"
#include "FLWindow.h"

#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "version.lib")
#pragma comment(lib, "windowscodecs.lib")

namespace LarpLess {

REACT_MODULE(FLScreenCapture)
struct FLScreenCapture {
  using JSValue = winrt::Microsoft::ReactNative::JSValue;
  using JSValueObject = winrt::Microsoft::ReactNative::JSValueObject;
  using ReactError = winrt::Microsoft::ReactNative::ReactError;
  template <typename T>
  using ReactPromise = winrt::Microsoft::ReactNative::ReactPromise<T>;

  REACT_METHOD(GetActiveWindow, L"getActiveWindow")
  void GetActiveWindow(ReactPromise<JSValue> &&result) noexcept {
    result.Resolve(JSValue{ToJS(QueryActiveWindow())});
  }

  // opts = { maxWidth, jpegQuality }. Rejects E_INVALID_ARG / E_CAPTURE. Runs off the JS thread.
  REACT_METHOD(Capture, L"capture")
  void Capture(JSValueObject &&opts, ReactPromise<JSValue> &&result) noexcept {
    const double maxWidth{Num(opts, "maxWidth", 1280)};
    const double quality{Num(opts, "jpegQuality", 0.7)};
    if (maxWidth < 16 || maxWidth > 8192 || quality <= 0 || quality > 1) {
      result.Reject(ReactError{"E_INVALID_ARG", "maxWidth must be 16-8192 and jpegQuality in (0, 1]", {}});
      return;
    }
    std::thread([result = std::move(result), maxWidth, quality]() mutable noexcept {
      const HRESULT coInit{CoInitializeEx(nullptr, COINIT_MULTITHREADED)};
      const ActiveWindow window{QueryActiveWindow()}; // snapshot the active window first, like macOS
      Frame frame;
      const bool ok{CaptureFrame(static_cast<int>(maxWidth), static_cast<float>(quality), frame)};
      if (SUCCEEDED(coInit)) {
        CoUninitialize();
      }
      if (!ok) {
        result.Reject(ReactError{"E_CAPTURE", "screen capture failed", {}});
        return;
      }
      JSValueObject obj{ToJS(window)};
      obj["jpegBase64"] = Base64(frame.jpeg);
      obj["width"] = frame.width;
      obj["height"] = frame.height;
      obj["capturedAt"] = EpochMs();
      result.Resolve(JSValue{std::move(obj)});
    }).detach();
  }

  // Dev harness only (HarnessA): cost of getActiveWindow over n runs.
  REACT_METHOD(BenchActiveWindow, L"benchActiveWindow")
  void BenchActiveWindow(double n, ReactPromise<JSValue> &&result) noexcept {
    const int runs{(std::max)(1, static_cast<int>(n))};
    double total{0}, worst{0};
    for (int i = 0; i < runs; ++i) {
      const auto start{std::chrono::steady_clock::now()};
      (void)QueryActiveWindow();
      const double ms{std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count()};
      total += ms;
      worst = (std::max)(worst, ms);
    }
    result.Resolve(JSValue{JSValueObject{{"runs", runs}, {"avgMs", total / runs}, {"maxMs", worst}}});
  }

  // The helpers below are also used by FLScreenModel.h (same window snapshot and capture rules).
  struct ActiveWindow {
    std::wstring appName, exeName, title;
    bool isSelf{false};
    bool found{false};
  };

  struct Frame {
    std::vector<uint8_t> jpeg;
    int width{0}, height{0};
  };

  static double Num(JSValueObject const &obj, char const *key, double fallback) {
    const auto it{obj.find(key)};
    return it == obj.end() || it->second.IsNull() ? fallback : it->second.AsDouble();
  }

  static JSValue Str(std::wstring const &s) {
    return s.empty() ? JSValue{nullptr} : JSValue{winrt::to_string(s)};
  }

  static JSValueObject ToJS(ActiveWindow const &w) {
    JSValueObject obj;
    obj["appName"] = Str(w.appName);
    obj["bundleId"] = Str(w.exeName); // no bundle ids on Windows; the exe name plays that role
    obj["windowTitle"] = Str(w.title);
    obj["isSelf"] = w.isSelf;
    return obj;
  }

  static std::wstring ProcessPath(DWORD pid) {
    std::wstring path;
    if (HANDLE process{OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid)}) {
      wchar_t buffer[MAX_PATH * 2]{};
      DWORD size{ARRAYSIZE(buffer)};
      if (QueryFullProcessImageNameW(process, 0, buffer, &size)) {
        path.assign(buffer, size);
      }
      CloseHandle(process);
    }
    return path;
  }

  // The exe's FileDescription ("Google Chrome"), falling back to the file name without extension.
  static std::wstring FriendlyName(std::wstring const &exePath) {
    DWORD ignored{0};
    const DWORD size{GetFileVersionInfoSizeW(exePath.c_str(), &ignored)};
    if (size > 0) {
      std::vector<uint8_t> data(size);
      if (GetFileVersionInfoW(exePath.c_str(), 0, size, data.data())) {
        struct Translation {
          WORD language, codePage;
        } *translations{nullptr};
        UINT length{0};
        if (VerQueryValueW(data.data(), L"\\VarFileInfo\\Translation", reinterpret_cast<void **>(&translations), &length) &&
            length >= sizeof(Translation)) {
          wchar_t key[64];
          swprintf_s(key, L"\\StringFileInfo\\%04x%04x\\FileDescription", translations[0].language, translations[0].codePage);
          wchar_t *description{nullptr};
          UINT descriptionLength{0};
          if (VerQueryValueW(data.data(), key, reinterpret_cast<void **>(&description), &descriptionLength) &&
              descriptionLength > 1) {
            return std::wstring{description};
          }
        }
      }
    }
    return std::filesystem::path{exePath}.stem().wstring();
  }

  static ActiveWindow QueryActiveWindow() {
    ActiveWindow w;
    const HWND foreground{GetForegroundWindow()};
    if (!foreground) {
      return w;
    }
    DWORD pid{0};
    GetWindowThreadProcessId(foreground, &pid);
    std::wstring path{ProcessPath(pid)};

    // Store/UWP apps are hosted by ApplicationFrameHost.exe; the real app owns a child window.
    if (_wcsicmp(std::filesystem::path{path}.filename().c_str(), L"ApplicationFrameHost.exe") == 0) {
      struct Search {
        DWORD hostPid, appPid;
      } search{pid, 0};
      EnumChildWindows(
          foreground,
          [](HWND child, LPARAM param) -> BOOL {
            auto *s{reinterpret_cast<Search *>(param)};
            DWORD childPid{0};
            GetWindowThreadProcessId(child, &childPid);
            if (childPid != s->hostPid) {
              s->appPid = childPid;
              return FALSE;
            }
            return TRUE;
          },
          reinterpret_cast<LPARAM>(&search));
      if (search.appPid != 0) {
        pid = search.appPid;
        path = ProcessPath(pid);
      }
    }

    wchar_t title[512]{};
    const int titleLength{GetWindowTextW(foreground, title, ARRAYSIZE(title))};
    w.title.assign(title, (std::max)(0, titleLength));
    w.isSelf = pid == GetCurrentProcessId();
    if (!path.empty()) {
      w.exeName = std::filesystem::path{path}.filename().wstring();
      w.appName = FriendlyName(path);
    }
    w.found = true;
    return w;
  }

  // Screen-DC rectangle of the monitor showing the foreground window (else the primary one), so the screenshot
  // matches the app name and title, and the output size: at most maxWidth wide, never upscaled.
  struct Target {
    int x{0}, y{0}, screenW{0}, screenH{0}, w{0}, h{0};
  };

  static bool FindTarget(int maxWidth, Target &t) {
    MONITORINFO monitor{};
    monitor.cbSize = sizeof(monitor);
    const HMONITOR target{MonitorFromWindow(GetForegroundWindow(), MONITOR_DEFAULTTOPRIMARY)};
    if (!target || !GetMonitorInfoW(target, &monitor)) {
      return false;
    }
    // Screen-DC coordinates: the primary monitor starts at 0,0; others can be negative.
    t.x = monitor.rcMonitor.left;
    t.y = monitor.rcMonitor.top;
    t.screenW = monitor.rcMonitor.right - monitor.rcMonitor.left;
    t.screenH = monitor.rcMonitor.bottom - monitor.rcMonitor.top;
    if (t.screenW <= 0 || t.screenH <= 0) {
      return false;
    }
    t.w = (std::min)(maxWidth, t.screenW);
    t.h = (std::max)(1, static_cast<int>(std::lround(static_cast<double>(t.w) * t.screenH / t.screenW)));
    return true;
  }

  // StretchBlts the target into `bitmap` (t.w x t.h) with the main window hidden from this capture only (the
  // floating panel is excluded permanently).
  static bool Blit(Target const &t, HDC screen, HBITMAP bitmap) {
    const HWND main{MainWindow()};
    const bool hideMain{main && IsWindowVisible(main) && SetWindowDisplayAffinity(main, WDA_EXCLUDEFROMCAPTURE)};
    if (hideMain) {
      DwmFlush(); // let DWM compose a frame without it
    }
    bool ok{false};
    if (const HDC memory{CreateCompatibleDC(screen)}) {
      const HGDIOBJ previous{SelectObject(memory, bitmap)};
      SetStretchBltMode(memory, HALFTONE);
      SetBrushOrgEx(memory, 0, 0, nullptr);
      ok = StretchBlt(memory, 0, 0, t.w, t.h, screen, t.x, t.y, t.screenW, t.screenH, SRCCOPY | CAPTUREBLT) != FALSE;
      SelectObject(memory, previous);
      DeleteDC(memory);
    }
    if (hideMain) {
      SetWindowDisplayAffinity(main, WDA_NONE);
    }
    return ok;
  }

  // JPEG-encoded in memory, for the Ollama path.
  static bool CaptureFrame(int maxWidth, float quality, Frame &frame) {
    Target t;
    if (!FindTarget(maxWidth, t)) {
      return false;
    }
    bool ok{false};
    const HDC screen{GetDC(nullptr)};
    const HBITMAP bitmap{screen ? CreateCompatibleBitmap(screen, t.w, t.h) : nullptr};
    if (screen && bitmap) {
      ok = Blit(t, screen, bitmap);
    }
    if (ok) {
      ok = EncodeJpeg(bitmap, quality, frame.jpeg);
      frame.width = t.w;
      frame.height = t.h;
    }
    if (bitmap) DeleteObject(bitmap);
    if (screen) ReleaseDC(nullptr, screen);
    return ok;
  }

  // Top-down BGRA pixels (alpha forced to 255), in memory, for FLScreenModel: its models run natively, so the
  // frame never reaches JS.
  static bool CaptureBgra(int maxWidth, std::vector<uint8_t> &bgra, int &width, int &height) {
    Target t;
    if (!FindTarget(maxWidth, t)) {
      return false;
    }
    BITMAPINFO info{};
    info.bmiHeader.biSize = sizeof(info.bmiHeader);
    info.bmiHeader.biWidth = t.w;
    info.bmiHeader.biHeight = -t.h; // top-down
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    void *bits{nullptr};
    bool ok{false};
    const HDC screen{GetDC(nullptr)};
    const HBITMAP bitmap{screen ? CreateDIBSection(screen, &info, DIB_RGB_COLORS, &bits, nullptr, 0) : nullptr};
    if (screen && bitmap && bits) {
      ok = Blit(t, screen, bitmap);
      if (ok) {
        GdiFlush();
        const size_t size{static_cast<size_t>(t.w) * t.h * 4};
        bgra.assign(static_cast<uint8_t const *>(bits), static_cast<uint8_t const *>(bits) + size);
        for (size_t i = 3; i < size; i += 4) {
          bgra[i] = 255;
        }
        width = t.w;
        height = t.h;
      }
    }
    if (bitmap) DeleteObject(bitmap);
    if (screen) ReleaseDC(nullptr, screen);
    return ok;
  }

  static bool EncodeJpeg(HBITMAP bitmap, float quality, std::vector<uint8_t> &out) {
    using Microsoft::WRL::ComPtr;
    ComPtr<IWICImagingFactory> factory;
    ComPtr<IWICBitmap> source;
    ComPtr<IStream> stream;
    ComPtr<IWICBitmapEncoder> encoder;
    ComPtr<IWICBitmapFrameEncode> frame;
    ComPtr<IPropertyBag2> options;
    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory))) ||
        FAILED(factory->CreateBitmapFromHBITMAP(bitmap, nullptr, WICBitmapIgnoreAlpha, &source)) ||
        FAILED(CreateStreamOnHGlobal(nullptr, TRUE, &stream)) || // memory only, never a file
        FAILED(factory->CreateEncoder(GUID_ContainerFormatJpeg, nullptr, &encoder)) ||
        FAILED(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache)) ||
        FAILED(encoder->CreateNewFrame(&frame, &options))) {
      return false;
    }
    PROPBAG2 option{};
    option.pstrName = const_cast<LPOLESTR>(L"ImageQuality");
    VARIANT value;
    VariantInit(&value);
    value.vt = VT_R4;
    value.fltVal = quality;
    options->Write(1, &option, &value);
    UINT width{0}, height{0};
    source->GetSize(&width, &height);
    WICPixelFormatGUID format{GUID_WICPixelFormat24bppBGR};
    if (FAILED(frame->Initialize(options.Get())) || FAILED(frame->SetSize(width, height)) ||
        FAILED(frame->SetPixelFormat(&format)) || FAILED(frame->WriteSource(source.Get(), nullptr)) ||
        FAILED(frame->Commit()) || FAILED(encoder->Commit())) {
      return false;
    }
    STATSTG stat{};
    if (FAILED(stream->Stat(&stat, STATFLAG_NONAME))) {
      return false;
    }
    out.resize(static_cast<size_t>(stat.cbSize.QuadPart));
    const LARGE_INTEGER zero{};
    ULONG read{0};
    return SUCCEEDED(stream->Seek(zero, STREAM_SEEK_SET, nullptr)) &&
        SUCCEEDED(stream->Read(out.data(), static_cast<ULONG>(out.size()), &read)) && read == out.size();
  }
};

} // namespace LarpLess
