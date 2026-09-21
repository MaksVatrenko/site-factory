// Converts a content spreadsheet exported as CSV into one page JSON.
//
// The spreadsheet's first column is a row marker: title, description, h1, h2, h3, table.
// An empty marker means the row is body text belonging to the section above it. Whether such
// a row is a paragraph or a list item is not marked at all, so the source is ambiguous by
// construction — this is where that ambiguity gets resolved once and written down explicitly,
// so nothing downstream has to guess again.
//
// Every block the converter writes is { type, content: [ … ] }, and every h1/h2/h3 row becomes a
// `title` entry carrying its tag as the key — { type: 'title', h2: '…' } — in exactly the position
// it was found. Unmarked rows become `text` or `list` entries the same way, and a `table` row a
// `table` entry. classify() below then looks at a section's whole content to recognise the handful
// of shapes the reference site renders differently (an FAQ, a table of contents, an "other pages"
// grid, a closing row of cards) — see its own comment. The page itself carries no address: that is
// the name of the file it is written to (src/lib/site-dir.mjs).
//
// Usage: node scripts/sheet-to-json.mjs <input.csv> [output.json]

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

// A spreadsheet exported as CSV. The rows are what the converter below actually works on, so a
// reader that already has them — scripts/xlsx.mjs, reading the .xlsx directly — hands them over
// instead of building a CSV for this to take apart again: a round trip through quoting is a round
// trip through a way to lose a comma.
export function sheetToPage(csvText) {
  return rowsToPage(parseCsv(csvText));
}

// One sheet, as a list of rows of cells, turned into one page.
export function rowsToPage(rawRows) {
  const rows = rawRows.map((cells) => cells.map((c) => String(c ?? "").trim()));
  const page = { title: '', description: '', blocks: [] };

  let current = null;
  let body = [];
  let table = null;

  // Body rows go into the open block's content in the order they were found — the hero's and a
  // section's alike, since every block is a content list now.
  const flushBody = () => {
    if (!current || body.length === 0) return;
    for (const part of splitBody(body)) {
      current.content.push(
        part.type === 'text'
          ? { type: 'text', text: part.text }
          : { type: 'list', items: part.items },
      );
    }
    body = [];
  };

  const flushSection = () => {
    flushBody();
    if (current) page.blocks.push(current);
    current = null;
    table = null;
  };

  // An h3/table marker needs a `section` to land in. The hero is the first screen, not a place for
  // subheadings and tables, so it is closed first and a fresh, possibly heading-less section is
  // opened — the same thing a stray h3 before the first h2 falls back to.
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
        current = { type: 'hero', content: [{ type: 'title', h1: stripEmoji(rest[0] || '') }] };
        break;
      case 'h2':
        flushSection();
        current = { type: 'section', content: [{ type: 'title', h2: stripEmoji(rest[0] || '') }] };
        break;
      case 'h3':
        flushBody();
        ensureSection();
        current.content.push({ type: 'title', h3: stripEmoji(rest[0] || '') });
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

const isTitle = (entry, tag) => entry.type === 'title' && typeof entry[tag] === 'string';

// Regroups a section's flat content back into "everything before the first h3" (`head` — the h2
// title plus whatever sits directly under it) and one group per h3 (that title plus everything up
// to the next one), which is the shape the pattern-recognition below reasons about.
function splitSubsections(content) {
  const head = [];
  const subs = [];
  for (const entry of content) {
    if (isTitle(entry, 'h3')) {
      subs.push({ heading: entry.h3, items: [] });
    } else if (subs.length > 0) {
      subs[subs.length - 1].items.push(entry);
    } else {
      head.push(entry);
    }
  }
  return { head, subs };
}

// The last two or three h3 subsections of a section are usually parallel sub-points rather than
// more prose — the reference site sets them side by side as framed cards. A trailing run of h3s
// carrying nothing but text is exactly that shape. The result is an ordinary `cards` element the
// JSON spells out in full, so it can be reordered, edited or split back into headings by hand.
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
    .flatMap((sub) => [{ type: 'title', h3: sub.heading }, ...sub.items]);
  const cards = subs.slice(start).map((sub) => {
    const text = sub.items.map((item) => item.text);
    // One sentence stays a string; several stay separate paragraphs.
    return { title: sub.heading, text: text.length === 1 ? text[0] : text };
  });

  return [...head, ...kept, { type: 'cards', items: cards }];
}

// The spreadsheet has no notion of block types — every section is just an h2, optionally followed
// by h3s. These are the shapes the reference site renders differently, recognised here once so the
// template does not have to pattern-match on headings:
//   - 3+ h3 subsections, every one of them a question, and no list or table anywhere in the
//     section -> `faq`: the h2 title, then one `toggle` per question.
//   - nothing but a single run of list items under the h2 -> `toc`: the title and that list.
//   - nothing at all under the h2 -> `links`, the reference site's "other pages" grid (its links
//     come from the site's nav, not the spreadsheet — see templates/template1/blocks/links.astro).
// Anything else stays an ordinary `section`, its trailing run of text-only h3s folded into cards.
//
// Exported so the same rules can be applied to page files converted before a shape was
// recognised. It only rewrites `section` blocks, so running it twice changes nothing the second time.
export function classify(page) {
  page.blocks = page.blocks.map((block) => {
    if (block.type !== 'section') return block;

    const content = Array.isArray(block.content) ? block.content : [];
    const h2 = content.find((entry) => isTitle(entry, 'h2'));
    const title = h2 ? [{ type: 'title', h2: h2.h2 }] : [];
    const { head, subs } = splitSubsections(content);
    const headBody = head.filter((entry) => entry !== h2);
    const hasTable = content.some((entry) => entry.type === 'table');
    const hasTopLevelList = headBody.some((entry) => entry.type === 'list');

    const isFaq =
      subs.length >= 3 && subs.every((s) => s.heading.includes('?')) && !hasTopLevelList && !hasTable;
    if (isFaq) {
      return {
        type: 'faq',
        content: [
          ...title,
          ...subs.map((s) => ({
            type: 'toggle',
            title: s.heading,
            text: s.items
              .filter((entry) => entry.type === 'text')
              .map((entry) => entry.text)
              .join(' '),
          })),
        ],
      };
    }

    const isToc =
      !hasTable && subs.length === 0 && headBody.length > 0 && headBody.every((e) => e.type === 'list');
    if (isToc) {
      return {
        type: 'toc',
        content: [...title, { type: 'list', items: headBody.flatMap((entry) => entry.items) }],
      };
    }

    // A section with a heading and nothing else is the reference site's "other pages" grid: the
    // spreadsheet holds only its title because the links come from the site's own page list.
    if (!hasTable && subs.length === 0 && headBody.length === 0) {
      return { type: 'links', content: title };
    }

    return { ...block, content: groupTrailingCards(content) };
  });
  return page;
}

// Guarded so importing this module (import-sheet.mjs does) cannot run the CLI path against the
// importer's own arguments.
const runDirectly = process.argv[1] && process.argv[1].endsWith('sheet-to-json.mjs');
const [input, output] = process.argv.slice(2);
if (runDirectly && input) {
  const page = sheetToPage(readFileSync(input, 'utf8'));
  const json = `${JSON.stringify(page, null, 2)}\n`;
  if (output) {
    writeFileSync(output, json);
    console.log(`${output}: ${page.blocks.length} блоков`);
  } else {
    process.stdout.write(json);
  }
}
