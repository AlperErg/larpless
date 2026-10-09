/**
 * Onboarding (D5): 1. Your modules → 2. Permissions → 3. Local AI → Home.
 * Full-window (no sidebar). Uses native.permissions / native.notifications only (allowed by the brief).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, View } from 'react-native';
import { config } from '../../config';
import type { TagColor } from '../../contracts/domain';
import type { PermissionKind, PermissionStatus } from '../../contracts/native';
import { native } from '../../native';
import { useAppStore } from '../../store/appStore';
import { useNavStore } from '../../store/navStore';
import { useSessionStore } from '../../store/sessionStore';
import { Button, Callout, CodeBlock, EditableTable, Muted, PageHeader, Strong, Tag, Text } from '../components';
import { PageBody } from '../layout/Page';
import { blankDraft, draftsFromModules, duplicateNames, modulesFromDrafts } from '../lib/modules';
import type { ModuleDraft } from '../lib/modules';
import { colors, motion, radius, space, tag } from '../theme';

const STEPS = ['Your modules', 'Permissions', 'Local AI'] as const;

export function OnboardingPage() {
  const [step, setStep] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: motion.base, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
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
      <PageHeader icon="👋" title="Welcome to Focusline" subtitle={<Text muted>Strava for studying. Everything is analysed on this Mac.</Text>} />
      <PageBody>
        <Progress step={step} />
        <Animated.View style={{ opacity: fade, transform: [{ translateY }] }}>
          {step === 0 ? <ModulesStep onNext={() => setStep(1)} /> : null}
          {step === 1 ? <PermissionsStep onBack={() => setStep(0)} onNext={() => setStep(2)} /> : null}
          {step === 2 ? <OllamaStep onBack={() => setStep(1)} onFinish={finish} /> : null}
        </Animated.View>
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
  const [drafts, setDrafts] = useState<ModuleDraft[]>(() =>
    stored.length
      ? draftsFromModules(stored)
      : [{ ...blankDraft([]), name: 'Biology', color: 'green', keywordsText: 'cell, mitosis' }],
  );
  const mods = modulesFromDrafts(drafts);
  const dups = duplicateNames(drafts);

  return (
    <View testID="onboarding-modules">
      <Text variant="h2" style={styles.h}>
        What are you studying?
      </Text>
      <Text muted style={styles.lead}>
        Add a row per module. Keywords (course codes, topics) help the on-device model pick the right subject.
      </Text>
      <EditableTable rows={drafts} onChange={setDrafts} />
      {dups.length ? (
        <Text variant="small" color={tag.red.text} style={styles.warn}>
          {`Names must be unique: ${dups.join(', ')}`}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          testID="onboarding-next"
          title="Continue"
          variant="primary"
          disabled={mods.length === 0}
          onPress={() => {
            saveModules(mods).catch(() => {});
            onNext();
          }}
        />
        {mods.length === 0 ? (
          <Text variant="small" style={styles.hint}>
            Add at least one module to continue.
          </Text>
        ) : null}
      </View>
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
        Let Focusline see what you see
      </Text>
      <Text muted style={styles.lead}>
        Frames stay in memory and are never saved. During breaks and while you're away, nothing is captured.
      </Text>

      <PermRow
        id="screen"
        icon="🖥"
        title="Screen Recording"
        body="Reads the frontmost window to tell study from distraction."
        status={perm?.screen ?? null}
        onAllow={() => request('screen')}
        onSettings={() => native.permissions.openSettings('screen').catch(() => {})}
        extra={
          perm?.screen !== 'granted' || screenRequested ? (
            <View style={styles.relaunch}>
              <Text variant="small" style={styles.flex}>
                macOS only applies Screen Recording after Focusline relaunches.
              </Text>
              <Button testID="relaunch" title="Relaunch" variant="secondary" onPress={() => native.permissions.relaunch().catch(() => {})} />
            </View>
          ) : null
        }
      />
      <PermRow
        id="camera"
        icon="📷"
        title="Camera"
        body="Notices when you step away or pick up your phone. Optional."
        status={perm?.camera ?? null}
        onAllow={() => request('camera')}
        onSettings={() => native.permissions.openSettings('camera').catch(() => {})}
      />
      <PermRow
        id="notifications"
        icon="🔔"
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
  icon: string;
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
        <Text style={styles.permIcon}>{icon}</Text>
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
/* 3. Local AI                                                         */
/* ------------------------------------------------------------------ */

function OllamaStep({ onBack, onFinish }: { onBack: () => void; onFinish: () => void }) {
  const ollama = useSessionStore((s) => s.ollama);
  const refreshOllama = useSessionStore((s) => s.refreshOllama);
  const model = useAppStore((s) => s.settings.model);
  const [checking, setChecking] = useState(false);
  const alive = useRef(true);

  const retry = () => {
    setChecking(true);
    refreshOllama()
      .catch(() => {})
      .finally(() => {
        if (alive.current) setChecking(false);
      });
  };
  useEffect(() => {
    alive.current = true;
    retry();
    return () => {
      alive.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ok = ollama.status === 'ok';
  const name = ollama.model || model;
  return (
    <View testID="onboarding-ollama">
      <Text variant="h2" style={styles.h}>
        Local AI
      </Text>
      <Text muted style={styles.lead}>
        Focusline asks a vision model running in Ollama what's on screen. Nothing leaves your Mac.
      </Text>
      {ok ? (
        <Callout testID="ollama-ready" emoji="🟢" tone="green">
          <Text>
            <Strong>{name}</Strong> is ready. Everything stays on this Mac.
          </Text>
        </Callout>
      ) : (
        <View testID="ollama-setup">
          <Callout emoji={ollama.status === 'unknown' ? '⏳' : '🔴'} tone={ollama.status === 'unknown' ? 'gray' : 'red'}>
            <Text>
              {ollama.status === 'modelMissing' ? (
                <>
                  Ollama is running but <Strong>{name}</Strong> isn't downloaded yet.
                </>
              ) : ollama.status === 'down' ? (
                'Ollama isn’t running.'
              ) : (
                'Checking for Ollama…'
              )}{' '}
              <Muted>You can finish now and set it up later; demo mode works offline.</Muted>
            </Text>
          </Callout>
          <Text variant="small" weight="medium" style={styles.stepLabel}>
            1. Open the Ollama app:
          </Text>
          <CodeBlock code="open -a Ollama" />
          <Text variant="small" weight="medium" style={styles.stepLabel}>
            2. Download the model:
          </Text>
          <CodeBlock testID="ollama-pull" code={`ollama pull ${name}`} />
          <View style={styles.actionsTight}>
            <Button testID="ollama-retry" title={checking ? 'Checking…' : 'Retry'} icon="↻" variant="secondary" disabled={checking} onPress={retry} />
          </View>
        </View>
      )}
      <View style={styles.actions}>
        <Button title="Back" variant="ghost" onPress={onBack} />
        <Button testID="onboarding-finish" title={ok ? 'Finish' : 'Finish anyway'} variant="primary" onPress={onFinish} style={styles.gapLeft} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { paddingBottom: 96 },
  progress: { flexDirection: 'row', marginBottom: space.xl },
  progressItem: { flex: 1, marginRight: space.sm },
  progressBar: { height: 3, borderRadius: 2, marginBottom: space.xs + 2 },
  h: { marginBottom: space.xs },
  lead: { marginBottom: space.lg },
  warn: { marginTop: space.sm },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: space.xl },
  actionsTight: { flexDirection: 'row', marginTop: space.md },
  hint: { marginLeft: space.md },
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
  permIcon: { fontSize: 22, lineHeight: 28, marginRight: space.md },
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
  stepLabel: { marginTop: space.lg, marginBottom: space.xs },
});
