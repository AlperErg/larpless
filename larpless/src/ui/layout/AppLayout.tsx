import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Animated, Easing, View } from 'react-native';
import type { Route } from '../../store/navStore';
import { colors, motion, themed } from '../theme';
import { ErrorBoundary } from './ErrorBoundary';
import { Sidebar } from './Sidebar';

export interface AppLayoutProps {
  route: Route;
  children?: ReactNode;
}

/** Sidebar + content. Route changes fade the content in (200 ms) with an 8 px upward slide. */
export function AppLayout({ route, children }: AppLayoutProps) {
  const t = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    t.setValue(0);
    Animated.timing(t, {
      toValue: 1,
      duration: motion.base,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    return () => t.stopAnimation();
  }, [route, t]);
  const translateY = useMemo(() => t.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }), [t]);
  return (
    <View style={styles.root}>
      <Sidebar />
      <Animated.View testID="content" style={[styles.content, { opacity: t, transform: [{ translateY }] }]}>
        <ErrorBoundary where={route}>{children}</ErrorBoundary>
      </Animated.View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  content: { flex: 1, backgroundColor: colors.bg },
}));
