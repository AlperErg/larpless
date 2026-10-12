import type { StudyModule } from '../contracts/domain';

/**
 * Fast paths that never take a screenshot.
 * Distraction: a matching app or title is "Not study". Plain "YouTube" and WhatsApp are
 * deliberately absent: a lecture and a work chat both need a look at the screen.
 * Study tools: hardware design and CPU simulators. Their waveform view looks like a game to the
 * small vision model, which then labels a lab "simulation" and marks it distracted.
 */

export interface DistractionRule {
  /** Shown in the UI and used as the chunk activity, e.g. "Instagram". */
  label: string;
  /** Case-insensitive pattern tested against `appName + ' ' + windowTitle`. */
  pattern: RegExp;
}

// Word boundaries keep "x.com" from matching "netflix.com" and "steam" from matching "mainstream".
export const DISTRACTION_RULES: readonly DistractionRule[] = [
  { label: 'YouTube Shorts', pattern: /\byoutube shorts\b|youtube\.com\/shorts\b/i },
  { label: 'Instagram', pattern: /\binstagram\b/i },
  { label: 'TikTok', pattern: /\btiktok\b/i },
  { label: 'Facebook', pattern: /\bfacebook\b/i },
  { label: 'Reddit', pattern: /\breddit\b/i },
  { label: 'X', pattern: /(^|[^a-z0-9.])x\.com\b/i },
  { label: 'Twitter', pattern: /\btwitter\b/i },
  { label: 'Netflix', pattern: /\bnetflix\b/i },
  { label: 'Twitch', pattern: /\btwitch\b/i },
  { label: 'Discord', pattern: /\bdiscord\b/i },
  { label: 'Messenger', pattern: /\bmessenger\b/i },
  { label: 'Steam', pattern: /\bsteam\b/i },
  { label: 'Amazon', pattern: /\bamazon\b/i },
];

export function matchDistraction(
  appName: string | null | undefined,
  windowTitle: string | null | undefined,
): { activity: string } | null {
  const hay = `${appName ?? ''} ${windowTitle ?? ''}`.trim();
  if (!hay) return null;
  for (const rule of DISTRACTION_RULES) {
    if (rule.pattern.test(hay)) return { activity: rule.label };
  }
  return null;
}

export interface StudyToolRule {
  /** Shown under the subject on the panel, e.g. "Vivado". */
  label: string;
  /** Case-insensitive pattern tested against `appName + ' ' + windowTitle`. */
  pattern: RegExp;
  /** Built-in subject when the student has no course of their own for this tool. */
  subject: string;
}

// Product names only. "simulation" is not a rule: flight sims and games use that word too.
export const STUDY_TOOL_RULES: readonly StudyToolRule[] = [
  { label: 'Vivado', pattern: /\bvivado\b|\bxsim\b/i, subject: 'Digital Logic' },
  { label: 'ModelSim', pattern: /\bmodelsim\b|\bquestasim\b/i, subject: 'Digital Logic' },
  { label: 'Quartus', pattern: /\bquartus\b/i, subject: 'Digital Logic' },
  { label: 'GTKWave', pattern: /\bgtkwave\b/i, subject: 'Digital Logic' },
  { label: 'Logisim', pattern: /\blogisim\b/i, subject: 'Digital Logic' },
  { label: 'RARS', pattern: /\brars\b/i, subject: 'Computer Architecture' },
];

/** A student's own course wins when its name or keywords are about this kind of work. */
const OWN_COURSE_HINTS = [
  'computer architecture',
  'digital logic',
  'vivado',
  'verilog',
  'vhdl',
  'fpga',
  'modelsim',
  'quartus',
  'logisim',
  'gtkwave',
  'xsim',
  'processor',
  'pipeline',
  'datapath',
];

function courseBlob(module: Pick<StudyModule, 'name' | 'keywords'>): string {
  return [module.name, ...module.keywords].join(' ').toLowerCase();
}

/**
 * Known coursework tool → a module, with no screenshot.
 * A user course about the tool or the subject beats the built-in fallback.
 * Returns null when the tool is unknown, or when that subject isn't one of `modules`
 * (the caller then asks the vision model).
 */
export function matchStudyTool(
  appName: string | null | undefined,
  windowTitle: string | null | undefined,
  modules: readonly Pick<StudyModule, 'id' | 'name' | 'keywords'>[],
): { moduleId: string; activity: string } | null {
  const hay = `${appName ?? ''} ${windowTitle ?? ''}`.trim();
  if (!hay) return null;
  const rule = STUDY_TOOL_RULES.find((r) => r.pattern.test(hay));
  if (!rule) return null;

  const ownMatches = modules.filter(
    (m) => !m.id.startsWith('lib_') && OWN_COURSE_HINTS.some((h) => courseBlob(m).includes(h)),
  );
  const named = ownMatches.find((m) => m.name.toLowerCase() === rule.subject.toLowerCase());
  const architecture =
    /(?:^|[^a-z0-9])(computer architecture|processor|pipeline|datapath|risc-?v|mips|alu)(?=[^a-z0-9]|$)/i.test(hay)
      ? modules.find((m) => m.name.toLowerCase() === 'computer architecture')
      : undefined;
  const fallback = modules.find((m) => m.name.toLowerCase() === rule.subject.toLowerCase());
  const chosen = named ?? ownMatches[0] ?? architecture ?? fallback;
  if (!chosen) return null;
  return { moduleId: chosen.id, activity: rule.label };
}
