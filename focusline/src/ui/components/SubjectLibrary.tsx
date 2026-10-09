import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SUBJECT_GROUPS } from '../../core/subjectLibrary';
import { space } from '../theme';
import { Tag } from './Tag';
import { Text } from './Text';

export interface SubjectLibraryProps {
  /** Names the user overrides with their own course (shown as "yours"). */
  overriddenNames?: string[];
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Read-only view of the built-in subjects Focusline recognises automatically (hover a tag for its keywords). */
export function SubjectLibrary({ overriddenNames = [], testID, style }: SubjectLibraryProps) {
  const overridden = new Set(overriddenNames.map((n) => n.trim().toLowerCase()));
  return (
    <View testID={testID} style={style}>
      {SUBJECT_GROUPS.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text variant="small" weight="medium" style={styles.groupTitle}>
            {group.title}
          </Text>
          <View style={styles.tags}>
            {group.presets.map((s) => {
              const mine = overridden.has(s.name.toLowerCase());
              return (
                <Tag
                  key={s.name}
                  testID={`subject-${s.name}`}
                  label={mine ? `${s.name} (yours)` : s.name}
                  icon={s.emoji}
                  color={s.color}
                  tooltip={mine ? 'Replaced by your own course' : s.keywords.join(', ')}
                  style={styles.tag}
                />
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: space.sm },
  groupTitle: { marginBottom: space.xs },
  tags: { flexDirection: 'row', flexWrap: 'wrap' },
  tag: { marginRight: space.xs, marginBottom: space.xs },
});
