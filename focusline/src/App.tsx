/**
 * Focusline root: route switch, sidebar layout, ⌘K palette, and the always-mounted Dev tools.
 *
 * Routing (WS-D brief):
 * - mount → appStore.load(); not onboarded → onboarding, else home
 * - session status idle/ended → running|paused|break → session; → ended → summary
 * - native menu: commandPalette / startSession / endSession
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { config } from './config';
import { native } from './native';
import { useAppStore } from './store/appStore';
import { useNavStore } from './store/navStore';
import type { Route } from './store/navStore';
import { useSessionStore } from './store/sessionStore';
import { CommandPalette } from './ui/layout/CommandPalette';
import { AppLayout } from './ui/layout/AppLayout';
import { ErrorBoundary } from './ui/layout/ErrorBoundary';
import { endSession, isLive, startSession } from './ui/lib/actions';
import { DevToolsPage, installUiIntrospection } from './ui/pages/DevToolsPage';
import { HistoryPage } from './ui/pages/HistoryPage';
import { HomePage } from './ui/pages/HomePage';
import { ModulesPage } from './ui/pages/ModulesPage';
import { OnboardingPage } from './ui/pages/OnboardingPage';
import { PlaceholderPage } from './ui/pages/PlaceholderPage';
import { SessionPage } from './ui/pages/SessionPage';
import { SettingsPage } from './ui/pages/SettingsPage';
import { SummaryPage } from './ui/pages/SummaryPage';
import { colors, layout } from './ui/theme';

function renderPage(route: Route) {
  switch (route) {
    case 'home':
      return <HomePage />;
    case 'session':
      return <SessionPage />;
    case 'summary':
      return <SummaryPage />;
    case 'history':
      return <HistoryPage />;
    case 'modules':
      return <ModulesPage />;
    case 'settings':
      return <SettingsPage />;
    case 'feed':
      return <PlaceholderPage icon="📰" title="Feed" note="Friends' sessions arrive in Phase 2." />;
    case 'profile':
      return <PlaceholderPage icon="🙂" title="Profile" note="Your profile arrives in Phase 2." />;
    case 'login':
      return <PlaceholderPage icon="🔑" title="Login" note="Accounts arrive in Phase 2." />;
    default:
      // 'dev' is rendered by the persistent overlay below; 'onboarding' outside the layout.
      return null;
  }
}

function useBootRouting(): boolean {
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    let alive = true;
    useAppStore
      .getState()
      .load()
      .catch((e: unknown) => console.warn('[ui] load failed:', e instanceof Error ? e.message : String(e)))
      .finally(() => {
        if (!alive) return;
        const { settings } = useAppStore.getState();
        const nav = useNavStore.getState();
        if (isLive(useSessionStore.getState().status)) nav.go('session');
        else nav.go(settings.onboarded ? 'home' : 'onboarding');
        setBooted(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  return booted;
}

function useSessionRouting(): void {
  useEffect(
    () =>
      useSessionStore.subscribe((s, prev) => {
        if (s.status === prev.status) return;
        const nav = useNavStore.getState();
        if (isLive(s.status) && (prev.status === 'idle' || prev.status === 'ended')) {
          nav.go('session', { sessionId: s.session?.id });
        } else if (s.status === 'ended') {
          nav.go('summary', { sessionId: s.session?.id });
        }
      }),
    [],
  );
}

function useMenuCommands(): void {
  useEffect(
    () =>
      native.appShell.onMenuCommand((c) => {
        if (c === 'commandPalette') useNavStore.getState().setPaletteOpen(true);
        else if (c === 'startSession') startSession();
        else if (c === 'endSession') endSession();
      }),
    [],
  );
}

function App() {
  const booted = useBootRouting();
  useSessionRouting();
  useMenuCommands();
  useEffect(() => {
    if (__DEV__) installUiIntrospection();
  }, []);
  const route = useNavStore((s) => s.route);

  return (
    <View style={styles.root}>
      {!booted ? null : route === 'onboarding' ? (
        <ErrorBoundary where="onboarding">
          <OnboardingPage />
        </ErrorBoundary>
      ) : (
        <AppLayout route={route}>{renderPage(route)}</AppLayout>
      )}
      {config.SHOW_DEV_TOOLS ? (
        // Always mounted so the native harnesses register on launch; shown only on the 'dev' route.
        <View style={route === 'dev' && booted ? styles.devOverlay : styles.hidden}>
          <ErrorBoundary where="dev">
            <DevToolsPage />
          </ErrorBoundary>
        </View>
      ) : null}
      <CommandPalette />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  devOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    left: layout.sidebarWidth,
    backgroundColor: colors.bg,
  },
  hidden: { display: 'none' },
});

export default App;
