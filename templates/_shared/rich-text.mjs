// Inline links inside a piece of body text.
//
// The content format is otherwise flat: a `text` entry is a string, and a string is rendered as
// itself. The reference site links a few words mid-sentence ("the full casino lobby", "the
// sportsbook section") to other pages of the same site, and there was no way to say that — the
// spreadsheet the text arrives in has no formatting to carry it either.
//
// So one markup form is supported, and only one: [label](/href), the shape everyone already
// recognises from Markdown. It survives a spreadsheet cell, a CSV export and a JSON string
// unchanged, which is the whole reason for choosing it over real HTML.
//
// Nothing here can fail: text with no links is one plain part, and markup that does not parse
// stays on screen as the characters it is made of.

// A label may not contain "]" or a line break; an href may not contain ")" or whitespace. Both
// bounds are what keep a stray bracket in ordinary prose from swallowing the rest of a sentence.
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

// Only these can appear in a page this factory builds: a path inside the same site, an anchor on
// the page, an ordinary web address, or a way to contact someone. Everything else — most of all
// `javascript:` — is not a link, it is an attempt to run something, and the content is written by
// a third party. An href that fails this check does not throw and does not disappear: its label
// stays in the sentence as plain words (see parseRichText), because the sentence still reads.
export function isSafeHref(value) {
  const href = typeof value === 'string' ? value.trim() : '';
  if (href === '') return false;
  // "//host" is a protocol-relative link to somewhere else entirely; "/path" is this site.
  if (href.startsWith('//')) return false;
  if (href.startsWith('/') || href.startsWith('#')) return true;
  return /^(https?:\/\/|mailto:|tel:)/i.test(href);
}

// Splits a string into an ordered list of parts: `{ text }` for plain words, `{ text, href }` for
// a link. A part is never empty, so a caller can render the list as-is.
export function parseRichText(value) {
  const text = typeof value === 'string' ? value : '';
  if (text === '') return [];

  const parts = [];
  let position = 0;

  for (const match of text.matchAll(LINK)) {
    const [whole, label, href] = match;
    if (match.index > position) parts.push({ text: text.slice(position, match.index) });
    parts.push(isSafeHref(href) ? { text: label, href: href.trim() } : { text: label });
    position = match.index + whole.length;
  }

  if (position < text.length) parts.push({ text: text.slice(position) });
  return parts.filter((part) => part.text !== '');
}
