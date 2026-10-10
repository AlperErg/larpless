/**
 * Platform switches for the Windows port: macOS (and anything that isn't Windows) keeps the original values,
 * Windows gets its own key shape, shortcut glyphs, wording and system fonts.
 */
type PlatformModules = {
  platform: typeof import('../../src/ui/platform');
  mac: typeof import('../../src/ui/components/mac');
  theme: typeof import('../../src/ui/theme');
};

/** Load the modules fresh with `Platform.OS` set to `os` (they read it at import time). */
function loadAs(os: string): PlatformModules {
  let out!: PlatformModules;
  jest.isolateModules(() => {
    const { Platform } = require('react-native');
    jest.replaceProperty(Platform, 'OS', os);
    out = {
      platform: require('../../src/ui/platform'),
      mac: require('../../src/ui/components/mac'),
      theme: require('../../src/ui/theme'),
    };
  });
  return out;
}

afterEach(() => jest.restoreAllMocks());

describe.each(['macos', 'ios'])('on %s', (os) => {
  const { platform, mac, theme } = loadAs(os);

  it('keeps the macOS glyphs and copy', () => {
    expect(platform.IS_WINDOWS).toBe(false);
    expect(`${platform.MOD}K`).toBe('⌘K');
    expect(`${platform.ALT}click`).toBe('⌥click');
    expect(platform.DEVICE).toBe('Mac');
  });

  it('passes keyDownEvents through unchanged', () => {
    const keys = [{ key: 'Escape' }, { key: 'k', metaKey: true }];
    expect(mac.handledKeys(keys)).toBe(keys);
  });

  it('keeps the bundled fonts', () => {
    expect(theme.fonts.semibold).toBe('Inter-SemiBold');
    expect(theme.fonts.serif).toBe('InstrumentSerif-Regular');
    expect(theme.fonts.mono).toBe('Menlo');
  });
});

describe('on windows', () => {
  const { platform, mac, theme } = loadAs('windows');

  it('spells out shortcuts and says PC', () => {
    expect(platform.IS_WINDOWS).toBe(true);
    expect(`${platform.MOD}K`).toBe('Ctrl+K');
    expect(`${platform.ALT}click`).toBe('Alt+click');
    expect(platform.DEVICE).toBe('PC');
  });

  it('maps keyDownEvents to the react-native-windows `code` shape', () => {
    expect(
      mac.handledKeys([{ key: 'ArrowUp' }, { key: 'Enter' }, { key: 'Escape' }, { key: 'k', ctrlKey: true }]),
    ).toEqual([{ code: 'ArrowUp' }, { code: 'Enter' }, { code: 'Escape' }, { code: 'KeyK', ctrlKey: true }]);
  });

  it('uses system fonts', () => {
    expect(theme.fonts.regular).toBe('Segoe UI');
    expect(theme.fonts.semibold).toBe('Segoe UI Semibold');
    expect(theme.fonts.mono).toBe('Consolas');
  });
});
