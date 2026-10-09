import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import {
  BreakdownBar,
  Button,
  Callout,
  CodeBlock,
  EditableTable,
  Heatmap,
  PageHeader,
  PrivacyBadge,
  Segmented,
  SerifTimer,
  StatusDot,
  Switch,
  Tag,
  Text,
  ToggleList,
  heatLevel,
} from '../../src/ui/components';
import { fixtureSessions, fixtureSummary } from '../../src/fixtures/data';
import { formatClock, formatDuration, timeAgo } from '../../src/ui/lib/format';
import { draftsFromModules, modulesFromDrafts } from '../../src/ui/lib/modules';
import { fixtureModules } from '../../src/fixtures/data';

function render(el: React.ReactElement): ReactTestRenderer {
  let r: ReactTestRenderer;
  act(() => {
    r = create(el);
  });
  return r!;
}

function textOf(r: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (n == null) return;
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (typeof n === 'object' && 'children' in (n as object)) walk((n as { children: unknown }).children);
  };
  walk(r.toJSON());
  return out.join('');
}

afterEach(() => {
  jest.useRealTimers();
});

describe('UI primitives', () => {
  it('format helpers', () => {
    expect(formatClock(0)).toBe('0:00:00');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(24 * 60)).toBe('24m');
    expect(formatDuration(72 * 60)).toBe('1h 12m');
    expect(timeAgo(1000, 13_000)).toBe('12 s ago');
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(14)).toBe(1);
    expect(heatLevel(29)).toBe(2);
    expect(heatLevel(59)).toBe(3);
    expect(heatLevel(60)).toBe(4);
  });

  it('module drafts round-trip, drop blanks and duplicates', () => {
    const drafts = draftsFromModules(fixtureModules);
    expect(modulesFromDrafts(drafts)).toEqual(fixtureModules);
    const dup = [...drafts, { ...drafts[0], id: 'x', name: ' biology ' }, { ...drafts[0], id: 'y', name: '  ' }];
    expect(modulesFromDrafts(dup)).toHaveLength(3);
  });

  it('renders every primitive', () => {
    const r = render(
      <>
        <Text variant="title">Title</Text>
        <Text variant="small">small</Text>
        <Tag label="Biology" color="green" selected onPress={() => {}} />
        <Button title="Start session" variant="primary" size="lg" onPress={() => {}} />
        <Button title="End" variant="danger" />
        <Callout emoji="💡">
          <Text>Last check</Text>
        </Callout>
        <ToggleList
          initiallyOpen={['a']}
          items={[
            { key: 'a', header: <Text>Row A</Text>, body: <Text>Body A</Text> },
            { key: 'b', header: <Text>Row B</Text>, body: () => <Text>Body B</Text> },
          ]}
        />
        <BreakdownBar entries={fixtureSummary.breakdown} legend legendTime />
        <SerifTimer timer={{ baseS: 3723, runningSinceMs: null }} />
        <StatusDot kind="subject" pulsing />
        <PrivacyBadge framesAnalysed={14} checksWithoutScreenshot={31} />
        <Heatmap sessions={fixtureSessions} />
        <PageHeader icon="🎯" title="Focus session" cover="green" subtitle={<Text>sub</Text>} />
        <EditableTable rows={draftsFromModules(fixtureModules)} onChange={() => {}} />
        <Segmented options={[{ value: 'off', label: 'Off' }, { value: '25/5', label: '25/5' }]} value="off" onChange={() => {}} />
        <Switch value onChange={() => {}} />
        <CodeBlock code="ollama pull qwen3-vl:4b" />
      </>,
    );
    const t = textOf(r);
    expect(t).toContain('Title');
    expect(t).toContain('Body A');
    expect(t).not.toContain('Body B');
    expect(t).toContain('Biology');
    expect(t).toContain('ollama pull qwen3-vl:4b');
    expect(t).toContain('stored: 0');
    act(() => r.unmount());
  });

  it('SerifTimer ticks from its anchor', () => {
    jest.useFakeTimers();
    const start = Date.now();
    const r = render(<SerifTimer testID="timer" timer={{ baseS: 0, runningSinceMs: start - 65_000 }} />);
    const label = () =>
      r.root.findAll((n) => n.props.testID === 'timer' && n.props.accessibilityLabel != null)[0].props.accessibilityLabel;
    expect(label()).toBe('0:01:05');
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(label()).toBe('0:01:07');
    act(() => r.unmount());
  });

  it('ToggleList expands a row on press', () => {
    const r = render(<ToggleList items={[{ key: 'a', header: <Text>Row A</Text>, body: <Text>Hidden body</Text> }]} />);
    expect(textOf(r)).not.toContain('Hidden body');
    const btn = r.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function')[0];
    act(() => btn.props.onPress());
    expect(textOf(r)).toContain('Hidden body');
    act(() => r.unmount());
  });
});
