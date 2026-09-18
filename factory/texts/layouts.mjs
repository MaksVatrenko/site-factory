import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// What a page is made of: which blocks, in what order, how many. Layouts live in layouts/ rather
// than inside a theme because composition does not depend on looks — the same long review reads the
// same whether it is drawn dark or light — so a second theme arrives without any layout being
// rewritten, and a second composition without any theme being touched.
//
// The division of labour with templates/<id>/blocks.json is strict, and this module is where it is
// enforced: the block owns its nature (does it carry a picture, a heading, the page's h1, does the
// factory fill it), the layout owns only the composition and the numbers inside it. A layout may
// pick a number out of a range the theme allows; it may not turn a nature on or off.
//
// Everything here is free and runs before the first paid request, which is the point: a layout that
// names a block nobody can draw, or asks for twenty questions where the theme carries eight, is a
// page that comes out wrong, and it costs nothing to say so now instead of after ten pages of
// generation have been paid for.

// Kept here rather than shared: the check is three words long, and a module that owns its own tiny
// guards can be read without opening a second file.
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A layout file, read and checked for shape but not yet understood: what its blocks mean takes a
// theme, and the same file is resolved against a different one on the next run. `id` is the file
// name, because that is what the owner types on the command line and what gets written into the
// page — a `name` field is free to be prose, and free to change, without moving anything.
export function loadLayouts(dir) {
  if (!existsSync(dir)) throw new Error(`нет папки с раскладками ${dir}`);
  const files = readdirSync(dir).filter((file) => file.endsWith('.json')).sort();
  // Two messages, not one: a typo in the path and an empty folder send the reader to two different
  // places, and "не найдено ни одной раскладки в /wrong/path" sends them to the wrong one.
  if (files.length === 0) throw new Error(`не найдено ни одной раскладки в ${dir}`);

  return files.map((file) => {
    const id = file.slice(0, -'.json'.length);
    let raw;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (error) {
      throw new Error(`раскладка ${file} не читается: ${error.message}`);
    }
    if (!isPlainObject(raw) || !Array.isArray(raw.blocks) || raw.blocks.length === 0) {
      throw new Error(`в раскладке «${id}» нужен непустой список blocks`);
    }
    for (const block of raw.blocks) {
      // Caught while reading rather than while resolving: a block with no type has no name to put
      // into any later message, so the file is the last place the mistake can still be pointed at.
      const named = typeof block === 'string'
        ? block !== ''
        : isPlainObject(block) && typeof block.type === 'string' && block.type !== '';
      if (!named) {
        throw new Error(`в раскладке «${id}» каждый блок — это имя блока или объект с полем type`);
      }
    }
    return { id, name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : id, blocks: raw.blocks };
  });
}

// Everything a layout is allowed to say about a block. Anything else is its nature, and the nature
// belongs to the theme: see natureOf below for why the difference is worth a message of its own.
const ALLOWED = new Set(['type', 'count', 'content']);

function natureOf(layout, content, type) {
  if (!content.known.includes(type)) {
    throw new Error(`раскладка «${layout.id}»: тема «${content.id}» не умеет блок «${type}»`);
  }
  // Two different mistakes with two different fixes: the theme has no such component at all, or it
  // has one and nothing says what goes inside it. Told apart here so the message names the fix.
  const nature = content.blocks[type];
  if (nature === undefined) {
    throw new Error(
      `раскладка «${layout.id}»: тема «${content.id}» рисует блок «${type}», но blocks.json его не описывает — неизвестно, что класть внутрь`,
    );
  }
  return nature;
}

// The numbers of one block after the layout has had its say. A range in blocks.json is the ceiling
// of what the theme can carry, and the layout picks a point out of it; what the layout leaves alone
// stays a range for the model to choose inside, by the subject of the page.
function contentOf(layout, nature, asked) {
  const content = {};
  for (const [element, range] of Object.entries(nature.content)) content[element] = [...range];
  if (asked === undefined) return content;
  if (!isPlainObject(asked)) {
    throw new Error(`в раскладке «${layout.id}» у блока «${nature.type}» content должен быть объектом`);
  }

  for (const [element, value] of Object.entries(asked)) {
    const range = nature.content[element];
    if (range === undefined) {
      throw new Error(
        `раскладка «${layout.id}» переопределяет форму блока «${nature.type}»: элемента «${element}» у него нет`,
      );
    }
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `в раскладке «${layout.id}» у блока «${nature.type}» элемент «${element}» должен быть целым числом`,
      );
    }
    // Out of range is refused, not clamped. Unchecked, the number reaches the schema as an exact
    // count, the model obediently writes that many, and the page comes out off-template with
    // nothing having complained. Clamping silently would be no better: the owner wrote a number and
    // is entitled to be told it was not taken.
    if (value < range[0] || value > range[1]) {
      throw new Error(
        `раскладка «${layout.id}»: у блока «${nature.type}» элемента «${element}» бывает от ${range[0]} до ${range[1]}, а раскладка просит ${value}`,
      );
    }
    content[element] = [value, value];
  }
  return content;
}

// A layout made sense of against one theme: the block list expanded by `count`, each block carrying
// its nature from blocks.json and its numbers after the override.
//
// `autoBlocks` is passed in rather than imported, so the check stays a check and this module never
// depends on assemble.mjs. It has no default on purpose: a silently empty list would refuse the
// contents and the "other pages" grid of every layout there is.
export function resolveLayout(layout, { content, autoBlocks }) {
  const blocks = [];
  for (const raw of layout.blocks) {
    const asked = typeof raw === 'string' ? { type: raw } : raw;
    const nature = natureOf(layout, content, asked.type);

    for (const field of Object.keys(asked)) {
      // The border between a layout and a block. A layout that could write `image: false` would
      // collapse a half-picture block into an empty half, and nothing downstream could tell the
      // block was ever meant to have one.
      if (!ALLOWED.has(field)) {
        throw new Error(
          `раскладка «${layout.id}» не может менять природу блока «${nature.type}»: поле «${field}»`,
        );
      }
    }
    if (nature.auto && !autoBlocks.includes(nature.type)) {
      throw new Error(
        `раскладка «${layout.id}»: блок «${nature.type}» помечен auto, но фабрика не умеет его заполнять`,
      );
    }

    const count = asked.count ?? 1;
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(
        `в раскладке «${layout.id}» у блока «${nature.type}» count должен быть целым числом больше нуля`,
      );
    }
    const resolved = contentOf(layout, nature, asked.content);

    // A fresh object per copy, down to the ranges. The theme is read once per run and serves every
    // page, each with a layout of its own, so a block pointing back into it would let one page's
    // numbers rewrite the next page's; and nine sections sharing one object would be one section
    // shown nine times the moment anything downstream wrote into a block it had just built.
    for (let copy = 0; copy < count; copy += 1) {
      blocks.push({
        type: nature.type,
        auto: nature.auto,
        h1: nature.h1,
        image: nature.image,
        heading: nature.heading,
        content: Object.fromEntries(Object.entries(resolved).map(([element, range]) => [element, [...range]])),
      });
    }
  }

  // Counted over the expanded list, so two heroes written as one `count: 2` line are caught as
  // surely as two lines. A page has exactly one h1; none and two are both broken pages, and this is
  // the last free moment to say so.
  if (blocks.filter((block) => block.h1).length !== 1) {
    throw new Error(
      `в раскладке «${layout.id}» должен быть ровно один блок с признаком h1 — у страницы ровно один заголовок h1`,
    );
  }

  // The FAQ is answered by one request for the whole page, so a second faq block has nowhere to get
  // different questions from: assemble.mjs would fill both from the same answer, word for word, and
  // the contents would carry the same entry twice. Refused rather than quietly deduplicated — a
  // layout asking for two is asking for something that cannot exist, and saying so costs nothing.
  if (countOf(blocks, 'faq') > 1) {
    throw new Error(
      `в раскладке «${layout.id}» больше одного блока faq — вопросы у страницы одни, и второй блок повторил бы первый слово в слово`,
    );
  }

  return { id: layout.id, name: layout.name, blocks };
}

const countOf = (blocks, type) => blocks.filter((block) => block.type === type).length;

// What the plan may put inside each kind of content block on this page, once the layout has had
// its say — one entry per type, because two kinds of block are two different questions to ask. A
// half-and-half block holds a heading, a paragraph or two and a call to action; a section holds
// tables and card sets besides. Asking for both with one list would offer the half-block a table
// it cannot hold, and the answer would be trimmed back out on arrival.
//
// Read off the resolved layout rather than off the theme: the theme states the ceiling, the layout
// picks out of it, and reading the theme here would quietly discard every exact number a layout
// wrote — `{ "type": "section", "content": { "table": 0 } }` would build a page with tables in it.
export function contentByType(blocks) {
  const byType = {};
  for (const block of blocks.filter(takesASection)) byType[block.type] ??= block.content;
  return byType;
}

// What the plan request has to pin down, read off a resolved layout. Sections are an exact number —
// the layout said how many. The FAQ and the lead paragraphs may still be a range: what a layout
// leaves as one, the model chooses inside, by the subject of the page. Pictures are counted, not
// budgeted: a picture exists because a block carries one by nature, so the count is simply how many
// such blocks the layout has, and the labels say where each one goes, in that same order.
// Which blocks of a layout are handed an entry from the plan's `sections`. This predicate and the
// order of branches in assemble.mjs's own walk are one rule written twice — keep them identical.
// Counting by name here ("blocks called section") and dispatching by nature there is how the two
// lists would come to disagree: a second kind of content block would be planned for zero times and
// then silently dropped when the page was put together, with nothing anywhere saying why.
export const takesASection = (block) =>
  !block.auto && block.type !== 'faq' && (block.heading === true || block.h1 === true);

export function planShape(blocks) {
  const imageLabels = [];
  const seen = new Map();
  for (const block of blocks) {
    const at = (seen.get(block.type) ?? 0) + 1;
    seen.set(block.type, at);
    // The label goes into the brief, so the model knows what the picture is of. A bare type says
    // enough while there is one such block; past that it has to say which one, or two pictures of
    // one page are briefed identically and come back as the same picture twice.
    if (block.image) {
      imageLabels.push(at === 1 && countOf(blocks, block.type) === 1 ? block.type : `${block.type} ${at}`);
    }
  }
  const faq = blocks.find((block) => block.type === 'faq');
  return {
    // One count per kind, not one total: each kind is asked for separately, so the plan can hold
    // nine sections and two half-blocks without either being described as the other.
    byType: Object.fromEntries(
      Object.entries(Object.groupBy(blocks.filter(takesASection), (block) => block.type)).map(
        ([type, list]) => [type, list.length],
      ),
    ),
    // The same blocks again, as the order they stand in on the page. The counts above say how many
    // of each to ask for; this says which comes first, which the per-page link budget needs — it is
    // spent top to bottom, and the plan's per-kind arrays cannot say what follows what.
    order: blocks.filter(takesASection).map((block) => block.type),
    faq: faq?.content?.toggle ?? [0, 0],
    images: imageLabels.length,
    imageLabels,
  };
}

// FNV-1a: a small, well-behaved string hash. Only used to turn a folder name into a seed number.
function hashSeed(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

// mulberry32: a tiny seeded generator. Math.random cannot be seeded, and nothing here needs
// cryptographic quality — only repeatability.
function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Which layout each page of a site is built from. Seeded rather than random, so a run that stopped
// halfway picks up with the same layouts instead of reshuffling the pages already on disk, and so
// two sites of one network come out different without anyone choosing per site by hand.
export function pickLayouts({ layouts, pages, seed, chosen = '' }) {
  if (chosen !== '') {
    const one = layouts.find((layout) => layout.id === chosen);
    if (!one) throw new Error(`раскладки «${chosen}» нет`);
    // Every page the same: this is how a layout gets looked at without re-running generation ten
    // times, and how something already shown to a client is shown again. Sorted like the seeded
    // branch below, so the two never hand back their keys in different orders.
    return Object.fromEntries([...pages].sort().map((page) => [page, one]));
  }
  const picked = {};
  // Sorted, so the answer depends on which pages were asked for and not on the order they arrived
  // in: the same site described two ways must come out the same. `layouts` is already sorted by
  // file name when loadLayouts hands it over and must not be sorted again here — the choice is
  // allowed to depend on the seed and on which files exist, and on nothing else.
  for (const page of [...pages].sort()) {
    // Each page gets its own generator, seeded by site and page together. Without this, adding one
    // page to the list would shift every later page's layout.
    const random = mulberry32(hashSeed(`${seed}:${page}`));
    // mulberry32 returns strictly less than one by construction, so the index stays in range.
    picked[page] = layouts[Math.floor(random() * layouts.length)];
  }
  return picked;
}
