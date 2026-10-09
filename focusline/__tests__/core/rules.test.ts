import { DISTRACTION_RULES, matchDistraction } from '../../src/core/rules';

describe('rules.matchDistraction', () => {
  it('matches the PLAN §7 list case-insensitively, with nicely cased labels', () => {
    const cases: [string | null, string | null, string][] = [
      ['Safari', 'Instagram', 'Instagram'],
      ['Google Chrome', 'TIKTOK - Make Your Day', 'TikTok'],
      ['Safari', '(3) Facebook', 'Facebook'],
      ['Firefox', 'r/memes - reddit', 'Reddit'],
      ['Safari', 'Home / x.com', 'X'],
      ['Safari', 'Twitter', 'Twitter'],
      ['Safari', 'Netflix', 'Netflix'],
      ['Safari', 'Twitch', 'Twitch'],
      ['Discord', '#general', 'Discord'],
      ['WhatsApp', null, 'WhatsApp'],
      ['Messenger', 'Chats', 'Messenger'],
      ['Steam', 'Library', 'Steam'],
      ['Safari', 'Amazon.com: Shopping Cart', 'Amazon'],
      ['Safari', 'YouTube Shorts', 'YouTube Shorts'],
    ];
    for (const [app, title, label] of cases) {
      expect(matchDistraction(app, title)).toEqual({ activity: label });
    }
  });

  it('does not flag plain YouTube, study content or lookalike words', () => {
    expect(matchDistraction('Safari', 'Integration by parts – YouTube')).toBeNull();
    expect(matchDistraction('Preview', 'BIO101 Lecture 4 – Cell division.pdf')).toBeNull();
    expect(matchDistraction('Safari', 'Mainstream economics – notes')).toBeNull();
    expect(matchDistraction('Safari', 'netflix.com')).toEqual({ activity: 'Netflix' });
    expect(matchDistraction('Safari', 'box.com files')).toBeNull();
    expect(matchDistraction(null, null)).toBeNull();
    expect(matchDistraction('', '')).toBeNull();
  });

  it('exports the rule list for Settings', () => {
    expect(DISTRACTION_RULES.map((r) => r.label)).toContain('Instagram');
    expect(DISTRACTION_RULES.length).toBe(14);
  });
});
