/**
 * Pages only *look* fitted when their content fits: the gutter, scrollbar and rubber band follow
 * the measured height, but the scroll view is never switched off (#51: courses were added to a
 * page that started short, the new height never reached the decision, and the rows below the fold
 * could not be reached at all).
 *
 * Jest never lays anything out, so the tests report the sizes native would: the page's viewport,
 * the content wrapper's own height and - separately - the scroll view's content size.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import type { StudyModule } from '../../src/contracts/domain';
import { initialAppState, useAppStore } from '../../src/store/appStore';
import { ModulesPage } from '../../src/ui/pages/ModulesPage';
import { Page } from '../../src/ui/layout/Page';

const VIEWPORT = 800;

/**
 * The page's scroll view, found by its props rather than by testID: on Windows the page's testID
 * sits on the frame that pins the header outside the scroller (see pageScrollWindows.test.tsx).
 */
function scrollView(r: ReactTestRenderer): ReactTestInstance {
  const hit = r.root.findAll(
    (n) => n.props.scrollEnabled === true && typeof n.props.onContentSizeChange === 'function' && typeof n.props.onLayout === 'function',
  )[0];
  if (!hit) throw new Error('no scroll view');
  return hit;
}
function wrapper(r: ReactTestRenderer): ReactTestInstance {
  const hit = r.root.findAll((n) => n.props.testID === 'page-scroll-content' && typeof n.props.onLayout === 'function')[0];
  if (!hit) throw new Error('no content wrapper');
  return hit;
}
const scrollEnabled = (r: ReactTestRenderer) => scrollView(r).props.scrollEnabled;
const indicator = (r: ReactTestRenderer) => scrollView(r).props.showsVerticalScrollIndicator;
/** The end gutter exists only while the page scrolls. */
const gutter = (r: ReactTestRenderer) => r.root.findAll((n) => n.props.testID === 'page-scroll-end').length > 0;

/** A View reporting its own frame, as native does. */
function frame(n: ReactTestInstance, height: number) {
  act(() => n.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 600, height } } }));
}
/** The scroll view's own content-size report (it counts the end gutter when there is one). */
function contentSize(r: ReactTestRenderer, height: number) {
  act(() => scrollView(r).props.onContentSizeChange(600, height));
}
const viewport = (r: ReactTestRenderer, height = VIEWPORT) => frame(scrollView(r), height);
/** The content wrapper's height: what the page actually renders, without the end gutter. */
const content = (r: ReactTestRenderer, height: number) => frame(wrapper(r), height);

function renderPage(height: number): ReactTestRenderer {
  let r: ReactTestRenderer;
  act(() => {
    r = create(
      <Page testID="page-test" header={{ icon: 'library', title: 'Test' }}>
        <Text>Body</Text>
      </Page>,
    );
  });
  viewport(r!);
  content(r!, height);
  contentSize(r!, height);
  return r!;
}

describe('FittedScroll', () => {
  it('leaves a page that fits still: no gutter, no scrollbar', () => {
    const r = renderPage(700);
    expect(gutter(r)).toBe(false);
    expect(indicator(r)).toBe(false);
    expect(scrollView(r).props.bounces).toBe(false);
    expect(scrollView(r).props.overScrollMode).toBe('never');
    act(() => r.unmount());
  });

  it('a page taller than the window gets the end gutter and the scrollbar', () => {
    const r = renderPage(1200);
    expect(gutter(r)).toBe(true);
    expect(indicator(r)).toBe(true);
    expect(scrollView(r).props.bounces).toBe(true);
    act(() => r.unmount());
  });

  // Never switched off, whatever the measurement says: a wrong height may cost a gutter, not the content.
  it('never disables scrolling', () => {
    for (const height of [10, 700, 1200]) {
      const r = renderPage(height);
      expect(scrollEnabled(r)).toBe(true);
      act(() => r.unmount());
    }
  });

  it('the end gutter alone never counts as content that overflows', () => {
    const r = renderPage(704); // 704 + the 96 px gutter = 800 = the viewport
    contentSize(r, 800);
    expect(gutter(r)).toBe(false);
    act(() => r.unmount());
  });

  // The reported bug: the page fitted, rows were added, and the scroll view never reported again.
  it('lifts the still page when the content wrapper grows, even if the content size never updates', () => {
    const r = renderPage(400);
    expect(gutter(r)).toBe(false);

    content(r, 1400);
    expect(gutter(r)).toBe(true);
    expect(indicator(r)).toBe(true);

    // Removing the rows fits the page again; a stale content size must not keep it scrolling.
    content(r, 400);
    expect(gutter(r)).toBe(false);
    act(() => r.unmount());
  });

  it('also trusts the scroll view when it reports more than the wrapper', () => {
    const r = renderPage(400);
    expect(gutter(r)).toBe(false);
    contentSize(r, 1200);
    expect(gutter(r)).toBe(true);
    act(() => r.unmount());
  });

  it('treats an unmeasured page as one that may overflow', () => {
    let r: ReactTestRenderer;
    act(() => {
      r = create(
        <Page testID="page-test" header={{ icon: 'library', title: 'Test' }}>
          <Text>Body</Text>
        </Page>,
      );
    });
    expect(scrollEnabled(r!)).toBe(true);
    expect(gutter(r!)).toBe(true);
    expect(indicator(r!)).toBe(true);
    act(() => r!.unmount());
  });
});

describe('Subjects page with a long course list (#51)', () => {
  const courses: StudyModule[] = Array.from({ length: 14 }, (_, i) => ({
    id: `mod_${i}`,
    name: `Course ${i + 1}`,
    color: 'blue',
    keywords: [`topic${i}`],
  }));

  /** Distinct rows: the composite and its host view share the testID. */
  const rows = (r: ReactTestRenderer) =>
    new Set(
      r.root
        .findAll((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('module-row-'))
        .map((n) => n.props.testID as string),
    ).size;

  beforeEach(async () => {
    jest.useFakeTimers();
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    act(() => useAppStore.setState({ ...initialAppState }));
  });

  it('renders every course, and scrolls to the last one and to the library once rows are added', async () => {
    act(() => useAppStore.setState({ modules: courses }));
    let r: ReactTestRenderer;
    act(() => {
      r = create(<ModulesPage />);
    });
    // The table has no scroll container of its own: every course is a row, and the library is below them.
    expect(rows(r!)).toBe(courses.length);
    expect(r!.root.findAll((n) => n.props.testID === 'modules-library').length).toBeGreaterThan(0);

    // A short page: the table ends well above the window, so nothing scrolls yet.
    viewport(r!, 900);
    content(r!, 500);
    contentSize(r!, 500);
    expect(gutter(r!)).toBe(false);
    expect(indicator(r!)).toBe(false);
    expect(scrollEnabled(r!)).toBe(true);

    // ＋ New: one more row. Only the wrapper reports its new height - as on Windows, where the
    // scroll view's content size stayed at the old one - and the page must still reach it.
    const add = r!.root.findAll((n) => n.props.testID === 'module-new' && typeof n.props.onPress === 'function')[0];
    await act(async () => add.props.onPress());
    expect(rows(r!)).toBe(courses.length + 1);
    content(r!, 1500);
    expect(gutter(r!)).toBe(true);
    expect(indicator(r!)).toBe(true);
    expect(scrollEnabled(r!)).toBe(true);

    act(() => r!.unmount());
  });
});
