import { loadContext } from '../lib/site-context.mjs';
import { resolveOrigin, pageUrl, escapeXml } from '../lib/urls.mjs';

export function GET(context) {
  const { site } = loadContext();
  const origin = resolveOrigin(context.site, site.domain);
  const urls = site.pages
    .map((page) => `  <url><loc>${escapeXml(pageUrl(origin, page.slug))}</loc></url>`)
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
