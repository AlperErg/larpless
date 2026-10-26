import { useState } from 'react';
import { StyleSheet, Text as NativeText, View } from 'react-native';
import { IS_WINDOWS } from '../platform';
import { colors, fonts, layout, radius, space, themed } from '../theme';
import { MacTextInput } from './mac';
import type { MacTextInputProps } from './mac';

/** White field on the canvas. The border turns cobalt while it is focused. */
export function TextField({ style, onFocus, onBlur, ...props }: MacTextInputProps) {
  const [focused, setFocused] = useState(false);
  const border = focused ? styles.focused : null;
  const handleFocus: MacTextInputProps['onFocus'] = (e) => {
    setFocused(true);
    onFocus?.(e);
  };
  const handleBlur: MacTextInputProps['onBlur'] = (e) => {
    setFocused(false);
    onBlur?.(e);
  };

  // Windows draws `color: 'transparent'` text, so the overlay mask would show the value through;
  // its native password box is fine there.
  if (props.secureTextEntry && !IS_WINDOWS) {
    return <MaskedTextField style={[style, border]} {...props} onFocus={handleFocus} onBlur={handleBlur} />;
  }

  return (
    <MacTextInput
      enableFocusRing={false}
      autoCorrect={false}
      autoCapitalize="none"
      placeholderTextColor={colors.faint}
      {...props}
      onFocus={handleFocus}
      onBlur={handleBlur}
      style={[styles.input, style, border]}
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

const styles = themed(() => StyleSheet.create({
  input: {
    height: layout.controlHeight,
    paddingHorizontal: space.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    backgroundColor: colors.raised,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  focused: { borderColor: colors.accent },
  maskedInput: {
    color: 'transparent',
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  maskedInputLayout: {
    height: layout.controlHeight,
    paddingHorizontal: space.sm + 2,
  },
  mask: {
    position: 'absolute',
    left: space.sm + 2,
    right: space.sm + 2,
    top: 0,
    height: layout.controlHeight,
    lineHeight: 26,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  placeholder: {
    color: colors.faint,
  },
}));
