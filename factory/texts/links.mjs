// What a link target means, on this site, in one place.
//
// Both plan.mjs (which filters the plan's own list of link targets) and assemble.mjs (which checks
// links written inside the prose) have to agree on which spellings name a real page — otherwise one
// module ends up repairing what the other discards. This is that agreement, factored out so it is
// made once.
//
// The brief hands the model page names, not a spelling rule for addresses (see plan.mjs), so the
// model answering with a bare name ("casino") or the obvious slash-prefixed guess ("/home") is not
// a mistake — it is the model doing the reasonable thing with what it was given. This module is what
// turns any of those reasonable spellings into the one address the rendered site actually uses.

// The address a page is reached at. Every page but home is its own name with a leading slash; home
// is the one exception, since it renders at the site root rather than at "/home".
export function pageAddress(page) {
  return page === 'home' ? '/' : `/${page}`;
}

// A link target, spelled however the model wrote it, resolved to the canonical address of a page on
// this site — or `null` when it does not name one. Accepts a bare page name, a leading slash, a
// trailing slash and surrounding whitespace as the same target; an anchor (`#...`) is a link within
// the current page rather than a page of its own, so it passes through untouched, exactly as before
// this module existed.
export function resolveLink(target, pages) {
  const raw = String(target ?? '');
  if (raw.startsWith('#')) return raw;

  let trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed.length > 1 && trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1);

  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const address = withSlash === '/home' ? '/' : withSlash;

  const known = new Set(pages.map(pageAddress));
  return known.has(address) ? address : null;
}
