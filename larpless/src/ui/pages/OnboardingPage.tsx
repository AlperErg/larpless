/**
 * Onboarding (D5): 1. Your modules → 2. Permissions → 3. Ollama → 4. AI model → Home.
 * Full-window (no sidebar). Steps 3 and 4 install, open and fill Ollama without the terminal.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { config } from '../../config';
import type { TagColor } from '../../contracts/domain';
import type { PermissionKind, PermissionStatus } from '../../contracts/native';
import { isLocalUrl } from '../../core/ollamaHost';
import { native } from '../../native';
import { useAppStore } from '../../store/appStore';
import { useNavStore } from '../../store/navStore';
import { useOllamaStore } from '../../store/ollamaStore';
import { useSessionStore } from '../../store/sessionStore';
import { Button, Callout, CodeBlock, EditableTable, Icon, ModelDownload, Muted, SubjectLibrary, PageHeader, Strong, Tag, Text } from '../components';
import type { IconName } from '../components';
import { PageBody } from '../layout/Page';
import { courseNameProblem, draftsFromModules, modulesFromDrafts } from '../lib/modules';
import type { ModuleDraft } from '../lib/modules';
import { colors, motion, radius, space, tag, themed } from '../theme';
import { ANIMATE, DEVICE, IS_WINDOWS, MotionView } from '../platform';
import { LIBRARY_MODULES } from '../../core/subjectLibrary';

const STEPS = ['Your modules', 'Permissions', 'Ollama', 'AI model'] as const;

export function OnboardingPage() {
  const [step, setStep] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!ANIMATE) return undefined;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: motion.base, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => fade.stopAnimation();
  }, [step, fade]);
  const translateY = useMemo(() => fade.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }), [fade]);

  const finish = () => {
    useAppStore
      .getState()
      .updateSettings({ onboarded: true })
      .catch(() => {});
    useNavStore.getState().go('home');
  };

  return (
    <ScrollView testID="page-onboarding" style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <PageHeader icon="hand" title="Welcome to LarpLess" subtitle={<Text muted>{`Strava for studying. Everything is analysed on this ${DEVICE}.`}</Text>} />
      <PageBody>
        <Progress step={step} />
        <MotionView style={ANIMATE ? { opacity: fade, transform: [{ translateY }] } : undefined}>
          {step === 0 ? <ModulesStep onNext={() => setStep(1)} /> : null}
          {step === 1 ? <PermissionsStep onBack={() => setStep(0)} onNext={() => setStep(2)} /> : null}
          {step === 2 ? <OllamaStep onBack={() => setStep(1)} onNext={() => setStep(3)} /> : null}
          {step === 3 ? <ModelStep onBack={() => setStep(2)} onFinish={finish} /> : null}
        </MotionView>
        {config.SHOW_DEV_TOOLS ? (
          <View style={styles.devRow}>
            <Button testID="onboarding-skip" title="Skip onboarding (dev)" variant="ghost" onPress={finish} />
            <Button title="Dev tools" variant="ghost" onPress={() => useNavStore.getState().go('dev')} />
          </View>
        ) : null}
      </PageBody>
    </ScrollView>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <View testID="onboarding-progress" style={styles.progress}>
      {STEPS.map((label, i) => (
        <View key={label} style={styles.progressItem}>
          <View style={[styles.progressBar, { backgroundColor: i <= step ? colors.accent : colors.border }]} />
          <Text variant="small" weight={i === step ? 'semibold' : 'regular'} color={i === step ? colors.text : colors.muted}>
            {`${i + 1}. ${label}`}
          </Text>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Modules                                                          */
/* ------------------------------------------------------------------ */

function ModulesStep({ onNext }: { onNext: () => void }) {
  const stored = useAppStore((s) => s.modules);
  const saveModules = useAppStore((s) => s.saveModules);
  const [drafts, setDrafts] = useState<ModuleDraft[]>(() => draftsFromModules(stored));
  const mods = modulesFromDrafts(drafts);
  const problem = courseNameProblem(drafts);

  return (
    <View testID="onboarding-modules">
      <Text variant="h2" style={styles.h}>
        Your subjects
      </Text>
      <Text muted style={styles.lead}>
        Nothing to pick: LarpLess recognises {LIBRARY_MODULES.length} subjects automatically and tracks whichever you
        study. Optionally add your own courses (course codes, topics, lecturer names) for sharper labels.
      </Text>
      <EditableTable rows={drafts} onChange={setDrafts} />
      {problem ? (
        <Text testID="onboarding-name-problem" variant="small" color={tag.red.text} style={styles.warn}>
          {problem}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          testID="onboarding-next"
          title={mods.length ? 'Continue' : 'Skip for now'}
          variant="primary"
          onPress={() => {
            if (mods.length || stored.length) saveModules(mods).catch(() => {});
            onNext();
          }}
        />
      </View>
      <Text variant="small" weight="medium" style={styles.presets}>
        Recognised automatically
      </Text>
      <SubjectLibrary testID="onboarding-library" />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Permissions                                                      */
/* ------------------------------------------------------------------ */

type NotifStatus = 'granted' | 'denied' | 'notDetermined';

const STATUS_TAG: Record<PermissionStatus, { label: string; color: TagColor }> = {
  granted: { label: 'Allowed', color: 'green' },
  denied: { label: 'Denied', color: 'red' },
  notDetermined: { label: 'Not asked', color: 'gray' },
};

function PermissionsStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [perm, setPerm] = useState<Record<PermissionKind, PermissionStatus> | null>(null);
  const [notif, setNotif] = useState<NotifStatus>('notDetermined');
  const [screenRequested, setScreenRequested] = useState(false);

  // Poll every 2 s while this step is open (grants happen in System Settings).
  useEffect(() => {
    let alive = true;
    const poll = () =>
      native.permissions
        .status()
        .then((s) => {
          if (alive) setPerm(s);
        })
        .catch(() => {});
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const request = (kind: PermissionKind) => {
    if (kind === 'screen') setScreenRequested(true);
    native.permissions
      .request(kind)
      .then((s) => setPerm((p) => (p ? { ...p, [kind]: s } : p)))
      .catch(() => {});
  };

  return (
    <View testID="onboarding-permissions">
      <Text variant="h2" style={styles.h}>
        Let LarpLess see what you see
      </Text>
      <Text muted style={styles.lead}>
        Frames stay in memory and are never saved. During breaks and while you're away, nothing is captured.
      </Text>

      {IS_WINDOWS ? null : (
      <PermRow
        id="screen"
        icon="monitor"
        title="Screen Recording"
        body="Reads the frontmost window to tell study from distraction."
        status={perm?.screen ?? null}
        onAllow={() => request('screen')}
        onSettings={() => native.permissions.openSettings('screen').catch(() => {})}
        extra={
          perm?.screen !== 'granted' || screenRequested ? (
            <View style={styles.relaunch}>
              <Text variant="small" style={styles.flex}>
                macOS only applies Screen Recording after LarpLess relaunches.
              </Text>
              <Button testID="relaunch" title="Relaunch" variant="secondary" onPress={() => native.permissions.relaunch().catch(() => {})} />
            </View>
          ) : null
        }
      />
      )}
      <PermRow
        id="camera"
        icon="camera"
        title="Camera"
        body="Notices when you step away or pick up your phone. Optional."
        status={perm?.camera ?? null}
        onAllow={() => request('camera')}
        onSettings={() => native.permissions.openSettings('camera').catch(() => {})}
      />
      <PermRow
        id="notifications"
        icon="bell"
        title="Notifications"
        body="A gentle nudge when you drift off for a few minutes."
        status={notif}
        onAllow={() =>
          native.notifications
            .requestPermission()
            .then(setNotif)
            .catch(() => {})
        }
      />

      <View style={styles.actions}>
        <Button title="Back" variant="ghost" onPress={onBack} />
        <Button testID="onboarding-next" title="Continue" variant="primary" onPress={onNext} style={styles.gapLeft} />
      </View>
    </View>
  );
}

function PermRow({
  id,
  icon,
  title,
  body,
  status,
  onAllow,
  onSettings,
  extra,
}: {
  id: string;
  icon: IconName;
  title: string;
  body: string;
  status: PermissionStatus | null;
  onAllow: () => void;
  onSettings?: () => void;
  extra?: ReactNode;
}) {
  const t = status ? STATUS_TAG[status] : { label: 'Checking…', color: 'gray' as TagColor };
  return (
    <View testID={`perm-${id}`} style={styles.permRow}>
      <View style={styles.permMain}>
        <View style={styles.permIcon}>
          <Icon name={icon} size={18} color={colors.text} />
        </View>
        <View style={styles.flex}>
          <View style={styles.permTitleRow}>
            <Text weight="semibold">{title}</Text>
            <Tag testID={`perm-${id}-status`} label={t.label} color={t.color} style={styles.gapLeftSm} />
          </View>
          <Text variant="small">{body}</Text>
        </View>
        {status !== 'granted' ? (
          <View style={styles.permButtons}>
            <Button title="Allow" variant="secondary" onPress={onAllow} />
            {onSettings ? <Button title="Open Settings" variant="ghost" onPress={onSettings} style={styles.gapLeftSm} /> : null}
          </View>
        ) : null}
      </View>
      {extra}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Ollama                                                           */
/* ------------------------------------------------------------------ */

/** Poll Ollama's host info and health every 2 s while a step is open: installs and launches happen outside. */
function useOllamaPolling() {
  const refreshHost = useOllamaStore((s) => s.refreshHost);
  const refreshOllama = useSessionStore((s) => s.refreshOllama);
  useEffect(() => {
    const poll = () => {
      refreshHost().catch(() => {});
      refreshOllama().catch(() => {});
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [refreshHost, refreshOllama]);
}

function OllamaStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  useOllamaPolling();
  const host = useOllamaStore((s) => s.host);
  const starting = useOllamaStore((s) => s.starting);
  const prepared = useOllamaStore((s) => s.prepared);
  const prepare = useOllamaStore((s) => s.prepare);
  const status = useSessionStore((s) => s.ollama.status);
  const url = useAppStore((s) => s.settings.ollamaUrl);

  const local = isLocalUrl(url);
  const running = status === 'ok' || status === 'modelMissing';
  const installed = running || !!host?.appInstalled || !!host?.cliInstalled;
  const open = () => {
    prepare({ launch: true }).catch(() => {});
  };

  let t: { label: string; color: TagColor };
  let body: string;
  if (running) {
    t = { label: 'Running', color: 'green' };
    body = local ? `Running on this ${DEVICE}.` : `Running at ${url}.`;
  } else if (starting) {
    t = { label: 'Starting…', color: 'blue' };
    body = 'Opening Ollama in the background.';
  } else if (local ? !host : status === 'unknown') {
    t = { label: 'Checking…', color: 'gray' };
    body = 'Looking for Ollama.';
  } else if (!local) {
    t = { label: 'Not reachable', color: 'red' };
    body = `Nothing answers at ${url}. Check the address in Settings.`;
  } else if (installed) {
    t = { label: 'Not running', color: 'orange' };
    body = host?.appInstalled ? 'Installed. LarpLess opens it in the background.' : 'Installed. Start it in Terminal:';
  } else {
    t = { label: 'Not installed', color: 'gray' };
    body = IS_WINDOWS
      ? 'Free, and needs no account. Install Ollama, then come back; this page notices when it’s there.'
      : 'Free, and needs no account. Open the downloaded Ollama.dmg and drag Ollama into Applications; this page notices when it’s there.';
  }

  return (
    <View testID="onboarding-ollama">
      <Text variant="h2" style={styles.h}>
        Install Ollama
      </Text>
      <Text muted style={styles.lead}>
        {`LarpLess reads your screen with a vision model that runs in Ollama, a free app for local AI. Nothing leaves your ${DEVICE}.`}
      </Text>

      <View testID="ollama-host" style={styles.permRow}>
        <View style={styles.permMain}>
          <View style={styles.permIcon}>
            <Icon name="bot" size={18} color={colors.text} />
          </View>
          <View style={styles.flex}>
            <View style={styles.permTitleRow}>
              <Text weight="semibold">Ollama</Text>
              <Tag testID="ollama-host-status" label={t.label} color={t.color} style={styles.gapLeftSm} />
            </View>
            <Text variant="small">{body}</Text>
          </View>
          {local && !running && !starting && !installed && host ? (
            <Button
              testID="ollama-download"
              title="Download Ollama"
              icon="download"
              variant="secondary"
              onPress={() => {
                Linking.openURL(config.OLLAMA_DOWNLOAD_URL).catch(() => {});
              }}
              style={styles.gapLeft}
            />
          ) : null}
          {local && !running && !starting && host?.appInstalled ? (
            <Button testID="ollama-open" title="Open Ollama" variant="secondary" onPress={open} style={styles.gapLeft} />
          ) : null}
        </View>
        {local && !running && !starting && installed && !host?.appInstalled ? (
          <CodeBlock code="LLAMA_ARG_CACHE_RAM=0 ollama serve" style={styles.permExtra} />
        ) : null}
        {prepared === 'failed' && !running && !starting ? (
          <Text testID="ollama-open-failed" variant="small" color={tag.red.text} style={styles.permExtra}>
            Ollama didn’t start. Try opening it from Applications.
          </Text>
        ) : null}
        {running && local ? <MemoryNote /> : null}
      </View>

      <View style={styles.actions}>
        <Button title="Back" variant="ghost" onPress={onBack} />
        <Button testID="onboarding-next" title="Continue" variant="primary" onPress={onNext} style={styles.gapLeft} />
      </View>
    </View>
  );
}

/** Whether Ollama runs with llama.cpp's 8 GB prompt cache, and the fix when it does. */
function MemoryNote() {
  const host = useOllamaStore((s) => s.host);
  const starting = useOllamaStore((s) => s.starting);
  const prepare = useOllamaStore((s) => s.prepare);
  if (host?.promptCache === 'off') {
    return (
      <View testID="ollama-memory" style={[styles.permExtra, styles.memoryOn]}>
        <Icon name="check" size={14} color={colors.muted} />
        <Text variant="small">Memory saver on: Ollama runs without its 8 GB prompt cache.</Text>
      </View>
    );
  }
  if (host?.promptCache !== 'default') return null;
  if (host.server !== 'app') {
    return (
      <View testID="ollama-memory" style={styles.permExtra}>
        <Text variant="small">
          Ollama keeps up to 8 GB of RAM in a prompt cache LarpLess never reuses. To turn it off, start Ollama with:
        </Text>
        <CodeBlock code="LLAMA_ARG_CACHE_RAM=0 ollama serve" style={styles.codeGap} />
      </View>
    );
  }
  return (
    <View testID="ollama-memory" style={[styles.relaunch, styles.permExtra]}>
      <Text variant="small" style={styles.flex}>
        Ollama keeps up to 8 GB of RAM in a prompt cache LarpLess never reuses. LarpLess restarts it without one
        when no model is loaded.
      </Text>
      <Button
        testID="ollama-restart"
        title={starting ? 'Restarting…' : 'Restart now'}
        variant="secondary"
        disabled={starting}
        onPress={() => {
          prepare({ launch: true, force: true }).catch(() => {});
        }}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 4. AI model                                                         */
/* ------------------------------------------------------------------ */

function ModelStep({ onBack, onFinish }: { onBack: () => void; onFinish: () => void }) {
  useOllamaPolling();
  const ollama = useSessionStore((s) => s.ollama);
  const model = useAppStore((s) => s.settings.model);
  const pulling = useOllamaStore((s) => s.pull.status === 'pulling');

  const ok = ollama.status === 'ok';
  const name = ollama.model || model;
  const size = config.MODEL_SIZES[name];
  return (
    <View testID="onboarding-model">
      <Text variant="h2" style={styles.h}>
        Download the AI model
      </Text>
      <Text muted style={styles.lead}>
        {`${name} looks at your screen to tell study from distraction. It’s a one-time download${
          size ? ` of about ${size}` : ''
        }, and it runs entirely on this ${DEVICE}.`}
      </Text>
      {ok ? (
        <Callout testID="ollama-ready" icon="check" tone="green">
          <Text>
            <Strong>{name}</Strong> is ready. Everything stays on this {DEVICE}.
          </Text>
        </Callout>
      ) : ollama.status === 'modelMissing' || pulling ? (
        <ModelDownload testID="ollama-pull" />
      ) : ollama.status === 'down' ? (
        <Callout testID="ollama-down" icon="alert" tone="red">
          <Text>Ollama isn’t running, so the model can’t download yet. Go back a step to start it.</Text>
        </Callout>
      ) : (
        <Text variant="small">Checking Ollama…</Text>
      )}
      {!ok ? (
        <Text variant="small" style={styles.later}>
          <Muted>You can finish now and download it later from Settings; demo mode works offline.</Muted>
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button title="Back" variant="ghost" onPress={onBack} />
        <Button testID="onboarding-finish" title={ok ? 'Finish' : 'Finish anyway'} variant="primary" onPress={onFinish} style={styles.gapLeft} />
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  presets: { marginTop: space.lg },
  scroll: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { paddingBottom: 96 },
  progress: { flexDirection: 'row', marginBottom: space.xl },
  progressItem: { flex: 1, marginRight: space.sm },
  progressBar: { height: 3, borderRadius: 2, marginBottom: space.xs + 2 },
  h: { marginBottom: space.xs },
  lead: { marginBottom: space.lg },
  warn: { marginTop: space.sm },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: space.xl },
  later: { marginTop: space.lg },
  gapLeft: { marginLeft: space.md },
  gapLeftSm: { marginLeft: space.sm },
  flex: { flex: 1 },
  devRow: { flexDirection: 'row', marginTop: space.xxxl, opacity: 0.7 },
  permRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius,
    padding: space.md,
    marginBottom: space.sm,
  },
  permMain: { flexDirection: 'row', alignItems: 'center' },
  permIcon: { width: 28, marginRight: space.md, alignItems: 'center' },
  permTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  permButtons: { flexDirection: 'row', marginLeft: space.md },
  relaunch: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  permExtra: { marginTop: space.sm },
  memoryOn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  codeGap: { marginTop: space.xs },
  stepLabel: { marginTop: space.lg, marginBottom: space.xs },
}));
