// FLFloatingPanel: the floating timer, the Windows twin of Native/Shell/FLFloatingPanel.swift + the SwiftUI
// FLShellPanelView. A native always-on-top, non-activating window drawn with Direct2D/DirectWrite
// (bundled Inter + Instrument Serif), hosted on the UI thread. 300x170, growing to 300x226 (top edge
// anchored) while a system media session is active. The 56 DIP strip matches a desktop now-playing
// bar: rounded album art, title over artist, a thin progress line, transport on the right.
// - show() / hide() / update(partial state) / FLPanelAction events: same contract as macOS.
// - Compact view: serif timer, status pill, subtitle, Pomodoro ring + dots + footer, tint crossfade, pulse,
//   "Back on track" flash. Hover shows the control hub (hidden 600 ms after the mouse leaves).
// - Drag anywhere that isn't a control to move it; excluded from screen capture.
#pragma once

#include "FLNowPlaying.h"

#include <NativeModules.h>
#include <d2d1_1.h>
#include <dwrite_3.h>
#include <dwmapi.h>
#include <ShellScalingApi.h>
#include <wrl/client.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <tuple>
#include <vector>

#include "FLUtil.h"
#include "FLWindow.h"

#pragma comment(lib, "d2d1.lib")
#pragma comment(lib, "dwrite.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "Shcore.lib")

namespace LarpLess {

namespace Panel {

using JSValue = winrt::Microsoft::ReactNative::JSValue;
using JSValueObject = winrt::Microsoft::ReactNative::JSValueObject;
using Microsoft::WRL::ComPtr;

constexpr float kWidth{300}, kHeight{170}, kMediaStrip{56}, kMargin{14}, kRadius{10}, kPad{14};
constexpr UINT kMediaMessage{WM_APP + 41};

struct Rgb {
  float r, g, b;
};
constexpr Rgb Hex(uint32_t v) {
  return {((v >> 16) & 255) / 255.0f, ((v >> 8) & 255) / 255.0f, (v & 255) / 255.0f};
}

// Light or dark, set from JS (setColorScheme). Only touched on the UI thread.
inline bool &DarkScheme() {
  static bool dark{false};
  return dark;
}

// NotionColors.swift
struct Tint {
  Rgb bg, text;
};
inline Tint TintFor(std::string const &name) {
  if (DarkScheme()) {
    if (name == "green") return {Hex(0x1A2420), Hex(0x6FBF8E)};
    if (name == "red") return {Hex(0x2A1C1B), Hex(0xE07A74)};
    if (name == "blue") return {Hex(0x1A242C), Hex(0x7EB0D4)};
    if (name == "brown") return {Hex(0x3F2F28), Hex(0xDEB3A0)};
    if (name == "orange") return {Hex(0x432D1F), Hex(0xEBAF85)};
    if (name == "pink") return {Hex(0x432A36), Hex(0xEBA6C5)};
    return {Hex(0x222220), Hex(0xC8C3B8)}; // gray / unknown
  }
  if (name == "green") return {Hex(0xEDF3EC), Hex(0x448361)};
  if (name == "red") return {Hex(0xFDEBEC), Hex(0xD44C47)};
  if (name == "blue") return {Hex(0xE7F3F8), Hex(0x337EA9)};
  if (name == "brown") return {Hex(0xF4EEEE), Hex(0x9F6B53)};
  if (name == "orange") return {Hex(0xFBECDD), Hex(0xD9730D)};
  if (name == "pink") return {Hex(0xFAF1F5), Hex(0xC14C8A)};
  return {Hex(0xF1F1EF), Hex(0x787774)}; // gray / unknown
}
struct Palette {
  Rgb bg, text, muted, border, hover;
};
inline Palette const &Colors() {
  static constexpr Palette light{Hex(0xFFFFFF), Hex(0x37352F), Hex(0x787774), Hex(0xE9E9E7), Hex(0xEFEFED)};
  // Dark matches theme.ts. The border is pre-blended over the dark bg: brushes here are opaque.
  static constexpr Palette dark{Hex(0x10110F), Hex(0xF4F1EA), Hex(0xC8C3B8), Hex(0x343532), Hex(0x2A2B28)};
  return DarkScheme() ? dark : light;
}

struct Pomodoro {
  std::string phase{"focus"};
  int round{1}, rounds{4};
  double phaseEndsAtMs{0};
};

struct State {
  std::string status{"idle"}, title{"LarpLess"}, tint{"gray"}, soundId{"off"};
  std::optional<std::string> subtitle, flash;
  double baseS{0};
  std::optional<double> runningSinceMs;
  std::optional<Pomodoro> pomodoro;
  double volume{0.5};
  bool pulse{false};
};

inline double NowMs() {
  return EpochMs();
}
inline double SteadyS() {
  return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
}
inline bool Num(JSValue const &v, double &out) {
  if (auto d{v.TryGetDouble()}) {
    out = *d;
    return true;
  }
  if (auto i{v.TryGetInt64()}) {
    out = static_cast<double>(*i);
    return true;
  }
  return false;
}
inline std::wstring W(std::string const &s) {
  return std::wstring{winrt::to_hstring(s)};
}
inline std::wstring Clock(double seconds, bool forceHours = false) {
  const long total{static_cast<long>((std::max)(0.0, std::floor(seconds)))};
  wchar_t buffer[32];
  if (total >= 3600 || forceHours) {
    swprintf_s(buffer, L"%ld:%02ld:%02ld", total / 3600, (total / 60) % 60, total % 60);
  } else {
    swprintf_s(buffer, L"%02ld:%02ld", total / 60, total % 60);
  }
  return buffer;
}
inline std::wstring Countdown(double seconds) {
  const long total{static_cast<long>((std::max)(0.0, std::ceil(seconds)))};
  wchar_t buffer[32];
  swprintf_s(buffer, L"%ld:%02ld", total / 60, total % 60);
  return buffer;
}

// One hub control: its rect (panel DIPs) and the action it sends (or a slider).
struct Control {
  D2D1_RECT_F rect;
  std::function<JSValueObject()> action;
  bool slider{false};
};

class Window {
 public:
  using Sink = std::function<void(JSValueObject const &)>;

  static Window &Instance() {
    static Window window;
    return window;
  }

  void SetSink(Sink sink) {
    m_sink = std::move(sink);
  }
  bool Visible() const {
    return m_hwnd && IsWindowVisible(m_hwnd);
  }
  HWND Hwnd() const {
    return m_hwnd;
  }

  bool Show() {
    m_wantsVisible = true;
    if (!Create()) {
      OutputDebugStringA("[FLPanel] Show: Create failed\n");
      return false;
    }
    m_mediaShown = FLNowPlayingState::Instance().Snapshot().active;
    if (!m_userMoved || NeedsReposition()) PlaceDefault();
    else FitMediaHeight();
    Present();
    OutputDebugStringA(Visible() ? "[FLPanel] Show: visible\n" : "[FLPanel] Show: ShowWindow failed\n");
    return Visible();
  }

  // Puts the timer back on the work area. A window Windows still calls "visible" can be 0-sized,
  // parked off-screen, or cloaked after another app (Spotify) closes; IsWindowVisible is not enough.
  void EnsureVisible() {
    if (m_dragging || m_sliderDragging) return;
    m_wantsVisible = true;
    if (!Create()) return;
    const bool broken{!IsWindowVisible(m_hwnd) || IsIconic(m_hwnd) || NeedsReposition()};
    if (!broken) return;
    if (IsIconic(m_hwnd)) ShowWindow(m_hwnd, SW_RESTORE);
    if (!m_userMoved || NeedsReposition()) PlaceDefault();
    else FitMediaHeight();
    Present();
  }

  void Hide() {
    m_wantsVisible = false;
    m_hover = false;
    m_hubTarget = 0;
    m_hubAlpha = 0;
    if (m_hwnd) {
      KillTimer(m_hwnd, kTickTimer);
      m_fastTimer = false;
      ShowWindow(m_hwnd, SW_HIDE);
    }
  }

  // Partial merge, same rules as the Swift panel: missing / mistyped keys keep their value, explicit null clears
  // the nullable fields, values are clamped.
  void Apply(JSValueObject const &patch) {
    auto get = [&](char const *key) -> JSValue const * {
      const auto it{patch.find(key)};
      return it == patch.end() ? nullptr : &it->second;
    };
    if (auto v{get("status")}; v && v->TryGetString()) m_state.status = *v->TryGetString();
    if (auto v{get("title")}; v && v->TryGetString()) m_state.title = *v->TryGetString();
    if (auto v{get("subtitle")}) {
      if (v->IsNull()) m_state.subtitle.reset();
      else if (v->TryGetString()) m_state.subtitle = *v->TryGetString();
    }
    if (auto v{get("tint")}; v && v->TryGetString() && *v->TryGetString() != m_state.tint) {
      m_prevTint = m_state.tint;
      m_tintChangeS = SteadyS();
      m_state.tint = *v->TryGetString();
    }
    if (auto v{get("timer")}; v && v->TryGetObject()) {
      auto const &timer{*v->TryGetObject()};
      double n;
      if (auto it{timer.find("baseS")}; it != timer.end() && Num(it->second, n)) m_state.baseS = (std::max)(0.0, n);
      if (auto it{timer.find("runningSinceMs")}; it != timer.end()) {
        if (it->second.IsNull()) m_state.runningSinceMs.reset();
        else if (Num(it->second, n)) m_state.runningSinceMs = n;
      }
    }
    if (auto v{get("pomodoro")}) {
      if (v->IsNull()) {
        m_state.pomodoro.reset();
      } else if (auto obj{v->TryGetObject()}) {
        Pomodoro p{m_state.pomodoro.value_or(Pomodoro{})};
        const Pomodoro before{p};
        double n;
        if (auto it{obj->find("phase")}; it != obj->end() && it->second.TryGetString()) p.phase = *it->second.TryGetString();
        if (auto it{obj->find("round")}; it != obj->end() && Num(it->second, n)) p.round = (std::max)(1, static_cast<int>(n));
        if (auto it{obj->find("rounds")}; it != obj->end() && Num(it->second, n)) p.rounds = (std::clamp)(static_cast<int>(n), 1, 12);
        if (auto it{obj->find("phaseEndsAtMs")}; it != obj->end() && Num(it->second, n)) p.phaseEndsAtMs = n;
        // Infer the phase start for the ring: a new phase/round starts now; an end-time shift keeps the length.
        const double now{NowMs()};
        if (!m_state.pomodoro || p.phase != before.phase || p.round != before.round) {
          m_phaseLengthMs = (std::max)(1.0, p.phaseEndsAtMs - now);
        }
        m_state.pomodoro = p;
      }
    }
    if (auto v{get("sound")}; v && v->TryGetObject()) {
      auto const &sound{*v->TryGetObject()};
      double n;
      if (auto it{sound.find("id")}; it != sound.end() && it->second.TryGetString()) m_state.soundId = *it->second.TryGetString();
      if (auto it{sound.find("volume")}; it != sound.end() && Num(it->second, n) && !m_sliderDragging) {
        m_state.volume = (std::clamp)(n, 0.0, 1.0);
      }
    }
    if (auto v{get("pulse")}; v && v->TryGetBoolean()) m_state.pulse = *v->TryGetBoolean();
    if (auto v{get("flash")}) {
      std::optional<std::string> next;
      if (v->TryGetString()) next = *v->TryGetString();
      if (next == std::optional<std::string>{"backOnTrack"} && m_state.flash != next) m_flashStartS = SteadyS();
      if (v->IsNull() || next) m_state.flash = next;
    }
    if (Visible()) {
      Render();
      Schedule();
    }
  }

  // Light / dark palette (see Colors()); repaints right away when visible.
  void SetColorScheme(bool dark) {
    if (DarkScheme() == dark) return;
    DarkScheme() = dark;
    if (Visible()) Render();
  }

  // Dev: let screenshots include the panel (it's excluded from screen capture by default).
  void SetCapturable(bool capturable) {
    m_capturable = capturable;
    if (m_hwnd) SetWindowDisplayAffinity(m_hwnd, capturable ? WDA_NONE : WDA_EXCLUDEFROMCAPTURE);
  }

  JSValueObject DebugInfo() const {
    RECT r{};
    if (m_hwnd) GetWindowRect(m_hwnd, &r);
    return JSValueObject{
        {"created", m_hwnd != nullptr}, {"visible", Visible()},       {"x", r.left},
        {"y", r.top},                   {"w", r.right - r.left},      {"h", r.bottom - r.top},
        {"scale", m_scale},             {"hover", m_hover},           {"fontsLoaded", m_fonts != nullptr},
        {"status", m_state.status},     {"tint", m_state.tint},       {"userMoved", m_userMoved}};
  }

 private:
  static constexpr UINT_PTR kTickTimer{1}, kLeaveTimer{2};

  bool Create() {
    if (m_hwnd && !IsWindow(m_hwnd)) m_hwnd = nullptr;
    if (m_hwnd) return true;
    if (!InitGraphics()) return false;
    WNDCLASSEXW wc{sizeof(wc)};
    wc.lpfnWndProc = &Window::Proc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.lpszClassName = L"LarpLessFloatingPanel";
    RegisterClassExW(&wc);
    m_hwnd = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED, wc.lpszClassName,
                             L"LarpLess timer", WS_POPUP, 0, 0, 1, 1, nullptr, nullptr, wc.hInstance, this);
    if (!m_hwnd) return false;
    FLNowPlayingState::Instance().SetListener([] {
      if (HWND hwnd = Window::Instance().Hwnd()) PostMessageW(hwnd, kMediaMessage, 0, 0);
    });
    SetWindowDisplayAffinity(m_hwnd, m_capturable ? WDA_NONE : WDA_EXCLUDEFROMCAPTURE); // never in LarpLess's own captures
    m_scale = GetDpiForWindow(m_hwnd) / 96.0f;
    return true;
  }

  bool InitGraphics() {
    if (m_d2d) return true;
    if (FAILED(D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, m_d2d.GetAddressOf())) ||
        FAILED(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory5),
                                   reinterpret_cast<IUnknown **>(m_dwrite.GetAddressOf())))) {
      return false;
    }
    LoadFonts();
    return true;
  }

  // Bundled Inter + Instrument Serif from Assets\Fonts (falls back to Segoe UI / Georgia).
  void LoadFonts() {
    wchar_t exe[MAX_PATH]{};
    GetModuleFileNameW(nullptr, exe, MAX_PATH);
    // Wildcard DeploymentContent lands at the package root (AppX\Assets) while the exe sits in AppX\LarpLess,
    // so look next to the exe first and then one level up.
    const std::filesystem::path exeDir{std::filesystem::path{exe}.parent_path()};
    std::filesystem::path dir{exeDir / L"Assets" / L"Fonts"};
    std::error_code ec;
    if (!std::filesystem::is_directory(dir, ec)) dir = exeDir.parent_path() / L"Assets" / L"Fonts";
    ComPtr<IDWriteFontSetBuilder1> builder;
    if (FAILED(m_dwrite->CreateFontSetBuilder(reinterpret_cast<IDWriteFontSetBuilder **>(builder.GetAddressOf())))) return;
    bool any{false};
    for (auto const &entry : std::filesystem::directory_iterator{dir, ec}) {
      ComPtr<IDWriteFontFile> file;
      if (SUCCEEDED(m_dwrite->CreateFontFileReference(entry.path().c_str(), nullptr, &file)) &&
          SUCCEEDED(builder->AddFontFile(file.Get()))) {
        any = true;
      }
    }
    ComPtr<IDWriteFontSet> set;
    if (any && SUCCEEDED(builder->CreateFontSet(&set))) {
      m_dwrite->CreateFontCollectionFromFontSet(set.Get(), &m_fonts);
    }
  }

  ComPtr<IDWriteTextFormat> Format(bool serif, DWRITE_FONT_WEIGHT weight, float size,
                                   DWRITE_TEXT_ALIGNMENT align = DWRITE_TEXT_ALIGNMENT_LEADING, wchar_t const *family = nullptr) {
    // Cached: creating ~20 text formats per frame made the hub fade sluggish.
    const auto key{std::make_tuple(serif, static_cast<int>(weight), size, static_cast<int>(align),
                                   std::wstring{family ? family : L""})};
    if (auto it{m_formats.find(key)}; it != m_formats.end()) return it->second;
    ComPtr<IDWriteTextFormat> format;
    const wchar_t *name{family ? family : m_fonts ? (serif ? L"Instrument Serif" : L"Inter") : (serif ? L"Georgia" : L"Segoe UI")};
    m_dwrite->CreateTextFormat(name, family ? nullptr : m_fonts.Get(), weight, DWRITE_FONT_STYLE_NORMAL,
                               DWRITE_FONT_STRETCH_NORMAL, size, L"en-us", &format);
    if (format) {
      format->SetTextAlignment(align);
      format->SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
      format->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
      DWRITE_TRIMMING trimming{DWRITE_TRIMMING_GRANULARITY_CHARACTER, 0, 0};
      ComPtr<IDWriteInlineObject> ellipsis;
      m_dwrite->CreateEllipsisTrimmingSign(format.Get(), &ellipsis);
      format->SetTrimming(&trimming, ellipsis.Get());
      m_formats.emplace(key, format);
    }
    return format;
  }

  HMONITOR MonitorForPlacement() const {
    if (HWND main{MainWindow()}) {
      if (HMONITOR mon{MonitorFromWindow(main, MONITOR_DEFAULTTONEAREST)}) return mon;
    }
    POINT cursor{};
    if (GetCursorPos(&cursor)) {
      if (HMONITOR mon{MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST)}) return mon;
    }
    return MonitorFromPoint({0, 0}, MONITOR_DEFAULTTOPRIMARY);
  }

  // Top-right of the work area on the main/cursor monitor, panel inset 16 DIP.
  void PlaceDefault() {
    HMONITOR const mon{MonitorForPlacement()};
    MONITORINFO mi{sizeof(mi)};
    GetMonitorInfoW(mon, &mi);
    UINT dpiX{96}, dpiY{96};
    GetDpiForMonitor(mon, MDT_EFFECTIVE_DPI, &dpiX, &dpiY);
    if (dpiX < 96) dpiX = 96;
    m_scale = dpiX / 96.0f;
    const int w{Px(kWidth + 2 * kMargin)}, h{Px(PanelDipHeight() + 2 * kMargin)};
    const int x{mi.rcWork.right - Px(16) - Px(kWidth + kMargin)};
    const int y{mi.rcWork.top + Px(16) - Px(kMargin)};
    SetWindowPos(m_hwnd, HWND_TOPMOST, x, y, w, h, SWP_NOACTIVATE);
  }

  bool OnSomeMonitor() const {
    RECT r{};
    if (!m_hwnd || !GetWindowRect(m_hwnd, &r)) return false;
    return MonitorFromRect(&r, MONITOR_DEFAULTTONULL) != nullptr;
  }

  // True when the timer is minimized, tiny, or mostly outside the work area (so "show" must move it).
  bool NeedsReposition() const {
    if (!m_hwnd || !IsWindow(m_hwnd) || IsIconic(m_hwnd)) return true;
    RECT r{};
    if (!GetWindowRect(m_hwnd, &r)) return true;
    const int w{r.right - r.left}, h{r.bottom - r.top};
    if (w < 80 || h < 80) return true;
    MONITORINFO mi{sizeof(mi)};
    HMONITOR const mon{MonitorFromWindow(m_hwnd, MONITOR_DEFAULTTONEAREST)};
    if (!mon || !GetMonitorInfoW(mon, &mi)) return true;
    RECT hit{};
    if (!IntersectRect(&hit, &r, &mi.rcWork)) return true;
    const int visible{(hit.right - hit.left) * (hit.bottom - hit.top)};
    return visible * 2 < w * h;
  }

  void Uncloak() {
    if (!m_hwnd) return;
    const BOOL off{FALSE};
    DwmSetWindowAttribute(m_hwnd, DWMWA_CLOAK, &off, sizeof(off));
  }

  // Show, re-top, and paint. Layered windows stay blank until UpdateLayeredWindow runs.
  void Present() {
    if (!m_hwnd) return;
    Uncloak();
    ShowWindow(m_hwnd, SW_SHOWNOACTIVATE);
    const DWORD affinity{static_cast<DWORD>(m_capturable ? WDA_NONE : WDA_EXCLUDEFROMCAPTURE)};
    SetWindowDisplayAffinity(m_hwnd, WDA_NONE);
    SetWindowDisplayAffinity(m_hwnd, affinity);
    SetWindowPos(m_hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    Render();
    Schedule();
  }

  // When the media strip changes height, keep the top edge and stay fully inside the monitor work area.
  void EnsureOnWorkArea(int &left, int &top, int width, int height) const {
    if (!m_hwnd) return;
    MONITORINFO mi{sizeof(mi)};
    HMONITOR const mon{MonitorFromWindow(m_hwnd, MONITOR_DEFAULTTONEAREST)};
    if (!mon || !GetMonitorInfoW(mon, &mi)) return;
    const RECT &w{mi.rcWork};
    if (left + width > w.right) left = w.right - width;
    if (top + height > w.bottom) top = w.bottom - height;
    if (left < w.left) left = w.left;
    if (top < w.top) top = w.top;
  }

  void ResizePanelKeepingTop(int pixelW, int pixelH) {
    if (!m_hwnd || pixelW < 80 || pixelH < 80) return;
    RECT r{};
    if (!GetWindowRect(m_hwnd, &r)) return;
    int left{r.left};
    int top{r.top};
    EnsureOnWorkArea(left, top, pixelW, pixelH);
    SetWindowPos(m_hwnd, HWND_TOPMOST, left, top, pixelW, pixelH, SWP_NOACTIVATE);
  }

  int Px(float dip) const {
    return static_cast<int>(std::lround(dip * m_scale));
  }

  // --- animation state ---
  double ElapsedS() const {
    return m_state.baseS + (m_state.runningSinceMs ? (NowMs() - *m_state.runningSinceMs) / 1000.0 : 0.0);
  }
  float TintMix() const {
    const double t{(SteadyS() - m_tintChangeS) / 0.3};
    if (t >= 1) return 1;
    const double eased{t < 0.5 ? 2 * t * t : 1 - std::pow(-2 * t + 2, 2) / 2}; // ease-in-out
    return static_cast<float>(eased);
  }
  float FlashAlpha() const {
    if (m_flashStartS <= 0) return 0;
    const double t{SteadyS() - m_flashStartS};
    if (t < 0.18) return static_cast<float>(t / 0.18);
    if (t < 1.2) return 1;
    if (t < 1.45) return static_cast<float>(1 - (t - 1.2) / 0.25);
    return 0;
  }
  bool Animating() const {
    return m_state.pulse || TintMix() < 1 || FlashAlpha() > 0 || m_hubAlpha != m_hubTarget || m_sliderDragging;
  }

  // `rearm` is false for mouse input: it arrives faster than the 16 ms timer, and re-arming SetTimer on every
  // move restarts its countdown, so the fade (and the clock) would stall while the mouse is moving.
  void Schedule(bool rearm = true) {
    if (!m_hwnd || !Visible()) return;
    const bool fast{Animating()};
    if (!rearm && (m_fastTimer || !fast)) return;
    m_fastTimer = fast;
    UINT delay{1000};
    if (fast) {
      delay = 16;
    } else if (m_state.runningSinceMs || MediaPlaying()) {
      // Tick on whole displayed seconds (study timer, or the track's time left).
      const double ms{std::fmod((m_state.runningSinceMs ? ElapsedS() : TrackRemainingS()) * 1000.0, 1000.0)};
      delay = static_cast<UINT>(1000.0 - ms) + 5;
    }
    SetTimer(m_hwnd, kTickTimer, delay, nullptr);
  }

  // --- drawing ---
  // One brush recoloured per use (every draw call consumes it before the next Brush() call).
  ComPtr<ID2D1SolidColorBrush> Brush(Rgb c, float a = 1) {
    if (!m_brush || m_brushTarget != m_rt.Get()) {
      m_brush.Reset();
      m_rt->CreateSolidColorBrush(D2D1::ColorF(c.r, c.g, c.b, a), &m_brush);
      m_brushTarget = m_rt.Get();
    } else {
      m_brush->SetColor(D2D1::ColorF(c.r, c.g, c.b, a));
    }
    return m_brush;
  }
  void Text(std::wstring const &s, IDWriteTextFormat *format, D2D1_RECT_F r, Rgb c, float a = 1) {
    if (!format || s.empty()) return;
    m_rt->DrawTextW(s.c_str(), static_cast<UINT32>(s.size()), format, r, Brush(c, a).Get(),
                    D2D1_DRAW_TEXT_OPTIONS_CLIP | D2D1_DRAW_TEXT_OPTIONS_ENABLE_COLOR_FONT);
  }
  float TextWidth(std::wstring const &s, IDWriteTextFormat *format) {
    ComPtr<IDWriteTextLayout> layout;
    if (!format || FAILED(m_dwrite->CreateTextLayout(s.c_str(), static_cast<UINT32>(s.size()), format, 1000, 100, &layout))) return 0;
    DWRITE_TEXT_METRICS m{};
    layout->GetMetrics(&m);
    return m.widthIncludingTrailingWhitespace;
  }
  void RoundRect(D2D1_RECT_F r, float radius, Rgb c, float a = 1) {
    m_rt->FillRoundedRectangle(D2D1::RoundedRect(r, radius, radius), Brush(c, a).Get());
  }

  std::wstring PillText() const {
    auto const &s{m_state};
    const std::wstring title{W(s.title)};
    if (s.status == "studying") return title.empty() || title == L"Studying" ? L"Studying" : L"Studying \u00B7 " + title;
    if (s.status == "distracted") return s.subtitle ? L"Distracted \u00B7 " + W(*s.subtitle) : title;
    if (s.status == "away") return L"Away";
    if (s.status == "break") {
      std::wstring text{s.pomodoro && s.pomodoro->phase == "longBreak" ? L"Long break" : L"Break"};
      if (s.pomodoro) text += L" \u00B7 " + Countdown((s.pomodoro->phaseEndsAtMs - NowMs()) / 1000.0) + L" left";
      return text;
    }
    if (s.status == "paused") return L"Paused";
    return title;
  }

  void Render() {
    if (!m_hwnd) return;
    const UINT dpi{GetDpiForWindow(m_hwnd)};
    if (dpi >= 96) m_scale = dpi / 96.0f;
    if (m_scale < 1.0f) m_scale = 1.0f;
    // One snapshot for this paint: the window height and the strip both follow it.
    auto const snap{FLNowPlayingState::Instance().Snapshot()};
    if (snap.active != m_mediaShown) {
      m_mediaShown = snap.active;
      ResizePanelKeepingTop(Px(kWidth + 2 * kMargin), Px(PanelDipHeight() + 2 * kMargin));
    }
    const float panelH{PanelDipHeight()};
    const int w{Px(kWidth + 2 * kMargin)}, h{Px(panelH + 2 * kMargin)};
    if (!EnsureSurface(w, h)) return;

    m_rt->BeginDraw();
    m_rt->Clear(D2D1::ColorF(0, 0, 0, 0));
    m_rt->SetTransform(D2D1::Matrix3x2F::Translation(kMargin, kMargin));
    const D2D1_RECT_F panel{0, 0, kWidth, panelH};
    const D2D1_RECT_F card{0, 0, kWidth, kHeight};

    // Soft shadow (stacked translucent rounded rects).
    for (int i = 6; i >= 1; --i) {
      const float g{static_cast<float>(i)};
      RoundRect({-g, -g + 2, kWidth + g, panelH + g + 2}, kRadius + g, {0, 0, 0}, 0.018f);
    }
    // White base, then the tint layer (crossfaded; modulated while pulsing).
    RoundRect(panel, kRadius, Colors().bg);
    const Tint tint{TintFor(m_state.tint)};
    float tintAlpha{1};
    if (m_state.pulse) tintAlpha = static_cast<float>(0.8 + 0.2 * std::cos(2 * 3.14159265358979 * SteadyS() / 2.4));
    const float mix{TintMix()};
    if (mix < 1) RoundRect(panel, kRadius, TintFor(m_prevTint).bg, tintAlpha * (1 - mix));
    RoundRect(panel, kRadius, tint.bg, tintAlpha * mix);
    m_rt->DrawRoundedRectangle(D2D1::RoundedRect({0.5f, 0.5f, kWidth - 0.5f, panelH - 0.5f}, kRadius, kRadius),
                               Brush(m_state.pulse ? tint.text : Colors().border, m_state.pulse ? 0.45f : 1).Get(), 1);

    const float hub{m_hubAlpha};
    if (hub < 1) DrawCompact(tint, 1 - hub);
    m_controls.clear();
    m_mediaHits.clear();
    if (hub > 0) DrawHub(tint, hub);
    if (snap.active) DrawMediaStrip(snap);

    if (const float flash{FlashAlpha()}; flash > 0) {
      const Tint green{TintFor("green")};
      RoundRect(card, kRadius, green.bg, flash);
      Text(L"Back on track \u2713", Format(false, DWRITE_FONT_WEIGHT_SEMI_BOLD, 18, DWRITE_TEXT_ALIGNMENT_CENTER).Get(), card,
           green.text, flash);
    }
    m_rt->EndDraw();

    RECT window{};
    GetWindowRect(m_hwnd, &window);
    POINT pos{window.left, window.top}, src{0, 0};
    SIZE size{w, h};
    BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
    const HDC screen{GetDC(nullptr)};
    if (!UpdateLayeredWindow(m_hwnd, screen, &pos, &size, m_memDC, &src, 0, &blend, ULW_ALPHA)) {
      OutputDebugStringA("[FLPanel] UpdateLayeredWindow failed\n");
    }
    ReleaseDC(nullptr, screen);
    SetWindowPos(m_hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
  }

  bool EnsureSurface(int w, int h) {
    if (m_rt && w == m_surfaceW && h == m_surfaceH) return true;
    if (m_dib) DeleteObject(m_dib);
    if (!m_memDC) m_memDC = CreateCompatibleDC(nullptr);
    BITMAPINFO bi{};
    bi.bmiHeader = {sizeof(BITMAPINFOHEADER), w, -h, 1, 32, BI_RGB};
    void *bits{nullptr};
    m_dib = CreateDIBSection(m_memDC, &bi, DIB_RGB_COLORS, &bits, nullptr, 0);
    if (!m_dib) return false;
    SelectObject(m_memDC, m_dib);
    m_rt.Reset();
    const D2D1_RENDER_TARGET_PROPERTIES props{D2D1::RenderTargetProperties(
        D2D1_RENDER_TARGET_TYPE_DEFAULT, D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED),
        96 * m_scale, 96 * m_scale)};
    ComPtr<ID2D1DCRenderTarget> rt;
    if (FAILED(m_d2d->CreateDCRenderTarget(&props, &rt))) return false;
    const RECT bounds{0, 0, w, h};
    if (FAILED(rt->BindDC(m_memDC, &bounds))) return false;
    m_rt = rt;
    m_surfaceW = w;
    m_surfaceH = h;
    m_artBitmap.Reset();
    m_artDrawn.reset();
    return true;
  }

  void DrawCompact(Tint const &tint, float a) {
    auto const &s{m_state};
    // Big serif timer + speaker icon + Pomodoro ring.
    Text(Clock(ElapsedS()), Format(true, DWRITE_FONT_WEIGHT_NORMAL, 44).Get(), {kPad, 6, kWidth - 70, 62}, Colors().text, a);
    float right{kWidth - kPad};
    if (s.pomodoro) {
      const D2D1_POINT_2F c{right - 10, 34};
      m_rt->DrawEllipse(D2D1::Ellipse(c, 9, 9), Brush(tint.text, 0.18f * a).Get(), 2.5f);
      const double remaining{(std::clamp)((s.pomodoro->phaseEndsAtMs - NowMs()) / m_phaseLengthMs, 0.0, 1.0)};
      DrawArc(c, 9, static_cast<float>(remaining), tint.text, a); // full at the start, empty at the end
      right -= 28;
    }
    if (s.soundId != "off") {
      Text(L"\uE767", Format(false, DWRITE_FONT_WEIGHT_NORMAL, 14, DWRITE_TEXT_ALIGNMENT_CENTER, L"Segoe MDL2 Assets").Get(),
           {right - 20, 24, right, 44}, Colors().muted, a);
    }

    // Status pill: dot + text in the tint colour.
    const auto pillFormat{Format(false, DWRITE_FONT_WEIGHT_MEDIUM, 12)};
    const std::wstring pill{PillText()};
    const float pillW{(std::min)(kWidth - 2 * kPad, TextWidth(pill, pillFormat.Get()) + 26)};
    RoundRect({kPad, 68, kPad + pillW, 90}, 11, tint.text, 0.10f * a);
    m_rt->FillEllipse(D2D1::Ellipse({kPad + 10, 79}, 3.5f, 3.5f), Brush(tint.text, a).Get());
    Text(pill, pillFormat.Get(), {kPad + 18, 68, kPad + pillW - 6, 90}, tint.text, a);

    // Secondary muted line: the subtitle (not for distracted, not when it repeats "Round x of y").
    std::wstring roundText;
    if (s.pomodoro) roundText = L"Round " + std::to_wstring(s.pomodoro->round) + L" of " + std::to_wstring(s.pomodoro->rounds);
    if (s.subtitle && s.status != "distracted" && W(*s.subtitle) != roundText) {
      Text(W(*s.subtitle), Format(false, DWRITE_FONT_WEIGHT_NORMAL, 12).Get(), {kPad, 94, kWidth - kPad, 112}, Colors().muted, a);
    }

    // Pomodoro dots + footer.
    if (s.pomodoro) {
      auto const &p{*s.pomodoro};
      const bool focus{p.phase == "focus"};
      const int completed{focus ? p.round - 1 : (std::min)(p.rounds, p.round)};
      for (int i = 0; i < p.rounds; ++i) {
        const D2D1_POINT_2F c{kPad + 4 + i * 12.0f, 128};
        if (i < completed) m_rt->FillEllipse(D2D1::Ellipse(c, 3.5f, 3.5f), Brush(tint.text, a).Get());
        else if (focus && i == completed) m_rt->DrawEllipse(D2D1::Ellipse(c, 3.5f, 3.5f), Brush(tint.text, a).Get(), 1.5f);
        else m_rt->FillEllipse(D2D1::Ellipse(c, 3.5f, 3.5f), Brush(Colors().muted, 0.25f * a).Get());
      }
      std::wstring footer{roundText};
      if (focus) footer += L" \u00B7 " + Countdown((p.phaseEndsAtMs - NowMs()) / 1000.0) + L" left";
      Text(footer, Format(false, DWRITE_FONT_WEIGHT_NORMAL, 11).Get(), {kPad, 140, kWidth - kPad, 158}, Colors().muted, a);
    }
  }

  // Clockwise arc from 12 o'clock covering `fraction` of the circle.
  void DrawArc(D2D1_POINT_2F c, float r, float fraction, Rgb color, float a) {
    if (fraction <= 0.001f) return;
    ComPtr<ID2D1PathGeometry> path;
    ComPtr<ID2D1GeometrySink> sink;
    if (FAILED(m_d2d->CreatePathGeometry(&path)) || FAILED(path->Open(&sink))) return;
    const float angle{(std::min)(fraction, 0.9999f) * 2 * 3.14159265f};
    sink->BeginFigure({c.x, c.y - r}, D2D1_FIGURE_BEGIN_HOLLOW);
    sink->AddArc(D2D1::ArcSegment({c.x + r * std::sin(angle), c.y - r * std::cos(angle)}, {r, r}, 0,
                                  D2D1_SWEEP_DIRECTION_CLOCKWISE, angle > 3.14159265f ? D2D1_ARC_SIZE_LARGE : D2D1_ARC_SIZE_SMALL));
    sink->EndFigure(D2D1_FIGURE_END_OPEN);
    sink->Close();
    if (!m_roundCap) {
      m_d2d->CreateStrokeStyle(D2D1::StrokeStyleProperties(D2D1_CAP_STYLE_ROUND, D2D1_CAP_STYLE_ROUND), nullptr, 0, &m_roundCap);
    }
    m_rt->DrawGeometry(path.Get(), Brush(color, a).Get(), 2.5f, m_roundCap.Get());
  }

  // A hub button; registers its hit area.
  void Button(D2D1_RECT_F r, std::wstring const &label, std::function<JSValueObject()> action, float a, bool selected = false,
              std::optional<Tint> chip = std::nullopt, bool icon = false) {
    const bool hot{m_hover && InRect(r, m_mouse)};
    if (selected) RoundRect(r, 5, chip ? chip->bg : Colors().hover, a);
    else if (hot) RoundRect(r, 5, Colors().hover, a);
    const auto format{icon ? Format(false, DWRITE_FONT_WEIGHT_NORMAL, 12, DWRITE_TEXT_ALIGNMENT_CENTER, L"Segoe MDL2 Assets")
                           : Format(false, DWRITE_FONT_WEIGHT_MEDIUM, 11.5f, DWRITE_TEXT_ALIGNMENT_CENTER)};
    Text(label, format.Get(), r, selected && chip ? chip->text : Colors().text, a);
    m_controls.push_back({r, std::move(action)});
  }

  void DrawHub(Tint const &, float a) {
    auto const &s{m_state};
    auto action = [](char const *type) {
      return [type] { return JSValueObject{{"type", std::string{type}}}; };
    };
    // Row 1: Pomodoro toggle / skip / presets, small elapsed timer.
    float x{kPad - 4};
    Button({x, 12, x + 26, 36}, s.pomodoro ? L"\uE769" : L"\uE768", action("pomodoroToggle"), a, false, std::nullopt, true);
    x += 28;
    Button({x, 12, x + 26, 36}, L"\uE893", action("pomodoroSkip"), a, false, std::nullopt, true);
    x += 32;
    for (char const *preset : {"25/5", "50/10"}) {
      Button({x, 12, x + 44, 36}, W(preset), [preset] {
        return JSValueObject{{"type", std::string{"pomodoroPreset"}}, {"preset", std::string{preset}}};
      }, a);
      x += 46;
    }
    Text(Clock(ElapsedS()), Format(false, DWRITE_FONT_WEIGHT_MEDIUM, 12, DWRITE_TEXT_ALIGNMENT_TRAILING).Get(),
         {kWidth - 90, 12, kWidth - kPad, 36}, Colors().muted, a);

    // Row 2: sound chips, the selected one in its own tag colour.
    struct Chip {
      char const *id;
      wchar_t const *label;
      char const *color;
    };
    static constexpr Chip chips[]{{"off", L"Off", "gray"},     {"white", L"White", "gray"}, {"pink", L"Pink", "pink"},
                                  {"brown", L"Brown", "brown"}, {"rain", L"Rain", "blue"},   {"cafe", L"Cafe", "orange"}};
    const float chipW{(kWidth - 2 * kPad + 4) / 6};
    x = kPad - 2;
    for (auto const &chip : chips) {
      Button({x, 46, x + chipW - 2, 68}, chip.label, [id = chip.id] {
        return JSValueObject{{"type", std::string{"sound"}}, {"id", std::string{id}}};
      }, a, s.soundId == chip.id, TintFor(chip.color));
      x += chipW;
    }

    // Row 3: volume slider.
    const D2D1_RECT_F track{kPad + 4, 86, kWidth - kPad - 4, 90};
    RoundRect(track, 2, Colors().muted, 0.25f * a);
    const float knobX{track.left + static_cast<float>(s.volume) * (track.right - track.left)};
    RoundRect({track.left, track.top, knobX, track.bottom}, 2, Colors().text, 0.7f * a);
    m_rt->FillEllipse(D2D1::Ellipse({knobX, 88}, 7, 7), Brush(Colors().bg, a).Get());
    m_rt->DrawEllipse(D2D1::Ellipse({knobX, 88}, 7, 7), Brush(Colors().border, a).Get(), 1);
    m_controls.push_back({{track.left - 8, 76, track.right + 8, 100}, nullptr, true});
    m_sliderTrack = track;

    // Row 4: pause|resume, end, open LarpLess.
    const float bw{(kWidth - 2 * kPad - 8) / 3};
    x = kPad;
    const bool paused{s.status == "paused"};
    Button({x, 118, x + bw, 146}, paused ? L"Resume" : L"Pause", action(paused ? "resume" : "pause"), a);
    x += bw + 4;
    Button({x, 118, x + bw, 146}, L"End", action("end"), a);
    x += bw + 4;
    Button({x, 118, x + bw, 146}, L"Open LarpLess", action("openMain"), a);
  }

  // --- input ---
  static bool InRect(D2D1_RECT_F const &r, D2D1_POINT_2F p) {
    return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  }
  D2D1_POINT_2F ToPanel(LPARAM lParam) const {
    return {GET_X_LPARAM_(lParam) / m_scale - kMargin, GET_Y_LPARAM_(lParam) / m_scale - kMargin};
  }
  static int GET_X_LPARAM_(LPARAM l) {
    return static_cast<int>(static_cast<short>(LOWORD(l)));
  }
  static int GET_Y_LPARAM_(LPARAM l) {
    return static_cast<int>(static_cast<short>(HIWORD(l)));
  }

  void Send(JSValueObject const &action) {
    if (m_sink) m_sink(action);
  }

  void SetVolumeFromX(float x, bool final) {
    const float t{(std::clamp)((x - m_sliderTrack.left) / (m_sliderTrack.right - m_sliderTrack.left), 0.0f, 1.0f)};
    m_state.volume = t;
    // While dragging, send on changes of >= 0.02; on release, the final value when it moved.
    if ((!final && std::abs(t - m_sentVolume) >= 0.02) || (final && std::abs(t - m_sentVolume) > 0.0005)) {
      m_sentVolume = t;
      Send(JSValueObject{{"type", std::string{"volume"}}, {"value", static_cast<double>(t)}});
    }
  }

  LRESULT Handle(UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
      case WM_MOUSEACTIVATE:
        return MA_NOACTIVATE; // clicks never steal focus from the app you're working in
      case WM_MOUSEMOVE: {
        m_mouse = ToPanel(lParam);
        if (!m_hover) {
          m_hover = true;
          TRACKMOUSEEVENT tme{sizeof(tme), TME_LEAVE, m_hwnd, 0};
          TrackMouseEvent(&tme);
        }
        KillTimer(m_hwnd, kLeaveTimer);
        m_hubTarget = 1;
        if (m_dragging) {
          POINT p;
          GetCursorPos(&p);
          SetWindowPos(m_hwnd, nullptr, p.x - m_dragOffset.x, p.y - m_dragOffset.y, 0, 0,
                       SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
          m_userMoved = true;
        } else if (m_sliderDragging) {
          SetVolumeFromX(m_mouse.x, false);
        }
        StepHub();
        Render();
        Schedule(false);
        return 0;
      }
      case WM_MOUSELEAVE:
        m_hover = false;
        SetTimer(m_hwnd, kLeaveTimer, 600, nullptr); // hide the hub 600 ms later unless the mouse returns
        Render();
        return 0;
      case WM_LBUTTONDOWN: {
        const D2D1_POINT_2F p{ToPanel(lParam)};
        for (auto const &hit : m_mediaHits) {
          if (!InRect(hit.rect, p)) continue;
          FLNowPlayingState::Instance().Command(hit.command);
          return 0;
        }
        if (m_hubTarget > 0 && m_hubAlpha > 0.05f) { // clickable as soon as the hub starts to appear
          for (auto const &control : m_controls) {
            if (!InRect(control.rect, p)) continue;
            if (control.slider) {
              m_sliderDragging = true;
              m_sentVolume = static_cast<float>(m_state.volume);
              SetCapture(m_hwnd);
              SetVolumeFromX(p.x, false);
            } else if (control.action) {
              Send(control.action());
            }
            Render();
            Schedule(false);
            return 0;
          }
        }
        // Anywhere else drags the panel.
        POINT cursor;
        GetCursorPos(&cursor);
        RECT r{};
        GetWindowRect(m_hwnd, &r);
        m_dragOffset = {cursor.x - r.left, cursor.y - r.top};
        m_dragging = true;
        SetCapture(m_hwnd);
        return 0;
      }
      case WM_LBUTTONUP:
        if (m_sliderDragging) {
          SetVolumeFromX(ToPanel(lParam).x, true);
          m_sliderDragging = false;
        }
        m_dragging = false;
        ReleaseCapture();
        Render();
        return 0;
      case kMediaMessage:
        // Spotify starting or quitting changes the strip height. That must not leave the timer hidden.
        if (!m_wantsVisible) return 0;
        FitMediaHeight();
        Present();
        return 0;
      case WM_TIMER:
        if (wParam == kLeaveTimer) {
          KillTimer(m_hwnd, kLeaveTimer);
          if (!m_hover) m_hubTarget = 0;
        }
        StepHub();
        Render();
        Schedule();
        return 0;
      case WM_DPICHANGED: {
        auto const *suggested{reinterpret_cast<RECT const *>(lParam)};
        m_scale = HIWORD(wParam) / 96.0f;
        SetWindowPos(m_hwnd, HWND_TOPMOST, suggested->left, suggested->top, suggested->right - suggested->left,
                     suggested->bottom - suggested->top, SWP_NOACTIVATE);
        m_rt.Reset();
        FitMediaHeight();
        Render();
        return 0;
      }
    }
    return DefWindowProcW(m_hwnd, msg, wParam, lParam);
  }

  // Hub fade: in immediately, ~0.2 s either way.
  void StepHub() {
    const double now{SteadyS()};
    const float dt{static_cast<float>((std::min)(0.05, now - m_lastStepS))};
    m_lastStepS = now;
    if (m_hubAlpha < m_hubTarget) m_hubAlpha = (std::min)(m_hubTarget, m_hubAlpha + dt / 0.2f);
    else if (m_hubAlpha > m_hubTarget) m_hubAlpha = (std::max)(m_hubTarget, m_hubAlpha - dt / 0.2f);
  }

  static LRESULT CALLBACK Proc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_NCCREATE) {
      auto *self{static_cast<Window *>(reinterpret_cast<CREATESTRUCTW *>(lParam)->lpCreateParams)};
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
      self->m_hwnd = hwnd;
    }
    if (auto *self{reinterpret_cast<Window *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA))}) {
      if (msg == WM_MOUSEMOVE && self->m_hubTarget == 0 && self->m_hubAlpha == 0) self->m_lastStepS = SteadyS();
      return self->Handle(msg, wParam, lParam);
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
  }

  HWND m_hwnd{nullptr};
  bool m_capturable{false}, m_fastTimer{false};
  ComPtr<ID2D1SolidColorBrush> m_brush;
  ID2D1RenderTarget *m_brushTarget{nullptr};
  std::map<std::tuple<bool, int, float, int, std::wstring>, ComPtr<IDWriteTextFormat>> m_formats;
  ComPtr<ID2D1StrokeStyle> m_roundCap;
  Sink m_sink;
  State m_state;
  std::string m_prevTint{"gray"};
  double m_tintChangeS{0}, m_flashStartS{0}, m_phaseLengthMs{25 * 60 * 1000}, m_lastStepS{0};
  float m_scale{1}, m_hubAlpha{0}, m_hubTarget{0}, m_sentVolume{0.5f};
  bool m_hover{false}, m_dragging{false}, m_sliderDragging{false}, m_userMoved{false}, m_wantsVisible{false};
  POINT m_dragOffset{};
  D2D1_POINT_2F m_mouse{};
  D2D1_RECT_F m_sliderTrack{};
  std::vector<Control> m_controls;
  struct MediaHit {
    D2D1_RECT_F rect;
    int command;
  };
  std::vector<MediaHit> m_mediaHits;
  bool m_mediaShown{false};

  float PanelDipHeight() const {
    return kHeight + (m_mediaShown ? kMediaStrip : 0);
  }
  bool MediaPlaying() const {
    auto const snap{FLNowPlayingState::Instance().Snapshot()};
    return snap.active && snap.rate > 0 && snap.hasDuration;
  }
  double TrackRemainingS() const {
    return FLNowPlayingRemainingS(FLNowPlayingState::Instance().Snapshot(), NowMs());
  }
  // Keeps the top edge put and grows downward while a track is active.
  void FitMediaHeight() {
    if (!m_hwnd) return;
    const bool show{FLNowPlayingState::Instance().Snapshot().active};
    RECT r{};
    GetWindowRect(m_hwnd, &r);
    const int wantH{Px((kHeight + (show ? kMediaStrip : 0)) + 2 * kMargin)};
    if (show == m_mediaShown && m_surfaceW != 0 && (r.bottom - r.top) == wantH) return;
    m_mediaShown = show;
    ResizePanelKeepingTop(Px(kWidth + 2 * kMargin), Px(PanelDipHeight() + 2 * kMargin));
  }
  void EnsureArtBitmap(std::shared_ptr<FLNowPlayingArt const> const &art) {
    if (art == m_artDrawn && m_artBitmap) return;
    m_artBitmap.Reset();
    m_artDrawn = art;
    if (!art || art->bgra.size() < static_cast<size_t>(FLNowPlayingArt::kSide * FLNowPlayingArt::kSide * 4) || !m_rt) return;
    const D2D1_BITMAP_PROPERTIES props{D2D1::BitmapProperties(
        D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED), 96 * m_scale, 96 * m_scale)};
    m_rt->CreateBitmap(D2D1::SizeU(FLNowPlayingArt::kSide, FLNowPlayingArt::kSide), art->bgra.data(),
                       FLNowPlayingArt::kSide * 4, props, &m_artBitmap);
  }

  void DrawAlbumArt(D2D1_RECT_F dest, std::shared_ptr<FLNowPlayingArt const> const &art) {
    EnsureArtBitmap(art);
    if (!m_artBitmap) {
      RoundRect(dest, 6, Colors().hover);
      Text(L"\uE8D6", Format(false, DWRITE_FONT_WEIGHT_NORMAL, 16, DWRITE_TEXT_ALIGNMENT_CENTER, L"Segoe MDL2 Assets").Get(),
           dest, Colors().muted);
      return;
    }
    ComPtr<ID2D1BitmapBrush> brush;
    const D2D1_BITMAP_BRUSH_PROPERTIES bp{D2D1::BitmapBrushProperties(
        D2D1_EXTEND_MODE_CLAMP, D2D1_EXTEND_MODE_CLAMP, D2D1_BITMAP_INTERPOLATION_MODE_LINEAR)};
    if (FAILED(m_rt->CreateBitmapBrush(m_artBitmap.Get(), &bp, nullptr, &brush))) return;
    const D2D1_SIZE_F size{m_artBitmap->GetSize()};
    if (size.width <= 0 || size.height <= 0) return;
    const float dw{dest.right - dest.left}, dh{dest.bottom - dest.top};
    brush->SetTransform(D2D1::Matrix3x2F::Scale(dw / size.width, dh / size.height) *
                         D2D1::Matrix3x2F::Translation(dest.left, dest.top));
    m_rt->FillRoundedRectangle(D2D1::RoundedRect(dest, 6, 6), brush.Get());
  }

  void DrawMediaStrip(FLNowPlayingTrack const &snap) {
    if (!snap.active) return;
    const float y{kHeight};
    if (snap.art) RoundRect({0, y, kWidth, y + kMediaStrip}, 0, {snap.art->r, snap.art->g, snap.art->b}, 0.16f);
    RoundRect({kPad, y, kWidth - kPad, y + 1}, 0, Colors().border);
    const D2D1_RECT_F art{8, y + 8, 48, y + 48};
    DrawAlbumArt(art, snap.art);
    auto const icon{Format(false, DWRITE_FONT_WEIGHT_NORMAL, 12, DWRITE_TEXT_ALIGNMENT_CENTER, L"Segoe MDL2 Assets")};
    auto add = [&](float x, wchar_t const *glyph, int command) {
      const D2D1_RECT_F r{x, y + 14, x + 22, y + 36};
      if (m_hover && InRect(r, m_mouse)) RoundRect(r, 4, Colors().hover);
      Text(glyph, icon.Get(), r, Colors().text);
      m_mediaHits.push_back({r, command});
    };
    const float controls{kWidth - 8 - 70};
    add(controls, L"\uE892", 0);
    add(controls + 24, snap.rate > 0 ? L"\uE769" : L"\uE768", 1);
    add(controls + 48, L"\uE893", 2);
    const D2D1_RECT_F title{56, y + 8, controls - 6, y + 26};
    const D2D1_RECT_F artist{56, y + 24, controls - 6, y + 42};
    Text(snap.title, Format(false, DWRITE_FONT_WEIGHT_SEMI_BOLD, 12).Get(), title, Colors().text);
    if (!snap.artist.empty()) {
      Text(snap.artist, Format(false, DWRITE_FONT_WEIGHT_NORMAL, 11).Get(), artist, Colors().muted);
    }
    if (snap.hasDuration && snap.durationS > 0) {
      const double remaining{FLNowPlayingRemainingS(snap, NowMs())};
      const float t{static_cast<float>((std::clamp)((snap.durationS - remaining) / snap.durationS, 0.0, 1.0))};
      const float x0{8}, x1{kWidth - 8}, yb{y + kMediaStrip - 5};
      RoundRect({x0, yb, x1, yb + 2}, 1, Colors().border);
      if (t > 0) {
        const Rgb ink{snap.art ? Rgb{snap.art->r, snap.art->g, snap.art->b} : Colors().text};
        RoundRect({x0, yb, x0 + (x1 - x0) * t, yb + 2}, 1, ink);
      }
    }
  }

  ComPtr<ID2D1Factory> m_d2d;
  ComPtr<IDWriteFactory5> m_dwrite;
  ComPtr<IDWriteFontCollection1> m_fonts;
  ComPtr<ID2D1DCRenderTarget> m_rt;
  HDC m_memDC{nullptr};
  HBITMAP m_dib{nullptr};
  int m_surfaceW{0}, m_surfaceH{0};
  std::shared_ptr<FLNowPlayingArt const> m_artDrawn;
  ComPtr<ID2D1Bitmap> m_artBitmap;
};

} // namespace Panel

REACT_MODULE(FLFloatingPanel)
struct FLFloatingPanel {
  using ReactContext = winrt::Microsoft::ReactNative::ReactContext;
  using JSValue = winrt::Microsoft::ReactNative::JSValue;
  using JSValueObject = winrt::Microsoft::ReactNative::JSValueObject;
  template <typename T>
  using ReactPromise = winrt::Microsoft::ReactNative::ReactPromise<T>;
  using ReactError = winrt::Microsoft::ReactNative::ReactError;

  ~FLFloatingPanel() noexcept {
    s_current = nullptr;
    // The panel HWND outlives this module (singleton). Session end calls hide(); do not hide here or a
    // Metro reload during a session leaves the timer gone with no way to restore it from JS.
  }

  REACT_INIT(Initialize)
  void Initialize(ReactContext const &reactContext) noexcept {
    m_context = reactContext;
    s_current = this;
    m_context.UIDispatcher().Post([] {
      Panel::Window::Instance().SetSink([](JSValueObject const &action) {
        // Dropped when JS isn't listening, like macOS. ('openMain' is handled by JS via appShell.bringToFront.)
        if (auto *self{s_current.load()}; self && self->m_listeners > 0) self->Action(action);
      });
    });
  }

  REACT_METHOD(Show, L"show")
  void Show(ReactPromise<void> &&result) noexcept {
    m_context.UIDispatcher().Post([result = std::make_shared<ReactPromise<void>>(std::move(result))] {
      if (Panel::Window::Instance().Show()) result->Resolve();
      else result->Reject(ReactError{"E_PANEL", "floating panel could not be created", {}});
    });
  }

  REACT_METHOD(EnsureVisible, L"ensureVisible")
  void EnsureVisible(ReactPromise<void> &&result) noexcept {
    m_context.UIDispatcher().Post([result = std::make_shared<ReactPromise<void>>(std::move(result))] {
      Panel::Window::Instance().EnsureVisible();
      result->Resolve();
    });
  }

  REACT_METHOD(Hide, L"hide")
  void Hide(ReactPromise<void> &&result) noexcept {
    m_context.UIDispatcher().Post([result = std::make_shared<ReactPromise<void>>(std::move(result))] {
      Panel::Window::Instance().Hide();
      result->Resolve();
    });
  }

  // Fire-and-forget partial update (see Panel::Window::Apply).
  REACT_METHOD(Update, L"update")
  void Update(JSValueObject &&state) noexcept {
    m_context.UIDispatcher().Post([patch = std::make_shared<JSValueObject>(std::move(state))] {
      Panel::Window::Instance().Apply(*patch);
    });
  }

  // 'light' | 'dark' (JS resolves 'system' first). Fire-and-forget; anything but 'dark' means light, like macOS.
  REACT_METHOD(SetColorScheme, L"setColorScheme")
  void SetColorScheme(std::string &&scheme) noexcept {
    const bool dark{scheme == "dark"};
    m_context.UIDispatcher().Post([dark] { Panel::Window::Instance().SetColorScheme(dark); });
  }

  // Dev diagnostics (HarnessB-style).
  REACT_METHOD(DebugInfo, L"debugInfo")
  void DebugInfo(ReactPromise<JSValue> &&result) noexcept {
    m_context.UIDispatcher().Post([result = std::make_shared<ReactPromise<JSValue>>(std::move(result))] {
      result->Resolve(JSValue{Panel::Window::Instance().DebugInfo()});
    });
  }

  // Dev: allow screenshots of the panel (excluded from capture by default).
  REACT_METHOD(DebugSetCapturable, L"debugSetCapturable")
  void DebugSetCapturable(bool capturable) noexcept {
    m_context.UIDispatcher().Post([capturable] { Panel::Window::Instance().SetCapturable(capturable); });
  }

  // Dev harness. A dict with "title" shows that row; anything else clears it. The title is not logged.
  REACT_METHOD(DebugSetTrack, L"debugSetTrack")
  void DebugSetTrack(JSValueObject &&track) noexcept {
    std::optional<FLNowPlayingTrack> parsed;
    if (auto it{track.find("title")}; it != track.end()) {
      auto trimmed = [](std::string const &s) {
        const auto begin = s.find_first_not_of(" \t\r\n");
        if (begin == std::string::npos) return std::string{};
        const auto end = s.find_last_not_of(" \t\r\n");
        return s.substr(begin, end - begin + 1);
      };
      if (auto title{it->second.TryGetString()}) {
        auto text = trimmed(*title);
        if (text.empty()) {
          FLNowPlayingState::Instance().DebugSetTrack(std::nullopt);
          return;
        }
        FLNowPlayingTrack row;
        row.active = true;
        row.title = std::wstring{winrt::to_hstring(text)};
        if (auto artist{track.find("artist")}; artist != track.end()) {
          if (auto artistText{artist->second.TryGetString()}) row.artist = std::wstring{winrt::to_hstring(*artistText)};
        }
        auto num = [&](char const *key) -> std::optional<double> {
          auto found{track.find(key)};
          if (found == track.end()) return std::nullopt;
          if (auto d{found->second.TryGetDouble()}) return *d;
          if (auto i{found->second.TryGetInt64()}) return static_cast<double>(*i);
          return std::nullopt;
        };
        if (auto duration{num("durationS")}; duration && *duration > 0) {
          row.hasDuration = true;
          row.durationS = *duration;
        }
        if (auto position{num("positionS")}) row.positionS = *position;
        if (auto at{num("positionAtMs")}) row.positionAtMs = *at;
        else row.positionAtMs = EpochMs();
        if (auto rate{num("rate")}) row.rate = *rate;
        parsed = std::move(row);
      }
    }
    FLNowPlayingState::Instance().DebugSetTrack(std::move(parsed));
  }

  REACT_METHOD(AddListener, L"addListener")
  void AddListener(std::string && /*eventName*/) noexcept {
    ++m_listeners;
  }

  REACT_METHOD(RemoveListeners, L"removeListeners")
  void RemoveListeners(double count) noexcept {
    m_listeners = (std::max)(0, m_listeners.load() - static_cast<int>(count));
  }

  REACT_EVENT(Action, L"FLPanelAction")
  std::function<void(JSValueObject const &)> Action;

 private:
  ReactContext m_context;
  std::atomic<int> m_listeners{0};
  static inline std::atomic<FLFloatingPanel *> s_current{nullptr};
};

} // namespace LarpLess
