/**
 * ⌘K palette (D11): centred 560 px overlay at 20% from the top, dimmed backdrop, autofocused input,
 * substring filter, ↑/↓ + ↵ via react-native-macos keyDownEvents/onKeyDown, Esc or backdrop click closes.
 * Opened by the native menu (FLMenuCommand 'commandPalette'), the sidebar "Search" row, or Dev tools.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text as RNText, useColorScheme, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import type { TextInput } from 'react-native';
import { config } from '../../config';
import type { SessionStatus } from '../../contracts/store';
import { useAppStore } from '../../store/appStore';
import { useNavStore } from '../../store/navStore';
import type { Route } from '../../store/navStore';
import { useSessionStore } from '../../store/sessionStore';
import { useSocialStore } from '../../store/socialStore';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { MacPressable, MacTextInput, MacView } from '../components/mac';
import type { HandledKey, MacKeyEvent } from '../components/mac';
import { endSession, isLive, startSession, togglePause } from '../lib/actions';
import { colors, fonts, radius, space, themed } from '../theme';

export interface PaletteCommand {
  id: string;
  group: 'Session' | 'Navigate' | 'Account' | 'Settings';
  icon: IconName;
  title: string;
  hint?: string;
  run: () => void;
}

const NAV: Array<{ route: Route; icon: IconName; title: string }> = [
  { route: 'home', icon: 'home', title: 'Go to Home' },
  { route: 'session', icon: 'timer', title: 'Go to Session' },
  { route: 'history', icon: 'calendar', title: 'Go to History' },
  { route: 'modules', icon: 'library', title: 'Go to Modules' },
  { route: 'feed', icon: 'users', title: 'Go to Friends' },
  { route: 'settings', icon: 'settings', title: 'Go to Settings' },
];

export function buildCommands(ctx: {
  status: SessionStatus;
  demoFast: boolean;
  hasSummary: boolean;
  devTools: boolean;
  auth?: 'signedIn' | 'signedOut';
  username?: string | null;
  appearance?: 'system' | 'light' | 'dark';
  /** Resolved light or dark, after `system` has followed the display. */
  scheme?: 'light' | 'dark';
}): PaletteCommand[] {
  const nav = useNavStore.getState();
  const out: PaletteCommand[] = [];
  const live = isLive(ctx.status);
  if (!live) {
    out.push({ id: 'start', group: 'Session', icon: 'play', title: 'Start session', run: () => startSession() });
    out.push({
      id: 'start-demo',
      group: 'Session',
      icon: 'clapperboard',
      title: 'Start demo session',
      hint: 'replays a recorded session',
      run: () => startSession({ demo: true }),
    });
  }
  if (ctx.status === 'running') out.push({ id: 'pause', group: 'Session', icon: 'pause', title: 'Pause session', run: togglePause });
  if (ctx.status === 'paused') out.push({ id: 'resume', group: 'Session', icon: 'play', title: 'Resume session', run: togglePause });
  if (ctx.status === 'break') {
    out.push({ id: 'skip', group: 'Session', icon: 'skip', title: 'Skip break', run: () => useSessionStore.getState().skipPomodoroPhase() });
  }
  if (live) out.push({ id: 'end', group: 'Session', icon: 'stop', title: 'End session', run: () => endSession() });

  NAV.forEach((n) => out.push({ id: `go-${n.route}`, group: 'Navigate', icon: n.icon, title: n.title, run: () => nav.go(n.route) }));
  if (ctx.hasSummary) out.push({ id: 'go-summary', group: 'Navigate', icon: 'flag', title: 'Go to last summary', run: () => nav.go('summary') });
  if (ctx.devTools) out.push({ id: 'go-dev', group: 'Navigate', icon: 'wrench', title: 'Go to Dev tools', run: () => nav.go('dev') });

  if (ctx.auth === 'signedOut') {
    out.push({ id: 'sign-in', group: 'Account', icon: 'key', title: 'Sign in', run: () => nav.go('feed', { auth: 'signIn' }) });
    out.push({
      id: 'create-account',
      group: 'Account',
      icon: 'sparkles',
      title: 'Create account',
      run: () => nav.go('feed', { auth: 'signUp' }),
    });
  }
  if (ctx.auth === 'signedIn') {
    out.push({
      id: 'sign-out',
      group: 'Account',
      icon: 'logOut',
      title: 'Sign out',
      hint: ctx.username ? `@${ctx.username}` : undefined,
      run: () => {
        useSocialStore.getState().signOut().catch(() => {});
      },
    });
  }

  const appearance = ctx.appearance ?? useAppStore.getState().settings.appearance;
  const dark = (ctx.scheme ?? (appearance === 'dark' ? 'dark' : 'light')) === 'dark';
  out.push({
    id: 'appearance',
    group: 'Settings',
    icon: 'moon',
    title: dark ? 'Use light mode' : 'Use dark mode',
    hint: appearance === 'system' ? 'following the system' : appearance,
    run: () => {
      useAppStore
        .getState()
        .updateSettings({ appearance: dark ? 'light' : 'dark' })
        .catch(() => {});
    },
  });
  out.push({
    id: 'demo-fast',
    group: 'Settings',
    icon: 'zap',
    title: 'Toggle demo fast mode',
    hint: ctx.demoFast ? 'on' : 'off',
    run: () => {
      useAppStore
        .getState()
        .updateSettings({ demoFast: !ctx.demoFast })
        .catch(() => {});
    },
  });
  return out;
}

export function filterCommands(cmds: PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return cmds;
  return cmds.filter((c) => `${c.title} ${c.group} ${c.hint ?? ''}`.toLowerCase().includes(q));
}

export function CommandPalette() {
  const open = useNavStore((s) => s.paletteOpen);
  return open ? <PaletteOverlay /> : null;
}

const KEYS: HandledKey[] = [{ key: 'ArrowUp' }, { key: 'ArrowDown' }, { key: 'Enter' }, { key: 'Escape' }];

function PaletteOverlay() {
  const setOpen = useNavStore((s) => s.setPaletteOpen);
  const status = useSessionStore((s) => s.status);
  const hasSummary = useSessionStore((s) => s.lastSummary != null);
  const demoFast = useAppStore((s) => s.settings.demoFast);
  const appearance = useAppStore((s) => s.settings.appearance);
  const system = useColorScheme();
  const scheme = appearance === 'dark' || (appearance !== 'light' && system === 'dark') ? 'dark' : 'light';
  const social = useSocialStore((s) => s.status);
  const username = useSocialStore((s) => s.profile?.username);
  const auth = social === 'signedIn' || social === 'signedOut' ? social : undefined;
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const ran = useRef(false);

  const commands = useMemo(
    () => buildCommands({ status, demoFast, hasSummary, devTools: config.SHOW_DEV_TOOLS, auth, username, appearance, scheme }),
    [status, demoFast, hasSummary, auth, username, appearance, scheme],
  );
  const filtered = filterCommands(commands, query);
  const selected = Math.min(sel, Math.max(0, filtered.length - 1));

  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(id);
  }, []);

  const close = () => setOpen(false);
  const runAt = (i: number) => {
    const c = filtered[i];
    if (!c || ran.current) return;
    ran.current = true;
    close();
    c.run();
  };
  const onKeyDown = (e: MacKeyEvent) => {
    switch (e.nativeEvent.key) {
      case 'ArrowDown':
        setSel((s) => Math.min(Math.min(s, filtered.length - 1) + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        setSel((s) => Math.max(Math.min(s, filtered.length - 1) - 1, 0));
        break;
      case 'Enter':
        runAt(selected);
        break;
      case 'Escape':
        close();
        break;
    }
  };

  let lastGroup = '';
  return (
    <View testID="palette" style={[StyleSheet.absoluteFill, styles.overlay]}>
      <Pressable testID="palette-backdrop" accessibilityLabel="Close palette" style={[StyleSheet.absoluteFill, styles.backdrop, styles.pointer]} onPress={close} />
      <View style={styles.cardWrap} pointerEvents="box-none">
        {/* Escape anywhere in the card; the input's own keys stop propagating (onKeyDown bubbles in JS). */}
        <MacView
          style={styles.card}
          keyDownEvents={[{ key: 'Escape' }]}
          onKeyDown={(e) => {
            if (e.nativeEvent.key === 'Escape') close();
          }}>
          <View style={styles.inputRow}>
            <View style={styles.searchIcon}>
              <Icon name="search" size={16} color={colors.muted} />
            </View>
            <MacTextInput
              ref={inputRef}
              testID="palette-input"
              autoFocus
              value={query}
              onChangeText={(v) => {
                setQuery(v);
                setSel(0);
              }}
              placeholder="Type a command…"
              placeholderTextColor={colors.faint}
              enableFocusRing={false}
              autoCorrect={false}
              keyDownEvents={KEYS}
              onKeyDown={(e) => {
                e.stopPropagation?.();
                onKeyDown(e);
              }}
              onSubmitEditing={() => runAt(selected)}
              onKeyPress={(e) => {
                const k = e.nativeEvent.key;
                if (k === 'Escape' || k === '\u001b') close();
              }}
              style={styles.input}
            />
          </View>
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {filtered.length === 0 ? <RNText style={styles.empty}>No matching commands</RNText> : null}
            {filtered.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              return (
                <View key={c.id}>
                  {header ? <RNText style={styles.group}>{header}</RNText> : null}
                  <MacPressable
                    testID={`palette-cmd-${c.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: i === selected }}
                    enableFocusRing={false}
                    focusable={false}
                    onHoverIn={() => setSel(i)}
                    onPress={() => runAt(i)}
                    style={[styles.row, i === selected ? styles.rowSelected : null]}>
                    <View style={styles.rowIcon}>
                      <Icon name={c.icon} size={16} color={colors.muted} />
                    </View>
                    <RNText numberOfLines={1} style={styles.rowTitle}>
                      {c.title}
                    </RNText>
                    {c.hint ? <RNText style={styles.rowHint}>{c.hint}</RNText> : null}
                  </MacPressable>
                </View>
              );
            })}
          </ScrollView>
          <View style={styles.footer}>
            <RNText style={styles.footerText}>↑↓ to move · ↵ to run · esc to close</RNText>
          </View>
        </MacView>
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  overlay: { zIndex: 100 },
  backdrop: { backgroundColor: colors.backdrop },
  pointer: { cursor: 'pointer' } as ViewStyle,
  cardWrap: { position: 'absolute', top: '20%', left: 0, right: 0, alignItems: 'center' },
  card: {
    width: 560,
    maxWidth: '90%',
    backgroundColor: colors.raised,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    overflow: 'hidden',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    height: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  searchIcon: { marginRight: space.sm },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
    borderWidth: 0,
    backgroundColor: 'transparent',
    paddingVertical: 0,
  },
  list: { maxHeight: 340, paddingVertical: space.xs },
  group: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: colors.muted,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 34,
    marginHorizontal: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius,
  },
  rowSelected: { backgroundColor: colors.hover },
  rowIcon: { width: 24, alignItems: 'center' },
  rowTitle: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: colors.text },
  rowHint: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, marginLeft: space.sm },
  empty: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, padding: space.md },
  footer: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.sidebar,
  },
  footerText: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint },
}));
