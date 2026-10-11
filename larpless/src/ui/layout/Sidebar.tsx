import { useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { config } from '../../config';
import type { OllamaStatus, SessionStatus } from '../../contracts/store';
import { useNavStore } from '../../store/navStore';
import type { Route } from '../../store/navStore';
import { useSessionStore } from '../../store/sessionStore';
import { MacPressable } from '../components/mac';
import { StatusDot } from '../components/StatusDot';
import type { DotKind } from '../components/StatusDot';
import { colors, fonts, layout, radius, space, tag, themed } from '../theme';
import { MOD } from '../platform';
import type { TagColor } from '../../contracts/domain';

interface NavItem {
  route: Route;
  icon: string;
  label: string;
}

const ITEMS: NavItem[] = [
  { route: 'home', icon: '🏠', label: 'Home' },
  { route: 'session', icon: '⏱', label: 'Session' },
  { route: 'modules', icon: '📚', label: 'Modules' },
  { route: 'history', icon: '🗓', label: 'History' },
  { route: 'feed', icon: '👥', label: 'Friends' },
  { route: 'settings', icon: '⚙️', label: 'Settings' },
];

const DEV_ITEM: NavItem = { route: 'dev', icon: '🛠', label: 'Dev tools' };

export function sessionDot(status: SessionStatus): { kind: DotKind; pulsing: boolean } | null {
  switch (status) {
    case 'running':
      return { kind: 'subject', pulsing: true };
    case 'paused':
      return { kind: 'paused', pulsing: false };
    case 'break':
      return { kind: 'break', pulsing: false };
    default:
      return null;
  }
}

export function ollamaLine(status: OllamaStatus, model: string): { color: TagColor; text: string } {
  switch (status) {
    case 'ok':
      return { color: 'green', text: `${model} ready` };
    case 'down':
      return { color: 'red', text: 'Ollama offline' };
    case 'modelMissing':
      return { color: 'orange', text: `${model} not pulled` };
    default:
      return { color: 'gray', text: `Checking ${model}…` };
  }
}

export function Sidebar() {
  const route = useNavStore((s) => s.route);
  const go = useNavStore((s) => s.go);
  const setPaletteOpen = useNavStore((s) => s.setPaletteOpen);
  const status = useSessionStore((s) => s.status);
  const ollama = useSessionStore((s) => s.ollama);
  const refreshOllama = useSessionStore((s) => s.refreshOllama);
  const dot = sessionDot(status);
  const items = config.SHOW_DEV_TOOLS ? [...ITEMS, DEV_ITEM] : ITEMS;
  const ol = ollamaLine(ollama.status, ollama.model);

  return (
    <View testID="sidebar" style={styles.sidebar}>
      <View style={styles.workspace}>
        <View style={styles.wsIcon}>
          <RNText style={styles.wsEmoji}>🎯</RNText>
        </View>
        <RNText style={styles.wsName}>LarpLess</RNText>
      </View>

      <SidebarRow testID="nav-search" onPress={() => setPaletteOpen(true)} icon="🔍" label="Search" trailing={<RNText style={styles.kbd}>{`${MOD}K`}</RNText>} />
      <View style={styles.gap} />

      {items.map((it) => (
        <SidebarRow
          key={it.route}
          testID={`nav-${it.route}`}
          icon={it.icon}
          label={it.label}
          active={
            route === it.route ||
            (it.route === 'session' && route === 'summary') ||
            (it.route === 'feed' && (route === 'profile' || route === 'login'))
          }
          onPress={() => go(it.route)}
          trailing={it.route === 'session' && dot ? <StatusDot kind={dot.kind} pulsing={dot.pulsing} size={7} /> : null}
        />
      ))}

      <View style={styles.flex} />

      <MacPressable
        testID="ollama-status"
        tooltip="Click to re-check Ollama"
        enableFocusRing={false}
        onPress={() => {
          refreshOllama().catch(() => {});
        }}
        style={styles.ollama}>
        <RNText style={styles.ollamaText} numberOfLines={1}>
          <RNText style={{ color: tag[ol.color].text }}>● </RNText>
          {ol.text}
        </RNText>
      </MacPressable>
    </View>
  );
}

function SidebarRow({
  icon,
  label,
  active,
  onPress,
  trailing,
  testID,
}: {
  icon: string;
  label: string;
  active?: boolean;
  onPress: () => void;
  trailing?: ReactNode;
  testID?: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <MacPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      enableFocusRing={false}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={[styles.row, active ? styles.rowActive : hover ? styles.rowHover : null]}>
      <RNText style={styles.rowIcon}>{icon}</RNText>
      <RNText numberOfLines={1} style={[styles.rowLabel, active ? styles.rowLabelActive : null]}>
        {label}
      </RNText>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </MacPressable>
  );
}

const styles = themed(() => StyleSheet.create({
  sidebar: {
    width: layout.sidebarWidth,
    backgroundColor: colors.sidebar,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    paddingHorizontal: space.sm - 2,
    paddingTop: space.md,
    paddingBottom: space.md,
  },
  workspace: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, marginBottom: space.md },
  wsIcon: {
    width: 22,
    height: 22,
    borderRadius: radius,
    backgroundColor: tag.red.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  wsEmoji: { fontSize: 13, lineHeight: 16 },
  wsName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  gap: { height: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 28,
    paddingHorizontal: space.sm,
    borderRadius: radius,
    marginBottom: 1,
  },
  rowHover: { backgroundColor: colors.hover },
  rowActive: { backgroundColor: colors.accentSoft },
  rowIcon: { width: 22, fontSize: 14, lineHeight: 18 },
  rowLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, color: colors.muted },
  rowLabelActive: { fontFamily: fonts.semibold, color: colors.text },
  trailing: { marginLeft: space.xs, alignItems: 'center', justifyContent: 'center' },
  kbd: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint },
  flex: { flex: 1 },
  ollama: { paddingHorizontal: space.sm, paddingVertical: space.xs + 2, borderRadius: radius },
  ollamaText: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted },
}));
