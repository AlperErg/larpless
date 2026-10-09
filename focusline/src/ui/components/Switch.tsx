import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { colors, motion } from '../theme';
import { MacPressable } from './mac';

export interface SwitchProps {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}

const W = 30;
const H = 18;
const KNOB = 14;

/** Notion-style toggle switch (accent when on). */
export function Switch({ value, onChange, disabled, testID, accessibilityLabel }: SwitchProps) {
  const t = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(t, {
      toValue: value ? 1 : 0,
      duration: motion.fast,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [value, t]);
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [2, W - KNOB - 2] });
  return (
    <MacPressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      enableFocusRing={false}
      onPress={() => onChange(!value)}
      style={[styles.track, { backgroundColor: value ? colors.accent : colors.active }, disabled ? styles.disabled : null]}>
      <Animated.View style={[styles.knob, { transform: [{ translateX }] }]} />
    </MacPressable>
  );
}

const styles = StyleSheet.create({
  track: { width: W, height: H, borderRadius: H / 2, justifyContent: 'center' },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: colors.bg },
  disabled: { opacity: 0.4 },
});
