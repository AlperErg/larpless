import { useMemo } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { addDays, format, startOfDay, startOfWeek } from 'date-fns';
import type { SessionSummary } from '../../contracts/domain';
import { colors, fonts, heat, space, themed } from '../theme';
import { dayKey, minutesByDay } from '../lib/derive';
import { MacView } from './mac';

export interface HeatmapProps {
  sessions: SessionSummary[];
  weeks?: number;
  /** Injected for tests; defaults to Date.now(). */
  now?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const CELL = 10;
const GAP = 2;
const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

export function heatLevel(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0;
  if (minutes < 15) return 1;
  if (minutes < 30) return 2;
  if (minutes < 60) return 3;
  return 4;
}

/** 12 weeks × 7 days of 10 px squares (2 px gap); green intensity by minutes studied. */
export function Heatmap({ sessions, weeks = 12, now, testID, style }: HeatmapProps) {
  const today = startOfDay(now ?? Date.now());
  const columns = useMemo(() => {
    const mins = minutesByDay(sessions);
    const firstWeek = addDays(startOfWeek(today, { weekStartsOn: 1 }), -7 * (weeks - 1));
    return Array.from({ length: weeks }, (_, w) =>
      Array.from({ length: 7 }, (__, d) => {
        const day = addDays(firstWeek, w * 7 + d);
        const future = day.getTime() > today.getTime();
        const m = mins.get(dayKey(day.getTime())) ?? 0;
        return { key: dayKey(day.getTime()), day: day.getTime(), minutes: m, future };
      }),
    );
  }, [sessions, weeks, today.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const monthLabels = columns.map((col, i) => {
    const first = col[0].day;
    const prev = i > 0 ? columns[i - 1][0].day : null;
    return prev == null || new Date(prev).getMonth() !== new Date(first).getMonth() ? format(first, 'MMM') : '';
  });

  return (
    <View testID={testID} style={style}>
      <View style={styles.row}>
        <View style={styles.dayLabels}>
          <View style={styles.monthRow} />
          {DAY_LABELS.map((l, i) => (
            <RNText key={i} style={styles.dayLabel}>
              {l}
            </RNText>
          ))}
        </View>
        {columns.map((col, w) => (
          <View key={col[0].key} style={styles.col}>
            <View style={styles.monthRow}>
              {monthLabels[w] ? <RNText style={styles.month}>{monthLabels[w]}</RNText> : null}
            </View>
            {col.map((c) => (
              <MacView
                key={c.key}
                tooltip={c.future ? undefined : `${format(c.day, 'EEE d MMM')} · ${Math.round(c.minutes)} min`}
                style={[
                  styles.cell,
                  { backgroundColor: c.future ? 'transparent' : heat[heatLevel(c.minutes)] },
                ]}
              />
            ))}
          </View>
        ))}
      </View>
      <View style={styles.legend}>
        <RNText style={styles.legendText}>Less</RNText>
        {heat.map((h, i) => (
          <View key={i} style={[styles.cell, styles.legendCell, { backgroundColor: h }]} />
        ))}
        <RNText style={styles.legendText}>More</RNText>
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  row: { flexDirection: 'row' },
  dayLabels: { marginRight: space.xs + 2 },
  dayLabel: { height: CELL, marginBottom: GAP, fontFamily: fonts.regular, fontSize: 9, lineHeight: CELL, color: colors.faint },
  monthRow: { height: 14 },
  month: { position: 'absolute', left: 0, width: 40, fontFamily: fonts.regular, fontSize: 10, lineHeight: 12, color: colors.muted },
  col: { marginRight: GAP },
  cell: { width: CELL, height: CELL, borderRadius: 2, marginBottom: GAP },
  legend: { flexDirection: 'row', alignItems: 'center', marginTop: space.xs, marginLeft: 30 },
  legendCell: { marginBottom: 0, marginRight: GAP },
  legendText: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 12, color: colors.faint, marginHorizontal: space.xs },
}));
