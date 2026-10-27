import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { StudyModule, TagColor } from '../../contracts/domain';
import { librarySubjectId, SUBJECT_GROUPS } from '../../core/subjectLibrary';
import { space } from '../theme';
import type { IconName } from './Icon';
import { Tag } from './Tag';
import { Text } from './Text';

export interface SubjectLibraryProps {
  /** Own courses, shown first as "Your courses" (only when `onToggle` is set). */
  courses?: readonly StudyModule[];
  /** Ids of subjects turned off: drawn gray and faded. */
  disabled?: readonly string[];
  /** Makes every tag a switch. Without it the library is read-only (onboarding). */
  onToggle?: (id: string) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

interface Item {
  id: string;
  name: string;
  icon?: IconName;
  color: TagColor;
  keywords: string[];
}

/** The built-in subjects LarpLess recognises (hover a tag for its keywords); click to turn one off or on. */
export function SubjectLibrary({ courses = [], disabled = [], onToggle, testID, style }: SubjectLibraryProps) {
  const off = new Set(disabled);
  const groups: { title: string; items: Item[] }[] = [
    ...(onToggle && courses.length ? [{ title: 'Your courses', items: courses.map((c) => ({ ...c })) }] : []),
    ...SUBJECT_GROUPS.map((g) => ({
      title: g.title,
      items: g.presets.map((s) => ({ ...s, id: librarySubjectId(s.name), icon: s.icon as IconName })),
    })),
  ];
  return (
    <View testID={testID} style={style}>
      {groups.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text variant="small" weight="medium" style={styles.groupTitle}>
            {group.title}
          </Text>
          <View style={styles.tags}>
            {group.items.map((s) => {
              const isOff = off.has(s.id);
              const hint = onToggle ? `${isOff ? 'Off. Click to turn on.' : 'On. Click to turn off.'}\n` : '';
              return (
                <Tag
                  key={s.name}
                  testID={`subject-${s.name}`}
                  label={s.name}
                  icon={s.icon}
                  color={isOff ? 'gray' : s.color}
                  tooltip={`${hint}${s.keywords.join(', ')}`}
                  onPress={onToggle ? () => onToggle(s.id) : undefined}
                  style={[styles.tag, isOff ? styles.off : null]}
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
  off: { opacity: 0.5 },
});
