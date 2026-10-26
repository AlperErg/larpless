import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import App from '../../src/App';
import type { MenuCommand } from '../../src/contracts/native';
import { noticeGroups } from '../../src/legal/notices';
import type { NoticePlatform } from '../../src/legal/notices';
import { native } from '../../src/native';
import { useNavStore } from '../../src/store/navStore';
import { AcknowledgementsPage } from '../../src/ui/pages/AcknowledgementsPage';

function textOf(r: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (n == null) return;
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (typeof n === 'object' && 'children' in (n as object)) walk((n as { children: unknown }).children);
  };
  walk(r.toJSON());
  return out.join('');
}

const names = (platform: NoticePlatform) => noticeGroups(platform).flatMap((g) => g.notices.map((n) => n.name));

describe('acknowledgements data (scripts/acknowledgements.mjs)', () => {
  it('every notice carries a licence and its text', () => {
    for (const platform of ['macos', 'windows'] as const) {
      for (const g of noticeGroups(platform)) {
        for (const n of g.notices) {
          expect(n.license).toBeTruthy();
          expect(n.text.length).toBeGreaterThan(100);
        }
      }
    }
  });

  it('covers the fonts, the model, the JS runtime and the macOS native libraries', () => {
    expect(names('macos')).toEqual(
      expect.arrayContaining([
        'Inter',
        'Instrument Serif',
        'Ultralytics YOLO11n',
        'react',
        'react-native-macos',
        '@supabase/supabase-js',
        'zustand',
        'date-fns',
        '@react-native-async-storage/async-storage',
        'react-native-url-polyfill',
        'hermes-engine',
        'RCT-Folly',
        'glog',
        'DoubleConversion',
        'boost',
        'mediaremote-adapter',
      ]),
    );
  });

  it('each build lists only what it ships', () => {
    expect(names('macos')).not.toContain('react-native-windows');
    expect(names('windows')).toEqual(expect.arrayContaining(['react-native-windows', 'Inter', 'Ultralytics YOLO11n']));
    expect(names('windows')).not.toContain('react-native-macos');
    expect(names('windows')).not.toContain('mediaremote-adapter');
    expect(names('windows')).not.toContain('RCT-Folly');
  });

  // Metro resolves `.json` before `.ts` (Jest the other way round), so `legal/acknowledgements` next to
  // acknowledgements.json loaded the raw JSON in the app and the page crashed while these tests passed.
  it('no JSON in src/ shares a basename with a TS module', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(path.join(__dirname, '../../src'));
    const modules = new Set(files.filter((f) => /\.tsx?$/.test(f)).map((f) => f.replace(/\.tsx?$/, '')));
    expect(files.filter((f) => f.endsWith('.json') && modules.has(f.slice(0, -'.json'.length)))).toEqual([]);
  });
});

describe('AcknowledgementsPage', () => {
  beforeEach(() => {
    jest.useFakeTimers(); // toggle animations
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('lists every group and shows a licence when its row is opened', async () => {
    let r: ReactTestRenderer;
    await act(async () => {
      r = create(<AcknowledgementsPage />);
    });
    const t = textOf(r!);
    for (const g of noticeGroups('macos')) expect(t).toContain(g.title);
    expect(t).toContain('Instrument Serif');
    expect(t).not.toContain('SIL OPEN FONT LICENSE');

    const row = r!.root.findAll((n) => n.props.testID === 'toggle-Inter@4.001' && typeof n.props.onPress === 'function')[0];
    await act(async () => row.props.onPress());
    expect(textOf(r!)).toContain('Copyright 2016 The Inter Project Authors');
    expect(textOf(r!)).toContain('SIL OPEN FONT LICENSE Version 1.1');
    act(() => r!.unmount());
  });
});

describe('LarpLess → Acknowledgements (macOS app menu)', () => {
  it('opens the page and brings the window forward', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    let fire: ((c: MenuCommand) => void) | null = null;
    const listen = jest.spyOn(native.appShell, 'onMenuCommand').mockImplementation((cb) => {
      fire = cb;
      return () => {};
    });
    const front = jest.spyOn(native.appShell, 'bringToFront');
    let r: ReactTestRenderer;
    await act(async () => {
      r = create(<App />);
    });
    act(() => fire!('acknowledgements'));
    expect(useNavStore.getState().route).toBe('acknowledgements');
    expect(front).toHaveBeenCalled();
    act(() => r!.unmount());
    listen.mockRestore();
    front.mockRestore();
    useNavStore.setState({ route: 'home', params: {}, paletteOpen: false });
  });
});
