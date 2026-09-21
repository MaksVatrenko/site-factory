import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATES_DIR } from '../../src/lib/templates.mjs';

// What a page is made of, read off a page that already exists. SEO supplies the content of real
// sites as examples, and the factory's job is to write a different site of the same shape — so the
// shape is measured here rather than described anywhere: which blocks, in what order, what stands
// inside each of them, how long the text runs.
//
// This is the place a resolved layout used to occupy (factory/texts/layouts.mjs in v1), and it
// hands back the same thing so everything downstream — the plan, the schema, the assembly — is
// untouched by where the shape came from.
//
// The division of labour with the theme is what is left of blocks.json: an example never says
// where a picture goes, because the sites it was taken from have none, and it never says how many
// links a block may carry. Those two stay the theme's, in templates/<id>/pictures.json. Everything
// else the theme no longer has an opinion about.
//
// Everything here is free and runs before the first paid request, on purpose: an example naming a
// block nobody can draw is a page that comes out wrong, and saying so costs nothing now instead of
// after nine pages have been paid for.

// Kept here rather than shared: the check is three words long, and a module that owns its own tiny
// guards can be read without opening a second file.
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// One example, read and checked for shape but not yet understood: what its blocks mean takes a
// theme, and the same file is read against a different one on the next run. `id` is page and file
// together — it is what goes into a message and into the built page, and "2" alone would name four
// different examples on a site of eight pages.
export function loadExamples(templateId, root = process.cwd()) {
  const dir = join(root, TEMPLATES_DIR, templateId, 'examples');
  if (!existsSync(dir)) {
    throw new Error(`тема «${templateId}» не поддерживает генерацию текстов: нет папки ${dir}`);
  }
  // A folder per page address, a file per source site. The address is the folder name for the same
  // reason a page's address is its file name: one name, in one place, that nothing can disagree with.
  const addresses = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  // Two messages, not one: a theme pointed at the wrong folder and a theme whose folder is empty
  // send the reader to two different places.
  if (addresses.length === 0) throw new Error(`у темы «${templateId}» в ${dir} нет ни одной страницы`);

  const examples = {};
  for (const address of addresses) {
    const files = readdirSync(join(dir, address)).filter((file) => file.endsWith('.json')).sort();
    if (files.length === 0) {
      throw new Error(`у темы «${templateId}» нет ни одного примера страницы «${address}»`);
    }
    examples[address] = files.map((file) => {
      const name = file.slice(0, -'.json'.length);
      const id = `${address}/${name}`;
      let page;
      try {
        page = JSON.parse(readFileSync(join(dir, address, file), 'utf8'));
      } catch (error) {
        throw new Error(`пример ${id} темы «${templateId}» не читается: ${error.message}`);
      }
      if (!isPlainObject(page) || !Array.isArray(page.blocks) || page.blocks.length === 0) {
        throw new Error(`пример ${id} темы «${templateId}» — не страница: нужен непустой список blocks`);
      }
      return { id, name, address, page };
    });
  }
  return examples;
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

// Which example each page of a site is built from. Seeded rather than random, so a run that stopped
// halfway picks up with the same examples instead of reshuffling the pages already on disk, and so
// two sites of one network come out different without anyone choosing per page by hand.
export function pickExamples({ examples, pages, seed, chosen = '' }) {
  const picked = {};
  // Sorted, so the answer depends on which pages were asked for and not on the order they arrived
  // in: the same site described two ways must come out the same.
  for (const page of [...pages].sort()) {
    const list = examples[page];
    if (!list || list.length === 0) throw new Error(`для страницы «${page}» нет ни одного примера`);
    if (chosen !== '') {
      // Every page built from the same source site: this is how one example gets looked at without
      // re-running generation eight times, and how something already shown to a client is shown
      // again. The name is the same across pages because it is the file name, one per source site.
      const one = list.find((example) => example.name === chosen);
      if (!one) throw new Error(`у страницы «${page}» нет примера «${chosen}»`);
      picked[page] = one;
      continue;
    }
    // Each page gets its own generator, seeded by site and page together. Without this, adding one
    // page to the list would shift every later page's example.
    const random = mulberry32(hashSeed(`${seed}:${page}`));
    // mulberry32 returns strictly less than one by construction, so the index stays in range.
    picked[page] = list[Math.floor(random() * list.length)];
  }
  return picked;
}

// Where an element keeps the things it is made of. Everything holds `items`; only a table calls
// them rows, because its rows are lists themselves and `items` would read as cells.
const COLLECTION = { table: 'rows' };

const isTitle = (element) => isPlainObject(element) && element.type === 'title';

// The middle value, not the average. Paragraph lengths across the supplied examples run from 3 to
// 415 characters — a stray list line at one end, a wall of text at the other — and a mean lets
// either end set the target for every paragraph of the page. The median is what the example mostly
// looks like, which is what is being copied.
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

// The shape of one page, read off an example and understood against one theme: the same thing
// resolveLayout handed back in v1, plus the lengths, which used to be a constant in blocks.json.
//
// `autoBlocks` is passed in rather than imported, so this module never depends on assemble.mjs. It
// has no default on purpose: a silently empty list would read the contents block as content the
// model must write, and the page would come out with the table of contents written twice.
export function frameOf(example, { content, autoBlocks }) {
  const blocks = [];
  const measured = {};
  const measure = (kind, text) => {
    if (typeof text === 'string' && text.trim() !== '') (measured[kind] ??= []).push(text.length);
  };

  for (const raw of example.page.blocks) {
    const type = raw?.type;
    if (!content.known.includes(type)) {
      throw new Error(`пример ${example.id}: тема «${content.id}» не умеет блок «${type}»`);
    }
    const auto = autoBlocks.includes(type);
    const items = Array.isArray(raw.content) ? raw.content : [];
    const head = items[0];

    // The block's own heading: the factory writes it from the plan, the model never does. It is
    // dropped from `elements` by the same rule that drops an h3 below — one rule, not two.
    const h1 = !auto && isTitle(head) && typeof head.h1 === 'string';
    const heading = !auto && isTitle(head) && !h1;
    if (!auto) measure(h1 ? 'h1' : 'h2', head?.h1 ?? head?.h2 ?? head?.h3);

    const elements = [];
    const counts = {};
    // An auto block is read for nothing at all: the factory builds the contents and the "other
    // pages" grid itself, so whatever the example wrote there is about to be thrown away, and
    // measuring its two-word lines would drag every length on the page down with them.
    for (const element of auto ? [] : items) {
      const kind = element?.type;
      // Every heading: the block's own, which the factory writes, and a second one inside it — an
      // h3 in the examples supplied, 5 across 387 blocks. h3 is not in use, so the section simply
      // reads longer without it, and asking for the block's own heading here would print it twice.
      if (isTitle(element)) continue;
      // And a picture, for the opposite reason to h3: pictures are placed by the theme, from
      // pictures.json, so one kept here would be a second picture in the same block.
      if (kind === 'image') continue;
      if (!content.elements.includes(kind)) {
        throw new Error(`пример ${example.id}: тема «${content.id}» не умеет элемент «${kind}»`);
      }
      elements.push(kind);

      const collection = element[COLLECTION[kind] ?? 'items'];
      if (Array.isArray(collection)) {
        // The widest of the block's same-kind elements, not the middle one: this number is also the
        // ceiling the answer is trimmed to on arrival, and a middling ceiling would cut a list the
        // example itself wrote in full.
        counts[kind] = Math.max(counts[kind] ?? 0, collection.length);
        if (kind === 'list') for (const item of collection) measure('listItem', item);
      }
      if (kind === 'text') measure('text', element.text);
      // A question and its answer, which a toggle keeps in `title` and `text` like every other
      // element of the format (docs/content-format.md) — not in fields named after what they hold.
      if (kind === 'toggle') {
        measure('question', element.title);
        measure('answer', element.text);
      }
    }

    blocks.push({
      type,
      auto,
      h1,
      heading,
      // The one thing the example cannot say. Its sites have no pictures at all — measured, all 32
      // pages — so where a picture goes is the theme's to declare and nobody else's.
      image: content.pictures[type] ?? false,
      elements,
      counts,
    });
  }

  // A page has exactly one h1; none and two are both broken pages, and this is the last free moment
  // to say so. The example is named because the fix is in the example, not in anything here.
  if (blocks.filter((block) => block.h1).length !== 1) {
    throw new Error(`в примере ${example.id} должен быть ровно один блок с заголовком h1`);
  }
  // The FAQ is answered by one request for the whole page, so a second faq block has nowhere to get
  // different questions from: assemble.mjs would fill both from the same answer, word for word.
  if (blocks.filter((block) => block.type === 'faq').length > 1) {
    throw new Error(`в примере ${example.id} больше одного блока faq — вопросы у страницы одни`);
  }

  measure('title', example.page.title);
  measure('description', example.page.description);
  return {
    blocks,
    lengths: Object.fromEntries(Object.entries(measured).map(([kind, values]) => [kind, median(values)])),
  };
}

// Which blocks of a page are handed an entry from the plan's `sections`. This predicate and the
// order of branches in assemble.mjs's own walk are one rule written twice — keep them identical.
// Counting by name here ("blocks called section") and dispatching by nature there is how the two
// lists would come to disagree: a second kind of content block would be planned for zero times and
// then silently dropped when the page was put together, with nothing anywhere saying why.
export const takesASection = (block) =>
  !block.auto && block.type !== 'faq' && (block.heading === true || block.h1 === true);

const countOf = (blocks, type) => blocks.filter((block) => block.type === type).length;

// What the plan request has to pin down, read off a frame. Everything here is exact — the example
// said how many of everything there is — where v1 could still leave a range for the model to choose
// inside. That is the point of the change: the page comes out the shape of the example, not the
// shape of a budget.
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
  // How many questions is how many toggles the example's own FAQ holds — the sequence already says
  // it, and a count beside it would be the same number written twice, free to disagree with itself.
  const questions = faq?.elements?.filter((element) => element === 'toggle').length ?? 0;
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
    faq: questions,
    images: imageLabels.length,
    imageLabels,
  };
}
