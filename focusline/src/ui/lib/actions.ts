/** Session actions shared by Home, the Session page, the ⌘K palette and the native menu. */
import type { PomodoroPreset } from '../../contracts/domain';
import type { SessionStatus } from '../../contracts/store';
import { useAppStore } from '../../store/appStore';
import { useNavStore } from '../../store/navStore';
import { useSessionStore } from '../../store/sessionStore';

export const isLive = (s: SessionStatus) => s === 'running' || s === 'paused' || s === 'break';

/** Start a session (or jump to the live one). Pomodoro defaults to settings.pomodoroDefault. */
export function startSession(opts: { pomodoro?: PomodoroPreset | 'off'; demo?: boolean } = {}): Promise<void> {
  const s = useSessionStore.getState();
  if (isLive(s.status)) {
    useNavStore.getState().go('session');
    return Promise.resolve();
  }
  const pomodoro = opts.pomodoro ?? useAppStore.getState().settings.pomodoroDefault;
  return s.start({ pomodoro, demo: opts.demo }).catch((e: unknown) => {
    console.warn('[ui] start failed:', e instanceof Error ? e.message : String(e));
  });
}

export function togglePause(): void {
  const s = useSessionStore.getState();
  if (s.status === 'running') s.pause();
  else if (s.status === 'paused') s.resume();
}

export function endSession(): Promise<void> {
  const s = useSessionStore.getState();
  if (!isLive(s.status)) return Promise.resolve();
  return s
    .end()
    .then(() => undefined)
    .catch((e: unknown) => {
      console.warn('[ui] end failed:', e instanceof Error ? e.message : String(e));
    });
}
