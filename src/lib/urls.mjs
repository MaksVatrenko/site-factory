const DEFAULT_ORIGIN = 'https://example.com';

function stripTrailingSlashes(value) {
  return value.replace(/\/+$/, '');
}

function isUsableOrigin(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function resolveOrigin(astroSite, domain) {
  if (astroSite) {
    return stripTrailingSlashes(astroSite.origin);
  }
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(domain);
  const candidate = stripTrailingSlashes(hasScheme ? domain : `https://${domain}`);
  return isUsableOrigin(candidate) ? candidate : DEFAULT_ORIGIN;
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
