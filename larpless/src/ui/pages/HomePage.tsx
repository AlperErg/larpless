import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { startOfWeek } from 'date-fns';
import type { PomodoroPreset } from '../../contracts/domain';
import { useAppStore } from '../../store/appStore';
import { useNavStore } from '../../store/navStore';
import { useSessionStore } from '../../store/sessionStore';
import { Button, Callout, Heatmap, Segmented, Strong, Text, ToggleList, isAltPress, sessionToggleItem } from '../components';
import { Page } from '../layout/Page';
import { isLive, startSession } from '../lib/actions';
import { streakDays } from '../lib/derive';
import { formatDuration, greeting } from '../lib/format';
import { POMODORO_OPTIONS } from '../lib/labels';
import { space } from '../theme';
import { ALT, MOD } from '../platform';
import { useAllModules } from '../lib/useAllModules';

const RECENT = 7;

export function HomePage() {
  const sessions = useAppStore((s) => s.sessions);
  const modules = useAllModules();
  const pomodoroDefault = useAppStore((s) => s.settings.pomodoroDefault);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const status = useSessionStore((s) => s.status);
  const go = useNavStore((s) => s.go);

  // Local mirror so the chips respond immediately even before the store persists the setting.
  const [preset, setPreset] = useState<PomodoroPreset | 'off'>(pomodoroDefault);
  useEffect(() => setPreset(pomodoroDefault), [pomodoroDefault]);

  const now = Date.now();
  const streak = useMemo(() => streakDays(sessions, now), [sessions]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekS = useMemo(() => {
    const ws = startOfWeek(now, { weekStartsOn: 1 }).getTime();
    return sessions.filter((s) => s.startedAt >= ws).reduce((a, s) => a + s.totalS, 0);
  }, [sessions]); // eslint-disable-line react-hooks/exhaustive-deps
  const recent = sessions.slice(0, RECENT);
  const live = isLive(status);

  return (
    <Page
      testID="page-home"
      header={{ icon: '🎯', title: 'LarpLess', subtitle: <Text muted>{`${greeting(now)}. Ready when you are.`}</Text> }}>
      {live ? (
        <Callout testID="home-live" emoji="⏱" tone="green">
          <View style={styles.liveRow}>
            <Text style={styles.flex}>
              A session is {status === 'break' ? 'on a break' : status === 'paused' ? 'paused' : 'running'}.
            </Text>
            <Button title="Open session" variant="secondary" onPress={() => go('session')} />
          </View>
        </Callout>
      ) : (
        <View>
          <View style={styles.startRow}>
            <Button
              testID="start-session"
              title="Start session"
              icon="▶︎"
              variant="primary"
              size="lg"
              tooltip={`${ALT}click for a demo session`}
              onPress={(e) => startSession({ pomodoro: preset, demo: isAltPress(e) })}
            />
            <View style={styles.preset}>
              <Text variant="small" style={styles.presetLabel}>
                Pomodoro
              </Text>
              <Segmented
                testID="pomodoro-preset"
                options={POMODORO_OPTIONS}
                value={preset}
                onChange={(v) => {
                  setPreset(v);
                  updateSettings({ pomodoroDefault: v }).catch(() => {});
                }}
              />
            </View>
          </View>
          <Text variant="small" style={styles.tip}>
            {`${ALT}click Start for a demo session · ${MOD}K for every command`}
          </Text>
        </View>
      )}


      <View style={styles.section}>
        <View style={styles.streakRow}>
          <Text variant="h2" testID="streak">
            {streak > 0 ? `🔥 ${streak}-day streak` : '🔥 No streak yet'}
          </Text>
          <Text muted style={styles.week}>
            This week: <Strong>{formatDuration(weekS)}</Strong>
          </Text>
        </View>
        <Heatmap testID="home-heatmap" sessions={sessions} style={styles.heatmap} />
      </View>

      <View style={styles.section}>
        <Text variant="h3" style={styles.h3}>
          Recent sessions
        </Text>
        {recent.length ? (
          <ToggleList testID="recent-sessions" items={recent.map((s) => sessionToggleItem(s, modules, (id) => go('summary', { sessionId: id })))} />
        ) : (
          <Callout testID="home-empty" emoji="🌱">
            <Text>No sessions yet. Your first one will show up here.</Text>
          </Callout>
        )}
        {sessions.length > RECENT ? (
          <Button title={`All ${sessions.length} sessions →`} variant="ghost" onPress={() => go('history')} style={styles.more} />
        ) : null}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  liveRow: { flexDirection: 'row', alignItems: 'center' },
  startRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  preset: { flexDirection: 'row', alignItems: 'center', marginLeft: space.xl },
  presetLabel: { marginRight: space.sm },
  tip: { marginTop: space.sm },
  block: { marginTop: space.lg },
  section: { marginTop: space.xxl },
  streakRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  week: { marginLeft: space.lg },
  heatmap: { marginTop: space.md },
  h3: { marginBottom: space.sm },
  more: { marginTop: space.sm },
});
