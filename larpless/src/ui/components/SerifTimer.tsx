import { useEffect, useState } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, fonts } from '../theme';
import { formatClock } from '../lib/format';

export interface TimerAnchor {
  baseS: number;
  runningSinceMs: number | null;
}

export function elapsedOf(t: TimerAnchor, now: number = Date.now()): number {
  return t.runningSinceMs == null ? t.baseS : t.baseS + Math.max(0, now - t.runningSinceMs) / 1000;
}

/** Whole elapsed seconds, recomputed every 250 ms while the anchor is running. */
export function useElapsedSeconds(t: TimerAnchor): number {
  const [s, setS] = useState(() => Math.floor(elapsedOf(t)));
  const { baseS, runningSinceMs } = t;
  useEffect(() => {
    const anchor = { baseS, runningSinceMs };
    const tick = () => {
      const v = Math.floor(elapsedOf(anchor));
      setS((prev) => (prev === v ? prev : v));
    };
    tick();
    if (runningSinceMs == null) return undefined;
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [baseS, runningSinceMs]);
  return s;
}

export interface SerifTimerProps {
  timer: TimerAnchor;
  /** Font size in pt (default 88). */
  size?: number;
  color?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

// Instrument Serif: ascent 0.99 em, descent 0.31 em. One line box fits every digit.
const LINE_EM = 1.3;

/**
 * h:mm:ss in Instrument Serif, as one text run (same approach as the floating panel).
 * Per-digit columns clipped 4–9 down to a speck on macOS; the full string does not.
 */
export function SerifTimer({ timer, size = 88, color = colors.text, testID, style }: SerifTimerProps) {
  const elapsed = useElapsedSeconds(timer);
  const text = formatClock(elapsed);
  const line = Math.ceil(size * LINE_EM);
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="timer"
      accessibilityLabel={text}
      style={[styles.row, { height: line }, style]}>
      <RNText style={[styles.glyph, { fontSize: size, lineHeight: line, color }]}>{text}</RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', alignSelf: 'flex-start' },
  glyph: { fontFamily: fonts.serif, fontVariant: ['tabular-nums'] },
});
