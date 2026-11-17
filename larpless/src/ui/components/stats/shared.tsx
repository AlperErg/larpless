/**
 * Pieces shared by the three History stats styles (#23): the period hook and toggle, the open/close reveal,
 * staggered items, and the "Subjects" button with its list.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { BreakdownEntry, SessionSummary } from '../../../contracts/domain';
import { periodStart, periodStats } from '../../../core/focus';
import type { PeriodStats, StatsPeriod } from '../../../core/focus';
import { formatDuration, formatLegendDuration } from '../../lib/format';
import { cubicBezier, useTween } from '../../lib/useTween';
import { colors, fonts, space, tag, themed } from '../../theme';
import { MacPressable } from '../mac';
import { GlowPill } from './GlowPill';
import { Text } from '../Text';

export interface StatsViewProps {
  sessions: SessionSummary[];
  /** Injected for tests; defaults to Date.now(). */
  now?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** bklit's bar easing, shared by the period chart and the subject bars. */
export const BAR_EASE = cubicBezier(0.85, 0, 0.15, 1);

export const PERIOD_NAMES: Record<StatsPeriod, { current: string; this: string; previous: string; bucket: string }> = {
  day: { current: 'Today', this: 'today', previous: 'yesterday', bucket: 'hour' },
  week: { current: 'This week', this: 'this week', previous: 'last week', bucket: 'day' },
  month: { current: 'This month', this: 'this month', previous: 'last month', bucket: 'day' },
};

/** "+1h 20m", "−15m", or "same" (under a minute either way). */
export function signedDuration(deltaS: number): string {
  if (Math.abs(deltaS) < 60) return 'same';
  return `${deltaS > 0 ? '+' : '−'}${formatDuration(Math.abs(deltaS))}`;
}

/** "+12 pts", "−4 pts", "same". */
export function signedPoints(delta: number): string {
  if (delta === 0) return 'same';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} pt${Math.abs(delta) === 1 ? '' : 's'}`;
}

export function signedCount(delta: number): string {
  if (delta === 0) return 'same';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`;
}

/** Colour for a delta: green when better, red when worse, muted when the same. */
export function deltaColor(delta: number): string {
  if (delta === 0) return colors.muted;
  return delta > 0 ? tag.green.text : tag.red.text;
}

/** Selected period plus its stats. The memo keys on the local day, not on every render's Date.now(). */
export function usePeriod(sessions: SessionSummary[], now?: number, initial: StatsPeriod = 'week') {
  const [period, setPeriod] = useState<StatsPeriod>(initial);
  const today = periodStart('day', now ?? Date.now());
  const stats = useMemo(() => periodStats(sessions, period, today), [sessions, period, today]);
  return { period, setPeriod, stats, names: PERIOD_NAMES[period] };
}

/** Subjects only (no Distracted), biggest first. */
export const subjectsOf = (s: PeriodStats): BreakdownEntry[] => s.breakdown.filter((e) => e.key !== 'distracted');

/** Busiest bucket by focused time, or null when nothing was focused. */
export function bestBucket(s: PeriodStats) {
  let best = s.buckets[0];
  for (const b of s.buckets) if (b.focusS > best.focusS) best = b;
  return best && best.focusS > 0 ? best : null;
}

const PERIODS: StatsPeriod[] = ['day', 'week', 'month'];
const PERIOD_LABEL: Record<StatsPeriod, string> = { day: 'Day', week: 'Week', month: 'Month' };

/** Pill toggle: a white thumb on a soft track. */
export function PeriodToggle({ value, onChange, testID }: { value: StatsPeriod; onChange: (p: StatsPeriod) => void; testID: string }) {
  return (
    <View testID={testID} style={styles.track} accessibilityRole="radiogroup">
      {PERIODS.map((p) => {
        const on = p === value;
        return (
          <MacPressable
            key={p}
            testID={`${testID}-${p}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(p)}
            style={[styles.option, on && styles.optionOn]}>
            <Text variant="small" weight={on ? 'medium' : 'regular'} color={on ? colors.text : colors.muted}>
              {PERIOD_LABEL[p]}
            </Text>
          </MacPressable>
        );
      })}
    </View>
  );
}

/**
 * Opens and closes its content by easing the height, fading and nudging it down. The content unmounts once closed.
 * It is laid out absolutely so it keeps its natural height inside the shorter, clipping box: in normal flow,
 * react-native-windows shrinks it to the box and the measured height stays at that squashed size. onLayout
 * follows it as it changes (a nested Reveal opening, a narrower window).
 */
export function Reveal({ open, children, ms = 300, style }: { open: boolean; children: ReactNode; ms?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTween(open ? 1 : 0, ms);
  const [h, setH] = useState(0);
  if (!open && t < 0.001) return null;
  return (
    <View style={[styles.clip, { height: h * t, opacity: t }, style]}>
      <View onLayout={(e) => setH(e.nativeEvent.layout.height)} style={[styles.measured, { transform: [{ translateY: (1 - t) * -8 }] }]}>
        {children}
      </View>
    </View>
  );
}

/** Fades and slides in after `index` × 30 ms: chips and rows that cascade when a list opens. */
export function Stagger({ index, children, style, from = 'below' }: { index: number; children: ReactNode; style?: StyleProp<ViewStyle>; from?: 'below' | 'left' }) {
  const t = useTween(1, 240, Math.min(index, 14) * 30);
  const shift = (1 - t) * 6;
  const transform = from === 'left' ? [{ translateX: -shift }] : [{ translateY: shift }];
  return <View style={[{ opacity: t, transform }, style]}>{children}</View>;
}

/** Ranked subject rows with a bar scaled to the biggest subject. */
export function SubjectRows({ entries, testID }: { entries: BreakdownEntry[]; testID: string }) {
  const top = entries[0]?.seconds || 1;
  return (
    <View testID={testID}>
      {entries.map((e, i) => (
        <Stagger key={e.key} index={i} from="left" style={styles.subjectRow}>
          <Text variant="small" numberOfLines={1} style={styles.subjectName}>
            {e.label}
          </Text>
          <SubjectBar share={e.seconds / top} index={i} color={(tag[e.color] ?? tag.gray).text} />
          <Text variant="small" muted style={styles.subjectTime}>
            {formatLegendDuration(e.seconds)}
          </Text>
        </Stagger>
      ))}
    </View>
  );
}

/** A round-capped bar that grows from the left like the period chart's bars. */
function SubjectBar({ share, index, color }: { share: number; index: number; color: string }) {
  const t = useTween(1, 700, 80 + Math.min(index, 14) * 45, BAR_EASE);
  return (
    <View style={styles.subjectTrack}>
      <View style={[styles.subjectFill, { width: `${Math.max(1.5, share * 100) * t}%`, backgroundColor: color }]} />
    </View>
  );
}

/** Up to four overlapping dots in the top subjects' colours: the Subjects button's leading mark. */
function SubjectDots({ entries }: { entries: BreakdownEntry[] }) {
  const top = entries.slice(0, 4);
  return (
    <View style={[styles.dots, { width: 12 + (top.length - 1) * 14 + 12 }]}>
      {top.map((e, i) => (
        <View key={e.key} style={[styles.dot, { left: 4 + i * 14, zIndex: top.length - i, backgroundColor: (tag[e.color] ?? tag.gray).text }]} />
      ))}
    </View>
  );
}

/**
 * The Subjects button (same GlowPill as "Your stats") and the ranked list it opens with a cascade. Distracted time is
 * left to the numbers above.
 */
export function SubjectsDisclosure({ stats, periodName, testID }: { stats: PeriodStats; periodName: string; testID: string }) {
  const [open, setOpen] = useState(false);
  const entries = subjectsOf(stats);
  if (entries.length === 0) return null;
  return (
    <View style={styles.subjects}>
      <GlowPill
        testID={`${testID}-toggle`}
        open={open}
        onPress={() => setOpen((o) => !o)}
        leading={<SubjectDots entries={entries} />}
        title="Subjects"
        detail={`${entries.length} studied ${periodName}`}
        hints={{ open: 'Shows your subjects', close: 'Hides your subjects' }}
        tone="yellow"
      />
      <Reveal open={open}>
        <View style={styles.subjectsBody}>
          <SubjectRows testID={`${testID}-list`} entries={entries} />
        </View>
      </Reveal>
    </View>
  );
}

export const statStyles = themed(() => StyleSheet.create({
  serifNumber: { fontFamily: fonts.serif, fontSize: 34, lineHeight: 38, color: colors.text },
}));

const styles = themed(() => StyleSheet.create({
  track: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: colors.hover, borderRadius: 999, padding: 3 },
  option: { paddingHorizontal: space.md, paddingVertical: 4, borderRadius: 999 },
  optionOn: { backgroundColor: colors.raised },
  clip: { overflow: 'hidden' },
  measured: { position: 'absolute', top: 0, left: 0, right: 0 },
  subjects: { marginTop: space.lg },
  dots: { height: 34, justifyContent: 'center' },
  dot: { position: 'absolute', top: 11, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.raised },
  subjectsBody: { paddingTop: space.md },
  subjectRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.xs + 3 },
  subjectName: { width: 170 },
  subjectTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.hover, overflow: 'hidden', marginHorizontal: space.sm },
  subjectFill: { height: '100%', borderRadius: 4 },
  subjectTime: { width: 64, textAlign: 'right' },
}));
