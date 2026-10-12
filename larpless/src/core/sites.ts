import type { ActivityCategory, StudyModule } from '../contracts/domain';
import { ACTIVITY_CATEGORIES } from '../contracts/domain';

export type SiteMode = 'distract' | 'study' | 'look';

export interface SiteEntry {
  /** Case-insensitive pattern on `appName + ' ' + windowTitle`. */
  pattern: RegExp;
  mode: SiteMode;
  /** Distraction category or default guess when the model picks "Not study". */
  category: ActivityCategory;
  /** Study-tool panel subtitle, e.g. "Vivado". */
  panelLabel?: string;
  /** Built-in subject when mode is study. */
  subject?: string;
  /** Extra user-message line when mode is look. */
  hint?: string;
}

/** First match wins. Put specific patterns (Shorts) before broad ones (YouTube). */
export const SITE_CATALOG: readonly SiteEntry[] = [
  { pattern: /\byoutube shorts\b|youtube\.com\/shorts\b/i, mode: 'distract', category: 'Video', panelLabel: 'YouTube Shorts' },
  { pattern: /\binstagram\b/i, mode: 'distract', category: 'Social media', panelLabel: 'Instagram' },
  { pattern: /\btiktok\b/i, mode: 'distract', category: 'Social media', panelLabel: 'TikTok' },
  { pattern: /\bfacebook\b/i, mode: 'distract', category: 'Social media', panelLabel: 'Facebook' },
  { pattern: /\breddit\b/i, mode: 'distract', category: 'Social media', panelLabel: 'Reddit' },
  { pattern: /(^|[^a-z0-9.])x\.com\b/i, mode: 'distract', category: 'Social media', panelLabel: 'X' },
  { pattern: /\btwitter\b/i, mode: 'distract', category: 'Social media', panelLabel: 'Twitter' },
  { pattern: /\bnetflix\b/i, mode: 'distract', category: 'Video', panelLabel: 'Netflix' },
  { pattern: /\btwitch\b/i, mode: 'distract', category: 'Video', panelLabel: 'Twitch' },
  { pattern: /\bdiscord\b/i, mode: 'distract', category: 'Chatting', panelLabel: 'Discord' },
  { pattern: /\bmessenger\b/i, mode: 'distract', category: 'Chatting', panelLabel: 'Messenger' },
  { pattern: /\bsteam\b/i, mode: 'distract', category: 'Gaming', panelLabel: 'Steam' },
  { pattern: /\bamazon\b/i, mode: 'distract', category: 'Shopping', panelLabel: 'Amazon' },

  { pattern: /\bvivado\b|\bxsim\b/i, mode: 'study', category: 'Other', panelLabel: 'Vivado', subject: 'Digital Logic' },
  { pattern: /\bmodelsim\b|\bquestasim\b/i, mode: 'study', category: 'Other', panelLabel: 'ModelSim', subject: 'Digital Logic' },
  { pattern: /\bquartus\b/i, mode: 'study', category: 'Other', panelLabel: 'Quartus', subject: 'Digital Logic' },
  { pattern: /\bgtkwave\b/i, mode: 'study', category: 'Other', panelLabel: 'GTKWave', subject: 'Digital Logic' },
  { pattern: /\blogisim\b/i, mode: 'study', category: 'Other', panelLabel: 'Logisim', subject: 'Digital Logic' },
  { pattern: /\brars\b/i, mode: 'study', category: 'Other', panelLabel: 'RARS', subject: 'Computer Architecture' },

  {
    pattern: /\blinkedin\b/i,
    mode: 'look',
    category: 'Social media',
    hint: 'LinkedIn: the feed is Social media (Not study); a job posting, course, or company page about coursework is studying.',
  },
  {
    pattern: /\b(chatgpt|claude|gemini|copilot|perplexity)\b/i,
    mode: 'look',
    category: 'Chatting',
    hint: 'This is an AI chat. Read the messages and any PDF. An exam, a proof, or a course problem is studying. Pick the closest module. Use activity "Chatting" only for clearly social chat; coursework leaves activity empty.',
  },
  {
    pattern: /\b(whatsapp|telegram|signal)\b/i,
    mode: 'look',
    category: 'Chatting',
    hint: 'This is a chat. Read the messages, not the app. Work or coursework in the thread is studying. Use "Chatting" only when the messages are clearly social.',
  },
  {
    pattern: /\b(messenger|messages|imessage)\b/i,
    mode: 'look',
    category: 'Chatting',
    hint: 'This is a chat. Read the messages. Coursework or work talk is studying.',
  },
  {
    pattern: /\byoutube\b/i,
    mode: 'look',
    category: 'Video',
    hint: 'YouTube: a lecture or tutorial matching a module is studying; entertainment is Video (Not study).',
  },
  {
    pattern: /\b(utm|parallels|vmware|virtualbox|qemu|hyper-v|virtual machine connection)\b/i,
    mode: 'look',
    category: 'Other',
    hint: 'This is a virtual machine. Judge what runs inside it, not the second desktop. A guest desktop, terminal, installer or settings is studying.',
  },
];

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

function haystack(appName: string | null | undefined, windowTitle: string | null | undefined): string {
  return `${appName ?? ''} ${windowTitle ?? ''}`.trim();
}

export function matchSite(appName: string | null | undefined, windowTitle: string | null | undefined): SiteEntry | null {
  const hay = haystack(appName, windowTitle);
  if (!hay) return null;
  return SITE_CATALOG.find((e) => e.pattern.test(hay)) ?? null;
}

/** Store-like window for rejecting bogus Shopping labels. */
export function isStoreWindow(appName: string | null, windowTitle: string | null): boolean {
  return /\b(amazon|ebay|etsy|shop|store|cart|checkout)\b/i.test(haystack(appName, windowTitle));
}

export function isChatSite(appName: string | null, windowTitle: string | null): boolean {
  const site = matchSite(appName, windowTitle);
  if (!site) return false;
  if (site.mode === 'look' && site.category === 'Chatting') return true;
  if (site.mode === 'distract' && site.category === 'Chatting') return true;
  return /\b(chatgpt|claude|gemini|copilot|perplexity)\b/i.test(haystack(appName, windowTitle));
}

export function isVirtualMachineApp(appName: string | null, windowTitle: string | null): boolean {
  return /\b(utm|parallels|vmware|virtualbox|qemu|hyper-v|virtual machine connection)\b/i.test(
    haystack(appName, windowTitle),
  );
}

const VM_DISTRACTION_CATEGORIES: ReadonlySet<ActivityCategory> = new Set([
  'Gaming',
  'Video',
  'Social media',
  'Shopping',
]);

export function vmShowsDistraction(activity: string): boolean {
  const cat = normalizeActivityCategory(activity);
  return cat !== null && VM_DISTRACTION_CATEGORIES.has(cat);
}

function courseBlob(module: Pick<StudyModule, 'name' | 'keywords'>): string {
  return [module.name, ...module.keywords].join(' ').toLowerCase();
}

export function matchStudySite(
  appName: string | null | undefined,
  windowTitle: string | null | undefined,
  modules: readonly Pick<StudyModule, 'id' | 'name' | 'keywords'>[],
): { moduleId: string; activity: string } | null {
  const site = matchSite(appName, windowTitle);
  if (!site || site.mode !== 'study' || !site.subject || !site.panelLabel) return null;
  const hay = haystack(appName, windowTitle);

  const ownMatches = modules.filter(
    (m) => !m.id.startsWith('lib_') && OWN_COURSE_HINTS.some((h) => courseBlob(m).includes(h)),
  );
  const named = ownMatches.find((m) => m.name.toLowerCase() === site.subject!.toLowerCase());
  const architecture =
    /(?:^|[^a-z0-9])(computer architecture|processor|pipeline|datapath|risc-?v|mips|alu)(?=[^a-z0-9]|$)/i.test(hay)
      ? modules.find((m) => m.name.toLowerCase() === 'computer architecture')
      : undefined;
  const fallback = modules.find((m) => m.name.toLowerCase() === site.subject!.toLowerCase());
  const chosen = named ?? ownMatches[0] ?? architecture ?? fallback;
  if (!chosen) return null;
  return { moduleId: chosen.id, activity: site.panelLabel };
}

export function matchDistractionSite(
  appName: string | null | undefined,
  windowTitle: string | null | undefined,
): { activity: string } | null {
  const site = matchSite(appName, windowTitle);
  if (!site || site.mode !== 'distract') return null;
  return { activity: site.category };
}

/** Settings and tests: distraction sites with a display name. */
export const DISTRACTION_SITES = SITE_CATALOG.filter((s) => s.mode === 'distract').map((s) => ({
  label: s.panelLabel ?? s.category,
  category: s.category,
}));

const LEGACY_ACTIVITY: Record<string, ActivityCategory> = {
  messaging: 'Chatting',
  chatting: 'Chatting',
  'online chatting': 'Chatting',
  'online shopping': 'Shopping',
  shopping: 'Shopping',
  'playing a game': 'Gaming',
  game: 'Gaming',
  gaming: 'Gaming',
};

/** Map model or legacy text to a fixed category, or null when unknown. */
export function normalizeActivityCategory(raw: unknown): ActivityCategory | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const exact = ACTIVITY_CATEGORIES.find((c) => c.toLowerCase() === text.toLowerCase());
  if (exact) return exact;
  const legacy = LEGACY_ACTIVITY[text.toLowerCase()];
  if (legacy) return legacy;
  for (const c of ACTIVITY_CATEGORIES) {
    if (text.toLowerCase().includes(c.toLowerCase())) return c;
  }
  return null;
}

export function siteLookHint(appName: string | null, windowTitle: string | null): string | null {
  const site = matchSite(appName, windowTitle);
  return site?.mode === 'look' ? (site.hint ?? null) : null;
}
