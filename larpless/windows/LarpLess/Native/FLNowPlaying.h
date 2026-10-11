// FLNowPlaying: system now-playing for the floating panel. Title and artist stay in this
// process (drawn on the panel only). They are never logged, stored, or sent to JS.
#pragma once

#include "FLUtil.h"

#include <NativeModules.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Media.Control.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

namespace LarpLess {

struct FLNowPlayingTrack {
  bool active{false};
  std::wstring title;
  std::wstring artist;
  bool hasDuration{false};
  double durationS{0};
  double positionS{0};
  double positionAtMs{0};
  double rate{0};
};

// elapsed = positionS + rate * (nowMs - positionAtMs) / 1000; remaining = max(0, duration - elapsed).
// Returns a negative value when there is no duration to show.
inline double FLNowPlayingRemainingS(FLNowPlayingTrack const &track, double nowMs) {
  if (!track.active || !track.hasDuration) return -1;
  const double elapsed{track.positionS + track.rate * (nowMs - track.positionAtMs) / 1000.0};
  return (std::max)(0.0, track.durationS - elapsed);
}

// Owns the GSMTC session. The panel reads Snapshot() and sends Command().
class FLNowPlayingState {
 public:
  static FLNowPlayingState &Instance() {
    static FLNowPlayingState state;
    return state;
  }

  ~FLNowPlayingState() {
    m_life->dead.store(true, std::memory_order_release);
    {
      std::lock_guard lock{m_mu};
      m_shutdown = true;
      m_enabled = false;
      ++m_gen;
      m_commandQueue.clear();
    }
    m_cv.notify_all();
    Stop();
    while (m_life->inflight.load(std::memory_order_acquire) != 0) std::this_thread::yield();
    if (m_worker.joinable()) m_worker.join();
    if (m_commands.joinable()) m_commands.join();
  }

  void SetListener(std::function<void()> listener) {
    std::lock_guard lock{m_mu};
    m_listener = std::move(listener);
  }

  void SetEnabled(bool on) {
    {
      std::lock_guard lock{m_mu};
      if (m_enabled == on && (on ? m_worker.joinable() : true) && !m_shutdown) {
        // A repeat enable while the worker is backing off should retry now, not a second thread.
        if (on && m_gen != m_installedGen) {
          m_retryNow = true;
          m_cv.notify_all();
        }
        return;
      }
      m_enabled = on;
      ++m_gen;
      if (!on) m_commandQueue.clear();
      EnsureThreadsLocked();
      m_cv.notify_all();
    }
    // Drop subscriptions on this thread so a slow worker cannot leave them live after disable.
    // The worker re-checks m_gen before it installs or publishes anything.
    if (!on) {
      Stop();
      SetLive({});
    }
  }

  // 0 previous, 1 play/pause, 2 next. Sent to the session Windows treats as current.
  void Command(int which) {
    {
      std::lock_guard lock{m_mu};
      if (m_shutdown || !m_enabled || !m_session) return;
      EnsureThreadsLocked();
      if (m_commandQueue.size() >= 4) m_commandQueue.pop_front();
      m_commandQueue.push_back({m_session, which});
      m_cv.notify_all();
    }
  }

  FLNowPlayingTrack Snapshot() const {
    std::lock_guard lock{m_mu};
    return ShownLocked();
  }

  // A track shows that row and hides the live session until cleared (nullopt or inactive).
  void DebugSetTrack(std::optional<FLNowPlayingTrack> track) {
    std::function<void()> listener;
    {
      std::lock_guard lock{m_mu};
      const bool was{ShownLocked().active};
      if (track && track->active && !track->title.empty()) {
        m_debug = true;
        m_override = *track;
      } else {
        m_debug = false;
        m_override = {};
      }
      const bool now{ShownLocked().active};
      if (was != now) Log(now ? "[FLNowPlaying] session up\n" : "[FLNowPlaying] session cleared\n");
      listener = m_listener;
    }
    if (listener) listener();
  }

 private:
  using Manager = winrt::Windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
  using Session = winrt::Windows::Media::Control::GlobalSystemMediaTransportControlsSession;

  struct CallbackLife {
    std::atomic<int> inflight{0};
    std::atomic<bool> dead{false};
  };

  FLNowPlayingTrack ShownLocked() const {
    return m_debug ? m_override : m_live;
  }

  static void Log(char const *line) {
    OutputDebugStringA(line);
  }

  void Notify() {
    std::function<void()> listener;
    {
      std::lock_guard lock{m_mu};
      listener = m_listener;
    }
    if (listener) listener();
  }

  void SetLive(FLNowPlayingTrack next) {
    {
      std::lock_guard lock{m_mu};
      const bool was{ShownLocked().active};
      m_live = std::move(next);
      const bool now{ShownLocked().active};
      if (was != now) Log(now ? "[FLNowPlaying] session up\n" : "[FLNowPlaying] session cleared\n");
    }
    Notify();
  }

  void Stop() {
    Session session{nullptr};
    Manager manager{nullptr};
    winrt::event_token sessionsToken{}, mediaToken{}, playbackToken{}, timelineToken{};
    bool haveSessions{false}, haveMedia{false}, havePlayback{false}, haveTimeline{false};
    {
      std::lock_guard lock{m_mu};
      session = m_session;
      manager = m_manager;
      sessionsToken = m_sessionsToken;
      mediaToken = m_mediaToken;
      playbackToken = m_playbackToken;
      timelineToken = m_timelineToken;
      haveSessions = m_haveSessions;
      haveMedia = m_haveMedia;
      havePlayback = m_havePlayback;
      haveTimeline = m_haveTimeline;
      m_session = nullptr;
      m_manager = nullptr;
      m_haveSessions = m_haveMedia = m_havePlayback = m_haveTimeline = false;
    }
    Revoke(session, manager, sessionsToken, mediaToken, playbackToken, timelineToken, haveSessions, haveMedia,
           havePlayback, haveTimeline);
  }

  static void Revoke(Session const &session, Manager const &manager, winrt::event_token sessionsToken,
                     winrt::event_token mediaToken, winrt::event_token playbackToken, winrt::event_token timelineToken,
                     bool haveSessions, bool haveMedia, bool havePlayback, bool haveTimeline) {
    try {
      if (session && haveMedia) session.MediaPropertiesChanged(mediaToken);
      if (session && havePlayback) session.PlaybackInfoChanged(playbackToken);
      if (session && haveTimeline) session.TimelinePropertiesChanged(timelineToken);
      if (manager && haveSessions) manager.CurrentSessionChanged(sessionsToken);
    } catch (...) {
    }
  }

  bool Current(int gen) const {
    return !m_shutdown && m_enabled && m_gen == gen;
  }

  void EnsureThreadsLocked() {
    if (!m_worker.joinable()) m_worker = std::thread([this] { Worker(); });
    if (!m_commands.joinable()) m_commands = std::thread([this] { CommandLoop(); });
  }

  // Callbacks only record the latest session. The worker applies it, so two threads never Hook at once.
  void PostRefresh(Session const &session, int gen) {
    std::lock_guard lock{m_mu};
    if (!Current(gen)) return;
    m_pendingSession = session;
    m_refreshPosted = true;
    m_cv.notify_all();
  }

  void Hook(Session const &session, int gen) {
    Session previous{nullptr};
    winrt::event_token mediaToken{}, playbackToken{}, timelineToken{};
    bool haveMedia{false}, havePlayback{false}, haveTimeline{false};
    {
      std::lock_guard lock{m_mu};
      if (!Current(gen)) return;
      if (m_session == session && m_haveMedia) return;
      previous = m_session;
      mediaToken = m_mediaToken;
      playbackToken = m_playbackToken;
      timelineToken = m_timelineToken;
      haveMedia = m_haveMedia;
      havePlayback = m_havePlayback;
      haveTimeline = m_haveTimeline;
      m_session = nullptr;
      m_haveMedia = m_havePlayback = m_haveTimeline = false;
    }
    Revoke(previous, nullptr, {}, mediaToken, playbackToken, timelineToken, false, haveMedia, havePlayback, haveTimeline);
    if (!session) return;
    winrt::event_token nextMedia{}, nextPlayback{}, nextTimeline{};
    try {
      // Subscribe without the mutex. A synchronous callback only posts; it does not take the pipeline.
      auto life = m_life;
      nextMedia = session.MediaPropertiesChanged([life, this, gen](Session const &sender, auto const &) { OnSession(life, this, gen, sender); });
      nextPlayback = session.PlaybackInfoChanged([life, this, gen](Session const &sender, auto const &) { OnSession(life, this, gen, sender); });
      nextTimeline = session.TimelinePropertiesChanged([life, this, gen](Session const &sender, auto const &) { OnSession(life, this, gen, sender); });
    } catch (...) {
      Revoke(session, nullptr, {}, nextMedia, nextPlayback, nextTimeline, false, true, true, true);
      return;
    }
    bool keep{false};
    {
      std::lock_guard lock{m_mu};
      if (Current(gen)) {
        m_session = session;
        m_mediaToken = nextMedia;
        m_playbackToken = nextPlayback;
        m_timelineToken = nextTimeline;
        m_haveMedia = m_havePlayback = m_haveTimeline = true;
        keep = true;
      }
    }
    if (!keep) Revoke(session, nullptr, {}, nextMedia, nextPlayback, nextTimeline, false, true, true, true);
  }

  void Publish(FLNowPlayingTrack next, int gen) {
    {
      std::lock_guard lock{m_mu};
      if (!Current(gen)) return;
      const bool was{ShownLocked().active};
      m_live = std::move(next);
      const bool now{ShownLocked().active};
      if (was != now) Log(now ? "[FLNowPlaying] session up\n" : "[FLNowPlaying] session cleared\n");
    }
    {
      std::lock_guard lock{m_mu};
      if (!Current(gen)) {
        const bool was{ShownLocked().active};
        m_live = {};
        const bool now{ShownLocked().active};
        if (was != now) Log("[FLNowPlaying] session cleared\n");
      }
    }
    Notify();
  }

  // WinRT may call this after revoke. `dead` is checked before `self` is used.
  static void OnSession(std::shared_ptr<CallbackLife> const &life, FLNowPlayingState *self, int gen, Session const &session) {
    life->inflight.fetch_add(1, std::memory_order_acq_rel);
    struct Exit {
      std::shared_ptr<CallbackLife> life;
      ~Exit() {
        life->inflight.fetch_sub(1, std::memory_order_acq_rel);
      }
    } exit{life};
    if (life->dead.load(std::memory_order_acquire)) return;
    self->PostRefresh(session, gen);
  }

  void Refresh(Session const &session, int gen) {
    {
      std::lock_guard lock{m_mu};
      if (!Current(gen)) return;
    }
    if (!session) {
      Publish({}, gen);
      return;
    }
    Hook(session, gen);
    try {
      auto props = session.TryGetMediaPropertiesAsync().get();
      {
        std::lock_guard lock{m_mu};
        if (!Current(gen)) return;
      }
      const std::wstring title{props.Title().c_str()};
      if (title.empty()) {
        Publish({}, gen);
        return;
      }
      auto playback = session.GetPlaybackInfo();
      using Status = winrt::Windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus;
      const bool playing{playback.PlaybackStatus() == Status::Playing};
      double rate{0};
      if (auto given = playback.PlaybackRate()) rate = given.Value();
      if (!playing) rate = 0;
      else if (!(rate > 0)) rate = 1;

      auto timeline = session.GetTimelineProperties();
      FLNowPlayingTrack track;
      track.active = true;
      track.title = title;
      track.artist = std::wstring{props.Artist().c_str()};
      track.positionS = static_cast<double>(timeline.Position().count()) / 10000000.0;
      const auto span{timeline.EndTime() - timeline.StartTime()};
      if (span.count() > 0) {
        track.hasDuration = true;
        track.durationS = static_cast<double>(span.count()) / 10000000.0;
      }
      const auto updated{winrt::clock::to_sys(timeline.LastUpdatedTime())};
      track.positionAtMs = static_cast<double>(
          std::chrono::duration_cast<std::chrono::milliseconds>(updated.time_since_epoch()).count());
      track.rate = rate;
      Publish(std::move(track), gen);
    } catch (...) {
      Publish({}, gen);
    }
  }

  // One worker for the life of the process. Generation is checked before every install and publish,
  // so a slow RequestAsync cannot tear down a newer session or revive a track after disable.
  void Worker() {
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    for (;;) {
      int gen{0};
      bool install{false};
      bool refresh{false};
      Session pending{nullptr};
      {
        std::unique_lock lock{m_mu};
        m_cv.wait(lock, [&] { return m_shutdown || m_refreshPosted || (m_enabled && m_gen != m_installedGen); });
        if (m_shutdown) return;
        if (!m_enabled) {
          m_refreshPosted = false;
          continue;
        }
        gen = m_gen;
        if (m_gen != m_installedGen) {
          install = true;
          m_refreshPosted = false;
        } else if (m_refreshPosted) {
          refresh = true;
          pending = m_pendingSession;
          m_refreshPosted = false;
        }
      }
      if (install) Install(gen);
      else if (refresh) Refresh(pending, gen);
    }
  }

  void Install(int gen) {
    Manager manager{nullptr};
    try {
      manager = Manager::RequestAsync().get();
    } catch (...) {
      std::unique_lock lock{m_mu};
      if (!Current(gen)) return;
      m_cv.wait_for(lock, std::chrono::seconds(1), [&] { return m_shutdown || !Current(gen) || m_retryNow; });
      m_retryNow = false;
      return;
    }
    {
      std::lock_guard lock{m_mu};
      if (!Current(gen)) return;
    }
    Stop();
    {
      std::lock_guard lock{m_mu};
      if (!Current(gen)) return;
    }
    winrt::event_token sessionsToken{};
    try {
      auto life = m_life;
      sessionsToken = manager.CurrentSessionChanged([life, this, gen](Manager const &sender, auto const &) {
        Session current{nullptr};
        try {
          current = sender.GetCurrentSession();
        } catch (...) {
          current = nullptr;
        }
        OnSession(life, this, gen, current);
      });
    } catch (...) {
      std::unique_lock lock{m_mu};
      if (!Current(gen)) return;
      m_cv.wait_for(lock, std::chrono::seconds(1), [&] { return m_shutdown || !Current(gen) || m_retryNow; });
      m_retryNow = false;
      return;
    }
    bool keep{false};
    {
      std::lock_guard lock{m_mu};
      if (Current(gen)) {
        m_manager = manager;
        m_sessionsToken = sessionsToken;
        m_haveSessions = true;
        m_installedGen = gen;
        keep = true;
      }
    }
    if (!keep) {
      try {
        manager.CurrentSessionChanged(sessionsToken);
      } catch (...) {
      }
      return;
    }
    Session session{nullptr};
    try {
      session = manager.GetCurrentSession();
    } catch (...) {
      session = nullptr;
    }
    Refresh(session, gen);
  }

  void CommandLoop() {
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    for (;;) {
      Session session{nullptr};
      int which{0};
      {
        std::unique_lock lock{m_mu};
        m_cv.wait(lock, [&] { return m_shutdown || !m_commandQueue.empty(); });
        if (m_shutdown) return;
        session = m_commandQueue.front().session;
        which = m_commandQueue.front().which;
        m_commandQueue.pop_front();
        if (!m_enabled || session != m_session) continue;
      }
      try {
        if (which == 0) session.TrySkipPreviousAsync().get();
        else if (which == 1) session.TryTogglePlayPauseAsync().get();
        else session.TrySkipNextAsync().get();
      } catch (...) {
      }
    }
  }

  struct QueuedCommand {
    Session session{nullptr};
    int which{0};
  };

  std::shared_ptr<CallbackLife> m_life{std::make_shared<CallbackLife>()};
  mutable std::mutex m_mu;
  std::condition_variable m_cv;
  std::thread m_worker;
  std::thread m_commands;
  std::deque<QueuedCommand> m_commandQueue;
  std::function<void()> m_listener;
  bool m_enabled{false};
  bool m_shutdown{false};
  bool m_debug{false};
  bool m_refreshPosted{false};
  bool m_retryNow{false};
  int m_gen{0};
  int m_installedGen{0};
  FLNowPlayingTrack m_live;
  FLNowPlayingTrack m_override;
  Manager m_manager{nullptr};
  Session m_session{nullptr};
  Session m_pendingSession{nullptr};
  winrt::event_token m_sessionsToken{};
  winrt::event_token m_mediaToken{};
  winrt::event_token m_playbackToken{};
  winrt::event_token m_timelineToken{};
  bool m_haveSessions{false};
  bool m_haveMedia{false};
  bool m_havePlayback{false};
  bool m_haveTimeline{false};
};

REACT_MODULE(FLNowPlaying)
struct FLNowPlaying {
  REACT_METHOD(SetEnabled, L"setEnabled")
  void SetEnabled(bool on) noexcept {
    FLNowPlayingState::Instance().SetEnabled(on);
  }
};

} // namespace LarpLess
