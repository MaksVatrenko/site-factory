import { loadContext } from '../lib/site-context.mjs';

export function GET(context) {
  const { site } = loadContext();
  const origin = (context.site?.origin ?? `https://${site.domain}`).replace(/\/$/, '');
  const body = `User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
