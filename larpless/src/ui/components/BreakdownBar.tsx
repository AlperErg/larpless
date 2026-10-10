import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { BreakdownEntry } from '../../contracts/domain';
import { colors, space, tag } from '../theme';
import { ANIMATE, MotionView } from '../platform';
import { formatDuration } from '../lib/format';
import { Tag } from './Tag';

export interface BreakdownBarProps {
  entries: BreakdownEntry[];
  /** Show a legend of Tags under the bar. */
  legend?: boolean;
  /** Add the duration next to the % in the legend. */
  legendTime?: boolean;
  height?: number;
  /** Legend only (no bar). */
  hideBar?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Horizontal stacked bar of tag-coloured segments; widths spring when the data changes. */
export function BreakdownBar({ entries, legend, legendTime, height = 10, hideBar, testID, style }: BreakdownBarProps) {
  const visible = entries.filter((e) => e.pct > 0);
  return (
    <View testID={testID} style={style}>
      {hideBar ? null : (
        <View style={[styles.track, { height, borderRadius: Math.min(4, height / 2) }]}>
          {visible.map((e, i) => (
            <Segment key={e.key} entry={e} last={i === visible.length - 1} />
          ))}
        </View>
      )}
      {legend && visible.length > 0 ? (
        <View style={[styles.legend, hideBar ? styles.legendOnly : null]}>
          {visible.map((e) => (
            <Tag
              key={e.key}
              color={e.color}
              label={`${e.label} ${Math.round(e.pct)}%${legendTime ? ` · ${formatDuration(e.seconds)}` : ''}`}
              style={styles.legendTag}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Segment({ entry, last }: { entry: BreakdownEntry; last: boolean }) {
  const w = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!ANIMATE) return undefined;
    Animated.spring(w, {
      toValue: entry.pct,
      useNativeDriver: false,
      friction: 9,
      tension: 60,
    }).start();
    return () => w.stopAnimation();
  }, [entry.pct, w]);
  const width = ANIMATE
    ? w.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'], extrapolate: 'clamp' })
    : (`${Math.min(100, Math.max(0, entry.pct))}%` as const);
  return (
    <MotionView
      testID={`segment-${entry.key}`}
      style={[
        styles.segment,
        { width, backgroundColor: tag[entry.color].text },
        last ? null : styles.separator,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    overflow: 'hidden',
    backgroundColor: colors.hover,
    width: '100%',
  },
  segment: { height: '100%' },
  separator: { borderRightWidth: 2, borderRightColor: colors.bg },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.sm },
  legendOnly: { marginTop: 0 },
  legendTag: { marginRight: space.xs + 2, marginBottom: space.xs },
});
