/**
 * VLM prompt, JSON schema and verdict parsing for the screen classifier.
 *
 * Node runs this file directly (scripts/bench-classifier.ts, type stripping), so it may only use
 * `import type` imports and erasable TypeScript: no enums, namespaces or parameter properties.
 */
import type { ScreenVerdict, StudyModule } from '../contracts/domain';
import { ACTIVITY_CATEGORIES } from '../contracts/domain';
import { normalizeActivityCategory, siteLookHint } from './sites';

export const NOT_STUDY = 'Not study';
export const MAX_ACTIVITY_CHARS = 60;
/** Short "why distracted" line on the panel. Longer model text is cut on a word. */
export const MAX_REASON_CHARS = 32;

/**
 * Context window requested from Ollama (`options.num_ctx`). The runner reserves KV memory for the
 * whole window up front (~0.14 MiB/token on qwen3-vl:4b; the 2B default is less), so the server
 * default (often 32K, about 4.6 GB on the 4B) wastes RAM. A request is ~2,400 tokens with the full
 * subject library (~1,070 of them the image), so 4096 leaves room for ~75 more custom courses.
 */
export const NUM_CTX = 4096;

export const SYSTEM = [
  'You label what a student is doing on their Mac for a study tracker. You get a screenshot of the main display, the frontmost app name, and its window title. Decide whether the visible content is studying for one of the student\'s modules.',
  '- Judge the content, not the app: a lecture on YouTube, slides in Preview, notes in Notion, a problem set in a browser or an IDE exercise all count as studying if they match a module.',
  '- Looking things up is studying: search results, Wikipedia, documentation, Stack Overflow, papers, forums about a topic, or an AI assistant chat about coursework. ChatGPT, Claude, Gemini and similar chats are not messaging. An exam, a proof, lecture notes, or a course PDF in that chat is studying. Pick the module the work is about.',
  '- Code in an editor or IDE (Cursor, VS Code, Xcode, a terminal) is Coding unless the code is clearly about a more specific module (e.g. pandas or a Jupyter notebook is Data Science).',
  '- Hardware design tools are studying too: Vivado, ModelSim, QuestaSim, Quartus, GTKWave, Logisim, XSIM and their waveform or simulation views. A gate-level or FPGA lab is Digital Logic. A processor, pipeline, datapath or instruction-set assignment is Computer Architecture. Do not call these a game or "Not study".',
  '- A simulation, lab, homework or assignment is studying. "simulation" is never a reason for "Not study".',
  '- A virtual machine (UTM, Parallels, VMware, VirtualBox, QEMU) is a coursework tool: an OS, networking or security lab. Judge what runs inside it. Another desktop, a terminal, an installer or settings inside it is studying; pick Operating Systems, Cybersecurity or Coding.',
  '- In a chat, read the messages. A conversation about code, a repository, a branch, a model, an assignment, or how a project works is studying. Class diagrams, notes, PDFs, and project files are studying too. "Messaging" and "Online chatting" only name the app, so they are not a reason for "Not study". Use "Not study" only when the messages are clearly social and not about work or a course.',
  '- Only a screen you are sure is social media, a game, shopping, entertainment video or unrelated news is "Not study". If you are not sure, guess the closest module and lower your confidence. Do not use "Not study" as the default.',
  '- Use the module keywords to pick the subject. The list covers many fields: pick the most specific module that fits (e.g. Calculus over Maths, Digital Logic over Coding). If it\'s clearly study content but matches no module, pick the closest one and lower your confidence.',
  '- The window title is a strong hint; if it conflicts with the screenshot, trust the screenshot.',
  '- "confidence": 0 to 1, how certain you are that the subject you chose is correct. It is NOT the probability of studying: a clear social feed is "Not study" with confidence 0.9 or more; use low values only when you are unsure which label fits.',
  '- Do not describe the screen. The subject is the whole answer.',
  '- When the subject is "Not study", set "activity" to exactly one category from the schema list that matches what is on screen. Never invent a phrase. When the subject is a module, set "activity" to "".',
  '',
  `Reply with JSON only, matching the schema: {"studying": true or false, "subject": one of the module names or "Not study", "confidence": 0.0 to 1.0, "activity": "" or one of ${ACTIVITY_CATEGORIES.map((c) => `"${c}"`).join(', ')}`,
].join('\n');

/**
 * Qwen3-VL in Ollama 0.30.7 ignores `think:false` and always reasons first (2–30 s). Ending the
 * conversation with an empty think block as an assistant prefill skips the reasoning. Ollama then
 * stops enforcing `format`, so the schema is also spelled out in SYSTEM and parseVerdict validates.
 */
export const NO_THINK_PREFILL = '<think>\n\n</think>\n\n';

export interface VerdictSchema {
  type: 'object';
  properties: {
    studying: { type: 'boolean' };
    subject: { type: 'string'; enum: string[] };
    confidence: { type: 'number' };
    /** Optional. Only kept for "Not study"; studying verdicts drop it. */
    activity: { type: 'string'; enum?: string[] };
  };
  required: string[];
}

const ACTIVITY_ENUM = ['', ...ACTIVITY_CATEGORIES] as const;

export function buildSchema(moduleNames: string[]): VerdictSchema {
  return {
    type: 'object',
    properties: {
      studying: { type: 'boolean' },
      subject: { type: 'string', enum: [...moduleNames, NOT_STUDY] },
      confidence: { type: 'number' },
      activity: { type: 'string', enum: [...ACTIVITY_ENUM] },
    },
    required: ['studying', 'subject', 'confidence'],
  };
}

/** Distraction category for the panel. Unknown or invented text becomes empty. */
export function distractionCategory(raw: unknown, _windowTitle?: string | null): string {
  return normalizeActivityCategory(raw) ?? '';
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

export interface PromptInput {
  appName: string | null;
  windowTitle: string | null;
  modules: Pick<StudyModule, 'name' | 'keywords'>[];
  imageBase64: string;
  /** Append the empty-think assistant prefill (see NO_THINK_PREFILL). */
  prefillNoThink?: boolean;
}

/** Max keywords per subject sent to the model. */
export const PROMPT_KEYWORDS_PER_SUBJECT = 8;

/**
 * SYSTEM plus the module list. It's identical on every call of a session, so Ollama reuses its
 * processed tokens and only the screenshot and window line are new (bench: 5.3 s → 3.0 s per call
 * with the ~930-token library list). Keep anything that changes per call out of here.
 */
export function buildSystem(modules: Pick<StudyModule, 'name' | 'keywords'>[]): string {
  const lines = [
    SYSTEM,
    '',
    'Modules:',
    ...modules.map((m) => {
      // Cap hints per subject: the built-in library has ~44 subjects, and a long prompt costs latency.
      const kws = m.keywords.slice(0, PROMPT_KEYWORDS_PER_SUBJECT);
      return kws.length ? `- ${m.name}: ${kws.join(', ')}` : `- ${m.name}`;
    }),
  ];
  return lines.join('\n');
}

export function buildUserText(appName: string | null, windowTitle: string | null): string {
  const lines = [`Frontmost app: ${appName ?? 'unknown'}`, `Window title: ${windowTitle ?? 'unknown'}`];
  const hint = siteLookHint(appName, windowTitle);
  if (hint) lines.push(hint);
  return lines.join('\n');
}

/** Same window line as the vision prompt, without an image, so Windows can answer before a screenshot. */
export function buildTitleUserText(appName: string | null, windowTitle: string | null): string {
  return [
    'No screenshot this time. Judge from the app and window title only. If the title doesn\'t say what the page is about, answer with confidence below 0.5.',
    buildUserText(appName, windowTitle),
  ].join('\n');
}

export function buildMessages({ appName, windowTitle, modules, imageBase64, prefillNoThink }: PromptInput): ChatMessage[] {
  const msgs: ChatMessage[] = [
    { role: 'system', content: buildSystem(modules) },
    { role: 'user', content: buildUserText(appName, windowTitle), images: [imageBase64] },
  ];
  if (prefillNoThink) msgs.push({ role: 'assistant', content: NO_THINK_PREFILL });
  return msgs;
}

/**
 * The subject of a parsed reply when it names neither a module nor "Not study", else null.
 * The model sometimes answers with the course name it reads on screen ("Information Management I");
 * with the prefill, `format` no longer holds it to the enum.
 */
export function unknownSubject(raw: unknown, modules: Pick<StudyModule, 'id' | 'name'>[]): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const subject = (raw as Record<string, unknown>).subject;
  if (typeof subject !== 'string' || !subject.trim()) return null;
  const candidates = subjectCandidates(subject.trim());
  if (candidates.some((s) => s.toLowerCase() === NOT_STUDY.toLowerCase())) return null;
  return candidates.some((s) => findModule(s, modules)) ? null : subject.trim();
}

/**
 * Continue the conversation after a reply with an unknown subject. The prefix up to the screenshot is
 * unchanged, so Ollama reuses the processed image and this costs a fraction of the first call.
 */
export function buildRetryMessages(messages: ChatMessage[], reply: string, subject: string): ChatMessage[] {
  const last = messages[messages.length - 1];
  const prefill = last?.role === 'assistant' ? last.content : '';
  const head = prefill ? messages.slice(0, -1) : messages;
  const out: ChatMessage[] = [
    ...head,
    { role: 'assistant', content: prefill + reply },
    {
      role: 'user',
      content: `"${subject}" is not one of the module names. Answer again with the closest module name from the list, or "Not study". Same JSON format.`,
    },
  ];
  if (prefill) out.push({ role: 'assistant', content: prefill });
  return out;
}

/**
 * Pull the first JSON object out of a model reply (tolerates code fences or stray text, which can
 * happen when `format` isn't enforced). Returns the parsed value or null.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function findModule<M extends Pick<StudyModule, 'id' | 'name'>>(subject: string, modules: M[]): M | null {
  const exact = modules.find((m) => m.name === subject);
  if (exact) return exact;
  const wanted = subject.trim().toLowerCase();
  return modules.find((m) => m.name.trim().toLowerCase() === wanted) ?? null;
}

/**
 * The model sometimes copies a whole module line ("Biology: cell, mitosis") as the subject. Try the
 * full string first (a course may itself contain ':'), then the part before the first ':'.
 */
function subjectCandidates(subject: string): string[] {
  const i = subject.indexOf(':');
  return i > 0 ? [subject, subject.slice(0, i).trim()] : [subject];
}

function clamp01(x: unknown): number {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN;
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/**
 * Turn the model's JSON (already parsed, or a JSON string) into a ScreenVerdict.
 * Returns null when the shape is unusable; the chunk then becomes `unknown`.
 */
export function parseVerdict(
  raw: unknown,
  modules: Pick<StudyModule, 'id' | 'name'>[],
  windowTitle?: string | null,
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

  const confidence = clamp01(r.confidence);
  const candidates = subjectCandidates(r.subject.trim());

  if (candidates.some((s) => s.toLowerCase() === NOT_STUDY.toLowerCase())) {
    // Studying keeps the subject name. A distraction gets a short category, never the window title.
    return { studying: false, moduleId: null, activity: distractionCategory(r.activity, windowTitle), confidence, source: 'vlm' };
  }
  const mod = candidates.map((s) => findModule(s, modules)).find((m) => m !== null) ?? null;
  if (!mod) return null;
  // A module subject with studying:false is the model contradicting itself; trust the boolean.
  const studying = typeof r.studying === 'boolean' ? r.studying : true;
  return {
    studying,
    moduleId: studying ? mod.id : null,
    activity: studying ? '' : distractionCategory(r.activity, windowTitle),
    confidence,
    source: 'vlm',
  };
}
