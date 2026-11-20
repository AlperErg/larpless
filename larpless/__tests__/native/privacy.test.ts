/**
 * Privacy guarantees that live in native startup code and can't run under Jest, checked from source (like
 * contract.test.ts). Each one fixed a real leak:
 * - React Native's networking used the default NSURLSession, whose disk NSURLCache kept a POST /api/chat to
 *   Ollama, base64 screenshot included, in ~/Library/Caches/<bundle id>/Cache.db.
 * - ONNX Runtime (the on-device screen model, and the webcam model on Windows) sent usage telemetry to Microsoft
 *   and kept a device ID on disk. On the Mac only ORT_DISABLE_TELEMETRY, set before the first OrtEnv, stops it;
 *   OrtApi::DisableTelemetryEvents comes after the telemetry has already started.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Source without comments, so a commented-out line doesn't count. Strings with `//` (URLs) aren't in these files' checks. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Paths relative to `root`, always with `/` (Windows' readdir and join give `\`), so they compare equal on every platform. */
function filesUnder(dir: string, ext: RegExp): string[] {
  return readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => ext.test(f))
    .map((f) => join(dir, f).replace(/\\/g, '/'));
}

describe('macOS startup', () => {
  it('turns ONNX Runtime telemetry off before the app starts', () => {
    const main = code(read('macos/Focusline-macOS/main.m'));
    const setenv = main.indexOf('setenv("ORT_DISABLE_TELEMETRY", "1", 1)');
    expect(setenv).toBeGreaterThan(-1);
    expect(setenv).toBeLessThan(main.indexOf('NSApplicationMain('));
  });

  it('gives React Native an ephemeral, cache-less URL session before React Native starts', () => {
    const delegate = code(read('macos/Focusline-macOS/AppDelegate.mm'));
    const install = delegate.indexOf('FLInstallPrivateNetworking();');
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(delegate.indexOf('[super applicationDidFinishLaunching:'));

    const fn = delegate.slice(delegate.indexOf('static void FLInstallPrivateNetworking'), delegate.indexOf('@implementation'));
    expect(fn).toContain('RCTSetCustomNSURLSessionConfigurationProvider(');
    expect(fn).toContain('NSURLSessionConfiguration.ephemeralSessionConfiguration');
    expect(fn).toContain('configuration.URLCache = nil;');
    expect(fn).toMatch(/NSURLCache\.sharedURLCache = \[\[NSURLCache alloc\] initWithMemoryCapacity:0 diskCapacity:0/);
    // What earlier builds left in the disk cache is deleted.
    for (const name of ['Cache.db', 'Cache.db-wal', 'Cache.db-shm', 'fsCachedData']) expect(fn).toContain(`@"${name}"`);
  });

  it('only ever builds ephemeral URL sessions without a cache in native code', () => {
    const swift = filesUnder('macos/Focusline-macOS/Native', /\.(swift|m|mm)$/).map((f) => [f, code(read(f))] as const);
    const problems: string[] = [];
    for (const [file, source] of swift) {
      if (/URLSessionConfiguration\.default|defaultSessionConfiguration|URLSession\.shared/.test(source)) {
        problems.push(`${file}: default URL session (disk cache, cookies)`);
      }
      if (/URLSession\(configuration:/.test(source) && !/\.urlCache = nil/.test(source)) {
        problems.push(`${file}: URL session without urlCache = nil`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('Windows startup', () => {
  it('turns ONNX Runtime telemetry off before React Native starts', () => {
    const app = code(read('windows/LarpLess/LarpLess.cpp'));
    const setenv = app.indexOf('SetEnvironmentVariableW(L"ORT_DISABLE_TELEMETRY", L"1")');
    expect(setenv).toBeGreaterThan(-1);
    expect(setenv).toBeLessThan(app.indexOf('ReactNativeAppBuilder()'));
  });

  it('disables telemetry on every ONNX Runtime env', () => {
    const problems: string[] = [];
    let envs = 0;
    for (const file of filesUnder('windows/LarpLess/Native', /\.h$/)) {
      const lines = code(read(file)).split('\n');
      lines.forEach((line, i) => {
        const created = /(\w+(?:->|\.)?\w*)\s*=\s*std::make_unique<Ort::Env>|auto\s+(\w+)\{std::make_unique<Ort::Env>/.exec(line);
        if (!created) return;
        envs += 1;
        const name = created[1] ?? created[2];
        if (!lines[i + 1]?.includes(`${name}->DisableTelemetryEvents()`)) problems.push(`${file}:${i + 1} ${name}`);
      });
    }
    expect(envs).toBeGreaterThanOrEqual(2);
    expect(problems).toEqual([]);
  });
});

describe('JS network calls', () => {
  /**
   * Only the Ollama client talks HTTP itself, and it refuses any URL that isn't this machine (isLocalUrl, checked
   * per request). Friends goes through the one Supabase client, which exists only while Friends is on. Anything
   * new that reaches the network needs a decision about PRIVACY.md, not just a line here.
   */
  it('happen only in the local Ollama client and the Friends client', () => {
    const allowed: Record<string, RegExp> = {
      'src/core/ollama.ts': /globalThis\.fetch|new XMLHttpRequest\(/,
      'src/social/supabase.ts': /\bcreateClient\(/,
    };
    const network = /\bfetch\s*\(|globalThis\.fetch|new XMLHttpRequest\(|new WebSocket\(|new EventSource\(|sendBeacon\(|\bcreateClient\(/;
    const found = filesUnder('src', /\.(ts|tsx)$/).filter((f) => network.test(code(read(f))));
    expect(found.sort()).toEqual(Object.keys(allowed).sort());
    for (const [file, pattern] of Object.entries(allowed)) expect(code(read(file))).toMatch(pattern);
  });
});
