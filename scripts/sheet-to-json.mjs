// Converts a content spreadsheet exported as CSV into one page JSON.
//
// The spreadsheet's first column is a row marker: title, description, h1, h2, h3, table.
// An empty marker means the row is body text belonging to the section above it. Whether such
// a row is a paragraph or a list item is not marked at all, so the source is ambiguous by
// construction — this is where that ambiguity gets resolved once and written down explicitly,
// so nothing downstream has to guess again.
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
// the source site uses, then keep the two apart in the output so the renderer never re-derives it.
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

function toParagraphsAndLists(lines) {
  const parts = splitBody(lines);
  return {
    paragraphs: parts.filter((p) => p.type === 'text').map((p) => p.text),
    lists: parts.filter((p) => p.type === 'list').map((p) => p.items),
    order: parts.map((p) => (p.type === 'text' ? 'text' : 'list')),
  };
}

export function sheetToPage(csvText, slug) {
  const rows = parseCsv(csvText).map((cells) => cells.map((c) => c.trim()));
  const page = { slug, title: '', description: '', blocks: [] };

  let current = null;
  let body = [];
  let table = null;

  const flushBody = () => {
    if (!current || body.length === 0) return;
    const { paragraphs, lists } = toParagraphsAndLists(body);
    const target = current.subsections?.length
      ? current.subsections[current.subsections.length - 1]
      : current;
    if (paragraphs.length) target.paragraphs = [...(target.paragraphs || []), ...paragraphs];
    for (const items of lists) target.list = [...(target.list || []), ...items];
    body = [];
  };

  const flushSection = () => {
    flushBody();
    if (current) page.blocks.push(current);
    current = null;
    table = null;
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
        current = { type: 'section', heading: stripEmoji(rest[0] || '') };
        break;
      case 'h3':
        flushBody();
        if (!current) current = { type: 'section', heading: '' };
        current.subsections = [...(current.subsections || []), { heading: stripEmoji(rest[0] || '') }];
        break;
      case 'table':
        flushBody();
        if (!current) current = { type: 'section', heading: '' };
        table = { columns: rest.map(stripEmoji), rows: [] };
        current.table = table;
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

// The spreadsheet has no notion of block types — every section is just an h2. These are the
// shapes the reference site renders differently, recognised here once so the template does not
// have to pattern-match on headings.
function classify(page) {
  page.blocks = page.blocks.map((block) => {
    if (block.type === 'hero') return block;

    const subs = block.subsections || [];
    const isFaq =
      subs.length >= 3 && subs.every((s) => s.heading?.includes('?')) && !block.list && !block.table;
    if (isFaq) {
      return {
        type: 'faq',
        heading: block.heading,
        items: subs.map((s) => ({ q: s.heading, a: (s.paragraphs || []).join(' ') })),
      };
    }

    if (!block.table && !subs.length && block.list && !block.paragraphs) {
      return { type: 'toc', heading: block.heading, items: block.list };
    }

    // A section with a heading and nothing else is the reference site's "other pages" grid: the
    // spreadsheet holds only its title because the links come from the site's own page list.
    // Naming it here keeps the template from having to infer intent from emptiness.
    if (!block.table && !subs.length && !block.list && !block.paragraphs) {
      return { type: 'links', heading: block.heading };
    }

    return block;
  });
  return page;
}

const [input, slug, output] = process.argv.slice(2);
if (input) {
  const page = sheetToPage(readFileSync(input, 'utf8'), slug || '/');
  const json = `${JSON.stringify(page, null, 2)}\n`;
  if (output) {
    writeFileSync(output, json);
    console.log(`${output}: ${page.blocks.length} блоков`);
  } else {
    process.stdout.write(json);
  }
}
