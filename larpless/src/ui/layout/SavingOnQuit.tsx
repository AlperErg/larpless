/**
 * Closing LarpLess during a session saves it (#74). The native shell holds a window close (Windows) or ⌘Q
 * (macOS) while a session runs and sends the 'quitRequested' menu command (App.tsx). Here the session ends as
 * End session does (summary saved, shows in History), then the app quits. A session you didn't want can be
 * deleted from History, so nothing is asked.
 */
import { StyleSheet, View } from 'react-native';
import { native } from '../../native';
import { useNavStore } from '../../store/navStore';
import { useSessionStore } from '../../store/sessionStore';
import { Text } from '../components/Text';
import { endSession, isLive } from '../lib/actions';
import { colors, space, themed } from '../theme';

/** Handle 'quitRequested': hold the quit, end and save a live session, then quit. */
export function saveSessionAndQuit(): void {
  const nav = useNavStore.getState();
  if (nav.savingOnQuit) {
    native.appShell.holdQuit(); // a second close while saving: still on it
    return;
  }
  if (!isLive(useSessionStore.getState().status)) {
    native.appShell.quit(); // ended meanwhile: nothing to save
    return;
  }
  native.appShell.holdQuit();
  nav.setPaletteOpen(false);
  nav.setSavingOnQuit(true);
  // endSession never rejects, and the chunks are on disk either way: quit whatever it reports.
  endSession().finally(() => native.appShell.quit());
}

/** "Saving your session…" while the session ends on its way out, so the window doesn't look stuck. */
export function SavingOnQuit() {
  const saving = useNavStore((s) => s.savingOnQuit);
  if (!saving) return null;
  return (
    <View testID="saving-on-quit" style={[StyleSheet.absoluteFill, styles.overlay]} accessibilityLiveRegion="polite">
      <View style={styles.card}>
        <Text variant="h3">Saving your session…</Text>
        <Text color={colors.muted} style={styles.body}>
          LarpLess closes when it's saved. You'll find it in History.
        </Text>
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  overlay: { zIndex: 110, backgroundColor: colors.backdrop, alignItems: 'center', justifyContent: 'center' },
  card: {
    width: 420,
    maxWidth: '90%',
    padding: space.lg,
    backgroundColor: colors.raised,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  body: { marginTop: space.xs },
}));
