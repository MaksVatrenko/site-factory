// What a link target means, on this site, in one place.
//
// Both plan.mjs (which filters the plan's own list of link targets) and assemble.mjs (which checks
// links written inside the prose) have to agree on which spellings name a real page — otherwise one
// module ends up repairing what the other discards. This is that agreement, factored out so it is
// made once.
//
// The same is true of what counts as a self-link (see isSelfLink below): a page linking to itself
// wastes a slot from the same per-page budget a link to a different page would have spent, so both
// callers need to tell the two apart and warn about them differently — that judgment belongs here
// too, next to the canonicalisation it is built on, rather than compared independently twice.
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

// Whether an address `resolveLink` already resolved names the very page it would sit on. A
// self-link helps nobody — the reader already has the page open, and a search engine gains nothing
// either — and worse, it spends a slot from the same per-page link budget a link to a different page
// would have used, which is exactly what that budget exists to ration. An anchor is never a
// self-link: it reaches a heading further down this same page, which is the one in-page link worth
// having, so it is excluded outright rather than by accident of never matching a page address.
//
// Takes the address `resolveLink` already produced, not the model's raw spelling: `resolveLink`
// collapses every spelling of home ("home", "/home", "/") onto the one address "/" before this ever
// runs, so a page planning itself as `home` is caught the same way under either spelling, not just
// the one the model happened to write.
export function isSelfLink(address, page) {
  return typeof address === 'string' && !address.startsWith('#') && address === pageAddress(page);
}
