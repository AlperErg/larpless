/** Session actions shared by Home, the Session page, the ⌘K palette and the native menu. */
import type { PomodoroPreset } from '../../contracts/domain';
import type { SessionStatus } from '../../contracts/store';
import { useAppStore } from '../../store/appStore';
import { useNavStore } from '../../store/navStore';
import { useSessionStore } from '../../store/sessionStore';
import { useSocialStore } from '../../store/socialStore';

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

/**
 * Delete a finished session and its chunks; History, streaks and stats follow from the session list.
 * `post` also takes it off the friends' feed, first: if that fails nothing is deleted, so the user can retry.
 */
export async function deleteSession(sessionId: string, opts: { post?: boolean } = {}): Promise<void> {
  const session = useSessionStore.getState();
  if (isLive(session.status) && session.session?.id === sessionId) throw new Error('End the session before deleting it.');
  if (opts.post) await useSocialStore.getState().unpublish(sessionId);
  // The summary page falls back to lastSummary, so drop it too or the deleted session reappears there.
  if (session.lastSummary?.id === sessionId) useSessionStore.setState({ lastSummary: null });
  await useAppStore.getState().deleteSession(sessionId);
}
