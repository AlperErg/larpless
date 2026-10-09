import { StyleSheet } from 'react-native';
import { colors, fonts, radius, space } from '../theme';
import { MacTextInput } from './mac';
import type { MacTextInputProps } from './mac';

/** 28 px bordered Notion input. */
export function TextField({ style, ...props }: MacTextInputProps) {
  return (
    <MacTextInput
      enableFocusRing={false}
      autoCorrect={false}
      autoCapitalize="none"
      placeholderTextColor={colors.faint}
      {...props}
      style={[styles.input, style]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    height: 28,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    backgroundColor: colors.bg,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
});
