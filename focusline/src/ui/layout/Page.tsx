import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { PageHeader } from '../components/PageHeader';
import type { PageHeaderProps } from '../components/PageHeader';
import { useGutter } from '../lib/hooks';
import { colors, layout, space } from '../theme';

export interface PageProps {
  header?: PageHeaderProps;
  testID?: string;
  children?: ReactNode;
  bodyStyle?: StyleProp<ViewStyle>;
}

/** Scrollable page: full-width cover header, then a centred column (max 900, 48 px side padding). */
export function Page({ header, testID, children, bodyStyle }: PageProps) {
  return (
    <ScrollView testID={testID} style={styles.scroll} contentContainerStyle={styles.content}>
      {header ? <PageHeader {...header} /> : null}
      <PageBody style={bodyStyle}>{children}</PageBody>
    </ScrollView>
  );
}

export function PageBody({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const pad = useGutter();
  return <View style={[styles.column, { paddingHorizontal: pad }, style]}>{children}</View>;
}

/** Section heading with a hairline under it, Notion-style. */
export function Section({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.section, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 96, flexGrow: 1 },
  column: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
    paddingTop: space.xl,
  },
  section: { marginTop: space.xxl },
});
