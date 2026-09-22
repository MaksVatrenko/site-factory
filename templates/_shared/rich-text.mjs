// Inline markup inside a piece of body text.
//
// The content format is otherwise flat: a `text` entry is a string, and a string is rendered as
// itself. The reference sites do two things inside a sentence that a flat string cannot say. They
// link a few words mid-sentence ("the full casino lobby") to another page, and they emphasise a
// few more — the first words of a paragraph, a stake, the name of a table. Without the second one
// a page of ours is a flat wall of text beside the page it was copied from.
//
// So two markup forms are supported, and only two: [label](/href) and **words**, the shapes
// everyone already recognises from Markdown. Both survive a spreadsheet cell, a CSV export and a
// JSON string unchanged, which is the whole reason for choosing them over real HTML.
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

// A run of emphasis: **words**. Same bounds as a link label, and for the same reason — no line
// break inside, so a stray pair of asterisks in one paragraph cannot reach down and bold the next.
// At least one non-space character between the markers, so "2 ** 3 ** 4" stays arithmetic.
const STRONG = /\*\*([^*\n]*[^*\s\n][^*\n]*)\*\*/g;

// Splits one already-linked part into plain and emphasised pieces, keeping whatever the part
// carried. A link label may be emphasised — `[**the bonus**](/bonus)` — so this runs inside a link
// as readily as outside one, and the piece comes out both bold and a link.
function splitStrong(part) {
  const pieces = [];
  let position = 0;
  for (const match of part.text.matchAll(STRONG)) {
    if (match.index > position) pieces.push({ ...part, text: part.text.slice(position, match.index) });
    pieces.push({ ...part, text: match[1], strong: true });
    position = match.index + match[0].length;
  }
  if (position < part.text.length) pieces.push({ ...part, text: part.text.slice(position) });
  return pieces;
}

// Splits a string into an ordered list of parts: `{ text }` for plain words, plus `href` when the
// piece is a link and `strong: true` when it is emphasised. A part is never empty, so a caller can
// render the list as-is.
//
// Links first, emphasis second, because a link's href must not be searched for asterisks: an
// address may legitimately contain one, and a label may legitimately contain both markups at once.
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
  return parts.flatMap(splitStrong).filter((part) => part.text !== '');
}
