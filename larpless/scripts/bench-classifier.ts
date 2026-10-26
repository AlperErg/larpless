/**
 * Classifier bench (WS-C). Run from larpless/:
 *
 *   node scripts/bench-classifier.ts --model qwen3-vl:2b
 *   node scripts/bench-classifier.ts --model qwen3-vl:8b --no-title
 *   node scripts/bench-classifier.ts --no-prefill      # let Qwen3-VL reason first (slow)
 *   node scripts/bench-classifier.ts --clean          # delete bench/ images afterwards
 *
 * Reads bench/*.png|jpg. Filename format:
 *   `<subject>__<category>__<desc>.png` — subject is a module name or `notstudy`; category is a fixed
 *   activity label (Social media, Video, …) scored when present.
 *   `<subject>__<desc>.png` — legacy; subject only.
 * Sidecar bench/<name>.json holds { appName, windowTitle } for the prompt. bench/ is gitignored.
 *
 * If bench/ has no images it renders 10 SYNTHETIC mock-ups (local HTML → headless Chrome on macOS,
 * Edge on Windows). It never captures the real screen. `--generate-only` also works on Windows, for
 * scripts/embed_bench.
 *
 * PRIVACY: prints file names, labels, confidences and latencies only — never image data.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { StudyModule } from '../src/contracts/domain';
import { buildMessages, buildSchema, extractJson, NOT_STUDY, NUM_CTX, parseVerdict } from '../src/core/prompt.ts';
import { normalizeActivityCategory } from '../src/core/sites.ts';

/* ------------------------------------------------------------------ */
/* Args                                                                */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const arg = (name: string, def: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const flag = (name: string): boolean => argv.includes(`--${name}`);

const MODEL = arg('model', 'qwen3-vl:2b');
const OLLAMA = arg('url', 'http://127.0.0.1:11434').replace(/\/+$/, '');
const NO_TITLE = flag('no-title');
const NO_THINK = !flag('omit-think'); // send think:false unless --omit-think
const CLEAN = flag('clean');
const ONLY_GENERATE = flag('generate-only');
const TIMEOUT_MS = Number(arg('timeout', '120000'));
const ONLY = arg('only', '');
const PREFILL = !flag('no-prefill'); // empty-think assistant prefill, as the app sends it

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(HERE, '..', 'bench');
const TMP = path.join(BENCH, '.tmp');
function resolveChrome(): string {
  const candidates =
    process.platform === 'win32'
      ? [
          process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error('Chrome or Edge not found (set bench/ images manually to skip synthetic render)');
}

/* Fixture modules (same as src/fixtures/data.ts). */
const MODULES: StudyModule[] = [
  { id: 'mod_biology', name: 'Biology', color: 'green', keywords: ['cell', 'mitosis', 'BIO101'] },
  { id: 'mod_maths', name: 'Maths', color: 'blue', keywords: ['integral', 'matrix', 'MATH201'] },
  { id: 'mod_history', name: 'History', color: 'orange', keywords: ['revolution', 'HIST110'] },
];

/* ------------------------------------------------------------------ */
/* Synthetic mock-ups                                                  */
/* ------------------------------------------------------------------ */

interface Scene {
  file: string; // <label>__<desc>
  appName: string;
  windowTitle: string;
  html: string;
  /** Library subjects that also count as correct (embed_bench scores against all 44; this bench uses 3 modules). */
  accept?: string[];
}

const FONT = `-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;

function desktop(appName: string, menus: string[], windowTitle: string, inner: string, opts: { url?: string; dark?: boolean } = {}): string {
  const bar = opts.url
    ? `<div class="tb"><span class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span>
         <span class="nav">‹ ›</span><div class="url">🔒 ${opts.url}</div></div>`
    : `<div class="tb"><span class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span>
         <div class="wt">${windowTitle}</div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{width:1440px;height:900px;overflow:hidden;font-family:${FONT};background:linear-gradient(135deg,#5b6d8a,#2c3a52)}
    .menubar{height:26px;background:rgba(240,240,240,.92);display:flex;align-items:center;gap:18px;padding:0 14px;font-size:13px;color:#222}
    .menubar b{font-weight:700}
    .menubar .r{margin-left:auto;display:flex;gap:14px}
    .win{position:absolute;left:30px;top:40px;width:1380px;height:845px;border-radius:10px;overflow:hidden;
         box-shadow:0 20px 50px rgba(0,0,0,.45);background:${opts.dark ? '#1e1e1e' : '#fff'};display:flex;flex-direction:column}
    .tb{height:44px;background:${opts.dark ? '#323233' : '#ececec'};display:flex;align-items:center;gap:14px;padding:0 14px;border-bottom:1px solid ${opts.dark ? '#111' : '#d5d5d5'}}
    .dots i{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:7px}
    .nav{color:#888;font-size:18px}
    .url{flex:1;max-width:760px;margin:0 auto;background:#fff;border-radius:7px;padding:6px 12px;font-size:13px;color:#444;text-align:center}
    .wt{flex:1;text-align:center;font-size:13px;color:${opts.dark ? '#ccc' : '#444'};margin-right:80px}
    .content{flex:1;position:relative;overflow:hidden}
  </style></head><body>
  <div class="menubar"><b></b><b>${appName}</b>${menus.map((m) => `<span>${m}</span>`).join('')}<span class="r"><span>🔋 82%</span><span>Wed 14:32</span></span></div>
  <div class="win">${bar}<div class="content">${inner}</div></div></body></html>`;
}

const BROWSER_MENUS = ['File', 'Edit', 'View', 'History', 'Bookmarks', 'Window', 'Help'];

function ytPage(videoInner: string, title: string, channel: string, views: string, side: string[]): string {
  return `<div style="display:flex;gap:24px;padding:20px 28px;background:#fff;height:100%">
    <div style="flex:1">
      <div style="height:520px;border-radius:12px;overflow:hidden;position:relative;background:#000">${videoInner}
        <div style="position:absolute;bottom:0;left:0;right:0;height:40px;background:linear-gradient(transparent,rgba(0,0,0,.7));color:#fff;font-size:13px;padding:14px">▶ ❚❚ 🔊 &nbsp; 12:41 / 48:05</div>
        <div style="position:absolute;bottom:38px;left:12px;right:12px;height:4px;background:#555"><div style="width:26%;height:4px;background:#f00"></div></div>
      </div>
      <div style="font-size:20px;font-weight:700;margin-top:14px;color:#0f0f0f">${title}</div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:10px;font-size:14px;color:#0f0f0f">
        <div style="width:40px;height:40px;border-radius:50%;background:#c33"></div><b>${channel}</b>
        <span style="background:#0f0f0f;color:#fff;border-radius:18px;padding:8px 16px">Subscribe</span>
        <span style="margin-left:auto;background:#eee;border-radius:18px;padding:8px 16px">👍 12K | 👎</span></div>
      <div style="background:#f2f2f2;border-radius:10px;padding:12px;margin-top:12px;font-size:13px;color:#333">${views}</div>
    </div>
    <div style="width:400px">${side
      .map(
        (s, i) => `<div style="display:flex;gap:8px;margin-bottom:10px"><div style="width:168px;height:94px;border-radius:8px;background:hsl(${i * 47},45%,55%)"></div>
          <div style="font-size:13px;font-weight:600;color:#0f0f0f">${s}<div style="font-weight:400;color:#606060;margin-top:4px">${Math.round(10 + i * 37)}K views</div></div></div>`,
      )
      .join('')}</div></div>`;
}

const SCENES: Scene[] = [
  {
    file: 'biology__lecture-slides',
    appName: 'Preview',
    windowTitle: 'BIO101 Lecture 4 – Cell division.pdf',
    html: desktop(
      'Preview',
      ['File', 'Edit', 'View', 'Go', 'Tools', 'Window', 'Help'],
      'BIO101 Lecture 4 – Cell division.pdf — Page 12 of 38',
      `<div style="display:flex;height:100%;background:#d9d9d9">
        <div style="width:150px;background:#e8e8e8;padding:10px">${[1, 2, 3, 4, 5]
          .map((i) => `<div style="height:84px;background:#fff;margin-bottom:10px;border:${i === 3 ? '3px solid #2c7be5' : '1px solid #bbb'}"></div>`)
          .join('')}</div>
        <div style="flex:1;display:flex;align-items:center;justify-content:center">
          <div style="width:1040px;height:585px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3);padding:44px 56px;font-family:Georgia,serif">
            <div style="font-size:15px;color:#2e7d32;font-family:${FONT};letter-spacing:1px">BIO101 · LECTURE 4</div>
            <div style="font-size:40px;font-weight:700;color:#1b3a1b;margin:8px 0 22px">Mitosis: the four phases of cell division</div>
            <div style="display:flex;gap:40px">
              <ul style="font-size:22px;line-height:1.7;color:#222;padding-left:24px;flex:1">
                <li><b>Prophase</b> – chromatin condenses into chromosomes</li>
                <li><b>Metaphase</b> – chromosomes align at the cell's equator</li>
                <li><b>Anaphase</b> – sister chromatids pulled to opposite poles</li>
                <li><b>Telophase</b> – nuclear envelopes re-form; cytokinesis</li>
              </ul>
              <div style="width:330px;display:flex;flex-wrap:wrap;gap:14px">${['Prophase', 'Metaphase', 'Anaphase', 'Telophase']
                .map(
                  (p) => `<div style="width:150px;height:150px;border-radius:50%;border:3px solid #66bb6a;background:#f1f8e9;display:flex;align-items:center;justify-content:center;font-size:13px;font-family:${FONT};color:#2e7d32">${p}<br>✕ ✕</div>`,
                )
                .join('')}</div>
            </div>
            <div style="position:absolute;bottom:90px;font-size:13px;color:#888;font-family:${FONT}">Slide 12 / 38</div>
          </div></div></div>`,
    ),
  },
  {
    file: 'maths__problem-set',
    accept: ['Calculus', 'Linear Algebra'],
    appName: 'Preview',
    windowTitle: 'MATH201 Problem set 3.pdf',
    html: desktop(
      'Preview',
      ['File', 'Edit', 'View', 'Go', 'Tools', 'Window', 'Help'],
      'MATH201 Problem set 3.pdf — Page 1 of 4',
      `<div style="height:100%;background:#d9d9d9;display:flex;justify-content:center;padding-top:24px">
        <div style="width:760px;height:1000px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3);padding:56px 64px;font-family:'Times New Roman',serif;color:#111">
          <div style="text-align:center;font-size:24px;font-weight:700">MATH201 — Calculus II</div>
          <div style="text-align:center;font-size:20px;margin:6px 0 4px">Problem Set 3: Techniques of Integration</div>
          <div style="text-align:center;font-size:15px;color:#444;margin-bottom:28px">Due Friday, 5 pm · Show all work</div>
          <div style="font-size:19px;line-height:2.1">
            <p><b>1.</b> Evaluate the integral &nbsp; <i>∫ x e<sup>x</sup> dx</i> &nbsp; using integration by parts.</p>
            <p><b>2.</b> Compute &nbsp; <i>∫<sub>0</sub><sup>π</sup> x² sin(x) dx</i>.</p>
            <p><b>3.</b> Use partial fractions to find &nbsp; <i>∫ (3x + 5) / (x² + x − 2) dx</i>.</p>
            <p><b>4.</b> Let A = [[2, 1], [1, 3]]. Find the eigenvalues of the matrix A and compute det(A).</p>
            <p><b>5.</b> Determine whether the improper integral &nbsp; <i>∫<sub>1</sub><sup>∞</sup> 1/x<sup>3/2</sup> dx</i> &nbsp; converges.</p>
            <p><b>6.</b> Trigonometric substitution: evaluate &nbsp; <i>∫ √(1 − x²) dx</i>.</p>
          </div></div></div>`,
    ),
  },
  {
    file: 'history__essay-notes',
    appName: 'Notion',
    windowTitle: 'HIST110 essay – Causes of the French Revolution',
    html: desktop(
      'Notion',
      ['File', 'Edit', 'View', 'History', 'Window', 'Help'],
      'HIST110 essay – Causes of the French Revolution',
      `<div style="display:flex;height:100%">
        <div style="width:240px;background:#f7f6f3;padding:14px;font-size:14px;color:#5f5e5b;line-height:2">
          <div style="font-weight:600;color:#37352f">🎓 University</div><div>📄 BIO101 notes</div><div>📄 MATH201</div>
          <div style="background:#e9e9e7;border-radius:4px;padding:0 6px;color:#37352f">📜 HIST110 essay</div><div>📅 Weekly plan</div></div>
        <div style="flex:1;padding:60px 120px;color:#37352f">
          <div style="font-size:52px">📜</div>
          <div style="font-size:38px;font-weight:700;margin:10px 0 18px">Causes of the French Revolution</div>
          <div style="font-size:14px;color:#787774;margin-bottom:22px">HIST110 · Essay draft · 1,450 / 2,500 words</div>
          <div style="font-size:17px;line-height:1.75">
            <p style="margin-bottom:14px">By 1789 the French monarchy faced a fiscal crisis. Decades of war, including support for the American Revolution, had left the crown deeply in debt, and the tax burden fell almost entirely on the Third Estate.</p>
            <h3 style="font-size:22px;margin:18px 0 8px">1. Social inequality under the Ancien Régime</h3>
            <p style="margin-bottom:14px">The clergy and nobility held privileges and tax exemptions, while peasants and the urban bourgeoisie paid the taille and seigneurial dues. Enlightenment writers such as Rousseau and Montesquieu questioned this order. Archive reference ZEBRASENTINEL.</p>
            <h3 style="font-size:22px;margin:18px 0 8px">2. The Estates-General and the Tennis Court Oath</h3>
            <p>When Louis XVI summoned the Estates-General in May 1789, the Third Estate declared itself the National Assembly …</p>
          </div></div></div>`,
    ),
  },
  {
    file: 'notstudy__instagram-feed',
    appName: 'Safari',
    windowTitle: 'Instagram',
    html: desktop(
      'Safari',
      BROWSER_MENUS,
      'Instagram',
      `<div style="display:flex;height:100%;background:#fff">
        <div style="width:240px;border-right:1px solid #dbdbdb;padding:28px 20px;font-size:16px;line-height:3;color:#262626">
          <div style="font-family:'Snell Roundhand',cursive;font-size:30px;line-height:1.6;margin-bottom:16px">Instagram</div>
          <div>🏠 Home</div><div>🔍 Search</div><div>🧭 Explore</div><div>🎬 Reels</div><div>✉️ Messages</div><div>❤️ Notifications</div></div>
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;padding-top:20px">
          <div style="display:flex;gap:16px;margin-bottom:22px">${['jess.travels', 'mike_eats', 'sunny.days', 'lena_k', 'tom.fit', 'ana.art', 'cityvibes']
            .map(
              (n, i) => `<div style="text-align:center;font-size:12px;color:#262626"><div style="width:62px;height:62px;border-radius:50%;padding:3px;background:linear-gradient(45deg,#f09433,#dc2743,#bc1888)"><div style="width:56px;height:56px;border-radius:50%;border:3px solid #fff;background:hsl(${i * 50},50%,60%)"></div></div>${n}</div>`,
            )
            .join('')}</div>
          <div style="width:470px;border-bottom:1px solid #dbdbdb">
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;font-size:14px"><div style="width:32px;height:32px;border-radius:50%;background:#e1306c"></div><b>jess.travels</b> · 2h<span style="margin-left:auto">•••</span></div>
            <div style="height:470px;border-radius:4px;background:linear-gradient(160deg,#ffb88c,#de6262 45%,#2c3e50);position:relative">
              <div style="position:absolute;bottom:40px;left:0;right:0;height:120px;background:linear-gradient(transparent,#1a2a3a)"></div>
              <div style="position:absolute;top:80px;left:180px;width:110px;height:110px;border-radius:50%;background:#ffe29a"></div></div>
            <div style="padding:10px 0;font-size:22px">♡ 💬 ➤ <span style="float:right">🔖</span></div>
            <div style="font-size:14px"><b>18,204 likes</b></div>
            <div style="font-size:14px;margin:4px 0 10px"><b>jess.travels</b> sunset in Santorini never gets old 🌅✨ #travel #summer</div></div>
        </div></div>`,
      { url: 'instagram.com' },
    ),
  },
  {
    file: 'maths__youtube-lecture',
    accept: ['Calculus'],
    appName: 'Safari',
    windowTitle: 'Integration by parts – YouTube',
    html: desktop(
      'Safari',
      BROWSER_MENUS,
      'Integration by parts – YouTube',
      ytPage(
        `<div style="position:absolute;inset:0;background:#1f3b2c;padding:40px 60px;color:#f5f5f0;font-family:'Chalkboard SE','Comic Sans MS',cursive">
          <div style="font-size:34px;margin-bottom:24px;text-decoration:underline">Integration by Parts</div>
          <div style="font-size:42px;margin-bottom:28px">∫ u dv = uv − ∫ v du</div>
          <div style="font-size:28px;line-height:1.7">Example: ∫ x eˣ dx<br>u = x &nbsp;&nbsp; dv = eˣ dx<br>du = dx &nbsp; v = eˣ<br>= x eˣ − ∫ eˣ dx = x eˣ − eˣ + C</div></div>`,
        'Integration by Parts — Calculus 2, Lecture 12',
        'Prof. Lee Calculus',
        '214K views · 2 years ago · Lecture 12 of the Calculus 2 course: integration by parts, the LIATE rule, and worked examples with definite integrals.',
        ['Trig substitution — Lecture 13', 'Partial fractions explained', 'Improper integrals in 20 minutes', 'Calculus 2 full course', 'Series and sequences intro'],
      ),
      { url: 'youtube.com/watch?v=q8Zt1b2RkLs' },
    ),
  },
  {
    file: 'notstudy__youtube-music',
    appName: 'Safari',
    windowTitle: 'Summer Nights (Official Music Video) – YouTube',
    html: desktop(
      'Safari',
      BROWSER_MENUS,
      'Summer Nights (Official Music Video) – YouTube',
      ytPage(
        `<div style="position:absolute;inset:0;background:linear-gradient(120deg,#ff3cac,#784ba0 50%,#2b86c5)">
          <div style="position:absolute;left:380px;top:120px;width:220px;height:300px;border-radius:110px 110px 20px 20px;background:rgba(20,10,40,.75)"></div>
          <div style="position:absolute;left:60px;bottom:80px;font-size:54px;color:#fff;font-weight:800;letter-spacing:4px;text-shadow:0 4px 12px rgba(0,0,0,.4)">SUMMER NIGHTS</div>
          <div style="position:absolute;left:64px;bottom:50px;font-size:20px;color:#fff">♪ NOVA RAY</div></div>`,
        'Nova Ray – Summer Nights (Official Music Video)',
        'NovaRayVEVO',
        '48M views · 3 months ago · Official music video for “Summer Nights” by Nova Ray. Stream the new album now 🎧 #music #pop',
        ['Nova Ray – Golden (Lyrics)', 'Top Hits 2026 playlist 🔥', 'Chill pop mix', 'Nova Ray live at the arena', 'Dance party hits'],
      ),
      { url: 'youtube.com/watch?v=Xs9mD7a1pQe' },
    ),
  },
  {
    file: 'notstudy__shopping',
    appName: 'Google Chrome',
    windowTitle: 'Running shoes – ShopMart',
    html: desktop(
      'Google Chrome',
      ['File', 'Edit', 'View', 'History', 'Bookmarks', 'Profiles', 'Tab', 'Window', 'Help'],
      'Running shoes – ShopMart',
      `<div style="background:#fff;height:100%">
        <div style="background:#131921;color:#fff;padding:14px 24px;display:flex;align-items:center;gap:24px;font-size:15px">
          <b style="font-size:24px">ShopMart</b><div style="flex:1;background:#fff;border-radius:6px;padding:9px;color:#555">running shoes men</div><span>🛒 Cart (2)</span></div>
        <div style="padding:16px 24px;font-size:14px;color:#555">1-24 of over 3,000 results for <b style="color:#c45500">"running shoes men"</b></div>
        <div style="display:flex;flex-wrap:wrap;gap:22px;padding:0 24px">${[
          ['AirStride Pro 3', '$89.99', '#e3f2fd'],
          ['TrailBlazer GTX', '$129.00', '#fce4ec'],
          ['CloudRun Lite', '$64.50', '#e8f5e9'],
          ['Velocity Knit 2', '$74.99', '#fff3e0'],
          ['UltraBoost Max', '$159.95', '#ede7f6'],
          ['Sprint Racer', '$54.00', '#f3e5f5'],
          ['Marathon Elite', '$139.99', '#e0f7fa'],
          ['Daily Trainer 5', '$69.99', '#fbe9e7'],
        ]
          .map(
            ([n, p, c]) => `<div style="width:310px;border:1px solid #ddd;border-radius:8px;padding:12px">
              <div style="height:150px;background:${c};border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:64px">👟</div>
              <div style="font-size:15px;margin:8px 0 4px">${n} Men's Running Shoe</div>
              <div style="color:#f90">★★★★☆ <span style="color:#007185">2,481</span></div>
              <div style="font-size:22px;font-weight:600;margin:4px 0">${p}</div>
              <div style="background:#ffd814;border-radius:16px;text-align:center;padding:6px;font-size:13px">Add to cart</div></div>`,
          )
          .join('')}</div></div>`,
      { url: 'shopmart.com/s?k=running+shoes+men' },
    ),
  },
  {
    file: 'notstudy__chat',
    appName: 'Messages',
    windowTitle: 'Messages',
    html: desktop(
      'Messages',
      ['File', 'Edit', 'View', 'Conversation', 'Window', 'Help'],
      'Messages',
      `<div style="display:flex;height:100%">
        <div style="width:320px;background:#f5f5f7;border-right:1px solid #ddd;padding:12px">${[
          ['Sam', 'lol did you see that video 😂'],
          ['Mom', 'Call me when you can'],
          ['Weekend crew', 'Who is bringing snacks?'],
          ['Alex', 'ok see you at 8'],
          ['Priya', 'haha yes!!'],
        ]
          .map(
            ([n, m], i) => `<div style="display:flex;gap:10px;padding:10px;border-radius:8px;${i === 2 ? 'background:#0a84ff;color:#fff' : ''}">
              <div style="width:42px;height:42px;border-radius:50%;background:hsl(${i * 70},40%,65%)"></div>
              <div style="font-size:14px"><b>${n}</b><div style="opacity:.8;margin-top:3px">${m}</div></div></div>`,
          )
          .join('')}</div>
        <div style="flex:1;display:flex;flex-direction:column;padding:20px 28px;gap:12px;font-size:16px">
          <div style="text-align:center;color:#888;font-size:13px">Weekend crew · Today 14:20</div>
          ${[
            ['l', 'Alex', 'are we still on for saturday??'],
            ['l', 'Priya', 'yesss beach day 🏖️'],
            ['r', '', 'I can drive, 3 seats left'],
            ['l', 'Sam', 'lol did you see that video 😂😂'],
            ['r', '', 'hahaha I watched it 5 times'],
            ['l', 'Alex', 'Who is bringing snacks?'],
            ['l', 'Priya', 'not me I brought them last time 😅'],
            ['r', '', 'fine I will get chips and drinks'],
          ]
            .map(([side, who, text]) =>
              side === 'r'
                ? `<div style="align-self:flex-end;background:#0a84ff;color:#fff;border-radius:18px;padding:9px 14px;max-width:60%">${text}</div>`
                : `<div style="align-self:flex-start;max-width:60%"><div style="font-size:12px;color:#888;margin-left:10px">${who}</div><div style="background:#e9e9eb;border-radius:18px;padding:9px 14px">${text}</div></div>`,
            )
            .join('')}
          <div style="margin-top:auto;border:1px solid #ccc;border-radius:18px;padding:9px 14px;color:#999">iMessage</div></div></div>`,
    ),
  },
  {
    file: 'maths__code-editor',
    accept: ['Linear Algebra', 'Coding'],
    appName: 'Code',
    windowTitle: 'matrix_hw.py — MATH201',
    html: desktop(
      'Code',
      ['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Window', 'Help'],
      'matrix_hw.py — MATH201',
      `<div style="display:flex;height:100%;background:#1e1e1e;color:#d4d4d4;font-family:Menlo,monospace;font-size:15px">
        <div style="width:240px;background:#252526;padding:12px;color:#ccc;font-size:13px;line-height:2;font-family:${FONT}">
          <div style="font-weight:700">MATH201</div><div>📁 assignments</div><div style="padding-left:14px;background:#37373d">🐍 matrix_hw.py</div><div style="padding-left:14px">🐍 integrals.py</div><div>📄 README.md</div></div>
        <div style="flex:1;padding:16px 0;line-height:1.65;white-space:pre">${[
          '<span style="color:#6a9955"># MATH201 Assignment 2: matrix multiplication, determinants, eigenvalues</span>',
          '<span style="color:#c586c0">import</span> numpy <span style="color:#c586c0">as</span> np',
          '',
          '<span style="color:#569cd6">def</span> <span style="color:#dcdcaa">matmul</span>(A, B):',
          '    <span style="color:#ce9178">"""Multiply two matrices without np.dot (exercise 1)."""</span>',
          '    n, m, p = <span style="color:#dcdcaa">len</span>(A), <span style="color:#dcdcaa">len</span>(B), <span style="color:#dcdcaa">len</span>(B[0])',
          '    C = [[0] * p <span style="color:#c586c0">for</span> _ <span style="color:#c586c0">in</span> <span style="color:#dcdcaa">range</span>(n)]',
          '    <span style="color:#c586c0">for</span> i <span style="color:#c586c0">in</span> <span style="color:#dcdcaa">range</span>(n):',
          '        <span style="color:#c586c0">for</span> j <span style="color:#c586c0">in</span> <span style="color:#dcdcaa">range</span>(p):',
          '            C[i][j] = <span style="color:#dcdcaa">sum</span>(A[i][k] * B[k][j] <span style="color:#c586c0">for</span> k <span style="color:#c586c0">in</span> <span style="color:#dcdcaa">range</span>(m))',
          '    <span style="color:#c586c0">return</span> C',
          '',
          '<span style="color:#569cd6">def</span> <span style="color:#dcdcaa">det2</span>(M):',
          '    <span style="color:#6a9955"># Exercise 2: determinant of a 2x2 matrix</span>',
          '    <span style="color:#c586c0">return</span> M[0][0] * M[1][1] - M[0][1] * M[1][0]',
          '',
          'A = np.array([[2, 1], [1, 3]])',
          '<span style="color:#dcdcaa">print</span>(<span style="color:#ce9178">"eigenvalues:"</span>, np.linalg.eigvals(A))',
        ]
          .map((l, i) => `<span style="color:#858585;display:inline-block;width:56px;text-align:right;margin-right:22px">${i + 1}</span>${l}`)
          .join('\n')}</div></div>`,
      { dark: true },
    ),
  },
  {
    file: 'notstudy__online-game',
    appName: 'Google Chrome',
    windowTitle: 'Block Blast Arena – Play free online',
    html: desktop(
      'Google Chrome',
      ['File', 'Edit', 'View', 'History', 'Bookmarks', 'Profiles', 'Tab', 'Window', 'Help'],
      'Block Blast Arena – Play free online',
      `<div style="height:100%;background:radial-gradient(circle at 50% 30%,#3a1c71,#120a2a);display:flex;align-items:center;justify-content:center;gap:50px;color:#fff">
        <div style="text-align:center"><div style="font-size:44px;font-weight:900;letter-spacing:2px;color:#ffd166;text-shadow:0 4px 0 #b5179e">BLOCK BLAST ARENA</div>
          <div style="display:grid;grid-template-columns:repeat(10,52px);gap:4px;margin-top:20px;padding:10px;background:rgba(255,255,255,.08);border-radius:10px">${Array.from({ length: 100 }, (_, i) => {
            const c = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#8338ec', 'transparent', 'transparent'][(i * 7 + (i % 3)) % 7];
            return `<div style="width:52px;height:52px;border-radius:8px;background:${c};${c === 'transparent' ? 'border:1px solid rgba(255,255,255,.12)' : 'box-shadow:inset 0 -5px rgba(0,0,0,.25)'}"></div>`;
          }).join('')}</div></div>
        <div style="width:260px;font-size:22px;line-height:2.2">
          <div>⭐ SCORE <b style="font-size:34px">48,250</b></div><div>🏆 BEST 61,900</div><div>🎮 LEVEL 7</div><div>💎 COMBO x4!</div>
          <div style="margin-top:20px;background:#06d6a0;color:#111;border-radius:30px;text-align:center;font-weight:800">PLAY AGAIN</div></div></div>`,
      { url: 'blockblastarena.io/play' },
    ),
  },
];

function generateSynthetic(): void {
  const chrome = resolveChrome();
  const htmlDir = path.join(TMP, 'html');
  const profile = path.join(TMP, 'chrome-profile');
  fs.mkdirSync(htmlDir, { recursive: true });
  for (const s of SCENES) {
    const htmlPath = path.join(htmlDir, `${s.file}.html`);
    fs.writeFileSync(htmlPath, s.html);
    const out = path.join(BENCH, `${s.file}.png`);
    execFileSync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${profile}`,
        '--window-size=1440,900',
        `--screenshot=${out}`,
        pathToFileURL(htmlPath).href,
      ],
      { stdio: 'ignore' },
    );
    fs.writeFileSync(
      path.join(BENCH, `${s.file}.json`),
      JSON.stringify({ appName: s.appName, windowTitle: s.windowTitle, synthetic: true, ...(s.accept ? { accept: s.accept } : {}) }),
    );
    console.log(`rendered ${s.file}.png`);
  }
  fs.rmSync(htmlDir, { recursive: true, force: true });
  fs.rmSync(profile, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ */
/* Bench                                                               */
/* ------------------------------------------------------------------ */

function listImages(): string[] {
  if (!fs.existsSync(BENCH)) return [];
  return fs
    .readdirSync(BENCH)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .filter((f) => !ONLY || f.includes(ONLY))
    .sort();
}

function expectedSubject(baseName: string): string {
  const prefix = baseName.split('__')[0].toLowerCase();
  if (prefix === 'notstudy') return NOT_STUDY;
  const mod = MODULES.find((m) => m.name.toLowerCase() === prefix);
  return mod ? mod.name : prefix;
}

function expectedFromFile(file: string): { subject: string; category: string | null } {
  const base = path.parse(file).name;
  const parts = base.split('__');
  const subject = expectedSubject(base);
  if (parts.length >= 3) {
    const cat = normalizeActivityCategory(parts[1]) ?? parts[1];
    return { subject, category: cat };
  }
  return { subject, category: null };
}

function downscale(file: string): string {
  const src = path.join(BENCH, file);
  if (process.platform !== 'darwin') return src;
  fs.mkdirSync(TMP, { recursive: true });
  const out = path.join(TMP, `${path.parse(file).name}.jpg`);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '--resampleWidth', '1280', src, '--out', out], {
    stdio: 'ignore',
  });
  return out;
}

interface ChatResult {
  ok: boolean;
  status: number;
  content: string | null;
  error: string | null;
  ms: number;
  loadMs: number;
  /** server-side breakdown: prompt eval (image encode) and generation, ms; output tokens */
  promptMs: number;
  evalMs: number;
  evalCount: number;
}

async function chat(imageBase64: string, appName: string | null, windowTitle: string | null, think: boolean): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: MODEL,
    stream: false,
    keep_alive: '30m',
    options: { temperature: 0, num_ctx: NUM_CTX },
    format: buildSchema(MODULES.map((m) => m.name)),
    messages: buildMessages({ appName, windowTitle, modules: MODULES, imageBase64, prefillNoThink: PREFILL }),
  };
  if (think) body.think = false;
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = (await res.json()) as {
      message?: { content?: string };
      error?: string;
      load_duration?: number;
      prompt_eval_duration?: number;
      eval_duration?: number;
      eval_count?: number;
    };
    return {
      ok: res.ok,
      status: res.status,
      content: data.message?.content ?? null,
      error: data.error ?? null,
      ms: Date.now() - t0,
      loadMs: Math.round((data.load_duration ?? 0) / 1e6),
      promptMs: Math.round((data.prompt_eval_duration ?? 0) / 1e6),
      evalMs: Math.round((data.eval_duration ?? 0) / 1e6),
      evalCount: data.eval_count ?? 0,
    };
  } catch (e) {
    return { ok: false, status: 0, content: null, error: String((e as Error).name), ms: Date.now() - t0, loadMs: 0, promptMs: 0, evalMs: 0, evalCount: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function main(): Promise<void> {
  fs.mkdirSync(BENCH, { recursive: true });
  let files = listImages();
  let synthetic = false;
  if (!files.length) {
    console.log('bench/ is empty → rendering 10 synthetic mock-ups with headless Chrome');
    generateSynthetic();
    files = listImages();
    synthetic = true;
  } else {
    synthetic = files.every((f) => {
      const side = path.join(BENCH, `${path.parse(f).name}.json`);
      return fs.existsSync(side) && JSON.parse(fs.readFileSync(side, 'utf8')).synthetic === true;
    });
  }
  if (ONLY_GENERATE) return;

  console.log(`\nmodel ${MODEL} · ${files.length} images${synthetic ? ' (synthetic)' : ''} · titles ${NO_TITLE ? 'OFF' : 'on'} · think:false ${NO_THINK ? 'sent' : 'omitted'} · prefill ${PREFILL ? 'ON' : 'off'}`);

  // Warm-up (loads the model; excluded from the latency stats).
  const warm = downscale(files[0]);
  let thinkOk = NO_THINK;
  let w = await chat(fs.readFileSync(warm).toString('base64'), 'Finder', 'Desktop', thinkOk);
  if (!w.ok && thinkOk && /think/i.test(w.error ?? '')) {
    console.log(`think:false rejected (${w.error}); retrying without it`);
    thinkOk = false;
    w = await chat(fs.readFileSync(warm).toString('base64'), 'Finder', 'Desktop', thinkOk);
  }
  console.log(`warm-up: ${w.ok ? 'ok' : `FAILED ${w.status} ${w.error}`} · ${w.ms} ms (model load ${w.loadMs} ms)`);
  if (!w.ok) process.exitCode = 1;

  const rows: {
    file: string;
    expected: string;
    expectedCategory: string | null;
    got: string;
    gotCategory: string;
    conf: string;
    ms: number;
    hit: boolean;
    categoryHit: boolean | null;
  }[] = [];
  for (const file of files) {
    const exp = expectedFromFile(file);
    const side = path.join(BENCH, `${path.parse(file).name}.json`);
    const meta = fs.existsSync(side) ? (JSON.parse(fs.readFileSync(side, 'utf8')) as { appName?: string; windowTitle?: string }) : {};
    const jpg = downscale(file);
    let b64: string | null = fs.readFileSync(jpg).toString('base64');
    const r = await chat(b64, meta.appName ?? null, NO_TITLE ? null : meta.windowTitle ?? null, thinkOk);
    b64 = null;
    fs.rmSync(jpg, { force: true });
    let got = 'null';
    let conf = '-';
    if (r.ok && r.content) {
      const v = parseVerdict(extractJson(r.content), MODULES);
      if (v) {
        got = v.studying ? MODULES.find((m) => m.id === v.moduleId)?.name ?? '?' : NOT_STUDY;
        conf = v.confidence.toFixed(2);
        const act = v.activity;
        const subjectHit = got === exp.subject;
        const categoryHit = exp.category === null ? null : act === exp.category;
        const hit = subjectHit && (categoryHit === null || categoryHit);
        rows.push({
          file,
          expected: exp.subject,
          expectedCategory: exp.category,
          got,
          gotCategory: act,
          conf,
          ms: r.ms,
          hit,
          categoryHit,
        });
        const catMark = exp.category === null ? '' : ` cat ${categoryHit ? '✓' : '✗'}`;
        console.log(`${pad(file, 34)} ${pad(exp.subject, 10)} ${pad(got, 10)} ${pad(conf, 5)} ${String(r.ms).padStart(6)} ms  ${hit ? '✓' : '✗'}${catMark}  [load ${r.loadMs} · img ${r.promptMs} · gen ${r.evalMs}/${r.evalCount}tok]  "${act}"`);
        continue;
      }
    }
    rows.push({
      file,
      expected: exp.subject,
      expectedCategory: exp.category,
      got,
      gotCategory: '',
      conf,
      ms: r.ms,
      hit: false,
      categoryHit: exp.category === null ? null : false,
    });
    console.log(`${pad(file, 34)} ${pad(exp.subject, 10)} ${pad(got, 10)} ${pad(conf, 5)} ${String(r.ms).padStart(6)} ms  ✗  ${r.error ?? ''}`);
  }

  const lat = rows.map((r) => r.ms).sort((a, b) => a - b);
  const hits = rows.filter((r) => r.hit).length;
  console.log('\n| file | expected | got | confidence | ms |');
  console.log('|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.file} | ${r.expected} | ${r.got}${r.hit ? '' : ' ✗'} | ${r.conf} | ${r.ms} |`);
  const catScored = rows.filter((r) => r.expectedCategory !== null);
  const catHits = catScored.filter((r) => r.categoryHit).length;
  console.log(
    `\nSUMMARY model=${MODEL} titles=${NO_TITLE ? 'off' : 'on'} prefill=${PREFILL ? 'on' : 'off'} subject=${hits}/${rows.length} category=${catScored.length ? `${catHits}/${catScored.length}` : 'n/a'} p50=${pct(lat, 50)}ms p90=${pct(lat, 90)}ms think:false=${thinkOk ? 'accepted' : 'not sent'}`,
  );

  fs.rmSync(TMP, { recursive: true, force: true });
  if (CLEAN) {
    for (const f of fs.readdirSync(BENCH)) {
      if (/\.(png|jpe?g|json)$/i.test(f)) fs.rmSync(path.join(BENCH, f), { force: true });
    }
    console.log('bench/ images deleted');
  }
}

main().catch((e) => {
  console.error('bench failed:', (e as Error).message);
  process.exitCode = 1;
});
