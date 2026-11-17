/**
 * The History stats buttons ("Your stats", "Subjects"): a raised capsule ending in an "Open ⌄" / "Close ⌃" badge.
 * On hover a soft glow in its tone fades in, the capsule lifts a pixel, the badge fills with the tone, and a border
 * draws itself from the top centre round both sides to the bottom; leaving plays it back.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTween } from '../../lib/useTween';
import { colors, space, tag, themed } from '../../theme';
import type { TagColor } from '../../../contracts/domain';
import { Icon } from '../Icon';
import { MacPressable } from '../mac';
import { Text } from '../Text';

export interface GlowPillProps {
  open: boolean;
  onPress: () => void;
  /** Drawn at the left edge (a small dial, colour dots…). */
  leading?: ReactNode;
  title: string;
  /** Muted text after the title. */
  detail?: string;
  /** Screen-reader hints for the closed and open states. */
  hints: { open: string; close: string };
  /** Dip the chevron twice when it first appears (use on one button per screen). */
  nudge?: boolean;
  /** 'accent' (blue, the default) or a tag colour such as 'yellow' for the glow, the traced border and the badge. */
  tone?: 'accent' | TagColor;
  /** On the pressable; the badge is `${testID}-hint`, the hover border `${testID}-trace`. */
  testID: string;
  style?: StyleProp<ViewStyle>;
}

/** Colours for a tone, read at render so they follow the light/dark scheme. */
function toneColors(tone: 'accent' | TagColor) {
  if (tone === 'accent') return { soft: colors.accentSoft, strong: colors.accent, onStrong: colors.onAccent };
  const t = tag[tone] ?? tag.gray;
  return { soft: t.bg, strong: t.text, onStrong: colors.raised };
}

export function GlowPill({ open, onPress, leading, title, detail, hints, nudge, tone = 'accent', testID, style }: GlowPillProps) {
  const c = toneColors(tone);
  const [hovered, setHovered] = useState(false);
  const glow = useTween(hovered ? 1 : 0, 180);
  const trace = useTween(hovered ? 1 : 0, 420);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  return (
    <View style={[styles.wrap, { transform: [{ translateY: -glow }] }, style]}>
      <View pointerEvents="none" style={[styles.halo, { opacity: glow, backgroundColor: c.soft }]} />
      <MacPressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint={open ? hints.close : hints.open}
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        style={[styles.pill, leading ? styles.pillLeading : null]}>
        {leading}
        <Text weight="medium" style={[styles.title, leading ? styles.titleAfterLeading : null]}>
          {title}
        </Text>
        {detail ? (
          <Text variant="small" muted>
            {detail}
          </Text>
        ) : null}
        <OpenBadge open={open} hovered={hovered} nudge={!!nudge} tone={c} testID={`${testID}-hint`} />
      </MacPressable>
      {size ? <BorderTrace w={size.w} h={size.h} progress={trace} color={c.strong} testID={`${testID}-trace`} /> : null}
    </View>
  );
}

const TRACE_W = 2;

/**
 * The hover border, drawn as it animates: two strokes leave the top centre of the capsule, run down the right and
 * left sides and meet at the bottom centre (`progress` 0 → 1). Lowering `progress` retracts them back to the top.
 */
function BorderTrace({ w, h, progress, color, testID }: { w: number; h: number; progress: number; color: string; testID: string }) {
  if (progress <= 0.001) return null;
  const i = TRACE_W / 2; // keep the stroke inside the box so it isn't clipped
  const r = h / 2 - i;
  const cx = w / 2;
  const half = w / 2 - h / 2 + Math.PI * r + (w / 2 - h / 2); // top centre → bottom centre along one side
  const right = `M ${cx} ${i} H ${w - h / 2} A ${r} ${r} 0 0 1 ${w - h / 2} ${h - i} H ${cx}`;
  const left = `M ${cx} ${i} H ${h / 2} A ${r} ${r} 0 0 0 ${h / 2} ${h - i} H ${cx}`;
  const dash = `${half * progress} ${half + 1}`;
  return (
    <View testID={testID} pointerEvents="none" style={[styles.trace, { width: w, height: h }]}>
      <Svg width={w} height={h}>
        <Path d={right} fill="none" stroke={color} strokeWidth={TRACE_W} strokeLinecap="round" strokeDasharray={dash} />
        <Path d={left} fill="none" stroke={color} strokeWidth={TRACE_W} strokeLinecap="round" strokeDasharray={dash} />
      </Svg>
    </View>
  );
}

/** Dips at 0.7 s and 1.3 s after the pill appears, then stays still: a one-time "press me". */
const NUDGE_AT_MS = [700, 1000, 1300, 1600];

/**
 * "Open ⌄" / "Close ⌃" in a soft capsule (two icons, not a rotation: react-native-windows rotates around the top-left
 * corner) that fills with the accent while the pill is hovered.
 */
function OpenBadge({ open, hovered, nudge, tone, testID }: { open: boolean; hovered: boolean; nudge: boolean; tone: ReturnType<typeof toneColors>; testID: string }) {
  const [down, setDown] = useState(false);
  useEffect(() => {
    if (open || !nudge) return undefined;
    const timers = NUDGE_AT_MS.map((ms, i) => setTimeout(() => setDown(i % 2 === 0), ms));
    return () => {
      timers.forEach(clearTimeout);
      setDown(false);
    };
  }, [open, nudge]);
  const dip = useTween(down ? 3 : 0, 220);
  const ink = hovered ? tone.onStrong : tone.strong;
  return (
    <View testID={testID} style={[styles.badge, { backgroundColor: hovered ? tone.strong : tone.soft }]}>
      <Text variant="small" weight="medium" color={ink}>
        {open ? 'Close' : 'Open'}
      </Text>
      <View style={[styles.chevron, { transform: [{ translateY: dip }] }]}>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} color={ink} strokeWidth={2.25} />
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { alignSelf: 'flex-start' },
  halo: { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: 999 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingLeft: space.lg,
    paddingRight: 6,
    paddingVertical: 5,
    minHeight: 46,
  },
  pillLeading: { paddingLeft: 5 },
  title: { marginRight: space.sm },
  titleAfterLeading: { marginLeft: space.sm + 2 },
  trace: { position: 'absolute', top: 0, left: 0 },
  badge: { flexDirection: 'row', alignItems: 'center', height: 26, borderRadius: 13, marginLeft: space.md, paddingLeft: space.sm + 2, paddingRight: space.sm },
  chevron: { width: 14, height: 14, marginLeft: 3 },
}));
