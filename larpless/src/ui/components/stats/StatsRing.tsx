/** History stats (#23): a pill with a small focus dial opens into a big ring, key numbers, a bar chart and subjects. */
import { useState } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { format } from 'date-fns';
import { formatDuration } from '../../lib/format';
import { useTween } from '../../lib/useTween';
import { colors, fonts, space, tag, themed } from '../../theme';
import { Text } from '../Text';
import type { PeriodBucket, StatsPeriod } from '../../../core/focus';
import { BarChart } from './BarChart';
import { GlowPill } from './GlowPill';
import type { BarDatum } from './BarChart';
import { PeriodToggle, Reveal, SubjectsDisclosure, bestBucket, deltaColor, signedCount, signedDuration, usePeriod } from './shared';
import type { StatsViewProps } from './shared';

export type { StatsViewProps };

function tick(period: StatsPeriod, b: PeriodBucket, i: number): string {
  if (period === 'day') return i % 6 === 0 ? format(b.start, 'HH') : '';
  if (period === 'week') return format(b.start, 'EEEEE');
  const d = new Date(b.start).getDate();
  return d === 1 || d % 7 === 1 ? String(d) : '';
}

/** Focused time per hour (day) or per day (week, month), as bar-chart data. */
export function chartData(period: StatsPeriod, buckets: PeriodBucket[]): BarDatum[] {
  return buckets.map((b, i) => ({
    key: b.start,
    value: b.focusS,
    label: tick(period, b, i),
    title: period === 'day' ? `${format(b.start, 'HH:00')}–${format(b.start + 3_600_000, 'HH:00')}` : format(b.start, 'EEEE d MMM'),
    valueText: `${formatDuration(b.focusS)} focused`,
  }));
}

/** Ring of `size` px, `pct` 0..100 filled clockwise from 12 o'clock. */
function Ring({ size, stroke, pct }: { size: number; stroke: number; pct: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colors.hover} strokeWidth={stroke} />
      {filled > 0.5 ? (
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tag.green.text}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ) : null}
    </Svg>
  );
}

export function StatsRing({ sessions, now, testID = 'stats-ring', style }: StatsViewProps) {
  const [open, setOpen] = useState(false);
  const { period, setPeriod, stats, names } = usePeriod(sessions, now);
  const fill = useTween(open ? stats.focusPct : 0, 800, open ? 150 : 0);
  const best = bestBucket(stats);
  const pctLabel = stats.sessions ? `${stats.focusPct}%` : '–';

  return (
    <View testID={testID} style={style}>
      <GlowPill
        testID={`${testID}-open`}
        open={open}
        onPress={() => setOpen((o) => !o)}
        leading={<Ring size={34} stroke={4} pct={stats.focusPct} />}
        title="Your stats"
        detail={stats.sessions ? `${pctLabel} ${names.this}` : `nothing ${names.this} yet`}
        hints={{ open: 'Shows your stats', close: 'Hides your stats' }}
        nudge
      />

      <Reveal open={open} ms={340}>
        <View style={styles.body}>
          <View style={styles.top}>
            <View style={styles.big}>
              <Ring size={132} stroke={10} pct={fill} />
              <View style={styles.bigLabel}>
                <RNText testID={`${testID}-pct`} style={styles.bigPct}>{pctLabel}</RNText>
                <Text variant="small" muted>focused</Text>
              </View>
            </View>
            <View style={styles.side}>
              <PeriodToggle testID={`${testID}-period`} value={period} onChange={setPeriod} />
              <View style={styles.grid}>
                <Row label="Focused" value={formatDuration(stats.focusS)} delta={signedDuration(stats.focusS - stats.previous.focusS)} deltaN={stats.focusS - stats.previous.focusS} testID={`${testID}-focus`} />
                <Row label="Sessions" value={String(stats.sessions)} delta={signedCount(stats.sessions - stats.previous.sessions)} deltaN={stats.sessions - stats.previous.sessions} testID={`${testID}-sessions`} />
                <Row
                  label={period === 'day' ? 'Best hour' : 'Best day'}
                  value={best ? `${period === 'day' ? format(best.start, 'HH:00') : format(best.start, 'EEEE d')}, ${formatDuration(best.focusS)}` : '–'}
                  testID={`${testID}-best`}
                />
              </View>
              <Text variant="small" muted>{`Compared with ${names.previous}`}</Text>
            </View>
          </View>
          <View style={styles.chart}>
            <Text variant="small" muted style={styles.chartTitle}>
              {period === 'day' ? 'Focused per hour' : 'Focused per day'}
            </Text>
            <BarChart key={period} testID={`${testID}-chart`} data={chartData(period, stats.buckets)} play={open} />
          </View>
          <SubjectsDisclosure testID={`${testID}-subjects`} stats={stats} periodName={names.this} />
        </View>
      </Reveal>
    </View>
  );
}

function Row({ label, value, delta, deltaN = 0, testID }: { label: string; value: string; delta?: string; deltaN?: number; testID: string }) {
  return (
    <View testID={testID} style={styles.row}>
      <Text muted style={styles.rowLabel}>{label}</Text>
      <Text>
        {value}
        {delta && delta !== 'same' ? <Text variant="small" color={deltaColor(deltaN)}>{`  ${delta}`}</Text> : null}
      </Text>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  body: { paddingTop: space.lg },
  top: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  big: { width: 132, height: 132, marginRight: space.xxl, marginBottom: space.md },
  bigLabel: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  bigPct: { fontFamily: fonts.serif, fontSize: 32, lineHeight: 36, color: colors.text },
  side: { flex: 1, minWidth: 240 },
  grid: { marginTop: space.md, marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'baseline', marginBottom: space.xs + 2 },
  rowLabel: { width: 96 },
  chart: { marginTop: space.lg },
  chartTitle: { marginBottom: space.xs },
}));
