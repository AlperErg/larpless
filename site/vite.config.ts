import { defineConfig, type Plugin } from 'vite';

/** Share crawlers ignore a relative og:image. Set SITE_URL to the public origin when building. */
function shareImageOrigin(): Plugin {
  return {
    name: 'share-image-origin',
    transformIndexHtml(html) {
      const site = process.env.SITE_URL?.trim().replace(/\/$/, '');
      if (!site) return html;
      return html.replaceAll('./og.png', `${site}/og.png`);
    },
  };
}

export default defineConfig({
  base: './',
  server: { port: 5173 },
  plugins: [shareImageOrigin()],
});
