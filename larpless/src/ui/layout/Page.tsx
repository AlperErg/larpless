import { useEffect, useRef, useState } from 'react';
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

/** Bottom gutter under the content, drawn only when the page scrolls. */
const END_PAD = 96;

/**
 * Scrolling page. A page whose content fits looks fitted - no end gutter, no scrollbar, no rubber
 * band - but the scroll view itself is never switched off. Switching it off is what stranded the
 * Subjects table (#51: courses were added to a page that started short, the new height never
 * reached that decision, and the rows below the fold became unreachable). A height report that
 * arrives late or not at all can now only cost a gutter, never the content.
 *
 * The height comes from two reports, and the larger wins:
 * - the wrapper View's own layout: plain Yoga, re-fires whenever rows are added or removed;
 * - the scroll view's content size, minus the gutter: the platform's own idea of the content,
 *   which some platforms report late or clamped.
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
  const [wrappedH, setWrappedH] = useState(0);
  const [scrollH, setScrollH] = useState(0);
  const contentH = Math.max(wrappedH, scrollH - END_PAD);
  // Unknown sizes count as scrollable: assume the content may not fit rather than hide it.
  const scrollable = viewport === 0 || contentH === 0 || contentH > viewport + 1;
  const ref = useRef<ScrollView>(null);
  // A page that fits again (rows removed, window grown) returns to the top: otherwise a shrunk
  // scroll range can leave it parked at an offset with no way back on Windows.
  useEffect(() => {
    if (!scrollable) ref.current?.scrollTo({ y: 0, animated: false });
  }, [scrollable]);
  const onLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    setViewport((prev) => (prev === h ? prev : h));
  };
  const onContentSizeChange = (_w: number, h: number) => {
    const next = Math.round(h);
    setScrollH((prev) => (prev === next ? prev : next));
  };
  const onContentLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.height);
    setWrappedH((prev) => (prev === next ? prev : next));
  };
  return (
    <ScrollView
      ref={ref}
      testID={testID}
      style={style}
      contentContainerStyle={contentContainerStyle}
      scrollEnabled
      showsVerticalScrollIndicator={scrollable}
      bounces={scrollable}
      // react-native-macos maps this to NSScrollView elasticity for every page; leave the Mac's rubber band alone.
      alwaysBounceVertical={PIN_PAGE_HEADER ? false : undefined}
      overScrollMode={scrollable ? 'auto' : 'never'}
      keyboardShouldPersistTaps={PIN_PAGE_HEADER ? 'handled' : undefined}
      onLayout={onLayout}
      onContentSizeChange={onContentSizeChange}>
      <View testID="page-scroll-content" collapsable={false} onLayout={onContentLayout}>
        {children}
      </View>
      {scrollable ? <View testID="page-scroll-end" style={styles.endPad} /> : null}
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
  content: { ...(PIN_PAGE_HEADER ? null : { flexGrow: 1 }) },
  endPad: { height: END_PAD },
  column: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
    paddingTop: space.xl,
  },
  section: { marginTop: space.xxl },
}));
