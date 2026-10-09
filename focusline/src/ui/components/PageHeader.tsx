import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing, StyleSheet, Text as RNText, View } from 'react-native';
import type { TagColor } from '../../contracts/domain';
import { useGutter } from '../lib/hooks';
import { colors, layout, motion, space, tag } from '../theme';
import { Text } from './Text';

export interface PageHeaderProps {
  icon: string;
  title: string;
  /** Cover strip colour: a subject's tag colour, or the sidebar beige when omitted. */
  cover?: TagColor | null;
  subtitle?: ReactNode;
  /** Optional element on the title row's right (e.g. a button). */
  right?: ReactNode;
  testID?: string;
}

/** Notion page header: full-width 120 px cover strip, 48 px emoji icon overlapping it, serif title. */
export function PageHeader({ icon, title, cover, subtitle, right, testID }: PageHeaderProps) {
  const target = cover ? tag[cover].bg : colors.sidebar;
  const [layers, setLayers] = useState({ under: target, over: target });
  const fade = useRef(new Animated.Value(1)).current;
  const gutter = useGutter();

  useEffect(() => {
    if (target === layers.over) return;
    // Cross-fade the cover to the new subject colour.
    setLayers((l) => ({ under: l.over, over: target }));
    fade.setValue(0);
    Animated.timing(fade, {
      toValue: 1,
      duration: motion.slow,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View testID={testID}>
      <View style={[styles.cover, { backgroundColor: layers.under }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: layers.over, opacity: fade }]} />
      </View>
      <View style={[styles.column, { paddingHorizontal: gutter }]}>
        <RNText style={styles.icon}>{icon}</RNText>
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
  icon: { fontSize: 48, lineHeight: 64, height: 64, marginTop: -34, alignSelf: 'flex-start' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: space.xs },
  title: { flex: 1 },
  right: { marginLeft: space.lg, paddingBottom: space.sm },
  subtitle: { marginTop: space.xs, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
});
