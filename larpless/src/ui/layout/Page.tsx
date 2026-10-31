import { useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { PageHeader } from '../components/PageHeader';
import type { PageHeaderProps } from '../components/PageHeader';
import { useGutter } from '../lib/hooks';
import { PIN_PAGE_HEADER } from '../platform';
import { colors, layout, space, themed } from '../theme';

export interface PageProps {
  header?: PageHeaderProps;
  testID?: string;
  children?: ReactNode;
  bodyStyle?: StyleProp<ViewStyle>;
}

/** Scrollable page: full-width cover header, then a centred column (max 900, 48 px side padding). */
export function Page({ header, testID, children, bodyStyle }: PageProps) {
  return (
    <PageScroll testID={testID} header={header ? <PageHeader {...header} /> : null} contentContainerStyle={styles.content}>
      <PageBody style={bodyStyle}>{children}</PageBody>
    </PageScroll>
  );
}

/**
 * Header plus a scrolling body. On Windows the header stays put (`PIN_PAGE_HEADER`);
 * elsewhere it scrolls away with the content.
 */
export function PageScroll({
  testID,
  header,
  children,
  contentContainerStyle,
}: {
  testID?: string;
  header?: ReactNode;
  children?: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  if (PIN_PAGE_HEADER) {
    return (
      <View testID={testID} style={styles.frame}>
        {header}
        {/* The ScrollViewer itself does not clip, so moving rows paint over the title. */}
        <View style={styles.clip} collapsable={false}>
          <FittedScroll style={styles.scroll} contentContainerStyle={contentContainerStyle}>
            {children}
          </FittedScroll>
        </View>
      </View>
    );
  }
  return (
    <FittedScroll testID={testID} style={styles.scroll} contentContainerStyle={contentContainerStyle}>
      {header}
      {children}
    </FittedScroll>
  );
}

/** Bottom gutter inside the scroll content. Ignored when deciding if the page needs to scroll. */
const END_PAD = 96;

/**
 * Scroll only when the real content is taller than the page. The end gutter must not
 * turn a page that already shows everything into a scrolling one.
 */
function FittedScroll({
  testID,
  style,
  contentContainerStyle,
  children,
}: {
  testID?: string;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const [viewport, setViewport] = useState(0);
  const [contentH, setContentH] = useState(0);
  const scrollable = viewport === 0 || contentH === 0 || contentH - END_PAD > viewport + 1;
  const onLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    setViewport((prev) => (prev === h ? prev : h));
  };
  const onContentSizeChange = (_w: number, h: number) => {
    const next = Math.round(h);
    setContentH((prev) => (prev === next ? prev : next));
  };
  return (
    <ScrollView
      testID={testID}
      style={style}
      contentContainerStyle={contentContainerStyle}
      scrollEnabled={scrollable}
      showsVerticalScrollIndicator={scrollable}
      bounces={scrollable}
      alwaysBounceVertical={false}
      overScrollMode={scrollable ? 'auto' : 'never'}
      keyboardShouldPersistTaps={PIN_PAGE_HEADER ? 'handled' : undefined}
      onLayout={onLayout}
      onContentSizeChange={onContentSizeChange}>
      {children}
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

const styles = themed(() => StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.bg },
  clip: { flex: 1, overflow: 'hidden' },
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: END_PAD, ...(PIN_PAGE_HEADER ? null : { flexGrow: 1 }) },
  column: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
    paddingTop: space.xl,
  },
  section: { marginTop: space.xxl },
}));
