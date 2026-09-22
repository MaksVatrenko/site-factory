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
// comes in as `blocks`: a frame read off the example SEO supplied, where every entry carries its
// own nature (see factory/texts/example.mjs). This module knows no block by name except the two it
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

// The example's own count for this very element — five list rows, three table rows — a ceiling the
// model was already asked to respect (see fill.mjs's brief), unlike the character lengths below. A
// count is safe to actually cut, unlike a length: dropping the last few rows never breaks one
// mid-sentence, so — unlike noteLength — this one trims rather than only reporting. An element the
// example gave no count has no ceiling to hold the answer to, and nothing is cut.
function trimToMax(what, list, range, warnings) {
  if (!range) return list;
  const max = Array.isArray(range) ? range[1] : range;
  if (list.length <= max) return list;
  warnings.push(`${what}: ${list.length} вместо ${max} — лишнее отброшено`);
  return list.slice(0, max);
}

// `spec` is the example's own entry for this position — { kind, count?, length? } — so a section's
// five-row list says nothing about what the table two elements later may hold.
function toElement(item, { images, pages, page, warnings, spec = {} }) {
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
      return { type: 'list', items: trimToMax('пунктов списка', item.items, spec.count, warnings).map(link) };
    case 'table': {
      const rows = trimToMax('строк таблицы', item.rows, spec.count, warnings);
      return { type: 'table', columns: item.columns, rows: rows.map((row) => row.map(link)) };
    }
    case 'cards':
      // No picture on a card: the schema does not offer one (see schema.mjs), because a picture
      // belongs to a block by its nature and is placed by the factory. A hand-written card may
      // still carry one — that is the content format, not this stage.
      return {
        type: 'cards',
        items: trimToMax('карточек', item.cards, spec.count, warnings).map((card) => ({
          title: card.title,
          text: link(card.text),
        })),
      };
    case 'toggle':
      return { type: 'toggle', title: item.title, text: link(item.text) };
    case 'buttons': {
      // A button's own target is held to the same rule a link in prose is (see links.mjs): it names
      // a page of this site or it names nothing. Naming nothing is not a mistake here — it is the
      // ordinary case, and it means the partner link, which the template fills in at build time. So
      // an unusable target is dropped back to that rather than turning the button into a dead end.
      const items = trimToMax('кнопок', item.items, spec.count, warnings)
        .map((button) => {
          const canonical = button.href ? resolveLink(button.href, pages) : null;
          if (button.href && canonical === null) {
            warnings.push(`кнопка «${button.text}» ведёт на ${button.href} — адреса нет, оставлена партнёрской`);
          } else if (canonical !== null && isSelfLink(canonical, page)) {
            // Reported rather than quietly turned into the partner button: a button that says
            // "read the bonus terms" and goes to the operator instead is a different promise than
            // the one the words make, and the log is the only place that can say so.
            warnings.push(`кнопка «${button.text}» ведёт на саму страницу — оставлена партнёрской`);
          }
          const href = canonical !== null && !isSelfLink(canonical, page) ? canonical : '';
          return { text: button.text, ...(href ? { href } : {}) };
        })
        .filter((button) => button.text !== '');
      return items.length > 0 ? { type: 'buttons', items } : null;
    }
    case 'info': {
      const items = trimToMax('плашек', item.items, spec.count, warnings).filter(Boolean);
      return items.length > 0 ? { type: 'info', items } : null;
    }
    case 'line':
      return { type: 'line' };
    case 'steps': {
      const items = trimToMax('шагов', item.items, spec.count, warnings)
        .map((step) => ({ title: step.title, text: link(step.text) }))
        .filter((step) => step.title !== '' || step.text !== '');
      return items.length > 0 ? { type: 'steps', items } : null;
    }
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

// A length measured off the example is a target, not a ceiling: the number is what the example
// wrote in that very place, and the brief asked for it "give or take a fifth". So a bare number is
// read the same way here — a fifth either side — and both ends are worth a line.
//
// Short used to be unreportable, because a bare number was read as a ceiling with a floor of zero.
// That is exactly the failure this whole per-element measurement was written for: a first screen
// the example wrote at 375 characters came back at 141, and nothing anywhere said so.
const TOLERANCE = 0.2;

// Reported, never enforced. Trimming a paragraph to fit would cut it mid-sentence, which is worse
// than a long paragraph, and the engine imposes no limit of its own — these numbers exist so the
// page reads like the one it was copied from, not so the build can fail.
function noteLength(what, value, range, warnings) {
  if (!range) return;
  const [min, max] = Array.isArray(range)
    ? range
    : [Math.round(range * (1 - TOLERANCE)), Math.round(range * (1 + TOLERANCE))];
  const length = String(value).length;
  if (length > max) warnings.push(`${what}: ${length} знаков вместо ${max} — оставлено как есть`);
  else if (min > 0 && length < min) warnings.push(`${what}: ${length} знаков вместо ${min} — оставлено как есть`);
}

// The factory's own blocks: what goes inside them is known without asking the model, so asking
// would only pay for something thrown away. Named here, beside the builders, and handed to
// example.mjs so a frame with an auto block nobody can fill is refused before the first request.
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

export function assemblePage({ plan, blocks, example = '', sections, faq, pages, page, labels, lengths = {} }) {
  const warnings = [];
  // One name per picture-bearing block, in page order, already normalised and de-duplicated by
  // trimPlan. A null is a block whose name came back unusable: it keeps its place in the list so
  // the pairing below stays aligned, and simply has no picture.
  const pictures = plan.images ?? [];
  const images = new Set(pictures.filter(Boolean));
  const context = { images, pages, page, warnings };

  // Two passes over the layout, because the contents cannot be built until every heading is known,
  // and a block with nothing to show is dropped along the way — so the auto blocks are filled over
  // what actually survived rather than over what the layout asked for.
  const built = [];
  for (const [at, block] of blocks.entries()) {
    if (block.auto) {
      // example.mjs refuses this before the first paid request; by the time a page is assembled it
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

    // Every block the model writes, the first screen included: it is an ordinary content block
    // that happens to carry the page's own heading instead of a section heading. Filled any other
    // way, it could only ever hold what that other way knew about — which is how its call to action
    // and its row of claims were once declared, described to the model, and still impossible to
    // produce, because the one path that filled the first screen knew about neither.
    if (block.heading || block.h1) {
      // Looked up by the block's own place on the page, not taken from the front of a queue. A
      // page can hold more than one kind of content block now, and they are not interchangeable: a
      // section dropped upstream would shift every later entry up by one, and a half-and-half block
      // would end up drawing a section's table in a column half as wide.
      const section = sections.get(at);
      // Dropped upstream because it came back empty. Its contents entry goes with it, which is the
      // whole reason the contents is built from what survived: no entry may point at a heading with
      // nothing under it.
      if (!section) continue;
      built.push({
        block,
        at,
        heading: section.heading,
        items: section.items
          .map((item, at) => {
            // The example's entry for this very position. The answer is pinned to the same length
            // as the sequence by the schema (see schema.mjs's sectionSchema), so item `at` is the
            // element the example wrote `at` — a kind that disagrees means the model answered
            // something the brief did not ask for, and the mismatch is worth a line of its own.
            const spec = block.elements?.[at] ?? {};
            if (spec.kind !== undefined && spec.kind !== item.kind) {
              warnings.push(`на месте ${at + 1} ждали «${spec.kind}», пришёл «${item.kind}»`);
            }
            if (item.kind === 'text') noteLength('text абзаца', item.text, spec.length, warnings);
            return toElement(item, { ...context, spec });
          })
          .filter(Boolean),
      });
      continue;
    }

    // Nothing to put in it: no heading to write, no h1 to carry, and the factory does not fill it.
    // A frame reaches here only from an example whose block has no heading of its own and is not
    // one the factory fills, so say so rather than emit an empty block onto the page.
    warnings.push(`блок «${block.type}» нечем наполнить — пропущен`);
  }

  // The contents lists the headed blocks that come after it, and only those. src/lib/anchors.mjs
  // pairs an entry with a block further down the page — that is the shape of a table of contents,
  // and it is the rule hand-written sites are matched by too, so it cannot be widened here. Listing
  // a block that sits above instead put an entry in the list with nothing below it to match, and
  // every later entry slid onto its neighbour's block: a layout with the FAQ above the contents
  // came out with all three of its links pointing at the wrong headings, and nothing said so.
  const headingsAfter = (index) =>
    built.slice(index + 1).filter((entry) => entry.block.heading).map((entry) => entry.heading);

  // Which picture belongs to which block, worked out over the whole frame rather than over what
  // survived. planShape counted the names in page order, so the fourth name is for the fourth
  // picture-bearing block of the page — whether or not the third one made it onto the page. A
  // counter advanced while emitting would instead shift every later picture up by one the moment a
  // block was dropped, quietly putting one block's picture under another block's heading.
  const pictureAt = new Map();
  let nextPicture = 0;
  for (const [at, block] of blocks.entries()) {
    if (!block.image) continue;
    pictureAt.set(at, pictures[nextPicture] ?? null);
    nextPicture += 1;
  }

  // A contents with nothing under it to list is an empty box on the page, so it goes — the same
  // rule every other block here is held to.
  for (const [index, entry] of built.entries()) {
    if (entry.block.type !== 'toc' || headingsAfter(index).length > 0) continue;
    warnings.push('оглавлению нечего перечислять — блок убран');
    built.splice(index, 1);
    break;
  }

  // A picture belongs to the block by its nature, so the factory places it — and the block says
  // where, because that is a fact about how the block is drawn and not something the model should
  // be choosing page by page. "top" puts it straight under the heading; "after-text" puts it below
  // the block's paragraphs, so a call to action written under it stays with the words it belongs to.
  const withPicture = (block, at, items) => {
    const picture = pictureAt.get(at);
    if (!picture) return items;
    if (block.image !== 'after-text') return [{ image: picture }, ...items];
    // After the last paragraph, not after the first: a block whose lead runs to two paragraphs
    // would otherwise have its picture wedged into the middle of its own sentence.
    const lastText = items.map((item) => item.type).lastIndexOf('text');
    const cut = lastText === -1 ? 0 : lastText + 1;
    return [...items.slice(0, cut), { image: picture }, ...items.slice(cut)];
  };

  const pageBlocks = built.map(({ block, at, heading, items = [] }, index) => ({
    type: block.type,
    content: block.auto
      ? AUTO[block.type]({ headings: headingsAfter(index), labels })
      : [
          ...(block.h1 ? [{ type: 'title', h1: plan.h1 }] : []),
          ...(block.heading ? [{ type: 'title', h2: heading }] : []),
          ...withPicture(block, at, items),
        ],
  }));

  noteLength('title страницы', plan.title, lengths.title, warnings);
  noteLength('description страницы', plan.description, lengths.description, warnings);
  // The h1 belongs here with them: the example gives it a length, it is the most prominent text on
  // the page, and unlike the item counts it is never trimmed anywhere earlier in the pipeline.
  noteLength('h1 страницы', plan.h1, lengths.h1, warnings);

  // Which example the page was built from, written into the page rather than into site.json.
  // Examples are per page, and site.json is written once at the start of a run and never
  // overwritten: a run that stopped and was picked up later would add pages that no table in
  // site.json could still grow to hold, so the record would be wrong exactly when it was needed
  // most. src/lib/site-dir.mjs reads a page by its own three fields and never looks at the rest,
  // so this one is inert — the engine does not read it and it reaches no built page.
  return {
    page: { title: plan.title, description: plan.description, example, blocks: pageBlocks },
    warnings,
  };
}
