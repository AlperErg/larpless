/**
 * The JS ↔ Swift bridge, checked from source: src/contracts/native.ts, the JS facades in
 * src/native/, the RCT_EXTERN_* declarations in each .m file and the Swift classes behind them.
 * The facades run for real against fake native modules built from the .m declarations, so a
 * renamed selector, a missing default argument or an unsupported event name fails here instead
 * of at runtime in the app. Every check collects its problems so one run lists them all.
 */
import type { ExternModule } from '../../test/nativeSources';
import {
  JS_TYPE_FOR,
  SWIFT_TYPES_FOR,
  readContract,
  readExternModules,
  readModuleNames,
  readSwiftModules,
  readWindowsModules,
} from '../../test/nativeSources';

const externs = readExternModules();
const swift = readSwiftModules();
const contract = readContract();
const moduleNames = readModuleNames();

interface Call {
  method: string;
  args: unknown[];
}

interface FakeModule {
  [method: string]: unknown;
  __calls: Call[];
  __emitter?: FakeEmitter;
}

interface Listener {
  event: string;
  cb: (payload: unknown) => void;
  removed: boolean;
}

class FakeEmitter {
  listeners: Listener[] = [];
  constructor(module: FakeModule) {
    module.__emitter = this;
  }
  addListener(event: string, cb: (payload: unknown) => void) {
    const l: Listener = { event, cb, removed: false };
    this.listeners.push(l);
    return {
      remove: () => {
        l.removed = true;
      },
    };
  }
}

/** Only what the .m file declares exists; promise methods resolve, the rest return undefined like the bridge. */
function fakeModule(ext: ExternModule): FakeModule {
  const mod: FakeModule = { __calls: [] };
  ext.methods.forEach((m) => {
    mod[m.jsName] = (...args: unknown[]) => {
      mod.__calls.push({ method: m.jsName, args });
      return m.promise ? Promise.resolve(null) : undefined;
    };
  });
  return mod;
}

function loadFacades(fakes: Record<string, FakeModule>): Record<string, Record<string, Record<string, (...a: unknown[]) => unknown>>> {
  const loaded: Record<string, Record<string, Record<string, (...a: unknown[]) => unknown>>> = {};
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ NativeModules: fakes, NativeEventEmitter: FakeEmitter }));
    for (const key of moduleNames.keys()) loaded[key] = require(`../../src/native/${key}`);
  });
  return loaded;
}

const jsType = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Problems with one call a facade made to its native module. */
function checkCall(label: string, moduleName: string, ext: ExternModule, calls: Call[], checkTypes: boolean): string[] {
  if (calls.length !== 1) return [`${label}: expected one call into ${moduleName}, got ${calls.length}`];
  const { method, args } = calls[0];
  const decl = ext.methods.get(method)!;
  const where = `${moduleName}.${method} (${ext.file})`;
  if (args.length !== decl.jsArity) return [`${label}: passes ${args.length} argument(s) to ${where}, which takes ${decl.jsArity}`];
  if (!checkTypes) return [];
  const jsTypes = decl.types.filter((t) => !t.startsWith('RCTPromise'));
  return args.flatMap((a, i) => {
    const want = JS_TYPE_FOR[jsTypes[i]];
    return want && jsType(a) !== want ? [`${label}: argument ${i + 1} to ${where} is ${jsType(a)}, ObjC expects ${jsTypes[i]} (${want})`] : [];
  });
}

describe('Swift ↔ Objective-C declarations', () => {
  it('found every module on both sides', () => {
    expect(externs.size).toBeGreaterThanOrEqual(8);
    expect([...externs.keys()].filter((n) => !swift.has(n))).toEqual([]);
  });

  it('each module class has the declared superclass', () => {
    const problems = [...externs.values()].flatMap((ext) => {
      const s = swift.get(ext.name);
      return s && s.superclass !== ext.superclass
        ? [`${ext.name}: ${ext.file} declares ${ext.superclass}, ${s.file} subclasses ${s.superclass}`]
        : [];
    });
    expect(problems).toEqual([]);
  });

  it('every RCT_EXTERN_METHOD has an @objc func with the same selector and compatible types', () => {
    const problems: string[] = [];
    for (const ext of externs.values()) {
      const s = swift.get(ext.name);
      if (!s) continue;
      for (const m of ext.methods.values()) {
        const types = s.methods.get(m.selector);
        if (!types) {
          problems.push(`${ext.name}: ${ext.file} declares ${m.selector}, no @objc func in ${s.file} has that selector`);
          continue;
        }
        m.types.forEach((objc, i) => {
          const allowed = SWIFT_TYPES_FOR[objc];
          if (!allowed) problems.push(`${ext.name}.${m.selector}: unknown ObjC type ${objc}; add it to SWIFT_TYPES_FOR`);
          else if (!allowed.includes(types[i])) problems.push(`${ext.name}.${m.selector}: parameter ${i + 1} is ${objc} in ObjC but ${types[i]} in Swift`);
        });
      }
    }
    expect(problems).toEqual([]);
  });

  it('event emitters only send events listed in supportedEvents()', () => {
    const problems: string[] = [];
    for (const s of swift.values()) {
      if (s.superclass !== 'RCTEventEmitter') continue;
      if (!s.supportedEvents) problems.push(`${s.name}: no supportedEvents() in ${s.file}`);
      for (const e of s.sentEvents) {
        if (!s.supportedEvents?.includes(e)) problems.push(`${s.name}: sends "${e}" but supportedEvents() does not list it`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('JS facades ↔ native modules', () => {
  it('src/native/index.ts covers every contract API with a module that exists natively', () => {
    expect([...moduleNames.keys()].sort()).toEqual(contract.map((a) => a.key).sort());
    expect([...moduleNames.values()].filter((n) => !externs.has(n) || !swift.has(n))).toEqual([]);
  });

  it.each(contract.map((a) => [a.key, a] as const))('%s: every contract method reaches a declared native method correctly', (key, api) => {
    const moduleName = moduleNames.get(key)!;
    const ext = externs.get(moduleName)!;
    const fake = fakeModule(ext);
    const facade = loadFacades({ [moduleName]: fake })[key][key];
    const s = swift.get(moduleName)!;
    const problems: string[] = [];

    for (const m of api.methods) {
      const label = `${api.interfaceName}.${m.name}`;
      fake.__calls.length = 0;

      if (m.returns === 'unsubscribe') {
        const cb = jest.fn();
        const unsubscribe = facade[m.name](cb) as () => void;
        const l = fake.__emitter?.listeners.at(-1);
        if (!l) {
          problems.push(`${label}: no listener registered on a NativeEventEmitter for ${moduleName}`);
          continue;
        }
        if (!m.event) problems.push(`${label}: contract comment should name the event (// event '…')`);
        else if (l.event !== m.event) problems.push(`${label}: listens to "${l.event}", contract says "${m.event}"`);
        if (ext.superclass !== 'RCTEventEmitter') problems.push(`${label}: ${moduleName} is not an RCTEventEmitter in ${ext.file}`);
        if (!s.supportedEvents?.includes(l.event)) problems.push(`${label}: ${moduleName}.supportedEvents() does not list "${l.event}"`);
        l.cb({ hello: 1 });
        if (!cb.mock.calls.length || cb.mock.calls[0][0]?.hello !== 1) problems.push(`${label}: the event payload does not reach the callback`);
        unsubscribe();
        if (!l.removed) problems.push(`${label}: unsubscribe does not remove the native listener`);
        continue;
      }

      // Once with only the required arguments (facade defaults must fill the rest), once with all of them.
      const variants = [m.params.filter((p) => !p.optional).map((p) => p.sample), m.params.map((p) => p.sample)];
      for (const args of m.params.some((p) => p.optional) ? variants : [variants[1]]) {
        fake.__calls.length = 0;
        let ret: unknown;
        try {
          ret = facade[m.name](...args);
        } catch (e) {
          problems.push(`${label}: ${(e as Error).message} (is it declared in ${ext.file}?)`);
          continue;
        }
        problems.push(...checkCall(`${label}(${args.length} args)`, moduleName, ext, fake.__calls, true));
        const decl = fake.__calls.length === 1 ? ext.methods.get(fake.__calls[0].method)! : null;
        if (!decl) continue;
        if (m.returns === 'promise' && !decl.promise) problems.push(`${label}: returns a Promise but ${decl.decl} has no resolve/reject`);
        if (m.returns === 'void' && decl.promise) problems.push(`${label}: is fire-and-forget but ${decl.decl} returns a promise`);
        if (m.returns === 'promise' && typeof (ret as Promise<unknown>)?.then !== 'function') problems.push(`${label}: does not return the native promise`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('dev-only debug helpers call declared methods with the right number of arguments', () => {
    const fakes = Object.fromEntries([...moduleNames.values()].map((n) => [n, fakeModule(externs.get(n)!)]));
    const facades = loadFacades(fakes);
    const problems: string[] = [];
    let checked = 0;
    for (const [key, exports] of Object.entries(facades)) {
      const moduleName = moduleNames.get(key)!;
      const fake = fakes[moduleName];
      for (const [exportName, helpers] of Object.entries(exports)) {
        if (!exportName.endsWith('Debug')) continue;
        for (const [fnName, fn] of Object.entries(helpers)) {
          const label = `${exportName}.${fnName}`;
          if (fnName === 'available') {
            if (fn() !== true) problems.push(`${label}: reports false although the module is present`);
            continue;
          }
          fake.__calls.length = 0;
          try {
            fn(...Array.from({ length: fn.length }, () => 0));
          } catch (e) {
            problems.push(`${label}: ${(e as Error).message} (is it declared in ${externs.get(moduleName)!.file}?)`);
            continue;
          }
          problems.push(...checkCall(label, moduleName, externs.get(moduleName)!, fake.__calls, false));
          checked++;
        }
      }
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(10);
  });

  it('windows REACT_METHOD names match the contract when that tree is present', () => {
    const windows = readWindowsModules();
    if (!windows) {
      expect(windows).toBeNull();
      return;
    }
    const problems: string[] = [];
    for (const api of contract) {
      const moduleName = moduleNames.get(api.key);
      if (!moduleName) {
        problems.push(`${api.key}: no native module name`);
        continue;
      }
      const methods = windows.get(moduleName);
      if (!methods) {
        problems.push(`${moduleName}: no REACT_MODULE`);
        continue;
      }
      for (const method of api.methods) {
        if (method.returns === 'unsubscribe') continue;
        if (!methods.has(method.name)) problems.push(`${moduleName}.${method.name}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
