import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { MODULE_PRESET_GROUPS } from '../lib/modulePresets';
import type { ModulePreset } from '../lib/modulePresets';
import { space } from '../theme';
import { Tag } from './Tag';
import { Text } from './Text';

export interface ModulePresetsProps {
  /** Names already in the table (compared case-insensitively); those presets show as added. */
  existingNames: string[];
  onAdd: (preset: ModulePreset) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** "Suggested modules": grouped one-click tags that add a pre-filled row (name, colour, keywords). */
export function ModulePresets({ existingNames, onAdd, testID, style }: ModulePresetsProps) {
  const existing = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  return (
    <View testID={testID} style={style}>
      <Text variant="small" muted style={styles.lead}>
        Suggested modules: click one to add it with ready-made keywords, then edit it like any other row.
      </Text>
      {MODULE_PRESET_GROUPS.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text variant="small" weight="medium" style={styles.groupTitle}>
            {group.title}
          </Text>
          <View style={styles.tags}>
            {group.presets.map((p) => {
              const added = existing.has(p.name.toLowerCase());
              return (
                <Tag
                  key={p.name}
                  testID={`preset-${p.name}`}
                  label={added ? `${p.name} ✓` : p.name}
                  icon={p.emoji}
                  color={added ? 'gray' : p.color}
                  tooltip={added ? 'Already added' : p.keywords.join(', ')}
                  onPress={added ? undefined : () => onAdd(p)}
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
  lead: { marginBottom: space.sm },
  group: { marginBottom: space.sm },
  groupTitle: { marginBottom: space.xs },
  tags: { flexDirection: 'row', flexWrap: 'wrap' },
  tag: { marginRight: space.xs, marginBottom: space.xs },
});
