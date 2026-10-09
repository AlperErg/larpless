import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { TagColor } from '../../contracts/domain';
import { radius, space, tag } from '../theme';

export interface CalloutProps {
  emoji: string;
  /** Background tone; Notion's default callout is gray. */
  tone?: TagColor;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/** Notion callout: emoji on the left, soft background, radius 4, padding 12. */
export function Callout({ emoji, tone = 'gray', testID, style, children }: CalloutProps) {
  return (
    <View testID={testID} style={[styles.box, { backgroundColor: tag[tone].bg }, style]}>
      <RNText style={styles.emoji}>{emoji}</RNText>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: radius,
    padding: space.md,
  },
  emoji: { fontSize: 18, lineHeight: 22, marginRight: space.sm + 2 },
  body: { flex: 1, minHeight: 22, justifyContent: 'center' },
});
