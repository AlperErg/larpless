/**
 * Dev-only handle for headless verification by agents (see scripts/js-eval.mjs).
 *
 *   node scripts/js-eval.mjs 8081 "__FL.ping()"
 *   node scripts/js-eval.mjs 8082 "__FL.harness.A()"
 *
 * Harnesses register runners with registerHarness('A', async () => ({ ...results })).
 * PRIVACY: results must never contain image data (base64, pixels) — report sizes and timings only.
 */
import { NativeEventEmitter, NativeModules } from 'react-native';
import { config } from '../config';
import { native } from '../native';
import { useSessionStore } from '../store/sessionStore';
import { useAppStore } from '../store/appStore';
import { applyFixture } from '../fixtures/apply';

type Runner = () => Promise<unknown>;

const harness: Record<string, Runner> = {};

export function registerHarness(name: string, run: Runner): void {
  harness[name] = run;
}

export function installDevGlobals(): void {
  if (!__DEV__) return;
  (globalThis as Record<string, unknown>).__FL = {
    NativeModules,
    native,
    config,
    useSessionStore,
    useAppStore,
    applyFixture,
    harness,
    ping: (): Promise<string> => NativeModules.FLPing?.ping() ?? Promise.resolve('FLPing missing'),
    pingRoundTrip,
  };
}

/** Proves both bridge directions: JS → Swift promise and Swift → JS event. */
function pingRoundTrip(): Promise<{ result: string; event: unknown }> {
  const M = NativeModules.FLPing;
  if (!M) return Promise.resolve({ result: 'FLPing missing', event: null });
  const emitter = new NativeEventEmitter(M);
  return new Promise((resolve) => {
    let event: unknown = null;
    const sub = emitter.addListener('FLPingEvent', (body: unknown) => {
      event = body;
    });
    M.ping().then((result: string) =>
      setTimeout(() => {
        sub.remove();
        resolve({ result, event });
      }, 300),
    );
  });
}
