// Links a page's table of contents to the sections it points at.
//
// Both sides used to derive an anchor from their own text: the contents entry slugified its label,
// the section slugified its heading, and the two matched only when the words happened to be
// identical. In real content they rarely are — a contents entry paraphrases ("Welcome Bonus — No
// Fluff") what the section spells out ("899OK Welcome Bonus — The Real Terms") — so most links led
// nowhere.
//
// Position is the reliable relationship, not wording: a table of contents lists the sections that
// follow it, in order. That is knowable only where the whole page is visible, which is here rather
// than inside a block component.

const MAX_ANCHOR_LENGTH = 60;

function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ANCHOR_LENGTH)
    .replace(/-+$/g, '');
}

function firstOfType(content, type) {
  const list = Array.isArray(content) ? content : [];
  return list.find(
    (entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && entry.type === type,
  );
}

// Every block names its heading the same way now: the first `title` element in its content,
// wherever it sits — content order is the author's call, so it is not always entry zero.
function headingOf(block) {
  const title = firstOfType(block.props.content, 'title');
  return title && typeof title.text === 'string' ? title.text : '';
}

function uniqueAnchor(base, taken, index) {
  // An id may legally start with a digit in HTML, but the same string is then not a valid CSS
  // selector: `document.querySelector('#899ok-bonus')` throws. Headings here routinely start with
  // a brand name that begins with digits, so prefix those rather than hand out ids that break
  // every script and tool that later tries to select them.
  const safeBase = /^\d/.test(base) ? `s-${base}` : base;
  const candidate = safeBase === '' ? `section-${index + 1}` : safeBase;
  if (!taken.has(candidate)) return candidate;
  let suffix = 2;
  while (taken.has(`${candidate}-${suffix}`)) suffix += 1;
  return `${candidate}-${suffix}`;
}

export function linkAnchors(page) {
  const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
  const taken = new Set();

  // Anchor every block that carries a heading, whether or not a contents entry points at it: a
  // section can also be linked to from another page or from outside the site.
  blocks.forEach((block, index) => {
    if (!block || typeof block !== 'object' || !block.props) return;
    const heading = headingOf(block);
    if (block.type === 'toc' || heading.trim() === '') return;
    const anchor = uniqueAnchor(slugify(heading), taken, index);
    taken.add(anchor);
    block.props.anchor = anchor;
  });

  // Then hand each contents entry the anchor of the block it belongs to. The contents are the
  // first list in the toc block's content; the pairs are stored beside it as `tocLinks`, which the
  // toc block draws in that list's place. An entry with no block left to point at keeps its label
  // and simply is not a link.
  //
  // Position alone was enough while the contents listed an unbroken run of sections and every other
  // headed block came after them. It stops being enough the moment a page puts a headed block the
  // contents does not name — the "other pages" grid — between two blocks it does: every later
  // pairing shifts by one, and the entry for the FAQ points at that grid instead. The factory
  // writes a contents entry and the heading under it from the same plan, so the two are the same
  // string; matching on it puts each entry back on its own block. A hand-written page whose entries
  // paraphrase their headings ("Welcome Bonus — No Fluff" over "899OK Welcome Bonus — The Real
  // Terms") matches nothing and keeps the old behaviour exactly. The search never looks back past a
  // block an earlier entry already took, so repeated headings stay in their own order.
  for (const [index, block] of blocks.entries()) {
    if (block?.type !== 'toc' || !block.props) continue;
    const targets = blocks.slice(index + 1).filter((candidate) => candidate?.props?.anchor);
    const list = firstOfType(block.props.content, 'list');
    const labels = Array.isArray(list?.items) ? list.items : [];
    let next = 0;
    block.props.tocLinks = labels.map((label) => {
      const text = typeof label === 'string' ? label : '';
      const named = targets.findIndex((candidate, at) => at >= next && headingOf(candidate) === text);
      const chosen = named === -1 ? next : named;
      next = chosen + 1;
      return { label: text, anchor: targets[chosen]?.props.anchor ?? '' };
    });
  }

  return page;
}
