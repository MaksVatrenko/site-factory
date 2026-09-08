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
    const heading = typeof block.props.heading === 'string' ? block.props.heading : '';
    if (block.type === 'toc' || heading.trim() === '') return;
    const anchor = uniqueAnchor(slugify(heading), taken, index);
    taken.add(anchor);
    block.props.anchor = anchor;
  });

  // Then hand each contents entry the anchor of the section holding the same position after it.
  // An entry with no section left to point at keeps its label and simply is not a link.
  for (const [index, block] of blocks.entries()) {
    if (block?.type !== 'toc' || !block.props) continue;
    const targets = blocks.slice(index + 1).filter((candidate) => candidate?.props?.anchor);
    const labels = Array.isArray(block.props?.items) ? block.props.items : [];
    block.props.items = labels.map((label, position) => ({
      label: typeof label === 'string' ? label : '',
      anchor: targets[position]?.props.anchor ?? '',
    }));
  }

  return page;
}
