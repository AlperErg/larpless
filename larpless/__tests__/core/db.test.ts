import { DEFAULT_SETTINGS } from '../../src/config';
import type { Chunk } from '../../src/contracts/domain';
import { createDb, createMemoryKv, KEYS } from '../../src/core/db';
import { fixtureChunks, fixtureModules, fixtureSessions } from '../../src/fixtures/data';

describe('db', () => {
  it('round-trips modules, settings, sessions and chunks through a Map', async () => {
    const kv = createMemoryKv();
    const db = createDb(kv);

    expect(await db.loadModules()).toEqual([]);
    await db.saveModules(fixtureModules);
    expect(await db.loadModules()).toEqual(fixtureModules);

    expect(await db.loadSettings()).toEqual(DEFAULT_SETTINGS);
    await db.saveSettings({ ...DEFAULT_SETTINGS, strictness: 5, onboarded: true });
    expect(await db.loadSettings()).toMatchObject({ strictness: 5, onboarded: true, model: 'qwen3-vl:2b' });

    // Saved out of order → listed newest first; same id replaces.
    const [a, b, c] = fixtureSessions;
    await db.saveSession(c);
    await db.saveSession(a);
    await db.saveSession(b);
    await db.saveSession({ ...a, focusPct: 1 });
    const list = await db.listSessions();
    expect(list.map((s) => s.id)).toEqual([a.id, b.id, c.id]);
    expect(list[0].focusPct).toBe(1);

    const chunks = fixtureChunks.slice(0, 5);
    await Promise.all(chunks.map((ch) => db.appendChunk(ch))); // concurrent appends are serialised
    expect(await db.getChunks(chunks[0].sessionId)).toEqual(chunks);
    expect(await db.getChunks('nope')).toEqual([]);

    expect([...kv.map.keys()].sort()).toEqual(['fl:chunks:ses_fixture', 'fl:modules', 'fl:sessions', 'fl:settings']);
  });

  it('updateChunk replaces by id; false when missing', async () => {
    const db = createDb(createMemoryKv());
    const ch = fixtureChunks[0];
    await db.appendChunk(ch);
    const relabelled: Chunk = { ...ch, kind: 'distracted', moduleId: null, reason: 'screen', source: 'user' };
    expect(await db.updateChunk(relabelled)).toBe(true);
    expect((await db.getChunks(ch.sessionId))[0]).toEqual(relabelled);
    expect(await db.updateChunk({ ...ch, id: 'other' })).toBe(false);
  });

  it('drops a track title stuffed into settings', async () => {
    const kv = createMemoryKv();
    const db = createDb(kv);
    await kv.setItem(KEYS.settings, JSON.stringify({ volume: 0.4, title: 'Secret Song', artist: 'Band' }));
    const loaded = await db.loadSettings();
    expect(loaded).toEqual({ ...DEFAULT_SETTINGS, volume: 0.4 });
    expect(JSON.stringify(loaded)).not.toContain('Secret Song');
    await db.saveSettings({ ...loaded, title: 'Nope' } as unknown as typeof DEFAULT_SETTINGS);
    const raw = kv.map.get(KEYS.settings)!;
    expect(raw).not.toContain('Nope');
    expect(raw).not.toContain('title');
    expect(raw).toContain('"volume":0.4');
  });

  it('settings saved before now playing still default the flag on', async () => {
    const kv = createMemoryKv();
    const db = createDb(kv);
    await kv.setItem(KEYS.settings, JSON.stringify({ volume: 0.2 }));
    const loaded = await db.loadSettings();
    expect(loaded.nowPlayingEnabled).toBe(true);
    expect(loaded).toEqual({ ...DEFAULT_SETTINGS, volume: 0.2 });
  });

  it('moves a saved qwen3-vl:4b default to the current model once', async () => {
    const kv = createMemoryKv();
    const db = createDb(kv);
    await kv.setItem(KEYS.settings, JSON.stringify({ model: 'qwen3-vl:4b', volume: 0.3 }));
    expect((await db.loadSettings()).model).toBe('qwen3-vl:2b');
    await db.saveSettings({ ...(await db.loadSettings()), model: 'qwen3-vl:4b' });
    expect((await db.loadSettings()).model).toBe('qwen3-vl:4b');
    await kv.setItem(KEYS.settings, JSON.stringify({ model: 'gemma3:4b' }));
    expect((await db.loadSettings()).model).toBe('gemma3:4b');
  });

  it('settings merge over DEFAULT_SETTINGS; corrupt values fall back', async () => {
    const kv = createMemoryKv();
    const db = createDb(kv);
    await kv.setItem(KEYS.settings, JSON.stringify({ volume: 0.9 }));
    expect(await db.loadSettings()).toEqual({ ...DEFAULT_SETTINGS, volume: 0.9 });
    await kv.setItem(KEYS.settings, '{not json');
    expect(await db.loadSettings()).toEqual(DEFAULT_SETTINGS);
    await kv.setItem(KEYS.settings, JSON.stringify({ powerProfile: 'turbo' }));
    expect((await db.loadSettings()).powerProfile).toBe('medium');
    await db.saveSettings({ ...DEFAULT_SETTINGS, powerProfile: 'turbo' } as unknown as typeof DEFAULT_SETTINGS);
    expect(kv.map.get(KEYS.settings)).not.toContain('turbo');
    expect((await db.loadSettings()).powerProfile).toBe('medium');
    for (const junk of [null, '', 'HIGH', 1]) {
      await db.saveSettings({ ...DEFAULT_SETTINGS, powerProfile: junk } as unknown as typeof DEFAULT_SETTINGS);
      expect((await db.loadSettings()).powerProfile).toBe('medium');
    }
    await kv.setItem(KEYS.settings, JSON.stringify({ appearance: 'neon', supabaseUrl: 12, supabaseAnonKey: { k: 1 } }));
    expect((await db.loadSettings()).appearance).toBe('system');
    expect((await db.loadSettings()).supabaseUrl).toBe('');
    expect((await db.loadSettings()).supabaseAnonKey).toBe('');
    await kv.setItem(KEYS.modules, '"oops"');
    expect(await db.loadModules()).toEqual([]);
  });

  it('persists only Chunk fields (no window titles or image data sneak in)', async () => {
    const kv = createMemoryKv();
    const db = createDb(kv);
    const dirty = { ...fixtureChunks[0], windowTitle: 'secret.pdf', jpegBase64: 'IMG' } as unknown as Chunk;
    await db.appendChunk(dirty);
    const raw = kv.map.get(KEYS.chunks(dirty.sessionId))!;
    expect(raw).not.toContain('secret.pdf');
    expect(raw).not.toContain('IMG');
  });
});
