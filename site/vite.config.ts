import { defineConfig, type Plugin } from 'vite';

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
    .replace(/\s*<link rel="canonical" href="__SITE_ORIGIN__\/"\s*\/?>/g, '')
    .replace(/\s*<meta property="og:url" content="__SITE_ORIGIN__\/"\s*\/?>/g, '');
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
</urlset>
`;
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
    },
  };
}

export default defineConfig({
  base: './',
  server: { port: 5173 },
  plugins: [seo()],
});
