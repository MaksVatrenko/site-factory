import { loadContext } from '../lib/site-context.mjs';

export function GET(context) {
  const { site } = loadContext();
  const origin = (context.site?.origin ?? `https://${site.domain}`).replace(/\/$/, '');
  const urls = site.pages
    .map((page) => `  <url><loc>${origin}${page.slug}</loc></url>`)
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
