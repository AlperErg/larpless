import { config } from '../../src/config';
import {
  effectiveProfile,
  platformProfile,
  resetSessionProfile,
  sessionOverride,
  stepSessionProfile,
  WINDOWS_ECO_TIMEOUT_MS,
} from '../../src/core/powerProfile';

describe('power profiles', () => {
  afterEach(() => resetSessionProfile());

  it('uses the saved profile, and an unknown value falls back to medium', () => {
    expect(effectiveProfile('high')).toMatchObject({ id: 'high', chunkS: 10, liveSettleMs: 1_000, keepAlive: '30m' });
    expect(effectiveProfile('eco').capture).toEqual({ maxWidth: 768, jpegQuality: 0.5 });
    expect(effectiveProfile('high').classifyTimeoutMs).toBe(30_000);
    expect(config.CLASSIFY_TIMEOUT_MS).toBe(30_000);
    expect(effectiveProfile('nope').id).toBe('medium');
    expect(effectiveProfile(undefined).chunkS).toBe(15);
  });

  it('Windows eco gets the longer ceiling; every other profile and the Mac keep 30 s', () => {
    expect(WINDOWS_ECO_TIMEOUT_MS).toBe(45_000);
    expect(platformProfile(effectiveProfile('eco'), 'windows')).toEqual({ ...effectiveProfile('eco'), classifyTimeoutMs: 45_000 });
    for (const id of ['medium', 'high']) {
      expect(platformProfile(effectiveProfile(id), 'windows').classifyTimeoutMs).toBe(30_000);
    }
    for (const id of ['eco', 'medium', 'high']) {
      expect(platformProfile(effectiveProfile(id), 'macos')).toBe(effectiveProfile(id));
    }
  });

  it('a session that steps down to eco on Windows picks up the longer ceiling', () => {
    stepSessionProfile('medium');
    expect(platformProfile(effectiveProfile('medium'), 'windows').classifyTimeoutMs).toBe(45_000);
  });

  it('steps high → medium → eco and stays there, without changing a later read of the saved name until the session resets', () => {
    expect(stepSessionProfile('high')).toBe('medium');
    expect(sessionOverride()).toBe('medium');
    expect(effectiveProfile('high').id).toBe('medium');
    expect(stepSessionProfile('high')).toBe('eco');
    expect(stepSessionProfile('high')).toBe('eco');
    resetSessionProfile();
    expect(sessionOverride()).toBeNull();
    expect(effectiveProfile('high').id).toBe('high');
  });
});
