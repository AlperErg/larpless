/**
 * VLM prompt, JSON schema and verdict parsing for the screen classifier.
 *
 * Node runs this file directly (scripts/bench-classifier.ts, type stripping), so it may only use
 * `import type` imports and erasable TypeScript: no enums, namespaces or parameter properties.
 */
import type { ScreenVerdict, StudyModule } from '../contracts/domain';

export const NOT_STUDY = 'Not study';
export const MAX_ACTIVITY_CHARS = 60;

export const SYSTEM = [
  'You label what a student is doing on their Mac for a study tracker. You get a screenshot of the main display, the frontmost app name, and its window title. Decide whether the visible content is studying for one of the student\'s modules.',
  '- Judge the content, not the app: a lecture on YouTube, slides in Preview, notes in Notion, a problem set in a browser or an IDE exercise all count as studying if they match a module.',
  '- Social media, messaging, games, shopping, entertainment video and unrelated news are "Not study".',
  '- Use the module keywords to pick the subject. If it\'s clearly study content but matches no module, pick the closest module and lower your confidence.',
  '- The window title is a strong hint; if it conflicts with the screenshot, trust the screenshot.',
  '- "activity": at most 6 words describing what is visible, e.g. "Reading cell division slides", "Scrolling Instagram feed".',
  '- "confidence": 0 to 1.',
  '',
  'Reply with JSON only, matching the schema.',
].join('\n');

export interface VerdictSchema {
  type: 'object';
  properties: {
    studying: { type: 'boolean' };
    subject: { type: 'string'; enum: string[] };
    activity: { type: 'string' };
    confidence: { type: 'number' };
  };
  required: string[];
}

export function buildSchema(moduleNames: string[]): VerdictSchema {
  return {
    type: 'object',
    properties: {
      studying: { type: 'boolean' },
      subject: { type: 'string', enum: [...moduleNames, NOT_STUDY] },
      activity: { type: 'string' },
      confidence: { type: 'number' },
    },
    required: ['studying', 'subject', 'activity', 'confidence'],
  };
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
  images?: string[];
}

export interface PromptInput {
  appName: string | null;
  windowTitle: string | null;
  modules: Pick<StudyModule, 'name' | 'keywords'>[];
  imageBase64: string;
}

export function buildUserText(
  appName: string | null,
  windowTitle: string | null,
  modules: Pick<StudyModule, 'name' | 'keywords'>[],
): string {
  const lines = [
    `Frontmost app: ${appName ?? 'unknown'}`,
    `Window title: ${windowTitle ?? 'unknown'}`,
    'Modules:',
    ...modules.map((m) => (m.keywords.length ? `- ${m.name}: ${m.keywords.join(', ')}` : `- ${m.name}`)),
  ];
  return lines.join('\n');
}

export function buildMessages({ appName, windowTitle, modules, imageBase64 }: PromptInput): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: buildUserText(appName, windowTitle, modules), images: [imageBase64] },
  ];
}

function findModule<M extends Pick<StudyModule, 'id' | 'name'>>(subject: string, modules: M[]): M | null {
  const exact = modules.find((m) => m.name === subject);
  if (exact) return exact;
  const wanted = subject.trim().toLowerCase();
  return modules.find((m) => m.name.trim().toLowerCase() === wanted) ?? null;
}

function clamp01(x: unknown): number {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN;
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function cleanActivity(x: unknown): string {
  if (typeof x !== 'string') return '';
  const one = x.replace(/\s+/g, ' ').trim();
  return one.length > MAX_ACTIVITY_CHARS ? one.slice(0, MAX_ACTIVITY_CHARS).trimEnd() : one;
}

/**
 * Turn the model's JSON (already parsed, or a JSON string) into a ScreenVerdict.
 * Returns null when the shape is unusable; the chunk then becomes `unknown`.
 */
export function parseVerdict(
  raw: unknown,
  modules: Pick<StudyModule, 'id' | 'name'>[],
): ScreenVerdict | null {
  let obj: unknown = raw;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const r = obj as Record<string, unknown>;
  if (typeof r.subject !== 'string') return null;

  const activity = cleanActivity(r.activity);
  const confidence = clamp01(r.confidence);
  const subject = r.subject.trim();

  if (subject.toLowerCase() === NOT_STUDY.toLowerCase()) {
    return { studying: false, moduleId: null, activity, confidence, source: 'vlm' };
  }
  const mod = findModule(subject, modules);
  if (!mod) return null;
  // A module subject with studying:false is the model contradicting itself; trust the boolean.
  const studying = typeof r.studying === 'boolean' ? r.studying : true;
  return {
    studying,
    moduleId: studying ? mod.id : null,
    activity,
    confidence,
    source: 'vlm',
  };
}
