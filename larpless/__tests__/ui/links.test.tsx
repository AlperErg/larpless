import { Linking } from 'react-native';
import { DEFAULT_SETTINGS } from '../../src/config';
import { useAppStore } from '../../src/store/appStore';
import { buildCommands } from '../../src/ui/layout/CommandPalette';
import { APP_VERSION, feedbackUrl, openFeedback, PRIVACY_URL, TERMS_URL } from '../../src/ui/lib/links';

let openURL: jest.SpyInstance;

beforeEach(() => {
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => {
  openURL.mockRestore();
});

describe('feedback link', () => {
  it('opens the feedback form with the version, OS and screen check mode filled in, and nothing else', () => {
    const url = feedbackUrl({ version: '0.1.0', os: 'macOS 15.5', mode: 'classifier' });
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://github.com/AlperErg/larpless/issues/new');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      template: 'feedback.yml',
      version: '0.1.0',
      os: 'macOS 15.5',
      mode: 'On-device classifier',
    });
  });

  it('uses the running app’s version and the saved screen check mode', () => {
    const before = useAppStore.getState().settings;
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, classifierMode: 'vlm' } });
    try {
      openFeedback();
      const url = new URL(openURL.mock.calls[0][0] as string);
      expect(url.searchParams.get('version')).toBe(APP_VERSION);
      expect(url.searchParams.get('mode')).toBe('Vision LLM (Ollama)');
      expect(url.searchParams.get('os')).toMatch(/^(macOS|Windows) /);
    } finally {
      useAppStore.setState({ settings: before });
    }
  });
});

describe('palette Help commands', () => {
  it('sends feedback and opens the privacy policy and terms', () => {
    const help = buildCommands({ status: 'idle', demoFast: false, hasSummary: false, devTools: false }).filter((c) => c.group === 'Help');
    expect(help.map((c) => c.title)).toEqual(['Send feedback', 'Privacy Policy', 'Terms of Use']);
    help.forEach((c) => c.run());
    expect(openURL.mock.calls.map((c) => c[0] as string)).toEqual([expect.stringContaining('/issues/new?template=feedback.yml'), PRIVACY_URL, TERMS_URL]);
  });
});
