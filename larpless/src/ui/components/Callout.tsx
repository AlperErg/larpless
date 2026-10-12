import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { TagColor } from '../../contracts/domain';
import { radius, space, tag } from '../theme';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export interface CalloutProps {
  icon: IconName;
  /** Background tone; the default callout is gray. */
  tone?: TagColor;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/** Soft banner with a stroke icon on the left. */
export function Callout({ icon, tone = 'gray', testID, style, children }: CalloutProps) {
  const toneColor = tag[tone].text;
  return (
    <View testID={testID} style={[styles.box, { backgroundColor: tag[tone].bg }, style]}>
      <View style={styles.icon}>
        <Icon name={icon} size={16} color={toneColor} />
      </View>
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
    gap: space.sm + 2,
  },
  icon: { height: 22, justifyContent: 'center' },
  body: { flex: 1, minHeight: 22, justifyContent: 'center' },
});
