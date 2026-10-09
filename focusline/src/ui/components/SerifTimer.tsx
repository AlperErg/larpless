import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text as RNText, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, fonts, motion } from '../theme';
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

// Instrument Serif metrics (units/em): widest digit 0.46, colon 0.213, ascent 0.99, descent 0.31.
const DIGIT_EM = 0.47;
const COLON_EM = 0.25;
const LINE_EM = 1.3;

/** h:mm:ss in Instrument Serif; every digit is a column that rolls (translateY) when it changes. */
export function SerifTimer({ timer, size = 88, color = colors.text, testID, style }: SerifTimerProps) {
  const elapsed = useElapsedSeconds(timer);
  const text = formatClock(elapsed);
  const chars = text.split('');
  const line = Math.ceil(size * LINE_EM);
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="timer"
      accessibilityLabel={text}
      style={[styles.row, { height: line }, style]}>
      {chars.map((ch, i) => {
        // Key from the right so existing digits keep their identity when hours gain a digit.
        const k = chars.length - i;
        if (ch === ':') {
          return (
            <View key={`c${k}`} style={{ width: size * COLON_EM, height: line }}>
              <RNText style={[styles.glyph, { fontSize: size, lineHeight: line, height: line, color }]}>:</RNText>
            </View>
          );
        }
        return <RollingDigit key={`d${k}`} slot={k} digit={Number(ch)} size={size} line={line} color={color} />;
      })}
    </View>
  );
}

const COLUMN = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

function RollingDigit({ slot, digit, size, line, color }: { slot: number; digit: number; size: number; line: number; color: string }) {
  const pos = useRef(new Animated.Value(digit)).current;
  const prev = useRef(digit);

  useEffect(() => {
    const from = prev.current;
    prev.current = digit;
    if (from === digit) return;
    const cfg = { duration: motion.slow, easing: Easing.out(Easing.cubic), useNativeDriver: false };
    if (from === 9 && digit === 0) {
      // Roll forward onto the trailing 0, then snap back to the top (seamless wrap).
      Animated.timing(pos, { ...cfg, toValue: 10 }).start(({ finished }) => {
        if (finished) pos.setValue(0);
      });
    } else {
      Animated.timing(pos, { ...cfg, toValue: digit }).start();
    }
    return () => pos.stopAnimation();
  }, [digit, pos]);

  // Memoised so re-renders (every second) reuse the same animated node.
  const translateY = useMemo(() => pos.interpolate({ inputRange: [0, 10], outputRange: [0, -10 * line] }), [pos, line]);
  return (
    <View style={{ width: size * DIGIT_EM, height: line, overflow: 'hidden' }}>
      <Animated.View testID={`timer-digit-${slot}`} style={{ transform: [{ translateY }] }}>
        {COLUMN.map((d, i) => (
          <RNText key={i} style={[styles.glyph, { fontSize: size, lineHeight: line, height: line, color }]}>
            {d}
          </RNText>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', alignSelf: 'flex-start' },
  glyph: { fontFamily: fonts.serif, textAlign: 'center' },
});
