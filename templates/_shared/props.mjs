export function asList(value) {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((item) => item !== undefined && item !== null && item !== '');
}

export function asText(value, fallback = '') {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

export function asRecords(value) {
  return asList(value).filter((item) => typeof item === 'object' && !Array.isArray(item));
}

// Unicode "Combining Diacritical Marks" block (0x0300-0x036f): what NFKD decomposition leaves
// behind on a base letter (e.g. an acute accent splits off as "e" + one of these). Built from
// character codes rather than a regex literal containing the actual combining characters, so
// this file's source stays plain ASCII and legible instead of having marks that visually attach
// themselves to whatever glyph precedes them on screen.
const COMBINING_MARKS = new RegExp(
  '[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']',
  'g',
);

// Turns arbitrary heading text into a URL-safe anchor id: lowercased, diacritics stripped,
// anything that is not a-z/0-9 collapsed to a single hyphen, leading/trailing hyphens trimmed.
// Never throws -- a non-string or an all-symbol input just yields ''.
//
// Used to pair a `toc` block's item text with the matching `section`/`faq`/`links` block's own
// heading. A block component only ever receives its own props (see BlockRenderer.astro), never
// its page siblings', so there is no shared id to hand out from one place -- instead, both sides
// independently slugify text that a well-formed page already gives the same wording, and the
// generated ids agree. A toc item whose wording does not match any heading simply links to an id
// nothing on the page has; that is a dead anchor, not a crash.
export function slugify(value) {
  const text = typeof value === 'string' ? value : '';
  return text
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
