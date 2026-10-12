import { matchDistractionSite, matchSite, matchStudySite, normalizeActivityCategory } from '../../src/core/sites';
import { matchDistraction, matchStudyTool } from '../../src/core/rules';

const logic = { id: 'lib_digital_logic', name: 'Digital Logic', color: 'yellow' as const, keywords: ['Vivado'] };

describe('sites', () => {
  it('maps known distractions to fixed categories', () => {
    expect(matchDistraction('Safari', 'Instagram')).toEqual({ activity: 'Social media' });
    expect(matchDistraction('Safari', 'Netflix')).toEqual({ activity: 'Video' });
    expect(matchDistraction('Safari', 'Amazon.com: Shopping Cart')).toEqual({ activity: 'Shopping' });
  });

  it('leaves plain YouTube and WhatsApp for the vision model', () => {
    expect(matchDistraction('Safari', 'Integration by parts – YouTube')).toBeNull();
    expect(matchDistraction('WhatsApp', 'Group project')).toBeNull();
  });

  it('LinkedIn is look, not an instant distraction', () => {
    const site = matchSite('Chrome', 'Feed | LinkedIn');
    expect(site?.mode).toBe('look');
    expect(site?.hint).toContain('LinkedIn');
    expect(matchDistractionSite('Chrome', 'Feed | LinkedIn')).toBeNull();
  });

  it('maps study tools through matchStudyTool', () => {
    expect(matchStudyTool('Vivado', 'sim_1', [logic])).toEqual({ moduleId: 'lib_digital_logic', activity: 'Vivado' });
  });

  it('normalizes legacy free-text labels to categories', () => {
    expect(normalizeActivityCategory('Messaging')).toBe('Chatting');
    expect(normalizeActivityCategory('Planning a party')).toBeNull();
    expect(normalizeActivityCategory('Social media')).toBe('Social media');
  });
});
