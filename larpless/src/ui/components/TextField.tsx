import { StyleSheet, Text as NativeText, View } from 'react-native';
import { colors, fonts, radius, space } from '../theme';
import { MacTextInput } from './mac';
import type { MacTextInputProps } from './mac';

/** 28 px bordered Notion input. */
export function TextField({ style, ...props }: MacTextInputProps) {
  if (props.secureTextEntry) {
    return <MaskedTextField style={style} {...props} />;
  }

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

/**
 * macOS 27 crashes inside react-native-macos' NSSecureTextField when it
 * becomes first responder. Keep the native input as a normal text field and
 * render a mask over its value instead.
 */
function MaskedTextField({ style, ...props }: MacTextInputProps) {
  const value = typeof props.value === 'string' ? props.value : '';
  const placeholder = typeof props.placeholder === 'string' ? props.placeholder : '';

  return (
    <View style={[styles.input, style]}>
      <MacTextInput
        {...props}
        secureTextEntry={false}
        enableFocusRing={false}
        autoCorrect={false}
        autoCapitalize="none"
        placeholderTextColor="transparent"
        style={[styles.maskedInput, styles.maskedInputLayout]}
      />
      <NativeText pointerEvents="none" style={[styles.mask, !value && styles.placeholder]}>
        {value ? '•'.repeat(value.length) : placeholder}
      </NativeText>
    </View>
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
  maskedInput: {
    color: 'transparent',
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  maskedInputLayout: {
    height: 28,
    paddingHorizontal: space.sm,
  },
  mask: {
    position: 'absolute',
    left: space.sm,
    right: space.sm,
    top: 0,
    height: 28,
    lineHeight: 26,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  placeholder: {
    color: colors.faint,
  },
});
