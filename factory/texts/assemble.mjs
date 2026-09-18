import { resolveLink, isSelfLink } from './links.mjs';

// Turns a plan and a pile of filled sections into one page of our own content format.
//
// Everything structural happens here rather than in the model: the table of contents is built from
// the block headings, each block's own heading is written from the plan, and the service blocks
// are labelled in the site's language. The couplings that a model breaks most often — a contents
// list that does not match the sections, a second h1, a link to a page that was never made, a link
// back to the page it is already on — are not checked here so much as made impossible by construction.
//
// What the page is made of — which blocks, in what order, how many — is not written here either. It
// comes in as `blocks`: a layout already resolved against the theme, where every entry carries its
// own nature (see factory/texts/layouts.mjs). This module knows no block by name except the two it
// fills itself, so a new kind of block reaches a page without a line of this file changing.

// [words](/target). Deliberately narrow: no nesting, no whitespace tricks, the same shape the
// engine's own link parser accepts (see docs/content-format.md).
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

// A link is kept only when it points at a page this site actually has and is not the page it
// appears on, or at an anchor on this one — and when it does, it is rewritten to that page's
// canonical address, so `[words](/home)` reaches the page as `[words](/)`. plan.mjs's brief tells
// the model the real addresses, but prose is not the schema: a link the model writes inside a
// sentence is never validated the way plan.mjs's own link list is, so the same repair belongs here
// too (see links.mjs). Anything that names no page of this site — an invented external address, a
// page from the example site — loses its brackets and stays as plain words, which reads fine and
// links nowhere. A link back to this same page loses its brackets the same way, but is reported
// with its own wording (see links.mjs's isSelfLink) — it did resolve, just to nowhere useful.
function keepLinks(text, pages, page, warnings) {
  return String(text).replace(LINK, (whole, label, href) => {
    const canonical = resolveLink(href, pages);
    if (canonical === null) {
      warnings.push(`ссылка ${href} ведёт в никуда — осталась текстом`);
      return label;
    }
    if (isSelfLink(canonical, page)) {
      warnings.push(`ссылка ${canonical} ведёт на саму страницу — осталась текстом`);
      return label;
    }
    return `[${label}](${canonical})`;
  });
}

// blocks.json's item counts (listItems, tableRows, cards) are a ceiling the model was already
// asked to respect, unlike the character lengths below. A count is safe to actually cut, unlike a
// length: dropping the last few rows never breaks one mid-sentence, so — unlike noteLength — this
// one trims rather than only reporting.
function trimToMax(what, list, range, warnings) {
  if (!range) return list;
  const max = Array.isArray(range) ? range[1] : range;
  if (list.length <= max) return list;
  warnings.push(`${what}: ${list.length} вместо ${max} — лишнее отброшено`);
  return list.slice(0, max);
}

function toElement(item, { images, pages, page, warnings, lengths }) {
  const link = (text) => keepLinks(text, pages, page, warnings);
  const picture = (name) => {
    if (name && images.has(name)) return name;
    if (name) warnings.push(`картинка «${name}» не объявлена планом — убрана`);
    return '';
  };

  switch (item.kind) {
    case 'title':
      return { type: 'title', [item.level]: item.text };
    case 'text':
      return { type: 'text', text: link(item.text) };
    case 'list':
      return { type: 'list', items: trimToMax('пунктов списка', item.items, lengths.listItems, warnings).map(link) };
    case 'table': {
      const rows = trimToMax('строк таблицы', item.rows, lengths.tableRows, warnings);
      return { type: 'table', columns: item.columns, rows: rows.map((row) => row.map(link)) };
    }
    case 'cards':
      return {
        type: 'cards',
        items: trimToMax('карточек', item.cards, lengths.cards, warnings).map((card) => {
          const image = picture(card.image);
          return { title: card.title, text: link(card.text), ...(image ? { image } : {}) };
        }),
      };
    case 'toggle':
      return { type: 'toggle', title: item.title, text: link(item.text) };
    case 'image': {
      const image = picture(item.name);
      return image ? { image } : null;
    }
    default:
      // Strict mode should make this unreachable; dropping beats writing something the renderer
      // would silently skip anyway.
      warnings.push(`элемент неизвестного вида «${item.kind}» — пропущен`);
      return null;
  }
}

// Lengths from blocks.json are reported, never enforced. Trimming a paragraph to fit would cut it
// mid-sentence, which is worse than a long paragraph, and the engine imposes no limit of its own —
// these numbers exist so the layout stays pleasant, not so the build can fail.
function noteLength(what, value, range, warnings) {
  if (!range) return;
  const [min, max] = Array.isArray(range) ? range : [0, range];
  const length = String(value).length;
  if (length > max) warnings.push(`${what}: ${length} знаков вместо ${max} — оставлено как есть`);
  else if (min > 0 && length < min) warnings.push(`${what}: ${length} знаков вместо ${min} — оставлено как есть`);
}

// The factory's own blocks: what goes inside them is known without asking the model, so asking
// would only pay for something thrown away. Named here, beside the builders, and handed to
// layouts.mjs so a layout naming an auto block nobody can fill is refused before the first request.
const AUTO = {
  // Built from the headings, not from anything the model wrote: one entry per headed block that
  // survived, in the same order they come out in.
  toc: ({ headings, labels }) => [
    { type: 'title', h2: labels.toc },
    { type: 'list', items: headings },
  ],
  // The "other pages" grid is drawn from site.json's own menu, so this block only needs its title.
  links: ({ labels }) => [{ type: 'title', h2: labels.links }],
};

export const AUTO_BLOCKS = Object.keys(AUTO);

export function assemblePage({ plan, blocks, sections, faq, pages, page, labels, lengths = {} }) {
  const warnings = [];
  // One name per picture-bearing block, in layout order, already normalised and de-duplicated by
  // trimPlan. A null is a block whose name came back unusable: it keeps its place in the list so
  // the pairing below stays aligned, and simply has no picture.
  const pictures = plan.images ?? [];
  const images = new Set(pictures.filter(Boolean));
  const context = { images, pages, page, warnings, lengths };

  // Two passes over the layout, because the contents cannot be built until every heading is known,
  // and a block with nothing to show is dropped along the way — so the auto blocks are filled over
  // what actually survived rather than over what the layout asked for.
  const built = [];
  let sectionIndex = 0;
  for (const [at, block] of blocks.entries()) {
    if (block.auto) {
      // layouts.mjs refuses this before the first paid request; by the time a page is assembled it
      // can only mean the two lists drifted apart, and an empty block on the page would be the
      // quietest possible way to say so.
      if (!AUTO[block.type]) {
        warnings.push(`блок «${block.type}» помечен auto, но фабрика не умеет его заполнять — пропущен`);
        continue;
      }
      built.push({ block, at });
      continue;
    }

    // The FAQ is the one block filled by a request of its own (see fill.mjs), so it is the one
    // block taken from its own argument rather than from the pool of filled sections.
    if (block.type === 'faq') {
      if (faq.length === 0) continue;
      built.push({
        block,
        at,
        heading: labels.faq,
        items: faq.map((entry) => ({
          type: 'toggle',
          title: entry.question,
          text: keepLinks(entry.answer, pages, page, warnings),
        })),
      });
      continue;
    }

    if (block.heading) {
      const section = sections[sectionIndex];
      // Dropped upstream because it came back empty. Its contents entry goes with it, which is the
      // whole reason the contents is built from what survived: no entry may point at a heading with
      // nothing under it.
      if (!section) continue;
      sectionIndex += 1;
      built.push({
        block,
        at,
        heading: section.heading,
        items: section.items
          .map((item) => {
            if (item.kind === 'text') noteLength('text абзаца', item.text, lengths.text, warnings);
            return toElement(item, context);
          })
          .filter(Boolean),
      });
      continue;
    }

    if (block.h1) {
      built.push({
        block,
        at,
        items: plan.heroText.map((text) => ({ type: 'text', text: keepLinks(text, pages, page, warnings) })),
      });
      continue;
    }

    // Nothing to put in it: no heading to write, no h1 to carry, and the factory does not fill it.
    // A layout reaches here only by naming a block blocks.json describes as holding content the
    // plan has no field for, so say so rather than emit an empty block onto the page.
    warnings.push(`блок «${block.type}» нечем наполнить — пропущен`);
  }

  const headings = built.filter((entry) => entry.block.heading).map((entry) => entry.heading);

  // Which picture belongs to which block, worked out over the whole layout rather than over what
  // survived. planShape counted the names in layout order, so the fourth name is for the fourth
  // picture-bearing block of the layout — whether or not the third one made it onto the page. A
  // counter advanced while emitting would instead shift every later picture up by one the moment a
  // block was dropped, quietly putting one block's picture under another block's heading.
  const pictureAt = new Map();
  let nextPicture = 0;
  for (const [at, block] of blocks.entries()) {
    if (!block.image) continue;
    pictureAt.set(at, pictures[nextPicture] ?? null);
    nextPicture += 1;
  }

  const pageBlocks = built.map(({ block, at, heading, items = [] }) => ({
    type: block.type,
    content: block.auto
      ? AUTO[block.type]({ headings, labels })
      : [
          ...(block.h1 ? [{ type: 'title', h1: plan.h1 }] : []),
          ...(block.heading ? [{ type: 'title', h2: heading }] : []),
          // A picture belongs to the block by its nature, so the factory places it: straight under
          // the heading, where every block that has one wants it. The model never chose where.
          ...(pictureAt.get(at) ? [{ image: pictureAt.get(at) }] : []),
          ...items,
        ],
  }));

  noteLength('title страницы', plan.title, lengths.title, warnings);
  noteLength('description страницы', plan.description, lengths.description, warnings);
  // The h1 belongs here with them: blocks.json gives it a limit, it is the most prominent text on
  // the page, and unlike the item counts it is never trimmed anywhere earlier in the pipeline.
  noteLength('h1 страницы', plan.h1, lengths.h1, warnings);

  return {
    page: { title: plan.title, description: plan.description, blocks: pageBlocks },
    warnings,
  };
}
