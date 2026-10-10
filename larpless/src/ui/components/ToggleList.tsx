import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing, StyleSheet, Text as RNText, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, motion, radius, space } from '../theme';
import { ANIMATE, MotionView } from '../platform';
import { MacPressable } from './mac';

export interface ToggleItem {
  key: string;
  header: ReactNode;
  /** Rendered only while expanded. */
  body?: ReactNode | (() => ReactNode);
}

export interface ToggleListProps {
  items: ToggleItem[];
  /** Keys expanded initially (uncontrolled). */
  initiallyOpen?: string[];
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Notion toggle list: ▸ rotates 90° (150 ms) and the body expands below the row. */
export function ToggleList({ items, initiallyOpen, testID, style }: ToggleListProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initiallyOpen ?? []));
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  return (
    <View testID={testID} style={style}>
      {items.map((it) => (
        <ToggleRow key={it.key} item={it} open={open.has(it.key)} onToggle={() => toggle(it.key)} />
      ))}
    </View>
  );
}

export function ToggleRow({ item, open, onToggle }: { item: ToggleItem; open: boolean; onToggle: () => void }) {
  const [hover, setHover] = useState(false);
  const rot = useRef(new Animated.Value(open ? 1 : 0)).current;
  const fade = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    if (!ANIMATE) return undefined;
    Animated.timing(rot, {
      toValue: open ? 1 : 0,
      duration: motion.fast,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
    if (open) {
      fade.setValue(0);
      Animated.timing(fade, {
        toValue: 1,
        duration: motion.base,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
    }
    return () => {
      rot.stopAnimation();
      fade.stopAnimation();
    };
  }, [open, rot, fade]);

  const rotate = ANIMATE ? rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }) : open ? '90deg' : '0deg';
  const translateY = ANIMATE ? fade.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) : 0;
  const bodyOpacity = ANIMATE ? fade : 1;
  const body = typeof item.body === 'function' ? (item.body as () => ReactNode)() : item.body;

  return (
    <View>
      <MacPressable
        testID={`toggle-${item.key}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        enableFocusRing={false}
        onPress={onToggle}
        onHoverIn={() => setHover(true)}
        onHoverOut={() => setHover(false)}
        style={[styles.row, hover ? styles.rowHover : null]}>
        <MotionView style={[styles.chevronBox, { transform: [{ rotate }] }]}>
          <RNText style={styles.chevron}>▸</RNText>
        </MotionView>
        <View style={styles.header}>{item.header}</View>
      </MacPressable>
      {open && body != null ? (
        <MotionView style={[styles.body, { opacity: bodyOpacity, transform: [{ translateY }] }]}>{body}</MotionView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 30,
    paddingVertical: 3,
    paddingHorizontal: space.xs,
    borderRadius: radius,
  },
  rowHover: { backgroundColor: colors.hover },
  chevronBox: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  chevron: { fontSize: 12, lineHeight: 14, color: colors.muted },
  header: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  body: { paddingLeft: 26, paddingRight: space.xs, paddingTop: space.xs, paddingBottom: space.sm },
});
