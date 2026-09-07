import { loadContext } from '../lib/site-context.mjs';
import { resolveOrigin } from '../lib/urls.mjs';

export function GET(context) {
  const { site } = loadContext();
  const origin = resolveOrigin(context.site, site.domain);
  const body = `User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
