/// <reference types="node" />
/**
 * Reads the three sides of the native bridge for __tests__/native/contract.test.ts:
 * the TS contract (src/contracts/native.ts), the Objective-C extern declarations (*.m) and the
 * Swift classes behind them. Mismatches between these only show up at runtime otherwise
 * ("unrecognized selector", "called with 1 arguments but expects 2", unsupported event).
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import * as ts from 'typescript';

export const ROOT = join(__dirname, '..');
export const NATIVE_DIR = join(ROOT, 'macos/Focusline-macOS/Native');
export const WINDOWS_NATIVE_DIR = join(ROOT, 'windows/LarpLess/Native');
export const CONTRACT_FILE = join(ROOT, 'src/contracts/native.ts');

const PROMISE_BLOCKS = ['RCTPromiseResolveBlock', 'RCTPromiseRejectBlock'];

/* ------------------------------------------------------------------ */
/* Objective-C: RCT_EXTERN_MODULE / RCT_EXTERN_METHOD                  */
/* ------------------------------------------------------------------ */

export interface ExternMethod {
  /** Name JS calls: the selector up to the first colon. */
  jsName: string;
  selector: string;
  /** Normalized ObjC types, e.g. NSString, double, BOOL, RCTPromiseResolveBlock. */
  types: string[];
  /** Arguments JS passes (everything except the promise blocks). */
  jsArity: number;
  promise: boolean;
  decl: string;
}

export interface ExternModule {
  name: string;
  superclass: string;
  file: string;
  methods: Map<string, ExternMethod>;
}

function walk(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return walk(p, ext);
    return p.endsWith(ext) ? [p] : [];
  });
}

/** Text between the paren at `open` and its match. */
function inParens(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`unbalanced parens at ${open}`);
}

const normalizeObjcType = (t: string) => t.replace(/\b(nonnull|nullable|_Nonnull|_Nullable|const)\b|\*|\s/g, '');

export function parseExternMethod(decl: string): ExternMethod {
  const parts = [...decl.matchAll(/(\w+)\s*:\s*\(([^)]*)\)\s*\w+/g)];
  if (!parts.length) {
    const name = decl.trim();
    return { jsName: name, selector: name, types: [], jsArity: 0, promise: false, decl };
  }
  const types = parts.map((m) => normalizeObjcType(m[2]));
  return {
    jsName: parts[0][1],
    selector: parts.map((m) => `${m[1]}:`).join(''),
    types,
    jsArity: types.filter((t) => !PROMISE_BLOCKS.includes(t)).length,
    promise: types.includes('RCTPromiseResolveBlock'),
    decl: decl.replace(/\s+/g, ' ').trim(),
  };
}

export function readExternModules(): Map<string, ExternModule> {
  const out = new Map<string, ExternModule>();
  for (const file of walk(NATIVE_DIR, '.m')) {
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const mod = /RCT_EXTERN_MODULE\(\s*(\w+)\s*,\s*(\w+)\s*\)/.exec(src);
    if (!mod) continue;
    const methods = new Map<string, ExternMethod>();
    for (const m of src.matchAll(/RCT_EXTERN_METHOD\s*\(/g)) {
      const method = parseExternMethod(inParens(src, m.index! + m[0].length - 1));
      methods.set(method.jsName, method);
    }
    out.set(mod[1], { name: mod[1], superclass: mod[2], file: relative(ROOT, file), methods });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Swift: @objc(Name) class, @objc func, supportedEvents, sendEvent    */
/* ------------------------------------------------------------------ */

export interface SwiftModule {
  /** Name exported to the ObjC runtime: @objc(Name). */
  name: string;
  superclass: string;
  file: string;
  /** Normalized Swift parameter types by ObjC selector. */
  methods: Map<string, string[]>;
  supportedEvents: string[] | null;
  sentEvents: string[];
}

/** Body of the `{` at `open`, skipping string literals and line comments. */
function braceBody(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === '\\') i++;
    } else if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i < 0) break;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`unbalanced braces at ${open}`);
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ('([<'.includes(c)) depth++;
    else if (')]>'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (s.slice(start).trim()) out.push(s.slice(start));
  return out.map((p) => p.trim());
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** ObjC selector Swift generates for `func name(params)` (or the explicit @objc(selector)). */
export function swiftSelector(name: string, params: string[], explicit?: string): string {
  if (explicit) return explicit;
  if (!params.length) return name;
  return params
    .map((p, i) => {
      const label = p.split(':')[0].trim().split(/\s+/)[0];
      if (i === 0) return label === '_' ? `${name}:` : `${name}With${cap(label)}:`;
      return `${label === '_' ? '' : label}:`;
    })
    .join('');
}

const normalizeSwiftType = (p: string) =>
  p
    .slice(p.indexOf(':') + 1)
    .replace(/[=].*$/, '') // default value
    .replace(/@escaping|inout/g, '')
    .replace(/\s/g, '');

export function readSwiftModules(): Map<string, SwiftModule> {
  const out = new Map<string, SwiftModule>();
  for (const file of walk(NATIVE_DIR, '.swift')) {
    const src = readFileSync(file, 'utf8');
    for (const cls of src.matchAll(/@objc\((\w+)\)\s*(?:(?:public|final|open)\s+)*class\s+\w+\s*:\s*(\w+)[^{]*\{/g)) {
      const body = braceBody(src, cls.index! + cls[0].length - 1);
      const methods = new Map<string, string[]>();
      for (const fn of body.matchAll(/@objc(?:\(([\w:]+)\))?\s+(?:(?:public|internal|final)\s+)*func\s+(\w+)\s*\(/g)) {
        const params = splitTopLevel(inParens(body, fn.index! + fn[0].length - 1));
        methods.set(swiftSelector(fn[2], params, fn[1]), params.map(normalizeSwiftType));
      }
      const supported = /func\s+supportedEvents\(\)[^{]*\{\s*(?:return\s+)?\[([^\]]*)\]/.exec(body);
      out.set(cls[1], {
        name: cls[1],
        superclass: cls[2],
        file: relative(ROOT, file),
        methods,
        supportedEvents: supported ? [...supported[1].matchAll(/"(\w+)"/g)].map((m) => m[1]) : null,
        sentEvents: [...body.matchAll(/sendEvent\(\s*withName:\s*"(\w+)"/g)].map((m) => m[1]),
      });
    }
  }
  return out;
}

/** Swift parameter types the bridge accepts for each ObjC type in an extern declaration. */
export const SWIFT_TYPES_FOR: Record<string, string[]> = {
  NSString: ['String', 'NSString'],
  NSDictionary: ['NSDictionary', '[String:Any]', '[AnyHashable:Any]'],
  NSArray: ['NSArray', '[Any]'],
  NSNumber: ['NSNumber'],
  double: ['Double', 'CGFloat'],
  float: ['Float'],
  BOOL: ['Bool'],
  NSInteger: ['Int'],
  RCTPromiseResolveBlock: ['RCTPromiseResolveBlock'],
  RCTPromiseRejectBlock: ['RCTPromiseRejectBlock'],
  RCTResponseSenderBlock: ['RCTResponseSenderBlock'],
};

/** typeof the JS value the bridge converts to each ObjC type. */
export const JS_TYPE_FOR: Record<string, string> = {
  NSString: 'string',
  NSDictionary: 'object',
  NSArray: 'array',
  NSNumber: 'number',
  double: 'number',
  float: 'number',
  NSInteger: 'number',
  BOOL: 'boolean',
};

/* ------------------------------------------------------------------ */
/* TS contract: NativeApis                                            */
/* ------------------------------------------------------------------ */

export interface ContractMethod {
  name: string;
  returns: 'promise' | 'void' | 'unsubscribe';
  /** One sample value per parameter, built from its declared type. */
  params: { name: string; optional: boolean; sample: unknown }[];
  /** From the `// event 'Name'` comment on subscription methods. */
  event: string | null;
}

export interface ContractApi {
  key: string;
  interfaceName: string;
  methods: ContractMethod[];
}

// ts.TypeFlags is a bit set.
/* eslint-disable no-bitwise */
function sampleFor(checker: ts.TypeChecker, type: ts.Type, at: ts.Node, depth = 0): unknown {
  if (type.isUnion()) {
    const defined = type.types.filter((t) => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)));
    if (defined.every((t) => t.flags & ts.TypeFlags.BooleanLiteral)) return true;
    return sampleFor(checker, defined[0], at, depth);
  }
  if (type.isStringLiteral()) return type.value;
  if (type.isNumberLiteral()) return type.value;
  if (type.flags & ts.TypeFlags.StringLike) return 'sample';
  if (type.flags & ts.TypeFlags.NumberLike) return 1;
  if (type.flags & ts.TypeFlags.BooleanLike) return true;
  if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length) return () => {};
  if (type.symbol?.getName() === 'Array' && depth < 3) {
    const [element] = checker.getTypeArguments(type as ts.TypeReference);
    return element ? [sampleFor(checker, element, at, depth + 1)] : [];
  }
  if (type.flags & ts.TypeFlags.Object && depth < 3) {
    const obj: Record<string, unknown> = {};
    for (const prop of checker.getPropertiesOfType(type)) {
      obj[prop.name] = sampleFor(checker, checker.getTypeOfSymbolAtLocation(prop, at), at, depth + 1);
    }
    return obj;
  }
  return null;
}
/* eslint-enable no-bitwise */

export function readContract(): ContractApi[] {
  const program = ts.createProgram([CONTRACT_FILE], { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2020 });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(CONTRACT_FILE)!;
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  sf.statements.forEach((s) => {
    if (ts.isInterfaceDeclaration(s)) interfaces.set(s.name.text, s);
  });
  const root = interfaces.get('NativeApis');
  if (!root) throw new Error('NativeApis not found in src/contracts/native.ts');

  return root.members.filter(ts.isPropertySignature).map((prop) => {
    const interfaceName = prop.type!.getText(sf);
    const iface = interfaces.get(interfaceName);
    if (!iface) throw new Error(`interface ${interfaceName} not found`);
    const methods = iface.members.filter(ts.isMethodSignature).map((m): ContractMethod => {
      const ret = m.type!.getText(sf);
      const returns = ret.startsWith('Promise<') ? 'promise' : ret === 'Unsubscribe' ? 'unsubscribe' : ret === 'void' ? 'void' : null;
      if (!returns) throw new Error(`${interfaceName}.${m.name.getText(sf)} returns ${ret}; teach test/nativeSources.ts about it`);
      const lineEnd = sf.text.indexOf('\n', m.end);
      return {
        name: m.name.getText(sf),
        returns,
        params: m.parameters.map((p) => ({
          name: p.name.getText(sf),
          optional: !!p.questionToken,
          sample: sampleFor(checker, checker.getTypeAtLocation(p), p),
        })),
        event: /event '(\w+)'/.exec(sf.text.slice(m.end, lineEnd))?.[1] ?? null,
      };
    });
    return { key: prop.name.getText(sf), interfaceName, methods };
  });
}

/**
 * JS names of REACT_METHOD on the Windows tree, keyed by REACT_MODULE name.
 * Null when this checkout has no windows/ sources (the macOS branch).
 */
export function readWindowsModules(): Map<string, Set<string>> | null {
  let entries: string[];
  try {
    entries = walk(WINDOWS_NATIVE_DIR, '.h');
  } catch {
    return null;
  }
  if (!entries.length) return null;
  const out = new Map<string, Set<string>>();
  for (const file of entries) {
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const parts = src.split(/REACT_MODULE\(/);
    for (const part of parts.slice(1)) {
      const name = /^(\w+)/.exec(part)?.[1];
      if (!name) continue;
      const body = part.slice(0, part.indexOf('REACT_MODULE') >= 0 ? part.indexOf('REACT_MODULE') : part.length);
      const names = new Set(out.get(name) ?? []);
      for (const m of body.matchAll(/REACT_METHOD\(\s*\w+\s*,\s*L"([^"]+)"/g)) names.add(m[1]);
      out.set(name, names);
    }
  }
  return out;
}

/** `pick('screen', 'FLScreenCapture', …)` in src/native/index.ts: contract key → native module name. */
export function readModuleNames(): Map<string, string> {
  const src = readFileSync(join(ROOT, 'src/native/index.ts'), 'utf8');
  return new Map([...src.matchAll(/pick\(\s*'(\w+)'\s*,\s*'(\w+)'/g)].map((m) => [m[1], m[2]]));
}
