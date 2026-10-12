import { StyleSheet, Text as RNText, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, fonts, radius, space, themed } from '../theme';
import { Icon } from './Icon';

export interface PrivacyBadgeProps {
  framesAnalysed: number;
  checksWithoutScreenshot: number;
  /** Always 0 by design; shown so the promise is visible. */
  framesStored?: 0;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** "Screenshots analysed: N · checks without a screenshot: M · stored: 0" */
export function PrivacyBadge({ framesAnalysed, checksWithoutScreenshot, framesStored = 0, testID, style }: PrivacyBadgeProps) {
  return (
    <View
      testID={testID}
      accessibilityLabel={`Screenshots analysed ${framesAnalysed}, checks without a screenshot ${checksWithoutScreenshot}, stored ${framesStored}`}
      style={[styles.badge, style]}>
      <Icon name="lock" size={13} color={colors.muted} />
      <RNText style={styles.text}>
        Screenshots analysed: <RNText style={styles.num}>{framesAnalysed}</RNText>
        {' · '}checks without a screenshot: <RNText style={styles.num}>{checksWithoutScreenshot}</RNText>
        {' · '}stored: <RNText style={styles.num}>{framesStored}</RNText>
      </RNText>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
  },
  text: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.muted },
  num: { fontFamily: fonts.semibold, color: colors.text },
}));
