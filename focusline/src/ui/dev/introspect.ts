/**
 * Dev-only, read-only introspection of the rendered UI for headless agents
 * (installed on __FL.ui by DevToolsPage.installUiIntrospection).
 *
 *   __FL.ui.text('page-session')        visible text under a testID (or the whole app)
 *   __FL.ui.measure('session-timer')    window frame {x,y,w,h}
 *   __FL.ui.overflow()                  testID'd views sticking out of the window horizontally
 *
 * Walks React's fiber tree through the DevTools global hook. Never returns image data.
 */
import { useViewport } from '../lib/viewport';

interface Fiber {
  tag: number;
  memoizedProps: unknown;
  stateNode: unknown;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
}

const HOST_TEXT = 6;

function roots(): Fiber[] {
  const hook = (globalThis as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: { renderers?: Map<number, unknown>; getFiberRoots?: (id: number) => Set<{ current: Fiber }> } })
    .__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook?.getFiberRoots || !hook.renderers) return [];
  const out: Fiber[] = [];
  hook.renderers.forEach((_r, id) => {
    hook.getFiberRoots!(id).forEach((root) => out.push(root.current));
  });
  return out;
}

function walk(f: Fiber | null, visit: (f: Fiber) => boolean | void): void {
  // Iterative DFS; `visit` returning false skips the subtree.
  const stack: Fiber[] = [];
  if (f) stack.push(f);
  while (stack.length) {
    const n = stack.pop()!;
    const descend = visit(n) !== false;
    if (n.sibling && n !== f) stack.push(n.sibling);
    if (descend && n.child) stack.push(n.child);
  }
}

function isHidden(f: Fiber): boolean {
  const p = f.memoizedProps as { style?: unknown } | null;
  if (!p || typeof p !== 'object' || !p.style) return false;
  const flat = ([] as unknown[]).concat(p.style as unknown[]).flat(Infinity as 1) as Array<{ display?: string } | null>;
  return flat.some((s) => s && typeof s === 'object' && s.display === 'none');
}

function findByTestID(testID: string): Fiber | null {
  let found: Fiber | null = null;
  for (const r of roots()) {
    walk(r, (f) => {
      if (found) return false;
      if (isHidden(f)) return false;
      const p = f.memoizedProps as { testID?: string } | null;
      if (p && typeof p === 'object' && p.testID === testID) {
        found = f;
        return false;
      }
      return true;
    });
    if (found) break;
  }
  return found;
}

/** Visible text (hidden `display:none` subtrees skipped). */
export function uiText(testID?: string): string {
  const start = testID ? findByTestID(testID) : null;
  if (testID && !start) return `<no ${testID}>`;
  const parts: string[] = [];
  const visit = (f: Fiber) => {
    if (isHidden(f)) return false;
    if (f.tag === HOST_TEXT && typeof f.memoizedProps === 'string') parts.push(f.memoizedProps);
    return true;
  };
  if (start) walk(start.child, visit);
  else roots().forEach((r) => walk(r, visit));
  return parts.join('');
}

/** accessibilityLabel of the first host view with this testID (e.g. the timer's h:mm:ss). */
export function uiLabel(testID: string): string | null {
  let label: string | null = null;
  for (const r of roots()) {
    walk(r, (f) => {
      if (label != null) return false;
      const p = f.memoizedProps as { testID?: string; accessibilityLabel?: string } | null;
      if (p && typeof p === 'object' && p.testID === testID && typeof p.accessibilityLabel === 'string') {
        label = p.accessibilityLabel;
        return false;
      }
      return true;
    });
  }
  return label;
}

type Frame = { x: number; y: number; w: number; h: number };

function hostInstance(f: Fiber): { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null {
  // Fabric: stateNode.canonical.publicInstance; Paper: stateNode is the public instance.
  const sn = f.stateNode as { canonical?: { publicInstance?: unknown }; measureInWindow?: unknown } | null;
  if (!sn) return null;
  const pub = (sn.canonical?.publicInstance ?? sn) as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void };
  return typeof pub.measureInWindow === 'function' ? pub : null;
}

function measureFiber(f: Fiber): Promise<Frame | null> {
  // Descend to the first host component (tag 5) if `f` is a composite.
  let host: Fiber | null = f;
  while (host && host.tag !== 5) host = host.child;
  const inst = host ? hostInstance(host) : null;
  if (!inst?.measureInWindow) return Promise.resolve(null);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 500);
    inst.measureInWindow!((x, y, w, h) => {
      clearTimeout(t);
      resolve({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
    });
  });
}

export function uiMeasure(testID: string): Promise<Frame | null> {
  const f = findByTestID(testID);
  return f ? measureFiber(f) : Promise.resolve(null);
}

/** Every visible testID'd host view whose frame extends past the app root's right edge (+1 px slack). */
export function uiOverflow(): Promise<{ window: { w: number; h: number }; checked: number; overflowing: Array<Frame & { id: string }> }> {
  const vp = useViewport.getState();
  const win = { width: vp.w, height: vp.h };
  const targets: Array<{ id: string; f: Fiber }> = [];
  for (const r of roots()) {
    walk(r, (f) => {
      if (isHidden(f)) return false;
      const p = f.memoizedProps as { testID?: string } | null;
      if (f.tag === 5 && p && typeof p === 'object' && typeof p.testID === 'string') targets.push({ id: p.testID, f });
      return true;
    });
  }
  return Promise.all(targets.map((t) => measureFiber(t.f).then((fr) => (fr ? { id: t.id, ...fr } : null)))).then((frames) => {
    const real = frames.filter((x): x is Frame & { id: string } => !!x && x.w > 0);
    return {
      window: { w: Math.round(win.width), h: Math.round(win.height) },
      checked: real.length,
      overflowing: real.filter((fr) => fr.x + fr.w > win.width + 1 || fr.x < -1),
    };
  });
}

/** Flattened committed style of the host view with this testID (debugging animations). */
export function uiStyle(testID: string): Record<string, unknown> | null {
  let out: Record<string, unknown> | null = null;
  for (const r of roots()) {
    walk(r, (f) => {
      if (out) return false;
      const p = f.memoizedProps as { testID?: string; style?: unknown } | null;
      if (f.tag === 5 && p && typeof p === 'object' && p.testID === testID) {
        const flat = ([] as unknown[]).concat(p.style as unknown[]).flat(Infinity as 1) as Array<Record<string, unknown> | null>;
        out = Object.assign({}, ...flat.filter((x) => x && typeof x === 'object'));
        return false;
      }
      return true;
    });
  }
  return out;
}
