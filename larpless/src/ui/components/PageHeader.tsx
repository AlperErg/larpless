import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { TagColor } from '../../contracts/domain';
import { useGutter } from '../lib/hooks';
import { colors, layout, motion, radius, space, tag } from '../theme';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { ANIMATE, MotionView } from '../platform';
import { Text } from './Text';

export interface PageHeaderProps {
  icon: IconName;
  title: string;
  /** Cover strip colour: a subject's tag colour, or the sidebar beige when omitted. */
  cover?: TagColor | null;
  subtitle?: ReactNode;
  /** Optional element on the title row's right (e.g. a button). */
  right?: ReactNode;
  testID?: string;
}

/** Short wash, then a raised icon tile and the serif title. */
export function PageHeader({ icon, title, cover, subtitle, right, testID }: PageHeaderProps) {
  const target = cover ? tag[cover].bg : colors.wash;
  const [layers, setLayers] = useState({ under: target, over: target });
  const fade = useRef(new Animated.Value(1)).current;
  const gutter = useGutter();

  useEffect(() => {
    if (target === layers.over) return;
    if (!ANIMATE) {
      setLayers({ under: target, over: target });
      return;
    }
    // Cross-fade the cover to the new subject colour.
    setLayers((l) => ({ under: l.over, over: target }));
    fade.setValue(0);
    Animated.timing(fade, {
      toValue: 1,
      duration: motion.slow,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
    return () => fade.stopAnimation();
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View testID={testID}>
      <View style={[styles.cover, { backgroundColor: layers.under }]}>
        <MotionView style={[StyleSheet.absoluteFill, { backgroundColor: layers.over, opacity: ANIMATE ? fade : 1 }]} />
      </View>
      <View style={[styles.column, { paddingHorizontal: gutter }]}>
        <View style={[styles.iconTile, { backgroundColor: colors.raised, borderColor: colors.border }]}>
          <Icon name={icon} size={20} color={colors.text} />
        </View>
        <View style={styles.titleRow}>
          <Text variant="title" style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {right ? <View style={styles.right}>{right}</View> : null}
        </View>
        {subtitle ? <View style={styles.subtitle}>{subtitle}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { height: layout.coverHeight, width: '100%', overflow: 'hidden' },
  column: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
  },
  iconTile: {
    width: 40,
    height: 40,
    marginTop: -20,
    borderRadius: radius,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: space.xs },
  title: { flex: 1 },
  right: { marginLeft: space.lg, paddingBottom: space.sm },
  subtitle: { marginTop: space.xs, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
});
