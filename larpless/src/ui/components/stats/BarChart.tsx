/**
 * Vertical bar chart in the style of bklit's BarChart (bklit.com/docs/components/bar-chart), rebuilt for React Native
 * with react-native-svg: bklit itself is a web component (DOM SVG + motion), so it can't run here.
 *
 * What carries over: round-capped bars that grow with bklit's easing, cubic-bezier(0.85, 0, 0.15, 1), staggered so
 * the whole set lands in about 1.1 s; dashed horizontal grid lines that fade out at the left and right edges (in
 * opacity steps: react-native-windows doesn't paint gradient strokes); on
 * hover the other bars fade to 30% and a small tooltip names the bar. Bars with no value draw nothing.
 */
import { useState } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { cubicBezier, useTween } from '../../lib/useTween';
import { colors, fonts, radius, space, tag, themed } from '../../theme';
import { MacPressable } from '../mac';

export interface BarDatum {
  key: string | number;
  value: number;
  /** Axis label under the bar ('' leaves it blank). */
  label: string;
  /** Tooltip title and value, shown on hover. */
  title: string;
  valueText: string;
}

export interface BarChartProps {
  data: BarDatum[];
  /** Plot height in px (the axis labels sit under it). */
  height?: number;
  /** Bars grow in when this turns true and shrink back when it turns false. */
  play?: boolean;
  color?: string;
  testID?: string;
}

const BKLIT_EASE = cubicBezier(0.85, 0, 0.15, 1);
const linear = (t: number) => t;
const TOTAL_MS = 1100;
const FADED = 0.3;
const GRID_LINES = 4;
const TOP_PAD = 8;
/** Grid line pieces [from, to, opacity] across the width: solid in the middle, fading out towards both edges. */
const GRID_FADE: [number, number, number][] = [
  [0, 0.04, 0.06], [0.04, 0.08, 0.14], [0.08, 0.12, 0.22], [0.12, 0.88, 0.3],
  [0.88, 0.92, 0.22], [0.92, 0.96, 0.14], [0.96, 1, 0.06],
];

export function BarChart({ data, height = 140, play = true, color = tag.green.text, testID = 'bar-chart' }: BarChartProps) {
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  // One clock for the whole chart; each bar maps it to its own staggered slice (bklit's auto stagger).
  const clock = useTween(play ? TOTAL_MS : 0, TOTAL_MS, 0, linear);

  const n = Math.max(1, data.length);
  const stagger = Math.min(70, 450 / n);
  const barMs = Math.max(300, TOTAL_MS - stagger * (n - 1));
  const max = Math.max(1, ...data.map((d) => d.value));
  const band = width / n;
  const barW = Math.max(3, Math.min(28, band * (n > 12 ? 0.62 : 0.5)));
  const plotH = height - TOP_PAD;

  const grow = (i: number) => BKLIT_EASE(Math.min(1, Math.max(0, (clock - i * stagger) / barMs)));
  const activeDatum = active == null ? null : data[active];

  return (
    <View testID={testID}>
      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {Array.from({ length: GRID_LINES + 1 }, (_, i) => {
              const y = TOP_PAD + (plotH * i) / GRID_LINES - 0.5;
              return GRID_FADE.map(([from, to, opacity]) => (
                <Line key={`${i}-${from}`} x1={width * from} x2={width * to} y1={y} y2={y}
                  stroke={colors.faint} strokeOpacity={opacity} strokeWidth={1} strokeDasharray="3,4" />
              ));
            })}
            {data.map((d, i) => {
              if (d.value <= 0) return null;
              const h = Math.max(barW, (d.value / max) * plotH) * grow(i);
              if (h < 0.5) return null;
              const x = band * i + (band - barW) / 2;
              const faded = active != null && active !== i;
              return (
                <Rect
                  key={d.key}
                  testID={`${testID}-bar`}
                  x={x}
                  y={height - h}
                  width={barW}
                  height={h}
                  rx={Math.min(barW / 2, h / 2)}
                  fill={color}
                  opacity={faded ? FADED : 1}
                />
              );
            })}
          </Svg>
        ) : null}

        {/* Hover / tap targets, one per column, over the whole plot height. */}
        <View style={styles.targets}>
          {data.map((d, i) => (
            <MacPressable
              key={d.key}
              testID={`${testID}-col-${i}`}
              accessibilityLabel={d.value > 0 ? `${d.title}, ${d.valueText}` : undefined}
              onHoverIn={() => setActive(i)}
              onHoverOut={() => setActive((a) => (a === i ? null : a))}
              onPress={() => setActive((a) => (a === i ? null : i))}
              style={styles.target}
            />
          ))}
        </View>

        {activeDatum && activeDatum.value > 0 && active != null ? (
          <View
            testID={`${testID}-tooltip`}
            pointerEvents="none"
            style={[
              styles.tooltip,
              {
                bottom: Math.max(barW, (activeDatum.value / max) * plotH) + 8,
                left: Math.min(Math.max(0, band * active + band / 2 - 70), Math.max(0, width - 140)),
              },
            ]}>
            <RNText style={styles.tooltipTitle} numberOfLines={1}>{activeDatum.title}</RNText>
            <RNText style={styles.tooltipValue} numberOfLines={1}>{activeDatum.valueText}</RNText>
          </View>
        ) : null}
      </View>

      <View style={styles.axis}>
        {data.map((d, i) => (
          <RNText key={d.key} numberOfLines={1} style={[styles.tick, active === i && styles.tickActive]}>
            {d.label}
          </RNText>
        ))}
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  targets: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row' },
  target: { flex: 1 },
  tooltip: {
    position: 'absolute',
    width: 140,
    alignItems: 'center',
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  tooltipTitle: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14, color: colors.muted },
  tooltipValue: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, color: colors.text },
  axis: { flexDirection: 'row', marginTop: space.xs },
  tick: { flex: 1, textAlign: 'center', fontFamily: fonts.regular, fontSize: 11, lineHeight: 14, color: colors.faint },
  tickActive: { color: colors.text },
}));
