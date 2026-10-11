// FLSound: ambient noise + chimes, a C++/XAudio2 port of Native/Shell/FLShellSoundEngine.swift (same generators,
// gains, equal-power ramps and chime synthesis).
// - play(id, fadeMs): crossfade to off|white|pink|brown|rain|cafe (rain/cafe play brown noise, like macOS
//   without its bundled loops). Resolves immediately.
// - setVolume(v), duck(factor, fadeMs): target gain = volume x duck (0.3 during breaks, 1 to restore).
// - chime(kind): soft|phase|back on a separate voice at 0.55, interrupting a chime still ringing.
#pragma once

#include <NativeModules.h>
#include <xaudio2.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#pragma comment(lib, "xaudio2.lib")

namespace LarpLess {

class FLSoundEngine {
 public:
  static constexpr std::array<char const *, 5> kVoices{"white", "pink", "brown", "rain", "cafe"};

  ~FLSoundEngine() {
    {
      std::lock_guard lock{m_mutex};
      m_quit = true;
    }
    m_wake.notify_all();
    if (m_thread.joinable()) m_thread.join();
    if (m_chimeVoice) m_chimeVoice->DestroyVoice();
    if (m_noiseVoice) m_noiseVoice->DestroyVoice();
    if (m_master) m_master->DestroyVoice();
    m_xaudio = nullptr;
  }

  void Play(std::string const &id, double fadeMs) {
    std::lock_guard lock{m_mutex};
    m_current = id;
    RetargetAll(fadeMs);
    EnsureRunning();
  }

  void SetVolume(double v) {
    {
      std::lock_guard lock{m_mutex};
      m_volume = v;
      if (m_current != "off") RetargetAll(80);
    }
    m_wake.notify_all();
  }

  void Duck(double factor, double fadeMs) {
    {
      std::lock_guard lock{m_mutex};
      m_duck = factor;
      RetargetAll(fadeMs);
    }
    m_wake.notify_all();
  }

  void Chime(std::string const &kind) {
    std::lock_guard lock{m_mutex};
    if (!Init()) return;
    std::vector<float> &buffer{ChimeBuffer(kind)};
    if (buffer.empty()) return;
    // A new chime interrupts one that's still ringing.
    m_chimeVoice->Stop();
    m_chimeVoice->FlushSourceBuffers();
    XAUDIO2_BUFFER xb{};
    xb.AudioBytes = static_cast<UINT32>(buffer.size() * sizeof(float));
    xb.pAudioData = reinterpret_cast<const BYTE *>(buffer.data());
    xb.Flags = XAUDIO2_END_OF_STREAM;
    m_chimeVoice->SubmitSourceBuffer(&xb);
    m_chimeVoice->Start();
  }

 private:
  struct Ramp {
    double from{0}, to{0}, gain{0};
    int64_t start{0}, length{0}; // in frames
  };

  struct Noise {
    uint32_t seed[2]{0x9E3779B9u, 0x7F4A7C15u};
    double b[2][7]{};
    double brown[2]{};
  };

  // Equal-power shaping: fades in follow sin(p·π/2), fades out 1 − cos(p·π/2), like the Swift engine.
  static double Shape(Ramp const &r, double p) {
    const double s{r.to >= r.from ? std::sin(p * 3.14159265358979 / 2) : 1 - std::cos(p * 3.14159265358979 / 2)};
    return r.from + (r.to - r.from) * s;
  }

  static float White(uint32_t &x) {
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    return static_cast<float>(static_cast<int32_t>(x)) / static_cast<float>(INT32_MAX);
  }

  void RetargetAll(double fadeMs) {
    const double fade{std::isfinite(fadeMs) ? (std::max)(0.0, fadeMs) : 400.0};
    for (char const *id : kVoices) {
      Ramp &r{m_ramps[id]};
      r.from = r.gain;
      r.to = m_current == id ? m_volume * m_duck : 0.0;
      r.start = m_frame;
      r.length = static_cast<int64_t>(fade / 1000.0 * m_rate);
      if (r.length == 0) r.gain = r.to;
    }
  }

  bool Init() {
    if (m_xaudio) return true;
    if (m_failed) return false;
    IXAudio2 *xaudio{nullptr};
    if (FAILED(XAudio2Create(&xaudio, 0, XAUDIO2_DEFAULT_PROCESSOR))) {
      m_failed = true;
      return false;
    }
    m_xaudio.attach(xaudio);
    XAUDIO2_VOICE_DETAILS details{};
    if (FAILED(m_xaudio->CreateMasteringVoice(&m_master))) {
      m_failed = true;
      return false;
    }
    m_master->GetVoiceDetails(&details);
    m_rate = details.InputSampleRate ? details.InputSampleRate : 48000;

    WAVEFORMATEX format{};
    format.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
    format.nChannels = 2;
    format.nSamplesPerSec = m_rate;
    format.wBitsPerSample = 32;
    format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
    format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
    if (FAILED(m_xaudio->CreateSourceVoice(&m_noiseVoice, &format)) ||
        FAILED(m_xaudio->CreateSourceVoice(&m_chimeVoice, &format))) {
      m_failed = true;
      return false;
    }
    m_chimeVoice->SetVolume(0.55f); // independent of the ambient volume and duck
    for (Noise *n : {&m_noise["white"], &m_noise["pink"], &m_noise["brown"], &m_noise["rain"], &m_noise["cafe"]}) {
      n->seed[0] += m_seedSalt;
      n->seed[1] += m_seedSalt * 3;
      m_seedSalt += 0x1234567u;
    }
    return true;
  }

  void EnsureRunning() {
    if (!Init() || m_thread.joinable()) {
      m_wake.notify_all();
      return;
    }
    m_thread = std::thread([this] { RenderLoop(); });
  }

  bool Audible() const {
    for (auto const &[id, r] : m_ramps) {
      if (r.gain > 0.0001 || r.to > 0.0001) return true;
    }
    return false;
  }

  // Keeps a few 10 ms buffers queued; pauses the voice after ~0.3 s of silence.
  void RenderLoop() {
    constexpr int kQueued{4};
    const int frames{static_cast<int>(m_rate / 100)};
    std::array<std::vector<float>, kQueued> buffers;
    for (auto &b : buffers) b.resize(static_cast<size_t>(frames) * 2);
    int next{0};
    int64_t silentSince{-1};
    bool started{false};

    std::unique_lock lock{m_mutex};
    while (!m_quit) {
      const bool audible{Audible()};
      if (!audible) {
        if (silentSince < 0) silentSince = m_frame;
        if (m_frame - silentSince > m_rate * 3 / 10 && started) {
          m_noiseVoice->Stop();
          m_noiseVoice->FlushSourceBuffers();
          started = false;
        }
        if (!started) {
          m_wake.wait(lock, [this] { return m_quit || Audible(); });
          silentSince = -1;
          continue;
        }
      } else {
        silentSince = -1;
      }

      XAUDIO2_VOICE_STATE state{};
      m_noiseVoice->GetState(&state, XAUDIO2_VOICE_NOSAMPLESPLAYED);
      if (state.BuffersQueued >= kQueued) {
        m_wake.wait_for(lock, std::chrono::milliseconds(5));
        continue;
      }
      std::vector<float> &out{buffers[next]};
      Render(out.data(), frames);
      XAUDIO2_BUFFER xb{};
      xb.AudioBytes = static_cast<UINT32>(out.size() * sizeof(float));
      xb.pAudioData = reinterpret_cast<const BYTE *>(out.data());
      m_noiseVoice->SubmitSourceBuffer(&xb);
      next = (next + 1) % kQueued;
      if (!started) {
        m_noiseVoice->Start();
        started = true;
      }
    }
  }

  void Render(float *out, int frames) {
    std::fill(out, out + static_cast<size_t>(frames) * 2, 0.0f);
    for (char const *id : kVoices) {
      Ramp &r{m_ramps[id]};
      if (r.gain <= 0.0001 && r.to <= 0.0001) continue;
      Noise &n{m_noise[id]};
      const std::string_view kind{id};
      for (int i = 0; i < frames; ++i) {
        const int64_t frame{m_frame + i};
        if (r.length > 0 && frame - r.start < r.length) {
          r.gain = Shape(r, static_cast<double>(frame - r.start) / static_cast<double>(r.length));
        } else {
          r.gain = r.to;
        }
        if (r.gain <= 0.0001) continue;
        for (int c = 0; c < 2; ++c) {
          const double w{White(n.seed[c])};
          double s;
          if (kind == "white") {
            s = w * 0.3;
          } else if (kind == "pink") {
            double *b{n.b[c]};
            b[0] = 0.99886 * b[0] + w * 0.0555179;
            b[1] = 0.99332 * b[1] + w * 0.0750759;
            b[2] = 0.96900 * b[2] + w * 0.1538520;
            b[3] = 0.86650 * b[3] + w * 0.3104856;
            b[4] = 0.55000 * b[4] + w * 0.5329522;
            b[5] = -0.7616 * b[5] - w * 0.0168980;
            const double pink{b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362};
            b[6] = w * 0.115926;
            s = pink * 0.11;
          } else { // brown, and rain/cafe without their loops
            n.brown[c] = (n.brown[c] + 0.02 * w) / 1.02;
            s = n.brown[c] * 3.5;
          }
          out[i * 2 + c] += static_cast<float>(s * r.gain);
        }
      }
    }
    m_frame += frames;
  }

  // Cached stereo chime: tones every 120 ms, each ringing 450 ms:
  // 0.28 · attack · decay · tail · (sin 2πft + 0.12 sin 4πft).
  std::vector<float> &ChimeBuffer(std::string const &kind) {
    auto it{m_chimes.find(kind)};
    if (it != m_chimes.end()) return it->second;
    std::vector<double> tones;
    if (kind == "soft") tones = {660, 880};
    else if (kind == "phase") tones = {523.25, 659.25, 783.99};
    else if (kind == "back") tones = {783.99, 1046.5};
    std::vector<float> &buffer{m_chimes[kind]};
    if (tones.empty()) return buffer;
    const double sr{static_cast<double>(m_rate)};
    const double total{0.12 * (tones.size() - 1) + 0.45};
    const size_t frames{static_cast<size_t>(total * sr)};
    const size_t ring{static_cast<size_t>(0.45 * sr)};
    buffer.assign(frames * 2, 0.0f);
    for (size_t t = 0; t < tones.size(); ++t) {
      const size_t offset{static_cast<size_t>(0.12 * t * sr)};
      for (size_t i = 0; i < ring && offset + i < frames; ++i) {
        const double time{i / sr};
        const double attack{(std::min)(1.0, time / 0.003)};
        const double decay{std::exp(-time / 0.11)};
        const double tail{(std::min)(1.0, (ring - i) / (0.006 * sr))};
        const double f{tones[t]};
        const double v{0.28 * attack * decay * tail *
                       (std::sin(2 * 3.14159265358979 * f * time) + 0.12 * std::sin(4 * 3.14159265358979 * f * time))};
        buffer[(offset + i) * 2] += static_cast<float>(v);
        buffer[(offset + i) * 2 + 1] = buffer[(offset + i) * 2]; // left copied to right
      }
    }
    return buffer;
  }

  std::mutex m_mutex;
  std::condition_variable m_wake;
  std::thread m_thread;
  bool m_quit{false};
  bool m_failed{false};
  winrt::com_ptr<IXAudio2> m_xaudio;
  IXAudio2MasteringVoice *m_master{nullptr};
  IXAudio2SourceVoice *m_noiseVoice{nullptr};
  IXAudio2SourceVoice *m_chimeVoice{nullptr};
  uint32_t m_rate{48000};
  uint32_t m_seedSalt{0x2545F491u};
  int64_t m_frame{0};
  std::string m_current{"off"};
  double m_volume{0.5};
  double m_duck{1.0};
  std::map<std::string, Ramp, std::less<>> m_ramps;
  std::map<std::string, Noise, std::less<>> m_noise;
  std::map<std::string, std::vector<float>, std::less<>> m_chimes;
};

REACT_MODULE(FLSound)
struct FLSound {
  template <typename T>
  using ReactPromise = winrt::Microsoft::ReactNative::ReactPromise<T>;

  REACT_METHOD(Play, L"play")
  void Play(std::string &&id, double fadeMs, ReactPromise<void> &&result) noexcept {
    if (id != "off" && id != "white" && id != "pink" && id != "brown" && id != "rain" && id != "cafe") {
      result.Reject(winrt::Microsoft::ReactNative::ReactError{"E_INVALID_ARG", "unknown sound id", {}});
      return;
    }
    m_engine.Play(id, fadeMs);
    result.Resolve();
  }

  REACT_METHOD(SetVolume, L"setVolume")
  void SetVolume(double v) noexcept {
    if (std::isfinite(v)) m_engine.SetVolume((std::clamp)(v, 0.0, 1.0));
  }

  REACT_METHOD(Duck, L"duck")
  void Duck(double factor, double fadeMs) noexcept {
    if (std::isfinite(factor)) m_engine.Duck((std::clamp)(factor, 0.0, 1.0), fadeMs);
  }

  REACT_METHOD(Chime, L"chime")
  void Chime(std::string &&kind) noexcept {
    m_engine.Chime(kind); // unknown kinds are ignored
  }

 private:
  FLSoundEngine m_engine;
};

} // namespace LarpLess
