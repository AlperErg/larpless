import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { config } from '../../config';
import type { Settings, SoundId } from '../../contracts/domain';
import { useAppStore } from '../../store/appStore';
import { useNavStore } from '../../store/navStore';
import { useSessionStore } from '../../store/sessionStore';
import { Button, MacPressable, MacTextInput, Segmented, Switch, Text } from '../components';
import { Page } from '../layout/Page';
import { isLive } from '../lib/actions';
import { POMODORO_OPTIONS, POWER_OPTIONS, SOUNDS, SOUND_ICON, SOUND_LABEL, STRICTNESS_OPTIONS } from '../lib/labels';
import { ollamaLine } from '../layout/Sidebar';
import { colors, fonts, radius, space, tag } from '../theme';

/** Local mirror of settings so controls respond instantly; every change also goes to updateSettings. */
function useSettingsDraft(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [local, setLocal] = useState(settings);
  useEffect(() => setLocal(settings), [settings]);
  const update = (patch: Partial<Settings>) => {
    setLocal((l) => ({ ...l, ...patch }));
    updateSettings(patch).catch((e: unknown) => console.warn('[ui] updateSettings failed:', e instanceof Error ? e.message : String(e)));
  };
  return [local, update];
}

export function SettingsPage() {
  const [s, update] = useSettingsDraft();
  const ollama = useSessionStore((st) => st.ollama);
  const refreshOllama = useSessionStore((st) => st.refreshOllama);
  const status = useSessionStore((st) => st.status);
  const setVolume = useSessionStore((st) => st.setVolume);
  const go = useNavStore((st) => st.go);
  const [model, setModel] = useState(s.model);
  const [url, setUrl] = useState(s.ollamaUrl);
  useEffect(() => setModel(s.model), [s.model]);
  useEffect(() => setUrl(s.ollamaUrl), [s.ollamaUrl]);
  const [checking, setChecking] = useState(false);

  const retry = () => {
    setChecking(true);
    refreshOllama()
      .catch(() => {})
      .finally(() => setChecking(false));
  };
  const commitModel = () => {
    const v = model.trim();
    if (v && v !== s.model) update({ model: v });
  };
  const commitUrl = () => {
    const v = url.trim();
    if (v && v !== s.ollamaUrl) update({ ollamaUrl: v });
  };
  const changeVolume = (v: number) => {
    const clamped = Math.max(0, Math.min(1, Math.round(v * 10) / 10));
    update({ volume: clamped });
    if (isLive(status)) setVolume(clamped);
  };
  const ol = ollamaLine(ollama.status, ollama.model);

  return (
    <Page testID="page-settings" header={{ icon: '⚙️', title: 'Settings' }}>
      <SectionTitle>Local AI</SectionTitle>
      <Row label="Model" hint="Ollama vision model used to read the screen.">
        <MacTextInput
          testID="settings-model"
          value={model}
          onChangeText={setModel}
          onBlur={commitModel}
          onSubmitEditing={commitModel}
          enableFocusRing={false}
          autoCorrect={false}
          style={styles.input}
        />
      </Row>
      <Row label="Ollama URL">
        <MacTextInput
          testID="settings-url"
          value={url}
          onChangeText={setUrl}
          onBlur={commitUrl}
          onSubmitEditing={commitUrl}
          enableFocusRing={false}
          autoCorrect={false}
          style={styles.input}
        />
      </Row>
      <Row label="Status">
        <View style={styles.inline}>
          <Text testID="settings-ollama" style={styles.statusText}>
            <Text color={tag[ol.color].text}>● </Text>
            {ol.text}
          </Text>
          <Button title={checking ? 'Checking…' : 'Retry'} icon="↻" variant="ghost" disabled={checking} onPress={retry} />
        </View>
      </Row>

      <SectionTitle>Focus</SectionTitle>
      <Row label="Power" hint="Slower machines use Eco so the model can finish.">
        <Segmented testID="settings-power" options={POWER_OPTIONS} value={s.powerProfile} onChange={(v) => update({ powerProfile: v })} />
      </Row>
      <Row label="Strictness" hint="Minutes of distraction before a notification.">
        <Segmented testID="settings-strictness" options={STRICTNESS_OPTIONS} value={s.strictness} onChange={(v) => update({ strictness: v })} />
      </Row>
      <Row label="Pomodoro" hint="Default for new sessions.">
        <Segmented testID="settings-pomodoro" options={POMODORO_OPTIONS} value={s.pomodoroDefault} onChange={(v) => update({ pomodoroDefault: v })} />
      </Row>
      <Row label="Demo fast mode" hint="Alerts after 20 s. Check rate stays on the power profile you picked.">
        <Switch testID="settings-demoFast" accessibilityLabel="Demo fast mode" value={s.demoFast} onChange={(v) => update({ demoFast: v })} />
      </Row>
      <Row label="Webcam" hint="Presence and phone detection, on device at 1 fps.">
        <Switch testID="settings-webcam" accessibilityLabel="Webcam" value={s.webcamEnabled} onChange={(v) => update({ webcamEnabled: v })} />
      </Row>
      <Row label="Now playing" hint="Song, time left, and skip on the timer. The title is never saved.">
        <Switch testID="settings-now-playing" accessibilityLabel="Now playing" value={s.nowPlayingEnabled} onChange={(v) => update({ nowPlayingEnabled: v })} />
      </Row>

      <SectionTitle>Sound</SectionTitle>
      <Row label="Chimes & alerts">
        <Switch testID="settings-sounds" accessibilityLabel="Sounds" value={s.soundsEnabled} onChange={(v) => update({ soundsEnabled: v })} />
      </Row>
      <Row label="Default sound">
        <Segmented<SoundId>
          testID="settings-sound"
          color="purple"
          options={SOUNDS.map((id) => ({ value: id, label: SOUND_LABEL[id], icon: SOUND_ICON[id] }))}
          value={s.defaultSound}
          onChange={(v) => update({ defaultSound: v })}
        />
      </Row>
      <Row label="Volume">
        <VolumeBar value={s.volume} onChange={changeVolume} />
      </Row>

      {config.SHOW_DEV_TOOLS ? (
        <>
          <SectionTitle>Developer</SectionTitle>
          <View style={styles.inline}>
            <Button testID="settings-devtools" title="Dev tools" icon="🛠" variant="secondary" onPress={() => go('dev')} />
            <Button title="Run onboarding again" variant="ghost" onPress={() => go('onboarding')} style={styles.gapLeft} />
          </View>
        </>
      ) : null}
    </Page>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text variant="h3" style={styles.section}>
      {children}
    </Text>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabel}>
        <Text>{label}</Text>
        {hint ? <Text variant="small">{hint}</Text> : null}
      </View>
      <View style={styles.rowControl}>{children}</View>
    </View>
  );
}

/** 10-step volume bar with − / +. */
function VolumeBar({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const steps = Math.round(value * 10);
  return (
    <View testID="settings-volume" style={styles.inline}>
      <Button title="−" variant="ghost" onPress={() => onChange(value - 0.1)} />
      <View style={styles.volBar}>
        {Array.from({ length: 10 }, (_, i) => (
          <MacPressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={`Volume ${(i + 1) * 10}%`}
            enableFocusRing={false}
            onPress={() => onChange((i + 1) / 10)}
            style={[styles.volStep, { backgroundColor: i < steps ? colors.accent : colors.active }]}
          />
        ))}
      </View>
      <Button title="+" variant="ghost" onPress={() => onChange(value + 0.1)} />
      <Text variant="small" style={styles.volPct}>{`${steps * 10}%`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: space.xxl, marginBottom: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: { width: 220, paddingRight: space.lg },
  rowControl: { flex: 1, alignItems: 'flex-start' },
  inline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  statusText: { marginRight: space.sm },
  input: {
    alignSelf: 'stretch',
    maxWidth: 320,
    height: 28,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    backgroundColor: colors.bg,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  volBar: { flexDirection: 'row', marginHorizontal: space.xs },
  volStep: { width: 14, height: 14, borderRadius: 2, marginRight: 3 },
  volPct: { marginLeft: space.sm, width: 36 },
  gapLeft: { marginLeft: space.md },
});
