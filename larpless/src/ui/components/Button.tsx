import { useState } from 'react';
import { StyleSheet, Text as RNText } from 'react-native';
import type { GestureResponderEvent, StyleProp, ViewStyle } from 'react-native';
import { colors, fonts, layout, radius, tag } from '../theme';
import { MacPressable } from './mac';

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'secondary';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress?: (e: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: string;
  disabled?: boolean;
  tooltip?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Press scales slightly so the click registers. */
export function Button({
  title,
  onPress,
  variant = 'ghost',
  size = 'md',
  icon,
  disabled,
  tooltip,
  testID,
  style,
}: ButtonProps) {
  const [hover, setHover] = useState(false);
  const v = VARIANTS[variant];
  return (
    <MacPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      tooltip={tooltip}
      enableFocusRing={false}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' ? styles.lg : null,
        { backgroundColor: v.bg, borderColor: v.border },
        hover && !disabled ? { backgroundColor: v.hoverBg } : null,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}>
      <RNText numberOfLines={1} style={[styles.label, size === 'lg' ? styles.labelLg : null, { color: v.text }]}>
        {icon ? `${icon}  ` : ''}
        {title}
      </RNText>
    </MacPressable>
  );
}

const VARIANTS: Record<ButtonVariant, { bg: string; hoverBg: string; text: string; border: string }> = {
  primary: { bg: colors.accent, hoverBg: colors.accentHover, text: colors.onAccent, border: colors.accent },
  ghost: { bg: 'transparent', hoverBg: colors.hover, text: colors.text, border: 'transparent' },
  secondary: { bg: colors.raised, hoverBg: colors.hover, text: colors.text, border: colors.border },
  danger: { bg: 'transparent', hoverBg: tag.red.bg, text: tag.red.text, border: 'transparent' },
};

const styles = StyleSheet.create({
  base: {
    height: layout.controlHeight,
    paddingHorizontal: 10,
    borderRadius: radius,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  lg: { height: 40, paddingHorizontal: 18 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  labelLg: { fontFamily: fonts.semibold, fontSize: 15 },
  pressed: { transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.4 },
});
