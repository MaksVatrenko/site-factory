export function resolveOrigin(astroSite, domain) {
  if (astroSite) {
    return astroSite.origin.replace(/\/+$/, '');
  }
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(domain);
  const withScheme = hasScheme ? domain : `https://${domain}`;
  return withScheme.replace(/\/+$/, '');
}

export function pageUrl(origin, slug) {
  return new URL(slug, origin).href;
}

export function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
