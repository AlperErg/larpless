/**
 * ⌘K palette (D11): centred 560 px overlay at 20% from the top, dimmed backdrop, autofocused input,
 * substring filter, ↑/↓ + ↵ via react-native-macos keyDownEvents/onKeyDown, Esc or backdrop click closes.
 * Opened by the native menu (FLMenuCommand 'commandPalette'), the sidebar "Search" row, or Dev tools.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text as RNText, View } from 'react-native';
import type { TextInput } from 'react-native';
import { config } from '../../config';
import type { SessionStatus } from '../../contracts/store';
import { useAppStore } from '../../store/appStore';
import { useNavStore } from '../../store/navStore';
import type { Route } from '../../store/navStore';
import { useSessionStore } from '../../store/sessionStore';
import { MacPressable, MacTextInput, MacView, handledKeys } from '../components/mac';
import type { MacKeyEvent } from '../components/mac';
import { endSession, isLive, startSession, togglePause } from '../lib/actions';
import { colors, fonts, motion, radius, space } from '../theme';
import { ANIMATE, MotionView } from '../platform';

export interface PaletteCommand {
  id: string;
  group: 'Session' | 'Navigate' | 'Settings';
  icon: string;
  title: string;
  hint?: string;
  run: () => void;
}

const NAV: Array<{ route: Route; icon: string; title: string }> = [
  { route: 'home', icon: '🏠', title: 'Go to Home' },
  { route: 'session', icon: '⏱', title: 'Go to Session' },
  { route: 'history', icon: '🗓', title: 'Go to History' },
  { route: 'modules', icon: '📚', title: 'Go to Modules' },
  { route: 'feed', icon: '👥', title: 'Go to Friends' },
  { route: 'settings', icon: '⚙️', title: 'Go to Settings' },
];

export function buildCommands(ctx: {
  status: SessionStatus;
  demoFast: boolean;
  hasSummary: boolean;
  devTools: boolean;
}): PaletteCommand[] {
  const nav = useNavStore.getState();
  const out: PaletteCommand[] = [];
  const live = isLive(ctx.status);
  if (!live) {
    out.push({ id: 'start', group: 'Session', icon: '▶︎', title: 'Start session', run: () => startSession() });
    out.push({
      id: 'start-demo',
      group: 'Session',
      icon: '🎬',
      title: 'Start demo session',
      hint: 'replays a recorded session',
      run: () => startSession({ demo: true }),
    });
  }
  if (ctx.status === 'running') out.push({ id: 'pause', group: 'Session', icon: '⏸', title: 'Pause session', run: togglePause });
  if (ctx.status === 'paused') out.push({ id: 'resume', group: 'Session', icon: '▶︎', title: 'Resume session', run: togglePause });
  if (ctx.status === 'break') {
    out.push({ id: 'skip', group: 'Session', icon: '⏭', title: 'Skip break', run: () => useSessionStore.getState().skipPomodoroPhase() });
  }
  if (live) out.push({ id: 'end', group: 'Session', icon: '■', title: 'End session', run: () => endSession() });

  NAV.forEach((n) => out.push({ id: `go-${n.route}`, group: 'Navigate', icon: n.icon, title: n.title, run: () => nav.go(n.route) }));
  if (ctx.hasSummary) out.push({ id: 'go-summary', group: 'Navigate', icon: '🏁', title: 'Go to last summary', run: () => nav.go('summary') });
  if (ctx.devTools) out.push({ id: 'go-dev', group: 'Navigate', icon: '🛠', title: 'Go to Dev tools', run: () => nav.go('dev') });

  out.push({
    id: 'demo-fast',
    group: 'Settings',
    icon: '⚡️',
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

const KEYS = handledKeys([{ key: 'ArrowUp' }, { key: 'ArrowDown' }, { key: 'Enter' }, { key: 'Escape' }]);
const ESCAPE = handledKeys([{ key: 'Escape' }]);

function PaletteOverlay() {
  const setOpen = useNavStore((s) => s.setPaletteOpen);
  const status = useSessionStore((s) => s.status);
  const hasSummary = useSessionStore((s) => s.lastSummary != null);
  const demoFast = useAppStore((s) => s.settings.demoFast);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const ran = useRef(false);

  const commands = useMemo(
    () => buildCommands({ status, demoFast, hasSummary, devTools: config.SHOW_DEV_TOOLS }),
    [status, demoFast, hasSummary],
  );
  const filtered = filterCommands(commands, query);
  const selected = Math.min(sel, Math.max(0, filtered.length - 1));

  const t = useRef(new Animated.Value(ANIMATE ? 0 : 1)).current;
  useEffect(() => {
    if (ANIMATE) {
      Animated.timing(t, { toValue: 1, duration: motion.fast, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    }
    const id = setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      clearTimeout(id);
      t.stopAnimation();
    };
  }, [t]);
  const scale = useMemo(() => t.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }), [t]);

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
    <MotionView testID="palette" style={[StyleSheet.absoluteFill, styles.overlay, { opacity: ANIMATE ? t : 1 }]}>
      <Pressable testID="palette-backdrop" accessibilityLabel="Close palette" style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={close} />
      <MotionView style={[styles.cardWrap, { transform: [{ scale: ANIMATE ? scale : 1 }] }]} pointerEvents="box-none">
        {/* Escape anywhere in the card; the input's own keys stop propagating (onKeyDown bubbles in JS). */}
        <MacView
          style={styles.card}
          keyDownEvents={ESCAPE}
          onKeyDown={(e) => {
            if (e.nativeEvent.key === 'Escape') close();
          }}>
          <View style={styles.inputRow}>
            <RNText style={styles.searchIcon}>🔍</RNText>
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
                    <RNText style={styles.rowIcon}>{c.icon}</RNText>
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
      </MotionView>
    </MotionView>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 100 },
  backdrop: { backgroundColor: colors.backdrop },
  cardWrap: { position: 'absolute', top: '20%', left: 0, right: 0, alignItems: 'center' },
  card: {
    width: 560,
    maxWidth: '90%',
    backgroundColor: colors.bg,
    borderRadius: radius + 2,
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
  searchIcon: { fontSize: 15, marginRight: space.sm },
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
  rowIcon: { width: 24, fontSize: 14 },
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
});
