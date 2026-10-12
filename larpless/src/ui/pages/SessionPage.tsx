import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PomodoroState, StudyModule, TagColor } from '../../contracts/domain';
import type { CurrentCheck, SessionStoreState, SessionStatus } from '../../contracts/store';
import { useAppStore } from '../../store/appStore';
import { useNavStore } from '../../store/navStore';
import { useSessionStore } from '../../store/sessionStore';
import {
  BreakdownBar,
  Button,
  Callout,
  PrivacyBadge,
  Segmented,
  SerifTimer,
  StatusDot,
  Muted,
  Strong,
  Tag,
  Text,
  type IconName,
} from '../components';
import type { DotKind } from '../components';
import { Page } from '../layout/Page';
import { endSession, startSession, togglePause } from '../lib/actions';
import { breakdownFromChunks, lookModule } from '../lib/derive';
import { formatCountdown, formatDuration, formatTime, timeAgo } from '../lib/format';
import { useNow } from '../lib/hooks';
import { POMODORO_OPTIONS, SOUND_ICON, SOUND_LABEL, nextSound } from '../lib/labels';
import { space } from '../theme';
import { DEVICE, MOD } from '../platform';
import { useAllModules } from '../lib/useAllModules';

export function SessionPage() {
  const status = useSessionStore((s) => s.status);
  if (status === 'idle') return <SessionIdle />;
  if (status === 'ended') return <SessionEnded />;
  return <LiveSession status={status} />;
}

/* ------------------------------------------------------------------ */
/* Live                                                                */
/* ------------------------------------------------------------------ */

function LiveSession({ status }: { status: SessionStatus }) {
  const session = useSessionStore((s) => s.session);
  const timer = useSessionStore((s) => s.timer);
  const chunks = useSessionStore((s) => s.chunks);
  const current = useSessionStore((s) => s.current);
  const webcam = useSessionStore((s) => s.webcam);
  const privacy = useSessionStore((s) => s.privacy);
  const pomodoro = useSessionStore((s) => s.pomodoro);
  const alert = useSessionStore((s) => s.alert);
  const sound = useSessionStore((s) => s.sound);
  const setSound = useSessionStore((s) => s.setSound);
  const skipPomodoroPhase = useSessionStore((s) => s.skipPomodoroPhase);
  const pausedForSleep = useSessionStore((s) => s.pausedForSleep);
  const modules = useAllModules();

  const breakdown = useMemo(() => breakdownFromChunks(chunks, modules), [chunks, modules]);
  const line = statusLine(status, current, modules);
  const cover = coverColor(status, current, modules);
  const cam = webcamInfo(webcam, status);
  const onBreak = status === 'break';

  return (
    <Page
      testID="page-session"
      header={{
        icon: 'target',
        title: 'Focus session',
        cover,
        subtitle: (
          <>
            <Text variant="small" style={styles.subtitleText}>
              {session ? `Started ${formatTime(session.startedAt)}` : 'Starting…'}
            </Text>
            {pomodoro && pomodoro.enabled ? <PomodoroChip p={pomodoro} /> : null}
          </>
        ),
      }}>
      {alert.level >= 2 && !onBreak ? <AlertBanner level={alert.level} since={alert.distractedSinceMs} /> : null}

      <SerifTimer testID="session-timer" timer={timer} size={88} style={styles.timer} />

      <View testID="session-status" style={styles.statusRow}>
        <StatusDot kind={line.kind} pulsing={line.pulsing} />
        <Text style={styles.statusText}>{line.text}</Text>
      </View>

      {status === 'paused' && pausedForSleep ? (
        <Callout testID="slept-callout" icon="moon">
          <Text>Paused while your {DEVICE} slept, so that time doesn’t count. Resume when you’re back.</Text>
        </Callout>
      ) : (
        <LastCheck current={current} modules={modules} onBreak={onBreak} />
      )}

      <View style={styles.block}>
        <Text variant="small" weight="medium" style={styles.label}>
          Breakdown
        </Text>
        {breakdown.length ? (
          <BreakdownBar testID="session-breakdown" entries={breakdown} legend legendTime />
        ) : (
          <Text variant="small">The bar fills in after the first check.</Text>
        )}
      </View>

      <View style={[styles.block, styles.chips]}>
        <Tag testID="webcam-chip" label={cam.label} icon={cam.icon} color={cam.color} style={styles.chip} />
        <Tag
          testID="sound-chip"
          label={SOUND_LABEL[sound.id]}
          icon={SOUND_ICON[sound.id]}
          color={sound.id === 'off' ? 'gray' : 'purple'}
          tooltip="Click to change the sound"
          onPress={() => setSound(nextSound(sound.id))}
          style={styles.chip}
        />
        <PrivacyBadge
          testID="privacy-badge"
          framesAnalysed={privacy.framesAnalysed}
          checksWithoutScreenshot={privacy.checksWithoutScreenshot}
          framesStored={privacy.framesStored}
          style={styles.chip}
        />
      </View>

      <View style={[styles.block, styles.buttons]}>
        {onBreak ? (
          <Button testID="skip-break" title="Skip break" icon="skip" variant="secondary" onPress={skipPomodoroPhase} />
        ) : (
          <Button
            testID="pause-resume"
            title={status === 'paused' ? 'Resume' : 'Pause'}
            icon={status === 'paused' ? 'play' : 'pause'}
            variant="ghost"
            onPress={togglePause}
          />
        )}
        <Button testID="end-session" title="End session" icon="stop" variant="danger" onPress={() => endSession()} style={styles.gapLeft} />
      </View>
    </Page>
  );
}

function PomodoroChip({ p }: { p: PomodoroState }) {
  const now = useNow(1000);
  const left = (p.phaseEndsAtMs - now) / 1000;
  const label =
    p.phase === 'focus'
      ? `Round ${p.round} of ${p.roundsBeforeLong} · ${formatCountdown(left)} left`
      : `${p.phase === 'longBreak' ? 'Long break' : 'Break'} · ${formatCountdown(left)}`;
  return (
    <Tag
      testID="pomodoro-chip"
      label={label}
      icon={p.phase === 'focus' ? 'timer' : 'coffee'}
      color={p.phase === 'focus' ? 'orange' : 'blue'}
      style={styles.subtitleChip}
    />
  );
}

function AlertBanner({ level, since }: { level: number; since: number | null }) {
  const now = useNow(1000);
  const mins = since ? Math.max(1, Math.round((now - since) / 60_000)) : null;
  return (
    <Callout testID="alert-banner" icon={level >= 3 ? 'megaphone' : 'alarm'} tone="red" style={styles.alert}>
      <Text>
        <Strong>{mins ? `Distracted for ${mins} min.` : 'Distracted.'}</Strong> Close the tab and come
        back — the timer only counts real focus.
      </Text>
    </Callout>
  );
}

function LastCheck({ current, modules, onBreak }: { current: CurrentCheck | null; modules: StudyModule[]; onBreak: boolean }) {
  const now = useNow(1000, !!current && !onBreak);
  if (onBreak) {
    return (
      <Callout testID="last-check" icon="moon" tone="blue">
        <Text>On a break: screen and camera checks are paused. Stretch, drink some water.</Text>
      </Callout>
    );
  }
  if (!current || current.kind === 'starting') {
    return (
      <Callout testID="last-check" icon="lightbulb">
        <Text>Waiting for the first check…</Text>
      </Callout>
    );
  }
  let label: string;
  let detail = current.activity;
  switch (current.kind) {
    case 'subject':
      label = lookModule(modules, current.moduleId).name;
      break;
    case 'distracted':
      label = 'Distracted';
      break;
    case 'away':
      label = 'Away';
      detail = detail || 'Nobody at the desk';
      break;
    default:
      label = 'Not sure';
      detail = detail || "Couldn't classify this one";
  }
  return (
    <Callout testID="last-check" icon="lightbulb" tone={current.kind === 'distracted' ? 'red' : 'gray'}>
      <Text>
        Last check: <Strong>{label}</Strong>
        {detail ? ` — ${detail}` : ''}
        <Muted>{` · ${timeAgo(current.at, now)}`}</Muted>
      </Text>
    </Callout>
  );
}

/* ------------------------------------------------------------------ */
/* Derivations                                                         */
/* ------------------------------------------------------------------ */

export function statusLine(
  status: SessionStatus,
  current: CurrentCheck | null,
  modules: StudyModule[],
): { kind: DotKind; pulsing: boolean; text: ReactNode } {
  if (status === 'paused') return { kind: 'paused', pulsing: false, text: 'Paused' };
  if (status === 'break') return { kind: 'break', pulsing: false, text: 'On a break' };
  if (!current || current.kind === 'starting') return { kind: 'starting', pulsing: true, text: 'Starting…' };
  switch (current.kind) {
    case 'subject':
      return {
        kind: 'subject',
        pulsing: true,
        text: (
          <>
            Studying <Strong>{lookModule(modules, current.moduleId).name}</Strong>
          </>
        ),
      };
    case 'distracted':
      return {
        kind: 'distracted',
        pulsing: true,
        text: (
          <>
            <Strong>Distracted</Strong>
            {current.activity ? ` · ${current.activity}` : ''}
          </>
        ),
      };
    case 'away':
      return { kind: 'away', pulsing: true, text: 'Away' };
    default:
      return { kind: 'unknown', pulsing: true, text: 'Not sure what this is' };
  }
}

function coverColor(status: SessionStatus, current: CurrentCheck | null, modules: StudyModule[]): TagColor | null {
  if (status === 'break') return 'blue';
  if (status === 'paused' || !current) return null;
  if (current.kind === 'subject') return lookModule(modules, current.moduleId).color;
  if (current.kind === 'distracted') return 'red';
  return null;
}

function webcamInfo(w: SessionStoreState['webcam'], status: SessionStatus): { icon: IconName; label: string; color: TagColor } {
  if (!w.enabled) return { icon: 'cameraOff', label: 'Camera off', color: 'gray' };
  if (status === 'break') return { icon: 'coffee', label: 'Not looking (break)', color: 'blue' };
  if (status === 'paused') return { icon: 'camera', label: 'Paused', color: 'gray' };
  if (!w.personPresent) return { icon: 'footprints', label: 'Away', color: 'gray' };
  if (w.phoneVisible) return { icon: 'phone', label: 'Phone spotted', color: 'red' };
  return { icon: 'camera', label: "You're here", color: 'green' };
}

/* ------------------------------------------------------------------ */
/* Idle / ended                                                        */
/* ------------------------------------------------------------------ */

function SessionIdle() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const preset = settings.pomodoroDefault;
  return (
    <Page testID="page-session" header={{ icon: 'target', title: 'Focus session' }}>
      <Callout testID="session-empty" icon="sprout">
        <Text>
          No session running. Start one here, from Home, or with <Strong>{`${MOD}K`}</Strong>.
        </Text>
      </Callout>
      <View style={[styles.block, styles.buttons]}>
        <Button testID="start-session" title="Start session" icon="play" variant="primary" size="lg" onPress={() => startSession()} />
        <Segmented
          testID="pomodoro-preset"
          options={POMODORO_OPTIONS}
          value={preset}
          onChange={(v) => {
            updateSettings({ pomodoroDefault: v }).catch(() => {});
          }}
          style={styles.gapLeft}
        />
      </View>
    </Page>
  );
}

function SessionEnded() {
  const go = useNavStore((s) => s.go);
  const summary = useSessionStore((s) => s.lastSummary);
  return (
    <Page testID="page-session" header={{ icon: 'target', title: 'Focus session' }}>
      <Callout icon="flag">
        <Text>
          Session ended{summary ? ` · ${formatDuration(summary.totalS)} at ${summary.focusPct}% focus` : ''}.
        </Text>
      </Callout>
      <View style={[styles.block, styles.buttons]}>
        <Button title="View summary" variant="primary" onPress={() => go('summary')} />
        <Button title="Start another" variant="ghost" onPress={() => startSession()} style={styles.gapLeft} />
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  subtitleText: { marginRight: space.sm },
  subtitleChip: { marginRight: space.sm },
  alert: { marginBottom: space.lg },
  timer: { marginTop: space.sm, marginLeft: -4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.xs, marginBottom: space.lg },
  statusText: { marginLeft: space.xs, fontSize: 16, lineHeight: 22 },
  block: { marginTop: space.xl },
  label: { marginBottom: space.sm, textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 11 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  chip: { marginRight: space.sm, marginBottom: space.xs },
  buttons: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  gapLeft: { marginLeft: space.md },
});
