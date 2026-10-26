import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../../src/config';
import { fixtureModules, fixtureSessions } from '../../src/fixtures/data';
import { mockNowPlaying } from '../../src/native/mock/nowPlaying';
import { resetMockScreen } from '../../src/native/mock/screen';
import { useAppStore } from '../../src/store/appStore';
import { getSessionController, useSessionStore } from '../../src/store/sessionStore';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('appStore (AsyncStorage)', () => {
  it('load keeps stored onboarded (own courses optional); save/update persist under fl:* keys', async () => {
    await AsyncStorage.setItem('fl:settings', JSON.stringify({ onboarded: true, volume: 0.8 }));
    await useAppStore.getState().load();
    expect(useAppStore.getState()).toMatchObject({ loaded: true, modules: [], sessions: [] });
    expect(useAppStore.getState().settings).toMatchObject({ onboarded: true, volume: 0.8, model: 'qwen3-vl:2b' });
    expect(useAppStore.getState().settings.nowPlayingEnabled).toBe(true);
    expect(mockNowPlaying.enabled).toBe(true);
    expect(mockNowPlaying).not.toHaveProperty('title');

    await useAppStore.getState().saveModules(fixtureModules);
    await useAppStore.getState().updateSettings({ onboarded: true, strictness: 5, nowPlayingEnabled: false });
    expect(mockNowPlaying.enabled).toBe(false);
    expect(JSON.parse((await AsyncStorage.getItem('fl:modules'))!)).toEqual(fixtureModules);
    expect(JSON.parse((await AsyncStorage.getItem('fl:settings'))!)).toMatchObject({ onboarded: true, strictness: 5 });

    await useAppStore.getState().updateSettings({ volume: 0.3, title: 'Secret Song', artist: 'Band' } as never);
    expect(useAppStore.getState().settings).not.toHaveProperty('title');
    expect(JSON.stringify(useAppStore.getState().settings)).not.toContain('Secret Song');
    expect(await AsyncStorage.getItem('fl:settings')).not.toContain('Secret Song');

    useAppStore.setState({ modules: [], loaded: false });
    await useAppStore.getState().load();
    expect(useAppStore.getState().modules).toEqual(fixtureModules);
    expect(useAppStore.getState().settings.onboarded).toBe(true);
  });

  it('deleteSession drops the session from state and storage', async () => {
    const [a, b] = fixtureSessions;
    await AsyncStorage.setItem('fl:sessions', JSON.stringify([a, b]));
    await useAppStore.getState().load();
    await useAppStore.getState().deleteSession(a.id);
    expect(useAppStore.getState().sessions.map((s) => s.id)).toEqual([b.id]);
    expect(JSON.parse((await AsyncStorage.getItem('fl:sessions'))!).map((s: { id: string }) => s.id)).toEqual([b.id]);
  });
});

describe('sessionStore wiring (mock native, mock classifier)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetMockScreen();
  });
  afterEach(() => {
    getSessionController().dispose();
    jest.useRealTimers();
  });

  it('store actions drive the controller end to end and the summary lands in the app store', async () => {
    expect(config.USE_MOCK_NATIVE).toBe(true);
    useAppStore.setState({ modules: fixtureModules, sessions: [] });
    await useAppStore.getState().updateSettings({ webcamEnabled: false });

    await useSessionStore.getState().start({ pomodoro: 'off' });
    expect(useSessionStore.getState().status).toBe('running');
    await jest.advanceTimersByTimeAsync(60_000);
    // Default power profile is medium: 15 s chunks, so a minute is four of them.
    expect(useSessionStore.getState().chunks).toHaveLength(4);
    expect(useSessionStore.getState().chunks[0]).toMatchObject({ kind: 'subject', moduleId: 'mod_biology' });

    const summary = await useSessionStore.getState().end();
    expect(useSessionStore.getState().status).toBe('ended');
    expect(useAppStore.getState().sessions[0]).toEqual(summary);
    expect(await useAppStore.getState().getChunks(summary!.id)).toHaveLength(4);

    // Stored values are labels only: no base64 JPEG and no window title fields.
    const keys = await AsyncStorage.getAllKeys();
    const values = await Promise.all(keys.filter((k) => k.startsWith('fl:')).map((k) => AsyncStorage.getItem(k)));
    const all = values.join('\n');
    expect(all).not.toContain('/9j/');
    expect(all).not.toContain('windowTitle');
  });
});
