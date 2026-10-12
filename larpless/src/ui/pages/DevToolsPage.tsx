/**
 * Dev tools (only reachable when config.SHOW_DEV_TOOLS): fixture switcher, palette trigger,
 * store snapshot, and the WS-A / WS-B native harnesses.
 *
 * App.tsx keeps this page mounted (hidden) on every route so the harnesses can register
 * their __FL.harness runners on launch, exactly like the Phase 0 dev shell did.
 */
import { StyleSheet, View } from 'react-native';
import { config } from '../../config';
import HarnessA from '../../dev/HarnessA';
import HarnessB from '../../dev/HarnessB';
import { applyFixture } from '../../fixtures/apply';
import type { FixtureName } from '../../fixtures/apply';
import { fixtureModules, fixtureSessions } from '../../fixtures/data';
import { useAppStore } from '../../store/appStore';
import { useNavStore } from '../../store/navStore';
import type { Route } from '../../store/navStore';
import { useSessionStore } from '../../store/sessionStore';
import { Button, Callout, Strong, Text } from '../components';
import { uiLabel, uiMeasure, uiOverflow, uiPress, uiStyle, uiText, uiType } from '../dev/introspect';
import { caughtErrors } from '../layout/ErrorBoundary';
import { useViewport } from '../lib/viewport';
import { Page } from '../layout/Page';
import { colors, space, themed } from '../theme';
import { MOD } from '../platform';

const FIXTURES: FixtureName[] = ['idle', 'running', 'distracted', 'break', 'summary'];

/** Fixture + the fixture modules and history, so names/colours/heatmaps are populated. */
export function applyFullFixture(name: FixtureName): void {
  useAppStore.setState({ modules: fixtureModules, sessions: fixtureSessions });
  applyFixture(name);
}

export function DevToolsPage() {
  const status = useSessionStore((s) => s.status);
  const chunks = useSessionStore((s) => s.chunks.length);
  const modules = useAppStore((s) => s.modules.length);
  const sessions = useAppStore((s) => s.sessions.length);
  const onboarded = useAppStore((s) => s.settings.onboarded);
  const route = useNavStore((s) => s.route);
  const go = useNavStore((s) => s.go);
  const setPaletteOpen = useNavStore((s) => s.setPaletteOpen);

  return (
    <Page testID="page-dev" header={{ icon: 'wrench', title: 'Dev tools' }}>
      <Callout icon="flask">
        <Text>
          Fixtures load a store snapshot (plus fixture modules and history). Store actions are no-ops until WS-C
          lands. Mock native: <Strong>{String(config.USE_MOCK_NATIVE)}</Strong>.
        </Text>
      </Callout>

      <Text variant="h3" style={styles.h}>
        Fixtures
      </Text>
      <View style={styles.row}>
        {FIXTURES.map((f) => (
          <Button key={f} testID={`fixture-${f}`} title={f} variant="secondary" onPress={() => applyFullFixture(f)} style={styles.btn} />
        ))}
        <Button
          title="Empty stores"
          variant="ghost"
          onPress={() => {
            applyFixture('idle');
            useAppStore.setState({ modules: [], sessions: [] });
          }}
          style={styles.btn}
        />
      </View>

      <Text variant="h3" style={styles.h}>
        Navigation
      </Text>
      <View style={styles.row}>
        <Button testID="dev-open-palette" title={`Open ${MOD}K palette`} variant="secondary" onPress={() => setPaletteOpen(true)} style={styles.btn} />
        <Button title="Onboarding" variant="secondary" onPress={() => go('onboarding')} style={styles.btn} />
        {(['home', 'session', 'summary', 'history', 'modules', 'settings'] as Route[]).map((r) => (
          <Button key={r} title={r} variant="ghost" onPress={() => go(r)} style={styles.btn} />
        ))}
      </View>

      <Text variant="small" style={styles.snapshot}>
        route={route} · status={status} · chunks={chunks} · modules={modules} · sessions={sessions} · onboarded=
        {String(onboarded)} · caught render errors={caughtErrors.length}
      </Text>

      <View style={styles.harness}>
        <HarnessA />
      </View>
      <View style={styles.harness}>
        <HarnessB />
      </View>
    </Page>
  );
}

/** Read-only UI introspection for headless checks: node scripts/js-eval.mjs 8081 "__FL.ui.state()". */
export function installUiIntrospection(): void {
  const g = globalThis as unknown as { __FL?: Record<string, unknown> };
  if (!__DEV__ || !g.__FL) return;
  g.__FL.ui = {
    nav: useNavStore,
    route: () => useNavStore.getState().route,
    go: (r: Route) => {
      useNavStore.getState().go(r);
      return useNavStore.getState().route;
    },
    palette: (open = true) => {
      useNavStore.getState().setPaletteOpen(open);
      return useNavStore.getState().paletteOpen;
    },
    fixture: (name: FixtureName) => {
      applyFullFixture(name);
      return { status: useSessionStore.getState().status, route: useNavStore.getState().route };
    },
    errors: () => caughtErrors.slice(),
    text: uiText,
    label: uiLabel,
    measure: uiMeasure,
    overflow: uiOverflow,
    style: uiStyle,
    press: uiPress,
    type: uiType,
    /** Pin the root to w×h (dev layout checks); call with no args to reset. */
    viewport: (w?: number, h?: number) => {
      useViewport.getState().setEmulate(w && h ? { w, h } : null);
      return useViewport.getState().emulate;
    },
    state: () => {
      const s = useSessionStore.getState();
      const a = useAppStore.getState();
      const n = useNavStore.getState();
      return {
        route: n.route,
        paletteOpen: n.paletteOpen,
        status: s.status,
        chunks: s.chunks.length,
        current: s.current ? s.current.kind : null,
        modules: a.modules.length,
        sessions: a.sessions.length,
        onboarded: a.settings.onboarded,
        renderErrors: caughtErrors.length,
      };
    },
  };
}

const styles = themed(() => StyleSheet.create({
  h: { marginTop: space.xl, marginBottom: space.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  btn: { marginRight: space.sm, marginBottom: space.sm },
  snapshot: { marginTop: space.md },
  harness: {
    marginTop: space.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 4,
    minHeight: 120,
  },
}));
