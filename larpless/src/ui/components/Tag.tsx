import { useState } from 'react';
import { StyleSheet, Text as RNText } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { TagColor } from '../../contracts/domain';
import { fonts, radius, tag } from '../theme';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { MacPressable, MacView } from './mac';

export interface TagProps {
  label: string;
  color?: TagColor;
  selected?: boolean;
  onPress?: () => void;
  /** Leading stroke icon. */
  icon?: IconName;
  tooltip?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Notion pill: tag bg + tag text, 12 px Medium, radius 4, padding 2×6. `selected` adds a 1 px ring. */
export function Tag({ label, color = 'gray', selected, onPress, icon, tooltip, testID, style }: TagProps) {
  const [hover, setHover] = useState(false);
  const tone = tag[color];
  const body = (
    <>
      {icon ? <Icon name={icon} size={12} color={tone.text} strokeWidth={2} /> : null}
      <RNText numberOfLines={1} style={[styles.label, { color: tone.text }]}>
        {label}
      </RNText>
    </>
  );
  const pillStyle = [
    styles.pill,
    { backgroundColor: tone.bg, borderColor: selected ? tone.text : 'transparent' },
    hover && onPress ? styles.hover : null,
    style,
  ];
  if (!onPress) {
    return (
      <MacView testID={testID} tooltip={tooltip} style={pillStyle}>
        {body}
      </MacView>
    );
  }
  return (
    <MacPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      tooltip={tooltip}
      enableFocusRing={false}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={pillStyle}>
      {body}
    </MacPressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    gap: 4,
  },
  label: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 },
  hover: { opacity: 0.8 },
});
