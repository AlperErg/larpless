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
      style={[styles.box, styles.text, style, border]}
    />
  );
}

/**
 * macOS 27 crashes inside react-native-macos' NSSecureTextField when it
 * becomes first responder. Keep the native input as a normal text field and
 * render a mask over its value instead. The input fills the box (so the caret
 * sits where a plain field's would) and the mask is drawn over its text rect.
 */
function MaskedTextField({ style, ...props }: MacTextInputProps) {
  const value = typeof props.value === 'string' ? props.value : '';
  const placeholder = typeof props.placeholder === 'string' ? props.placeholder : '';

  return (
    <View style={[styles.box, style]}>
      <MacTextInput
        {...props}
        secureTextEntry={false}
        enableFocusRing={false}
        autoCorrect={false}
        autoCapitalize="none"
        placeholderTextColor="transparent"
        style={[styles.text, styles.maskedInput]}
      />
      <NativeText pointerEvents="none" numberOfLines={1} style={[styles.mask, !value && styles.placeholder]}>
        {value ? '\u2022'.repeat(value.length) : placeholder}
      </NativeText>
    </View>
  );
}

/** Horizontal padding inside the border. */
const PAD_X = space.sm + 2;
/**
 * react-native-macos turns `padding` into the NSTextField cell's text inset and draws the
 * line from the top of it, so a fixed-height field needs vertical padding to centre the
 * text: (32 − 2 border − ~17 line) / 2. Windows' TextBox centres on its own.
 */
const PAD_Y = IS_WINDOWS ? 0 : Math.floor((layout.controlHeight - 2 - 17) / 2);
/** NSTextFieldCell insets its text 2pt from the left of the title rect; the mask has to match. */
const CELL_INSET_X = 2;

const styles = themed(() => StyleSheet.create({
  box: {
    height: layout.controlHeight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    backgroundColor: colors.raised,
  },
  text: {
    paddingHorizontal: PAD_X,
    paddingVertical: PAD_Y,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  focused: { borderColor: colors.accent },
  maskedInput: {
    flex: 1,
    color: 'transparent',
    backgroundColor: 'transparent',
  },
  mask: {
    position: 'absolute',
    left: PAD_X + CELL_INSET_X,
    right: PAD_X,
    top: PAD_Y,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  placeholder: {
    color: colors.faint,
  },
}));
