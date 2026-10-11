import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { colors, fonts, themed } from '../theme';

export type TextVariant = 'title' | 'h2' | 'h3' | 'body' | 'small';
export type TextWeight = 'regular' | 'medium' | 'semibold';

export interface TextProps {
  variant?: TextVariant;
  weight?: TextWeight;
  /** Override colour (a theme token value). */
  color?: string;
  muted?: boolean;
  serif?: boolean;
  italic?: boolean;
  center?: boolean;
  numberOfLines?: number;
  selectable?: boolean;
  testID?: string;
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
}

const WEIGHT_FONT: Record<TextWeight, string> = {
  regular: fonts.regular,
  medium: fonts.medium,
  semibold: fonts.semibold,
};

/** Inter by default; `title` is Instrument Serif 40. Nest <Text weight="semibold"> for bold runs. */
export function Text({
  variant = 'body',
  weight,
  color,
  muted,
  serif,
  italic,
  center,
  numberOfLines,
  selectable,
  testID,
  style,
  children,
}: TextProps) {
  const base = styles[variant];
  const family = serif
    ? italic
      ? fonts.serifItalic
      : fonts.serif
    : weight
      ? WEIGHT_FONT[weight]
      : undefined;
  return (
    <RNText
      testID={testID}
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={[
        base,
        family ? { fontFamily: family } : null,
        muted ? styles.muted : null,
        color ? { color } : null,
        center ? styles.center : null,
        style,
      ]}>
      {children}
    </RNText>
  );
}

/** Inline bold run inside a <Text>; inherits size and colour from its parent. */
export function Strong({ children, color }: { children?: ReactNode; color?: string }) {
  return <RNText style={[styles.strong, color ? { color } : null]}>{children}</RNText>;
}

/** Inline muted run inside a <Text>. */
export function Muted({ children }: { children?: ReactNode }) {
  return <RNText style={styles.muted}>{children}</RNText>;
}

const styles = themed(() => StyleSheet.create({
  strong: { fontFamily: fonts.semibold },
  title: { fontFamily: fonts.serif, fontSize: 40, lineHeight: 46, letterSpacing: -0.6, color: colors.text },
  h2: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 28, color: colors.text },
  h3: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.text },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.text },
  small: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.muted },
  muted: { color: colors.muted },
  center: { textAlign: 'center' },
}));
