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

 private:
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

  static double EpochMs() {
    return static_cast<double>(
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch())
            .count());
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

  // Primary display, scaled to at most maxWidth (never upscaled), JPEG-encoded in memory.
  static bool CaptureFrame(int maxWidth, float quality, Frame &frame) {
    const int screenW{GetSystemMetrics(SM_CXSCREEN)};
    const int screenH{GetSystemMetrics(SM_CYSCREEN)};
    if (screenW <= 0 || screenH <= 0) {
      return false;
    }
    const int w{(std::min)(maxWidth, screenW)};
    const int h{(std::max)(1, static_cast<int>(std::lround(static_cast<double>(w) * screenH / screenW)))};

    // Hide the main window from this capture only (the floating panel is excluded permanently).
    const HWND main{MainWindow()};
    const bool hideMain{main && IsWindowVisible(main) && SetWindowDisplayAffinity(main, WDA_EXCLUDEFROMCAPTURE)};
    if (hideMain) {
      DwmFlush(); // let DWM compose a frame without it
    }

    bool ok{false};
    const HDC screen{GetDC(nullptr)};
    const HDC memory{CreateCompatibleDC(screen)};
    const HBITMAP bitmap{CreateCompatibleBitmap(screen, w, h)};
    if (screen && memory && bitmap) {
      const HGDIOBJ previous{SelectObject(memory, bitmap)};
      SetStretchBltMode(memory, HALFTONE);
      SetBrushOrgEx(memory, 0, 0, nullptr);
      ok = StretchBlt(memory, 0, 0, w, h, screen, 0, 0, screenW, screenH, SRCCOPY | CAPTUREBLT) != FALSE;
      SelectObject(memory, previous);
    }
    if (hideMain) {
      SetWindowDisplayAffinity(main, WDA_NONE);
    }
    if (ok) {
      ok = EncodeJpeg(bitmap, quality, frame.jpeg);
      frame.width = w;
      frame.height = h;
    }
    if (bitmap) DeleteObject(bitmap);
    if (memory) DeleteDC(memory);
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

  static std::string Base64(std::vector<uint8_t> const &data) {
    static constexpr char table[]{"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"};
    std::string out;
    out.reserve((data.size() + 2) / 3 * 4);
    size_t i{0};
    for (; i + 2 < data.size(); i += 3) {
      const uint32_t n{(uint32_t{data[i]} << 16) | (uint32_t{data[i + 1]} << 8) | data[i + 2]};
      out += table[(n >> 18) & 63];
      out += table[(n >> 12) & 63];
      out += table[(n >> 6) & 63];
      out += table[n & 63];
    }
    if (i < data.size()) {
      const uint32_t n{(uint32_t{data[i]} << 16) | (i + 1 < data.size() ? uint32_t{data[i + 1]} << 8 : 0)};
      out += table[(n >> 18) & 63];
      out += table[(n >> 12) & 63];
      out += i + 1 < data.size() ? table[(n >> 6) & 63] : '=';
      out += '=';
    }
    return out;
  }
};

} // namespace LarpLess
