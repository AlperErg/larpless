/**
 * LarpLess root: route switch, sidebar layout and ⌘K palette.
 *
 * Routing (WS-D brief):
 * - mount → appStore.load(); not onboarded → onboarding, else home
 * - session status idle/ended → running|paused|break → session; → ended → summary
 * - native menu: commandPalette / startSession / endSession / acknowledgements
 */
import { useEffect, useState } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import { config } from './config';
import { native } from './native';
import { useAppStore } from './store/appStore';
import { useNavStore } from './store/navStore';
import type { Route } from './store/navStore';
import { useOllamaStore } from './store/ollamaStore';
import { isClassifierMode, useSessionStore } from './store/sessionStore';
import { useSocialStore } from './store/socialStore';
import { BootScreen } from './ui/components/BootScreen';
import { installUiIntrospection } from './ui/dev/introspect';
import { CommandPalette } from './ui/layout/CommandPalette';
import { AppLayout } from './ui/layout/AppLayout';
import { ErrorBoundary } from './ui/layout/ErrorBoundary';
import { endSession, isLive, startSession } from './ui/lib/actions';
import { useViewport } from './ui/lib/viewport';
import { AcknowledgementsPage } from './ui/pages/AcknowledgementsPage';
import { DevToolsPage } from './ui/pages/DevToolsPage';
import { FriendsPage } from './ui/pages/FriendsPage';
import { HistoryPage } from './ui/pages/HistoryPage';
import { HomePage } from './ui/pages/HomePage';
import { AuthGate } from './ui/pages/LoginPage';
import { ModulesPage } from './ui/pages/ModulesPage';
import { OnboardingPage } from './ui/pages/OnboardingPage';
import { SessionPage } from './ui/pages/SessionPage';
import { SettingsPage } from './ui/pages/SettingsPage';
import { SummaryPage } from './ui/pages/SummaryPage';
import { applyScheme, colors, themed } from './ui/theme';
import { openFeedback, openLink, PRIVACY_URL, TERMS_URL } from './ui/lib/links';

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
    case 'acknowledgements':
      return <AcknowledgementsPage />;
    case 'feed':
    case 'profile':
      return <FriendsPage />;
    case 'login':
      return <AuthGate />;
    case 'dev':
      return config.SHOW_DEV_TOOLS ? <DevToolsPage /> : null;
    default:
      // 'onboarding' renders outside the layout.
      return null;
  }
}

function useBootRouting(): boolean {
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    let alive = true;
    useSocialStore.getState().init();
    useAppStore
      .getState()
      .load()
      .catch((e: unknown) => console.warn('[ui] load failed:', e instanceof Error ? e.message : String(e)))
      .finally(() => {
        // Health-check Ollama once settings (model/url) are loaded; the sidebar shows the result.
        useSessionStore
          .getState()
          .refreshOllama()
          .catch((e: unknown) => console.warn('[ui] refreshOllama failed:', e instanceof Error ? e.message : String(e)));
        // Restart an idle Ollama without its 8 GB prompt cache now rather than at session start. Never opens it.
        if (!isClassifierMode()) {
          useOllamaStore
            .getState()
            .prepare({ launch: false })
            .catch(() => {});
        }
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
        else if (c === 'acknowledgements') {
          native.appShell.bringToFront();
          useNavStore.getState().go('acknowledgements');
        }
        else if (c === 'feedback') openFeedback();
        else if (c === 'privacyPolicy') openLink(PRIVACY_URL);
        else if (c === 'termsOfUse') openLink(TERMS_URL);
      }),
    [],
  );
}

/** `system` follows the display. Anything else is pinned. */
function useResolvedScheme(): 'light' | 'dark' {
  const appearance = useAppStore((s) => s.settings.appearance);
  const system = useColorScheme();
  if (appearance === 'light' || appearance === 'dark') return appearance;
  return system === 'dark' ? 'dark' : 'light';
}

function App() {
  const booted = useBootRouting();
  useSessionRouting();
  useMenuCommands();
  const scheme = useResolvedScheme();
  applyScheme(scheme);
  useEffect(() => {
    native.panel.setColorScheme(scheme);
  }, [scheme]);
  useEffect(() => {
    if (__DEV__) installUiIntrospection();
  }, []);
  const route = useNavStore((s) => s.route);
  const emulate = useViewport((s) => s.emulate);
  // Jest mounts the routed page directly. The cover is the real launch animation.
  const [bootCover, setBootCover] = useState(process.env.JEST_WORKER_ID == null);

  return (
    <View
      style={[styles.root, emulate ? { flex: 0, width: emulate.w, height: emulate.h } : null]}
      onLayout={(e) => useViewport.getState().setSize(e.nativeEvent.layout.width, e.nativeEvent.layout.height)}>
      {!booted ? null : route === 'onboarding' ? (
        <ErrorBoundary where="onboarding">
          <OnboardingPage />
        </ErrorBoundary>
      ) : (
        <AppLayout route={route}>{renderPage(route)}</AppLayout>
      )}
      <CommandPalette />
      {bootCover ? <BootScreen ready={booted} onDone={() => setBootCover(false)} /> : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
}));

export default App;
