import { useState } from 'react';
import { Clipboard, StyleSheet, Text as RNText, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, fonts, radius, space } from '../theme';
import { MacPressable } from './mac';

export interface CodeBlockProps {
  code: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

function copy(text: string): boolean {
  try {
    // Deprecated in core but still shipped by react-native-macos 0.81; the text is also selectable.
    Clipboard.setString(text);
    return true;
  } catch {
    return false;
  }
}

/** Notion code block with a Copy button. */
export function CodeBlock({ code, testID, style }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  return (
    <View testID={testID} style={[styles.box, style]}>
      <RNText selectable style={styles.code}>
        {code}
      </RNText>
      <MacPressable
        accessibilityRole="button"
        accessibilityLabel="Copy"
        enableFocusRing={false}
        onPress={() => {
          if (copy(code)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }
        }}
        style={styles.copy}>
        <RNText style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</RNText>
      </MacPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.sidebar,
    borderRadius: radius,
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.md,
  },
  code: { flex: 1, fontFamily: fonts.mono, fontSize: 13, lineHeight: 18, color: colors.text },
  copy: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius },
  copyText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
});
