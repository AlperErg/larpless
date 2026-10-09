import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { TagColor } from '../../contracts/domain';
import { space } from '../theme';
import { Tag } from './Tag';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  icon?: string;
}

export interface SegmentedProps<T extends string | number> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Colour of the selected chip (others are gray). */
  color?: TagColor;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Row of Tag-like chips (e.g. Off / 25/5 / 50/10, or 2 / 5 / 10 min). */
export function Segmented<T extends string | number>({ options, value, onChange, color = 'blue', testID, style }: SegmentedProps<T>) {
  return (
    <View testID={testID} style={[styles.row, style]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Tag
            key={String(o.value)}
            testID={`${testID ?? 'segmented'}-${o.value}`}
            label={o.label}
            icon={o.icon}
            color={selected ? color : 'gray'}
            selected={selected}
            onPress={() => onChange(o.value)}
            style={styles.chip}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  chip: { marginRight: space.xs + 2, marginVertical: 2 },
});
