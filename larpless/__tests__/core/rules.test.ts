import type { StudyModule } from '../../src/contracts/domain';
import { DISTRACTION_RULES, matchDistraction, matchStudyTool } from '../../src/core/rules';

describe('rules.matchDistraction', () => {
  it('matches the PLAN §7 list case-insensitively, with nicely cased labels', () => {
    const cases: [string | null, string | null, string][] = [
      ['Safari', 'Instagram', 'Social media'],
      ['Google Chrome', 'TIKTOK - Make Your Day', 'Social media'],
      ['Safari', '(3) Facebook', 'Social media'],
      ['Firefox', 'r/memes - reddit', 'Social media'],
      ['Safari', 'Home / x.com', 'Social media'],
      ['Safari', 'Twitter', 'Social media'],
      ['Safari', 'Netflix', 'Video'],
      ['Safari', 'Twitch', 'Video'],
      ['Discord', '#general', 'Chatting'],
      ['Messenger', 'Chats', 'Chatting'],
      ['Steam', 'Library', 'Gaming'],
      ['Safari', 'Amazon.com: Shopping Cart', 'Shopping'],
      ['Safari', 'YouTube Shorts', 'Video'],
    ];
    for (const [app, title, label] of cases) {
      expect(matchDistraction(app, title)).toEqual({ activity: label });
    }
  });

  it('does not flag plain YouTube, study content or lookalike words', () => {
    expect(matchDistraction('Safari', 'Integration by parts – YouTube')).toBeNull();
    expect(matchDistraction('Preview', 'BIO101 Lecture 4 – Cell division.pdf')).toBeNull();
    expect(matchDistraction('Safari', 'Mainstream economics – notes')).toBeNull();
    expect(matchDistraction('Safari', 'netflix.com')).toEqual({ activity: 'Video' });
    expect(matchDistraction('Safari', 'box.com files')).toBeNull();
    expect(matchDistraction('WhatsApp', 'Group project')).toBeNull();
    expect(matchDistraction(null, null)).toBeNull();
    expect(matchDistraction('', '')).toBeNull();
  });

  it('exports the rule list for Settings', () => {
    expect(DISTRACTION_RULES.map((r) => r.label)).toContain('Instagram');
    expect(DISTRACTION_RULES.length).toBe(13);
  });
});

const logic: StudyModule = {
  id: 'lib_digital_logic',
  name: 'Digital Logic',
  color: 'yellow',
  keywords: ['Vivado', 'Verilog', 'FPGA'],
};
const arch: StudyModule = {
  id: 'mod_arch',
  name: 'Computer Architecture',
  color: 'blue',
  keywords: ['pipeline', 'processor'],
};
const bio: StudyModule = {
  id: 'lib_biology',
  name: 'Biology',
  color: 'green',
  keywords: ['cell'],
};

describe('rules.matchStudyTool', () => {
  it('maps Vivado and the other hardware tools onto Digital Logic', () => {
    expect(matchStudyTool('Vivado', 'sim_1 - Behavioral Simulation - Vivado 2024.1', [bio, logic])).toEqual({
      moduleId: 'lib_digital_logic',
      activity: 'Vivado',
    });
    expect(matchStudyTool('xsim', null, [logic])?.activity).toBe('Vivado');
    expect(matchStudyTool('ModelSim', 'wave', [logic])?.activity).toBe('ModelSim');
    expect(matchStudyTool('QuestaSim', null, [logic])?.moduleId).toBe('lib_digital_logic');
    expect(matchStudyTool('Quartus', 'Prime', [logic])?.activity).toBe('Quartus');
    expect(matchStudyTool('GTKWave', null, [logic])?.activity).toBe('GTKWave');
    expect(matchStudyTool('Logisim-evolution', 'main', [logic])?.activity).toBe('Logisim');
  });

  it('does not treat the word simulation, or a missing subject, as a study tool', () => {
    expect(matchStudyTool('Safari', 'flight simulation', [logic])).toBeNull();
    expect(matchStudyTool('Preview', 'Behavioral Simulation', [logic])).toBeNull();
    expect(matchStudyTool('Vivado', 'sim_1', [bio])).toBeNull();
    expect(matchStudyTool(null, null, [logic])).toBeNull();
  });

  it('prefers the student\'s own course, and a processor window over generic Digital Logic', () => {
    expect(matchStudyTool('Vivado', 'sim_1 - Behavioral Simulation', [arch, logic])).toEqual({
      moduleId: 'mod_arch',
      activity: 'Vivado',
    });
    const libArch: StudyModule = { ...arch, id: 'lib_computer_architecture' };
    expect(matchStudyTool('Vivado', 'pipeline_cpu - Vivado', [bio, logic, libArch])).toEqual({
      moduleId: 'lib_computer_architecture',
      activity: 'Vivado',
    });
    expect(matchStudyTool('RARS', 'riscv', [logic, libArch])?.moduleId).toBe('lib_computer_architecture');
  });
});
