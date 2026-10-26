import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { StudyModule } from '../../src/contracts/domain';
import { initialAppState, useAppStore } from '../../src/store/appStore';
import { LIBRARY_MODULES, librarySubjectId } from '../../src/core/subjectLibrary';
import { nextTagColor, toggleSubject } from '../../src/ui/lib/modules';
import { ModulesPage } from '../../src/ui/pages/ModulesPage';

const DEBOUNCE_MS = 600;

// Own courses only: names of built-in subjects (like the Biology/Maths fixtures) are refused by the page.
const courses: StudyModule[] = [
  { id: 'mod_thesis', name: 'Thesis', color: 'purple', keywords: ['draft', 'chapter'] },
  { id: 'mod_compilers', name: 'Compilers', color: 'blue', keywords: ['parser', 'CS420'] },
  { id: 'mod_optics', name: 'Quantum Optics', color: 'pink', keywords: ['laser'] },
];

function render(): ReactTestRenderer {
  let r: ReactTestRenderer;
  act(() => {
    r = create(<ModulesPage />);
  });
  return r!;
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

/** One instance per table row, in order (the composite and its host view share the testID). */
function rows(r: ReactTestRenderer): ReactTestInstance[] {
  const seen = new Set<string>();
  return r.root.findAll((n) => {
    const id = n.props.testID;
    if (typeof id !== 'string' || !id.startsWith('module-row-') || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function control(row: ReactTestInstance, id: string, prop: string): (...a: unknown[]) => void {
  const hit = row.findAll((n) => n.props.testID === id && typeof n.props[prop] === 'function')[0];
  if (!hit) throw new Error(`no ${id} with ${prop}`);
  return hit.props[prop];
}

/** Types into a row's name or keywords cell (re-queried every time: handlers close over the latest rows). */
function typeIn(r: ReactTestRenderer, rowIndex: number, cell: 'name' | 'keywords', text: string) {
  act(() => control(rows(r)[rowIndex], `module-${cell}`, 'onChangeText')(text));
}

async function blur(r: ReactTestRenderer, rowIndex: number) {
  await act(async () => control(rows(r)[rowIndex], 'module-name', 'onBlur')());
}

async function press(r: ReactTestRenderer, id: string, rowIndex?: number) {
  const scope = rowIndex == null ? r.root : rows(r)[rowIndex];
  await act(async () => control(scope, id, 'onPress')());
}

/** Advance the debounce and let the AsyncStorage write settle. */
async function wait(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

const modules = () => useAppStore.getState().modules;
const names = () => modules().map((m) => m.name);
const stored = async (): Promise<StudyModule[] | null> => JSON.parse((await AsyncStorage.getItem('fl:modules')) ?? 'null');
const moduleWrites = () => (AsyncStorage.setItem as jest.Mock).mock.calls.filter((c) => c[0] === 'fl:modules').length;
const saveState = (r: ReactTestRenderer) => {
  const hit = r.root.findAll((n) => n.props.testID === 'modules-save-state')[0];
  return hit ? textOf(hit).trim() : null;
};
const problem = (r: ReactTestRenderer) => {
  const hit = r.root.findAll((n) => n.props.testID === 'modules-name-problem')[0];
  return hit ? textOf(hit) : null;
};

const actionsBackup = { ...useAppStore.getState() };

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  (AsyncStorage.setItem as jest.Mock).mockClear();
});

afterEach(() => {
  jest.useRealTimers();
  act(() => useAppStore.setState({ ...actionsBackup, ...initialAppState }));
});

describe('Modules page', () => {
  it('adding a course: Saving… while you type, one save after you pause, then Saved', async () => {
    const r = render();
    expect(rows(r)).toHaveLength(0);

    await press(r, 'module-new');
    expect(rows(r)).toHaveLength(1);
    await wait(DEBOUNCE_MS);
    expect(moduleWrites()).toBe(0); // a blank row is not a course yet

    typeIn(r, 0, 'name', 'L');
    await wait(DEBOUNCE_MS / 2);
    typeIn(r, 0, 'name', 'Signal Processing');
    await wait(DEBOUNCE_MS / 2);
    typeIn(r, 0, 'keywords', 'matrix, eigen , ');
    expect(saveState(r)).toBe('Saving…');
    expect(moduleWrites()).toBe(0);

    await wait(DEBOUNCE_MS);
    expect(moduleWrites()).toBe(1);
    expect(modules()).toEqual([{ id: expect.any(String), name: 'Signal Processing', color: expect.any(String), keywords: ['matrix', 'eigen'] }]);
    expect(['gray', 'red']).not.toContain(modules()[0].color); // those mean away / distracted
    expect(await stored()).toEqual(modules());
    expect(saveState(r)).toBe('Saved');
    act(() => r.unmount());
  });

  it('leaving a cell saves straight away', async () => {
    const r = render();
    await press(r, 'module-new');
    typeIn(r, 0, 'name', 'Thesis');
    await blur(r, 0);
    expect(names()).toEqual(['Thesis']);
    expect(await stored()).toEqual(modules());

    await wait(DEBOUNCE_MS);
    expect(moduleWrites()).toBe(1); // the pending debounce finds nothing new to save
    act(() => r.unmount());
  });

  it('your own save does not wipe a blank row you are about to fill in', async () => {
    const r = render();
    await press(r, 'module-new');
    typeIn(r, 0, 'name', 'Thesis');
    await press(r, 'module-new');
    await wait(DEBOUNCE_MS);
    expect(names()).toEqual(['Thesis']);
    expect(rows(r)).toHaveLength(2);
    act(() => r.unmount());
  });

  it('clicking a colour cycles it and saves at once', async () => {
    act(() => useAppStore.setState({ modules: courses }));
    const r = render();
    const before = courses[0].color;
    await press(r, 'module-color', 0);
    expect(modules()[0].color).toBe(nextTagColor(before));
    expect((await stored())?.[0].color).toBe(nextTagColor(before));
    act(() => r.unmount());
  });

  it('deleting a row saves at once', async () => {
    act(() => useAppStore.setState({ modules: courses }));
    const r = render();
    await press(r, 'module-remove', 0);
    expect(names()).toEqual(courses.slice(1).map((m) => m.name));
    expect(rows(r)).toHaveLength(courses.length - 1);
    expect((await stored())?.map((m) => m.name)).toEqual(names());
    act(() => r.unmount());
  });

  it('a built-in subject name is flagged and not saved as a course', async () => {
    const r = render();
    await press(r, 'module-new');
    typeIn(r, 0, 'name', 'biology');
    expect(problem(r)).toContain('Biology is already built in');
    await wait(DEBOUNCE_MS);
    expect(modules()).toEqual([]);

    typeIn(r, 0, 'name', 'Biology 101');
    expect(problem(r)).toBeNull();
    await wait(DEBOUNCE_MS);
    expect(names()).toEqual(['Biology 101']);
    act(() => r.unmount());
  });

  it('duplicate names are flagged; only the first one is saved', async () => {
    const r = render();
    await press(r, 'module-new');
    await press(r, 'module-new');
    typeIn(r, 0, 'name', 'Thesis');
    typeIn(r, 1, 'name', ' thesis ');
    expect(problem(r)).toBe('Names must be unique: thesis');
    await wait(DEBOUNCE_MS);
    expect(names()).toEqual(['Thesis']);
    act(() => r.unmount());
  });

  it('leaving the page saves edits that were still waiting for the pause', async () => {
    const r = render();
    await press(r, 'module-new');
    typeIn(r, 0, 'name', 'Compilers');
    expect(moduleWrites()).toBe(0);
    await act(async () => r.unmount());
    expect(names()).toEqual(['Compilers']);
    expect((await stored())?.map((m) => m.name)).toEqual(['Compilers']);
  });

  it('modules changed elsewhere (load, fixtures) replace the table', () => {
    const r = render();
    act(() => useAppStore.setState({ modules: courses }));
    expect(rows(r)).toHaveLength(courses.length);
    expect(control(rows(r)[0], 'module-name', 'onChangeText')).toBeDefined();
    const shownNames = rows(r).map((row) => row.findAll((n) => n.props.testID === 'module-name' && n.props.value != null)[0].props.value);
    expect(shownNames).toEqual(courses.map((m) => m.name));
    act(() => r.unmount());
  });

  it('a failed save is logged and does not claim Saved', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    const r = render();
    await press(r, 'module-new');
    typeIn(r, 0, 'name', 'Thesis');
    await blur(r, 0);
    expect(warn).toHaveBeenCalledWith('[ui] saveModules failed:', 'disk full');
    expect(saveState(r)).toBe('');
    warn.mockRestore();
    act(() => r.unmount());
  });
});

describe('Choosing which subjects are detected', () => {
  const disabled = () => useAppStore.getState().settings.disabledSubjects;
  const storedSettings = async () => JSON.parse((await AsyncStorage.getItem('fl:settings')) ?? 'null');
  const count = (r: ReactTestRenderer) => textOf(r.root.findAll((n) => n.props.testID === 'modules-detect-count')[0]);
  const allOnButton = (r: ReactTestRenderer) => r.root.findAll((n) => n.props.testID === 'modules-all-on');

  it('clicking a subject turns it off and saves; clicking again turns it back on', async () => {
    const r = render();
    const total = LIBRARY_MODULES.length;
    expect(count(r)).toBe(`${total} of ${total} on`);
    expect(allOnButton(r)).toHaveLength(0);

    await press(r, 'subject-Biology');
    expect(disabled()).toEqual([librarySubjectId('Biology')]);
    expect((await storedSettings()).disabledSubjects).toEqual([librarySubjectId('Biology')]);
    expect(count(r)).toBe(`${total - 1} of ${total} on`);

    await press(r, 'subject-Biology');
    expect(disabled()).toEqual([]);
    act(() => r.unmount());
  });

  it('own courses are listed and can be turned off too', async () => {
    act(() => useAppStore.setState({ modules: courses }));
    const r = render();
    await press(r, 'subject-Thesis');
    expect(disabled()).toEqual(['mod_thesis']);
    act(() => r.unmount());
  });

  it('the last subject on cannot be turned off; Turn all on resets', async () => {
    const allButHistory = LIBRARY_MODULES.filter((m) => m.name !== 'History').map((m) => m.id);
    act(() => useAppStore.setState({ settings: { ...useAppStore.getState().settings, disabledSubjects: allButHistory } }));
    const r = render();
    expect(count(r)).toBe(`1 of ${LIBRARY_MODULES.length} on`);

    await press(r, 'subject-History');
    expect(disabled()).toEqual(allButHistory);
    expect(count(r)).toBe('Keep at least one subject on.');

    await press(r, 'modules-all-on');
    expect(disabled()).toEqual([]);
    expect(allOnButton(r)).toHaveLength(0);
    act(() => r.unmount());
  });

  it('toggleSubject drops ids of subjects that no longer exist', () => {
    expect(toggleSubject(['mod_gone', 'a'], 'b', ['a', 'b', 'c'])).toEqual(['a', 'b']);
    expect(toggleSubject(['a', 'b'], 'b', ['a', 'b', 'c'])).toEqual(['a']);
    expect(toggleSubject(['a', 'b'], 'c', ['a', 'b', 'c'])).toBeNull();
  });
});
