import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { config } from '../../config';
import type { Settings, SoundId } from '../../contracts/domain';
import type { OllamaHostInfo } from '../../contracts/native';
import { isLocalUrl } from '../../core/ollamaHost';
import { useAppStore } from '../../store/appStore';
import { useNavStore } from '../../store/navStore';
import { useOllamaStore } from '../../store/ollamaStore';
import { useScreenModelStore } from '../../store/screenModelStore';
import { useSessionStore } from '../../store/sessionStore';
import { normalizeSupabaseProjectUrl } from '../../social/supabase';
import { useSocialStore } from '../../store/socialStore';
import { Button, CodeBlock, MacPressable, MacTextInput, ModelDownload, ScreenModelDownload, Segmented, Switch, Text } from '../components';
import { TextField } from '../components/TextField';
import { Page } from '../layout/Page';
import { isLive } from '../lib/actions';
import { errorText } from '../lib/social';
import { APPEARANCE_OPTIONS, CLASSIFIER_OPTIONS, POMODORO_OPTIONS, POWER_OPTIONS, SOUNDS, SOUND_ICON, SOUND_LABEL, STRICTNESS_OPTIONS } from '../lib/labels';
import { ollamaLine } from '../layout/Sidebar';
import { DEVICE, IS_WINDOWS } from '../platform';
import { colors, fonts, layout, radius, space, tag, themed } from '../theme';

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
  // ScreenModelDownload (in the "Screen check" row) refreshes this on mount and after a download.
  const screenModelInstalled = useScreenModelStore((st) => st.status?.installed === true);
  const [model, setModel] = useState(s.model);
  const [url, setUrl] = useState(s.ollamaUrl);
  const [urlRejected, setUrlRejected] = useState(false);
  const [supabaseUrl, setSupabaseUrl] = useState(s.supabaseUrl);
  const [supabaseKey, setSupabaseKey] = useState(s.supabaseAnonKey);
  useEffect(() => setModel(s.model), [s.model]);
  useEffect(() => setUrl(s.ollamaUrl), [s.ollamaUrl]);
  useEffect(() => setSupabaseUrl(s.supabaseUrl), [s.supabaseUrl]);
  useEffect(() => setSupabaseKey(s.supabaseAnonKey), [s.supabaseAnonKey]);
  const [checking, setChecking] = useState(false);
  const host = useOllamaStore((st) => st.host);
  const starting = useOllamaStore((st) => st.starting);
  const prepared = useOllamaStore((st) => st.prepared);
  const pull = useOllamaStore((st) => st.pull);
  const prepare = useOllamaStore((st) => st.prepare);
  const refreshHost = useOllamaStore((st) => st.refreshHost);
  const local = isLocalUrl(s.ollamaUrl);
  useEffect(() => {
    refreshHost().catch(() => {});
  }, [refreshHost]);

  const retry = () => {
    setChecking(true);
    refreshHost().catch(() => {});
    refreshOllama()
      .catch(() => {})
      .finally(() => setChecking(false));
  };
  const startOllama = (force: boolean) => {
    prepare({ launch: true, force }).catch(() => {});
  };
  const commitModel = () => {
    const v = model.trim();
    if (v && v !== s.model) update({ model: v });
  };
  const commitUrl = () => {
    const v = url.trim();
    // Screenshots go to this URL, so it has to be this machine.
    const ok = !v || isLocalUrl(v);
    setUrlRejected(!ok);
    if (!ok) {
      setUrl(s.ollamaUrl);
      return;
    }
    if (v && v !== s.ollamaUrl) update({ ollamaUrl: v });
  };
  const commitSupabase = () => {
    const nextUrl = normalizeSupabaseProjectUrl(supabaseUrl);
    const nextKey = supabaseKey.trim();
    if (nextUrl !== supabaseUrl) setSupabaseUrl(nextUrl);
    if (nextUrl === s.supabaseUrl && nextKey === s.supabaseAnonKey) return;
    update({ supabaseUrl: nextUrl, supabaseAnonKey: nextKey });
  };
  const changeVolume = (v: number) => {
    const clamped = Math.max(0, Math.min(1, Math.round(v * 10) / 10));
    update({ volume: clamped });
    if (isLive(status)) setVolume(clamped);
  };
  const ol = ollamaLine(ollama.status, ollama.model, pull);

  return (
    <Page testID="page-settings" header={{ icon: 'settings', title: 'Settings' }}>
      <SectionTitle>Appearance</SectionTitle>
      <Row label="Theme" hint="Dark mode, light mode, or follow the system.">
        <Segmented
          testID="settings-appearance"
          options={APPEARANCE_OPTIONS}
          value={s.appearance}
          onChange={(v) => update({ appearance: v })}
        />
      </Row>
      <SectionTitle>Friends</SectionTitle>
      <Row label="Project URL" hint="Supabase → Project Settings → API → Project URL (not the /rest/v1/ path). Filled in, these replace the bundled keys.">
        <MacTextInput
          testID="settings-supabase-url"
          value={supabaseUrl}
          onChangeText={setSupabaseUrl}
          onBlur={commitSupabase}
          onSubmitEditing={commitSupabase}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://your-project.supabase.co"
          enableFocusRing={false}
          style={styles.input}
        />
      </Row>
      <Row label="Anon key" hint="The anon public key. Both fields are saved together.">
        <TextField
          testID="settings-supabase-key"
          value={supabaseKey}
          onChangeText={setSupabaseKey}
          onBlur={commitSupabase}
          onSubmitEditing={commitSupabase}
          secureTextEntry
          placeholder="eyJ…"
          style={styles.supabaseKey}
        />
      </Row>
      <AccountSection />
      <SectionTitle>Local AI</SectionTitle>
      {IS_WINDOWS ? (
        <Row
          label="Screen check"
          hint={
            s.classifierMode === 'embed'
              ? 'Only the on-device classifier reads the screen. Ollama is never opened; unsure screens count as unknown.'
              : screenModelInstalled
                ? 'The on-device classifier answers when it’s sure; Ollama checks the rest.'
                : 'The on-device classifier answers when it’s sure; Ollama checks the rest. Download it below to use it alone.'
          }>
          <Segmented
            testID="settings-classifier"
            // "On-device only" with no model would make every check unknown. Already chosen, it stays selectable
            // so it can be switched back.
            options={CLASSIFIER_OPTIONS.map((o) =>
              o.value === 'embed' && !screenModelInstalled && s.classifierMode !== 'embed' ? { ...o, disabled: true } : o,
            )}
            value={s.classifierMode}
            onChange={(v) => update({ classifierMode: v })}
          />
          <View style={styles.screenModel}>
            <ScreenModelDownload testID="settings-screen-model" />
          </View>
        </Row>
      ) : null}
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
      <Row label="Ollama URL" hint="Must be on this computer: localhost or 127.0.0.1.">
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
        {urlRejected ? (
          <Text testID="settings-url-error" variant="small" color={tag.red.text}>
            Screenshots never leave this computer, so the Ollama URL has to point at it.
          </Text>
        ) : null}
      </Row>
      <Row label="Status">
        <View style={styles.inline}>
          <Text testID="settings-ollama" style={styles.statusText}>
            <Text color={tag[ol.color].text}>● </Text>
            {ol.text}
          </Text>
          <Button title={checking ? 'Checking…' : 'Retry'} icon="refresh" variant="ghost" disabled={checking} onPress={retry} />
          {ollama.status === 'down' && local && host?.appInstalled ? (
            <Button
              testID="settings-open-ollama"
              title={starting ? 'Opening…' : 'Open Ollama'}
              variant="secondary"
              disabled={starting}
              onPress={() => startOllama(false)}
            />
          ) : null}
        </View>
        {ollama.status === 'modelMissing' || pull.status === 'pulling' ? <ModelDownload testID="settings-pull" /> : null}
      </Row>
      {local && host?.promptCache ? (
        <Row label="Memory saver" hint="Runs Ollama without the prompt cache that can hold 8 GB of RAM.">
          <View style={styles.inline}>
            <Text testID="settings-memory" style={styles.statusText}>
              {MEMORY_TEXT[host.promptCache]}
            </Text>
            {host.promptCache === 'default' && host.server === 'app' ? (
              <Button
                testID="settings-restart-ollama"
                title={starting ? 'Restarting…' : 'Restart Ollama'}
                variant="secondary"
                disabled={starting}
                onPress={() => startOllama(true)}
              />
            ) : null}
          </View>
          {host.promptCache === 'default' && host.server !== 'app' ? (
            <CodeBlock code="LLAMA_ARG_CACHE_RAM=0 ollama serve" style={styles.code} />
          ) : null}
          {prepared === 'failed' ? (
            <Text variant="small" color={tag.red.text}>
              Couldn’t restart Ollama.
            </Text>
          ) : null}
        </Row>
      ) : null}

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

      <SectionTitle>About</SectionTitle>
      <Row label="Acknowledgements" hint="Open-source software, fonts and models in LarpLess.">
        <Button testID="settings-acknowledgements" title="View" icon="scale" variant="secondary" onPress={() => go('acknowledgements')} />
      </Row>

      {config.SHOW_DEV_TOOLS ? (
        <>
          <SectionTitle>Developer</SectionTitle>
          <View style={styles.inline}>
            <Button testID="settings-devtools" title="Dev tools" icon="wrench" variant="secondary" onPress={() => go('dev')} />
            <Button title="Run onboarding again" variant="ghost" onPress={() => go('onboarding')} style={styles.gapLeft} />
          </View>
        </>
      ) : null}
    </Page>
  );
}

const MEMORY_TEXT: Record<NonNullable<OllamaHostInfo['promptCache']>, string> = {
  off: 'On',
  default: 'Off: Ollama may hold up to 8 GB more RAM',
  custom: 'Custom prompt cache size',
};

function AccountSection() {
  const status = useSocialStore((s) => s.status);
  const profile = useSocialStore((s) => s.profile);
  const signOut = useSocialStore((s) => s.signOut);
  const [busy, setBusy] = useState(false);
  if (status !== 'signedIn' && status !== 'signedOut') return null;

  const openAuth = (auth: 'signIn' | 'signUp') => {
    useNavStore.getState().go('feed', { auth });
  };

  return (
    <>
      <SectionTitle>Account</SectionTitle>
      {status === 'signedIn' ? (
        <>
          <Row label={profile ? `@${profile.username}` : 'Signed in'} hint="This is the name friends see on posts you share.">
            <Button
              testID="settings-signout"
              title={busy ? 'Signing out…' : 'Sign out'}
              variant="danger"
              disabled={busy}
              onPress={() => {
                if (busy) return;
                setBusy(true);
                signOut()
                  .catch(() => {})
                  .finally(() => setBusy(false));
              }}
            />
          </Row>
          <DeleteAccountRow />
        </>
      ) : (
        <Row label="Friends" hint="Sign in to share sessions, or make an account.">
          <View style={styles.inline}>
            <Button testID="settings-signin" title="Sign in" variant="secondary" onPress={() => openAuth('signIn')} />
            <Button testID="settings-signup" title="Create account" variant="primary" onPress={() => openAuth('signUp')} style={styles.gapLeft} />
          </View>
        </Row>
      )}
    </>
  );
}

/** Two steps, so one stray click can't delete an account. */
function DeleteAccountRow() {
  const deleteAccount = useSocialStore((s) => s.deleteAccount);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    deleteAccount()
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => {
        setBusy(false);
        setConfirming(false);
      });
  };

  return (
    <Row
      label="Delete account"
      hint={`Deletes your username, friends and every session you posted. History on this ${DEVICE} stays.`}>
      {confirming ? (
        <View style={styles.inline}>
          <Button testID="settings-delete-confirm" title={busy ? 'Deleting…' : 'Delete for good'} variant="danger" disabled={busy} onPress={run} />
          <Button
            testID="settings-delete-cancel"
            title="Cancel"
            variant="ghost"
            disabled={busy}
            onPress={() => setConfirming(false)}
            style={styles.gapLeft}
          />
        </View>
      ) : (
        <Button testID="settings-delete-account" title="Delete account…" variant="secondary" onPress={() => setConfirming(true)} />
      )}
      {error ? (
        <Text testID="settings-delete-error" variant="small" color={tag.red.text}>
          {error}
        </Text>
      ) : null}
    </Row>
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

const styles = themed(() => StyleSheet.create({
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
    height: layout.controlHeight,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    backgroundColor: colors.raised,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  volBar: { flexDirection: 'row', marginHorizontal: space.xs },
  volStep: { width: 14, height: 14, borderRadius: 2, marginRight: 3 },
  volPct: { marginLeft: space.sm, width: 36 },
  gapLeft: { marginLeft: space.md },
  code: { alignSelf: 'stretch', maxWidth: 420, marginTop: space.xs },
  screenModel: { alignSelf: 'stretch', maxWidth: 420, marginTop: space.sm },
  supabaseKey: { alignSelf: 'stretch', maxWidth: 420 },
}));
