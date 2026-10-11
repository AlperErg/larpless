import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ChunkKind } from '../../contracts/domain';
import { kindColor, tag } from '../theme';
import { ANIMATE } from '../platform';

export type DotKind = ChunkKind | 'break' | 'paused' | 'starting';

export interface StatusDotProps {
  kind: DotKind;
  /** Pulse (scale 1 ↔ 1.6 + fade) while a session is running. */
  pulsing?: boolean;
  size?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** 8 px dot: subject = green, distracted = red, away = gray, break = blue. */
export function StatusDot({ kind, pulsing, size = 8, testID, style }: StatusDotProps) {
  const fill = tag[kindColor[kind]].text;
  const t = useRef(new Animated.Value(0)).current;

  const pulse = pulsing && ANIMATE;
  useEffect(() => {
    if (!pulse) {
      t.stopAnimation();
      t.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(400),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, t]);

  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  const box = size * 2;
  return (
    <View testID={testID} style={[{ width: box, height: box }, styles.box, style]}>
      {pulse ? (
        <Animated.View
          style={[
            styles.abs,
            { width: size, height: size, borderRadius: size / 2, backgroundColor: fill, opacity, transform: [{ scale }] },
          ]}
        />
      ) : null}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: fill }} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  abs: { position: 'absolute' },
});
