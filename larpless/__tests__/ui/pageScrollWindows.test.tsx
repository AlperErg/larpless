/**
 * The same page on Windows, where `PIN_PAGE_HEADER` keeps the cover and title out of the scroller
 * (#51 was reported from the Windows build, and that extra clipping view is only in this path).
 */
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { Page } from '../../src/ui/layout/Page';

jest.mock('../../src/ui/platform', () => ({
  ...jest.requireActual('../../src/ui/platform'),
  IS_WINDOWS: true,
  PIN_PAGE_HEADER: true,
}));

/** The scroll view carries no testID here: the page's testID is on the frame around it. */
function scrollView(r: ReactTestRenderer): ReactTestInstance {
  const hit = r.root.findAll(
    (n) => n.props.scrollEnabled === true && typeof n.props.onContentSizeChange === 'function' && typeof n.props.onLayout === 'function',
  )[0];
  if (!hit) throw new Error('no scroll view');
  return hit;
}
const wrapper = (r: ReactTestRenderer) => {
  const hit = r.root.findAll((n) => n.props.testID === 'page-scroll-content' && typeof n.props.onLayout === 'function')[0];
  if (!hit) throw new Error('no content wrapper');
  return hit;
};
const gutter = (r: ReactTestRenderer) => r.root.findAll((n) => n.props.testID === 'page-scroll-end').length > 0;

function frame(n: ReactTestInstance, height: number) {
  act(() => n.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 600, height } } }));
}

function textOf(node: ReactTestInstance | ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (n == null) return;
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (typeof n === 'object' && 'children' in (n as object)) walk((n as { children: unknown }).children);
  };
  walk('toJSON' in node ? node.toJSON() : node);
  return out.join('');
}

function renderPage(): ReactTestRenderer {
  let r: ReactTestRenderer;
  act(() => {
    r = create(
      <Page testID="page-test" header={{ icon: 'library', title: 'Pinned title' }}>
        <Text>Body</Text>
      </Page>,
    );
  });
  frame(scrollView(r!), 600);
  return r!;
}

describe('on Windows', () => {
  it('pins the header outside the scroller', () => {
    const r = renderPage();
    expect(textOf(wrapper(r))).not.toContain('Pinned title');
    expect(textOf(r)).toContain('Pinned title');
    act(() => r.unmount());
  });

  it('scrolls to rows added below the fold, even when the content size never updates', () => {
    const r = renderPage();
    frame(wrapper(r), 300);
    act(() => scrollView(r).props.onContentSizeChange(600, 300));
    expect(gutter(r)).toBe(false);
    expect(scrollView(r).props.showsVerticalScrollIndicator).toBe(false);

    // Rows are added: only the wrapper reports its new height.
    frame(wrapper(r), 1500);
    expect(gutter(r)).toBe(true);
    expect(scrollView(r).props.showsVerticalScrollIndicator).toBe(true);
    expect(scrollView(r).props.scrollEnabled).toBe(true);
    act(() => r.unmount());
  });

  it('never switches scrolling off, whatever the height report says', () => {
    const r = renderPage();
    frame(wrapper(r), 10);
    act(() => scrollView(r).props.onContentSizeChange(600, 10));
    expect(gutter(r)).toBe(false);
    expect(scrollView(r).props.scrollEnabled).toBe(true);
    act(() => r.unmount());
  });
});
