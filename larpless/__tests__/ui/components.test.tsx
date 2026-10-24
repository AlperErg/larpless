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
import { formatClock, formatDuration, formatLegendDuration, timeAgo } from '../../src/ui/lib/format';
import { builtInNames, courseNameProblem, draftsFromModules, modulesFromDrafts } from '../../src/ui/lib/modules';
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
    expect(formatLegendDuration(30)).toBe('30s');
    expect(formatLegendDuration(90)).toBe('1m 30s');
    expect(formatLegendDuration(6 * 60)).toBe('6m');
    expect(formatLegendDuration(10 * 60 + 30)).toBe(formatDuration(10 * 60 + 30));
    expect(timeAgo(1000, 13_000)).toBe('12 s ago');
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(14)).toBe(1);
    expect(heatLevel(29)).toBe(2);
    expect(heatLevel(59)).toBe(3);
    expect(heatLevel(60)).toBe(4);
  });

  it('module drafts round-trip, drop blanks and duplicates', () => {
    const courses = fixtureModules.map((m) => ({ ...m, name: `${m.name} 101` }));
    const drafts = draftsFromModules(courses);
    expect(modulesFromDrafts(drafts)).toEqual(courses);
    const dup = [...drafts, { ...drafts[0], id: 'x', name: ' biology 101 ' }, { ...drafts[0], id: 'y', name: '  ' }];
    expect(modulesFromDrafts(dup)).toHaveLength(3);
    expect(courseNameProblem(dup)).toBe('Names must be unique: biology 101');
  });

  it('built-in subject names are refused as course names', () => {
    const drafts = draftsFromModules([
      { id: 'a', name: ' biology ', color: 'green', keywords: [] },
      { id: 'b', name: 'Signals & systems', color: 'blue', keywords: [] },
      { id: 'c', name: 'Biology BIO101', color: 'green', keywords: ['cell'] },
    ]);
    expect(modulesFromDrafts(drafts).map((m) => m.name)).toEqual(['Biology BIO101']);
    expect(builtInNames(drafts)).toEqual(['Biology', 'Signals & Systems']);
    expect(courseNameProblem(drafts)).toMatch(/^Biology, Signals & Systems are already built in/);
    expect(courseNameProblem(drafts.slice(2))).toBeNull();
  });

  it('renders every primitive', () => {
    const r = render(
      <>
        <Text variant="title">Title</Text>
        <Text variant="small">small</Text>
        <Tag label="Biology" color="green" selected onPress={() => {}} />
        <Button title="Start session" variant="primary" size="lg" onPress={() => {}} />
        <Button title="End" variant="danger" />
        <Callout icon="lightbulb">
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
        <PageHeader icon="target" title="Focus session" cover="green" subtitle={<Text>sub</Text>} />
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

  it('Segmented: a disabled option shows but cannot be picked', () => {
    const onChange = jest.fn();
    const r = render(
      <Segmented
        testID="mode"
        options={[{ value: 'hybrid', label: 'Hybrid' }, { value: 'embed', label: 'Alone', disabled: true }]}
        value="hybrid"
        onChange={onChange}
      />,
    );
    expect(textOf(r)).toContain('Alone');
    const pressable = (id: string) => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function');
    expect(pressable('mode-embed')).toHaveLength(0);
    act(() => pressable('mode-hybrid')[0].props.onPress());
    expect(onChange).toHaveBeenCalledWith('hybrid');
    act(() => r.unmount());
  });

  it('SerifTimer ticks from its anchor', () => {
    jest.useFakeTimers();
    const start = Date.now();
    const r = render(<SerifTimer testID="timer" timer={{ baseS: 0, runningSinceMs: start - 65_000 }} />);
    const label = () =>
      r.root.findAll((n) => n.props.testID === 'timer' && n.props.accessibilityLabel != null)[0].props.accessibilityLabel;
    expect(label()).toBe('0:01:05');
    expect(textOf(r)).toContain('0:01:05');
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(label()).toBe('0:01:07');
    // Digits 4–9 must be in the rendered string (the old per-digit columns clipped them).
    const late = render(<SerifTimer timer={{ baseS: 4 * 3600 + 59 * 60 + 48, runningSinceMs: null }} />);
    expect(textOf(late)).toContain('4:59:48');
    act(() => late.unmount());
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
