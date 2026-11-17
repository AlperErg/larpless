import { useMemo, useState } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { format } from 'date-fns';
import type { SessionSummary } from '../../contracts/domain';
import { periodStart, periodStats } from '../../core/focus';
import type { PeriodBucket, PeriodStats as Stats, StatsPeriod } from '../../core/focus';
import { formatDuration } from '../lib/format';
import { colors, fonts, space, tag, themed } from '../theme';
import { BreakdownBar } from './BreakdownBar';
import { MacView } from './mac';
import { Segmented } from './Segmented';
import { Text } from './Text';

export interface PeriodStatsProps {
  sessions: SessionSummary[];
  /** Injected for tests; defaults to Date.now(). */
  now?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const NAMES: Record<StatsPeriod, { current: string; previous: string }> = {
  day: { current: 'Today', previous: 'yesterday' },
  week: { current: 'This week', previous: 'last week' },
  month: { current: 'This month', previous: 'last month' },
};

const CHART_H = 64;

/** "+1h 20m", "−15m", or "same" (under a minute either way). */
export function signedDuration(deltaS: number): string {
  if (Math.abs(deltaS) < 60) return 'same';
  return `${deltaS > 0 ? '+' : '−'}${formatDuration(Math.abs(deltaS))}`;
}

/** "+12 pts", "−4 pts", "same". */
export function signedPoints(delta: number): string {
  if (delta === 0) return 'same';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} pts`;
}

/** Axis label under a bar, or '' to leave it blank. */
function tickLabel(period: StatsPeriod, b: PeriodBucket, i: number): string {
  if (period === 'day') return i % 6 === 0 ? format(b.start, 'HH') : '';
  if (period === 'week') return format(b.start, 'EEEEE');
  const d = new Date(b.start).getDate();
  return d === 1 || d % 7 === 1 ? String(d) : '';
}

function tooltipOf(period: StatsPeriod, b: PeriodBucket): string {
  const when = period === 'day' ? format(b.start, 'HH:00') : format(b.start, 'EEE d MMM');
  return `${when} · ${formatDuration(b.focusS)} focused of ${formatDuration(b.totalS)}`;
}

/** Day / Week / Month toggle with focus time, focus %, sessions (each vs the period before), a bar chart and the subject mix. */
export function PeriodStats({ sessions, now, testID = 'period-stats', style }: PeriodStatsProps) {
  const [period, setPeriod] = useState<StatsPeriod>('week');
  // Only the day matters for which period is shown, so key the memo on it rather than on every render's Date.now().
  const today = periodStart('day', now ?? Date.now());
  const stats = useMemo(() => periodStats(sessions, period, today), [sessions, period, today]);
  const names = NAMES[period];

  return (
    <View testID={testID} style={style}>
      <View style={styles.head}>
        <Text variant="h3" style={styles.title}>
          {names.current}
        </Text>
        <Segmented testID={`${testID}-period`} options={PERIODS} value={period} onChange={setPeriod} />
      </View>

      <View style={styles.tiles}>
        <Tile
          testID={`${testID}-focus`}
          label="Focused"
          value={formatDuration(stats.focusS)}
          delta={signedDuration(stats.focusS - stats.previous.focusS)}
          previous={names.previous}
        />
        <Tile
          testID={`${testID}-pct`}
          label="Focus"
          value={stats.sessions ? `${stats.focusPct}%` : '–'}
          delta={stats.sessions && stats.previous.sessions ? signedPoints(stats.focusPct - stats.previous.focusPct) : null}
          previous={names.previous}
        />
        <Tile
          testID={`${testID}-sessions`}
          label="Sessions"
          value={String(stats.sessions)}
          delta={stats.sessions === stats.previous.sessions ? 'same' : `${stats.sessions > stats.previous.sessions ? '+' : '−'}${Math.abs(stats.sessions - stats.previous.sessions)}`}
          previous={names.previous}
        />
      </View>

      <Chart stats={stats} testID={`${testID}-chart`} />

      {stats.breakdown.length > 0 ? (
        <BreakdownBar testID={`${testID}-breakdown`} entries={stats.breakdown} legend legendTime style={styles.breakdown} />
      ) : (
        <Text muted testID={`${testID}-empty`} style={styles.breakdown}>
          {`No sessions ${period === 'day' ? 'today' : `this ${period}`} yet.`}
        </Text>
      )}
    </View>
  );
}

function Tile({ label, value, delta, previous, testID }: { label: string; value: string; delta: string | null; previous: string; testID: string }) {
  return (
    <View testID={testID} style={styles.tile}>
      <Text muted variant="small">
        {label}
      </Text>
      <Text variant="h2" weight="semibold">
        {value}
      </Text>
      <Text muted variant="small">
        {delta == null ? ' ' : `${delta} vs ${previous}`}
      </Text>
    </View>
  );
}

/** One bar per bucket: the full height is the busiest bucket's running time; the solid part is focused time. */
function Chart({ stats, testID }: { stats: Stats; testID: string }) {
  const max = Math.max(1, ...stats.buckets.map((b) => b.totalS));
  const h = (s: number) => (s > 0 ? Math.max(2, Math.round((s / max) * CHART_H)) : 0);
  return (
    <View testID={testID} style={styles.chart}>
      <View style={styles.bars}>
        {stats.buckets.map((b) => (
          <MacView key={b.start} tooltip={b.totalS ? tooltipOf(stats.period, b) : undefined} style={styles.slot}>
            <View style={[styles.bar, styles.barTotal, { height: h(b.totalS) }]}>
              <View testID={b.focusS ? `${testID}-bar` : undefined} style={[styles.bar, styles.barFocus, { height: h(b.focusS) }]} />
            </View>
          </MacView>
        ))}
      </View>
      <View style={styles.ticks}>
        {stats.buckets.map((b, i) => (
          <RNText key={b.start} style={styles.tick} numberOfLines={1}>
            {tickLabel(stats.period, b, i)}
          </RNText>
        ))}
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: space.sm },
  title: { marginRight: space.md },
  tiles: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { minWidth: 120, marginRight: space.xl, marginBottom: space.sm },
  chart: { marginTop: space.sm },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: CHART_H, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  slot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  bar: { width: '70%', maxWidth: 18, borderTopLeftRadius: 2, borderTopRightRadius: 2, justifyContent: 'flex-end' },
  barTotal: { backgroundColor: colors.hover },
  barFocus: { width: '100%', maxWidth: undefined, backgroundColor: tag.green.text },
  ticks: { flexDirection: 'row', marginTop: 2 },
  tick: { flex: 1, textAlign: 'center', fontFamily: fonts.regular, fontSize: 9, lineHeight: 12, color: colors.faint },
  breakdown: { marginTop: space.md },
}));
