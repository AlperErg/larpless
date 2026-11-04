import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { defineConfig, type Plugin } from 'vite';

const SITE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(SITE_DIR, '..');
const REPO_URL = 'https://github.com/AlperErg/larpless/blob/main/';

const ORIGIN_TOKEN = '__SITE_ORIGIN__';

/**
 * Share crawlers ignore a relative og:image, and a canonical URL has to be absolute.
 * Netlify sets URL to the primary site origin at build time. SITE_URL overrides it
 * when the public domain is different from that URL.
 */
function siteOrigin(): string | undefined {
  const raw = (process.env.SITE_URL || process.env.URL)?.trim().replace(/\/$/, '');
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function applyOrigin(html: string, origin: string | undefined): string {
  if (origin) return html.replaceAll(ORIGIN_TOKEN, origin);

  const stripped = html
    .replace(/\s*<link rel="canonical" href="__SITE_ORIGIN__\/[^"]*"\s*\/?>/g, '')
    .replace(/\s*<meta property="og:url" content="__SITE_ORIGIN__\/[^"]*"\s*\/?>/g, '');
  return scrubLocalSchema(stripped.replaceAll(ORIGIN_TOKEN, '.'));
}

/** Drop absolute-only schema fields when the build has no public origin. */
function scrubLocalSchema(html: string): string {
  return html.replace(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    (_match, body: string) => {
      let data: unknown;
      try {
        data = JSON.parse(body);
      } catch {
        return `<script type="application/ld+json">${body}</script>`;
      }
      const scrub = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(scrub);
        if (!value || typeof value !== 'object') return value;
        const out: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value)) {
          if (typeof child === 'string' && (child === './' || child.startsWith('./#'))) continue;
          out[key] = scrub(child);
        }
        return out;
      };
      return `<script type="application/ld+json">\n${JSON.stringify(scrub(data), null, 2)}\n    </script>`;
    },
  );
}

function seo(): Plugin {
  const origin = siteOrigin();
  return {
    name: 'seo',
    transformIndexHtml(html) {
      return applyOrigin(html, origin);
    },
    generateBundle() {
      const robots = origin
        ? `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`
        : 'User-agent: *\nAllow: /\n';
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots });
      if (!origin) return;

      const lastmod = new Date().toISOString().slice(0, 10);
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${origin}/</loc>
    <lastmod>${lastmod}</lastmod>
    <image:image>
      <image:loc>${origin}/home.webp</image:loc>
      <image:caption>LarpLess home screen: Start session, Pomodoro presets, a streak heatmap, and recent sessions</image:caption>
    </image:image>
  </url>
  <url>
    <loc>${origin}/privacy/</loc>
    <lastmod>${lastmod}</lastmod>
  </url>
  <url>
    <loc>${origin}/terms/</loc>
    <lastmod>${lastmod}</lastmod>
  </url>
</urlset>
`;
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
    },
  };
}

/** The documents the legal pages render, from the repository root, and where each lives on the site. */
const LEGAL_PAGES: Record<string, string> = { 'PRIVACY.md': '../privacy/', 'TERMS.md': '../terms/' };
const LEGAL_MARKER = /<!--\s*legal:([A-Z]+\.md)\s*-->/;

/** GitHub's heading anchors, so links like #downloads-you-start work the same on both. */
function slug(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&[#a-z0-9]+;/gi, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/** Links between the documents go to their pages; other repository files go to GitHub. */
function legalHref(href: string): string {
  const [path, hash] = href.split('#');
  if (!path || /^[a-z]+:/i.test(href)) return href;
  const page = LEGAL_PAGES[path];
  if (page) return hash ? `${page}#${hash}` : page;
  return `${REPO_URL}${path}${hash ? `#${hash}` : ''}`;
}

function renderLegal(file: string): string {
  const marked = new Marked({
    gfm: true,
    walkTokens(token) {
      if (token.type === 'link') token.href = legalHref(token.href);
    },
  });
  const html = marked.parse(readFileSync(resolve(REPO_DIR, file), 'utf8'), { async: false });
  return html
    .replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_m, depth: string, inner: string) => `<h${depth} id="${slug(inner)}">${inner}</h${depth}>`)
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');
}

/**
 * /privacy/ and /terms/ are PRIVACY.md and TERMS.md at the repository root, rendered at build time
 * (and on every request in dev), so the site never holds a second, drifting copy of them.
 */
function legal(): Plugin {
  return {
    name: 'legal',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace(LEGAL_MARKER, (_m, file: string) => {
          if (!(file in LEGAL_PAGES)) throw new Error(`legal: unknown document ${file}`);
          return renderLegal(file);
        });
      },
    },
    configureServer(server) {
      const files = Object.keys(LEGAL_PAGES).map((f) => resolve(REPO_DIR, f));
      server.watcher.add(files);
      server.watcher.on('change', (changed) => {
        if (files.includes(changed)) server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

export default defineConfig({
  base: './',
  server: { port: 5173 },
  plugins: [legal(), seo()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(SITE_DIR, 'index.html'),
        privacy: resolve(SITE_DIR, 'privacy/index.html'),
        terms: resolve(SITE_DIR, 'terms/index.html'),
      },
    },
  },
});
