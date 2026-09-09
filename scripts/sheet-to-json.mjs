// Converts a content spreadsheet exported as CSV into one page JSON.
//
// The spreadsheet's first column is a row marker: title, description, h1, h2, h3, table.
// An empty marker means the row is body text belonging to the section above it. Whether such
// a row is a paragraph or a list item is not marked at all, so the source is ambiguous by
// construction — this is where that ambiguity gets resolved once and written down explicitly,
// so nothing downstream has to guess again.
//
// Every `h2`/`h3` row becomes a `title` entry (tag h2/h3) in that section's ordered `content`
// array, in exactly the position it was found — unmarked rows become `text` or `list` entries the
// same way, and a `table` row becomes a `table` entry. classify() below then looks at the whole
// `content` array to recognise the handful of shapes the reference site renders differently (an
// FAQ, a table of contents, an "other pages" links grid) — see its own comment.
//
// Usage: node scripts/sheet-to-json.mjs <input.csv> <slug> [output.json]

import { readFileSync, writeFileSync } from 'node:fs';

const EMOJI_START = /^\p{Extended_Pictographic}/u;

// The source spreadsheet decorates list items and table-of-contents entries with emoji. They are
// used here to tell a list item from a paragraph, and then stripped: the emoji never reaches the
// site. Variation selectors and zero-width joiners go too, otherwise a stripped compound emoji
// leaves invisible characters behind.
const EMOJI_ANYWHERE = /[\p{Extended_Pictographic}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}]/gu;

function stripEmoji(text) {
  return text.replace(EMOJI_ANYWHERE, '').replace(/\s{2,}/g, ' ').trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// A list opens when a paragraph ends in a colon, or when a row starts with an emoji, and it then
// runs on until a row ends in a full stop. That last part is what actually separates the two in
// this source: every list item is a fragment, and every paragraph is a finished sentence. Without
// it a list collapses back into paragraphs from its second row onward.
function classifyRow(text, previous, inList) {
  if (EMOJI_START.test(text)) return true;
  if (previous !== undefined && previous.trimEnd().endsWith(':')) return true;
  if (inList) return !/[.!?]$/.test(text.trimEnd());
  return false;
}

// Body rows arrive as a flat run. Split it into paragraphs and list items using the same rule
// the source site uses, keeping the two in the exact order they were found in — a `text`/`list`
// entry per run, so a section's `content` array can reproduce "paragraph, then list, then another
// paragraph" instead of collapsing every paragraph together and every list together.
function splitBody(lines) {
  const parts = [];
  let list = null;

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i];
    if (classifyRow(text, lines[i - 1], list !== null)) {
      if (!list) {
        list = { type: 'list', items: [] };
        parts.push(list);
      }
      list.items.push(stripEmoji(text));
    } else {
      list = null;
      parts.push({ type: 'text', text: stripEmoji(text) });
    }
  }
  return parts;
}

// Only `hero` still collects body text into separate paragraphs/list fields (see
// templates/review/blocks/hero.astro, untouched by the content-array refactor) — the two are
// concatenated across every run the same way this always worked, order between them not kept,
// because hero has never needed it.
function toParagraphsAndLists(lines) {
  const parts = splitBody(lines);
  return {
    paragraphs: parts.filter((p) => p.type === 'text').map((p) => p.text),
    lists: parts.filter((p) => p.type === 'list').map((p) => p.items),
  };
}

export function sheetToPage(csvText, slug) {
  const rows = parseCsv(csvText).map((cells) => cells.map((c) => c.trim()));
  const page = { slug, title: '', description: '', blocks: [] };

  let current = null;
  let body = [];
  let table = null;

  const flushHeroBody = () => {
    const { paragraphs, lists } = toParagraphsAndLists(body);
    if (paragraphs.length) current.paragraphs = [...(current.paragraphs || []), ...paragraphs];
    for (const items of lists) current.list = [...(current.list || []), ...items];
  };

  const flushSectionBody = () => {
    for (const part of splitBody(body)) {
      current.content.push(
        part.type === 'text'
          ? { type: 'text', text: part.text }
          : { type: 'list', items: part.items },
      );
    }
  };

  const flushBody = () => {
    if (!current || body.length === 0) return;
    if (current.type === 'hero') flushHeroBody();
    else flushSectionBody();
    body = [];
  };

  const flushSection = () => {
    flushBody();
    if (current) page.blocks.push(current);
    current = null;
    table = null;
  };

  // An h3/table marker needs a `section` (its `content` array) to land in. If the current block is
  // already one, it lands there; otherwise whatever is in progress (a hero, or nothing at all) is
  // flushed first and a fresh, possibly heading-less section is opened for it — the same thing a
  // stray h3 before the first h2 has always fallen back to, just now on a shape that can actually
  // hold it (a hero has no `content` array to push into).
  const ensureSection = () => {
    if (current?.type === 'section') return;
    if (current) page.blocks.push(current);
    current = { type: 'section', content: [] };
  };

  for (const cells of rows) {
    const marker = cells[0] || '';
    const rest = cells.slice(1).filter((c) => c !== '');

    if (marker === '' && rest.length === 0) {
      flushSection();
      continue;
    }

    switch (marker) {
      case 'title':
        page.title = stripEmoji(rest[0] || '');
        break;
      case 'description':
        page.description = stripEmoji(rest[0] || '');
        break;
      case 'h1':
        flushSection();
        current = { type: 'hero', heading: stripEmoji(rest[0] || '') };
        break;
      case 'h2':
        flushSection();
        current = {
          type: 'section',
          content: [{ type: 'title', tag: 'h2', text: stripEmoji(rest[0] || '') }],
        };
        break;
      case 'h3':
        flushBody();
        ensureSection();
        current.content.push({ type: 'title', tag: 'h3', text: stripEmoji(rest[0] || '') });
        break;
      case 'table':
        flushBody();
        ensureSection();
        table = { type: 'table', columns: rest.map(stripEmoji), rows: [] };
        current.content.push(table);
        break;
      default:
        if (table && rest.length > 1) {
          table.rows.push(rest.map(stripEmoji));
        } else {
          table = null;
          if (rest[0]) body.push(rest[0]);
        }
    }
  }
  flushSection();

  return classify(page);
}

// Regroups a section's flat `content` array back into "everything before the first h3" (`head` —
// the h2 title itself plus any paragraphs/lists/tables directly under it) and one group per h3
// title (that title plus everything up to the next one) — close enough to the old
// heading+subsections shape that the same pattern-recognition below still applies to it.
function splitSubsections(content) {
  const head = [];
  const subs = [];
  for (const entry of content) {
    if (entry.type === 'title' && entry.tag === 'h3') {
      subs.push({ heading: entry.text, items: [] });
    } else if (subs.length > 0) {
      subs[subs.length - 1].items.push(entry);
    } else {
      head.push(entry);
    }
  }
  return { head, subs };
}

// The last two or three h3 subsections of a section are usually parallel sub-points rather than
// more prose -- the reference site sets them side by side as framed cards. A trailing run of h3s
// that carry nothing but text is exactly that shape, and it is recognised here, once, for the same
// reason the block types below are: so the template renders what the content says instead of
// pattern-matching headings itself. The result is an ordinary `cards` element the JSON spells out
// in full, so it can be reordered, edited or split back into headings by hand afterwards.
//
// Two is the minimum: a single card is not a set, it is a subheading.
function groupTrailingCards(content) {
  const { head, subs } = splitSubsections(content);
  const isCard = (sub) => sub.items.length > 0 && sub.items.every((item) => item.type === 'text');

  let start = subs.length;
  while (start > 0 && isCard(subs[start - 1])) start -= 1;
  if (subs.length - start < 2) return content;

  const kept = subs
    .slice(0, start)
    .flatMap((sub) => [{ type: 'title', tag: 'h3', text: sub.heading }, ...sub.items]);
  const cards = subs.slice(start).map((sub) => ({
    type: 'card',
    title: sub.heading,
    text: sub.items.map((item) => item.text),
  }));

  return [
    ...head,
    ...kept,
    {
      type: 'cards',
      items: cards.map(({ title, text }) => ({
        title,
        // One sentence stays a string; several stay separate paragraphs.
        text: text.length === 1 ? text[0] : text,
      })),
    },
  ];
}

// The spreadsheet has no notion of block types — every section is just an h2, optionally followed
// by h3s. These are the shapes the reference site renders differently, recognised here once so the
// template does not have to pattern-match on headings:
//   - 3+ h3 subsections, every one of them a question, and no list or table anywhere in the
//     section -> `faq`, one item per subsection.
//   - nothing but a single run of list items under the h2 (no text, no table, no subsections)
//     -> `toc`, the page's own table of contents.
//   - nothing at all under the h2 -> `links`, the reference site's "other pages" grid (its own
//     links come from the site's nav, not the spreadsheet — see templates/review/blocks/links.astro).
// Anything else stays an ordinary `section`, its content array kept as it stands apart from the
// trailing-h3 run groupTrailingCards folds into a `cards` element.
//
// Exported so the same rules can be applied to page files that were converted before a shape was
// recognised, without re-downloading the spreadsheet: it maps blocks and re-reads nothing, so
// running it twice over the same page changes nothing the second time.
export function classify(page) {
  page.blocks = page.blocks.map((block) => {
    if (block.type !== 'section') return block;

    const content = Array.isArray(block.content) ? block.content : [];
    const h2 = content.find((entry) => entry.type === 'title' && entry.tag === 'h2');
    const heading = h2 ? h2.text : '';
    const { head, subs } = splitSubsections(content);
    const headBody = head.filter((entry) => entry !== h2);
    const hasTable = content.some((entry) => entry.type === 'table');
    const hasTopLevelList = headBody.some((entry) => entry.type === 'list');

    const isFaq =
      subs.length >= 3 && subs.every((s) => s.heading.includes('?')) && !hasTopLevelList && !hasTable;
    if (isFaq) {
      return {
        type: 'faq',
        heading,
        items: subs.map((s) => ({
          q: s.heading,
          a: s.items
            .filter((entry) => entry.type === 'text')
            .map((entry) => entry.text)
            .join(' '),
        })),
      };
    }

    const isToc =
      !hasTable && subs.length === 0 && headBody.length > 0 && headBody.every((e) => e.type === 'list');
    if (isToc) {
      return {
        type: 'toc',
        heading,
        items: headBody.filter((e) => e.type === 'list').flatMap((e) => e.items),
      };
    }

    // A section with a heading and nothing else is the reference site's "other pages" grid: the
    // spreadsheet holds only its title because the links come from the site's own page list.
    // Naming it here keeps the template from having to infer intent from emptiness.
    if (!hasTable && subs.length === 0 && headBody.length === 0) {
      return { type: 'links', heading };
    }

    return { ...block, content: groupTrailingCards(content) };
  });
  return page;
}

// Guarded so importing this module (import-sheet.mjs does) cannot run the CLI path against the
// importer's own arguments.
const runDirectly = process.argv[1] && process.argv[1].endsWith('sheet-to-json.mjs');
const [input, slug, output] = process.argv.slice(2);
if (runDirectly && input) {
  const page = sheetToPage(readFileSync(input, 'utf8'), slug || '/');
  const json = `${JSON.stringify(page, null, 2)}\n`;
  if (output) {
    writeFileSync(output, json);
    console.log(`${output}: ${page.blocks.length} блоков`);
  } else {
    process.stdout.write(json);
  }
}
