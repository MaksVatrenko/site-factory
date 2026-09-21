import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest, TEMPLATES_DIR } from '../../src/lib/templates.mjs';

// A theme says what it can render — manifest.json: which blocks and which element types — and,
// for text generation, what each of those blocks is by its nature: templates/<id>/blocks.json,
// read by loadTemplateBlocks below. What a page is made of is neither of those things and lives
// apart from both, in layouts/ (see factory/texts/layouts.mjs).
//
// blocks.json is the single source for both halves of the job: a layout is resolved against it,
// and describeBlocks() renders the same file as the rules the model is shown. Written twice, the
// two would drift; derived from one file, they cannot. That is what lets a new theme arrive with a
// correct prompt and no prompt editing at all.

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Either an exact count (3) or a range ([2, 6]). Normalised to a range so callers have one shape.
function readRange(raw, where) {
  if (Number.isInteger(raw) && raw >= 0) return [raw, raw];
  const isPair =
    Array.isArray(raw) && raw.length === 2 && raw.every((n) => Number.isInteger(n) && n >= 0);
  if (!isPair || raw[0] > raw[1]) {
    throw new Error(`в ${where} нужно целое число или пара [меньше, больше] — сейчас ${JSON.stringify(raw)}`);
  }
  return [raw[0], raw[1]];
}

// Where a picture sits inside its block, which is the block's business and not the model's. A bare
// `true` puts it directly under the heading, which is what a first-screen picture wants when the
// words are short and what most sections want always. "after-text" puts it below the block's
// paragraphs instead, so a call to action written under it is not separated from the words it
// belongs to. Written as a value rather than a field beside one: a block either has a picture or
// has not, and where it goes is nothing to say about a block that has none.
const IMAGE_PLACES = new Set(['top', 'after-text']);

function placeOf(value, where) {
  if (value === undefined || value === false) return false;
  if (value === true) return 'top';
  if (typeof value === 'string' && IMAGE_PLACES.has(value)) return value;
  throw new Error(`картинка ${where} — это true, false или одно из: ${[...IMAGE_PLACES].join(', ')}`);
}

// blocks.json: what each block of this theme is by its nature, one entry per block, with no
// composition in it at all. What a page is made of — which blocks, in what order, how many — lives
// in layouts/ instead, because the same composition suits more than one theme and a theme's own
// look suits more than one composition (see docs/specs/2026-09-18-layouts-design.md).
//
// Four natures, each of which decides something no layout may override:
//   h1      — this block carries the page's own heading. Exactly one block of a layout has it.
//   heading — this block has a heading of its own, written by the factory from the plan, and that
//             heading becomes an entry in the table of contents.
//   image   — this block holds a picture. That is what places pictures now: not a budget rolled per
//             page, not the model choosing where one belongs.
//   auto    — the factory fills this block itself (contents from the headings, "other pages" from
//             the menu). The model is never shown it and never writes into it.
//
// `lengths` and `links` sit beside the blocks rather than inside them: they are properties of the
// page's text as a whole.
export function loadTemplateBlocks(templateId, root = process.cwd()) {
  const file = join(root, TEMPLATES_DIR, templateId, 'blocks.json');
  if (!existsSync(file)) {
    throw new Error(`шаблон «${templateId}» не поддерживает генерацию текстов: нет файла ${file}`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`не удалось прочитать blocks.json шаблона «${templateId}»: ${error.message}`);
  }
  if (!isPlainObject(raw)) throw new Error(`blocks.json шаблона «${templateId}» должен быть объектом`);
  if (!isPlainObject(raw.blocks) || Object.keys(raw.blocks).length === 0) {
    throw new Error(`в blocks.json шаблона «${templateId}» нужен непустой объект blocks`);
  }

  const manifest = readManifest(templateId, root);
  const knownBlocks = new Set(manifest.blocks);
  const knownElements = new Set(manifest.elements);

  const flag = (block, name, type) => {
    const value = block[name];
    if (value === undefined) return false;
    if (typeof value !== 'boolean') {
      throw new Error(
        `признак «${name}» блока «${type}» шаблона «${templateId}» должен быть true или false`,
      );
    }
    return value;
  };

  const blocks = {};
  for (const [type, block] of Object.entries(raw.blocks)) {
    if (!isPlainObject(block)) {
      throw new Error(`блок «${type}» шаблона «${templateId}» должен быть объектом`);
    }
    if (!knownBlocks.has(type)) {
      throw new Error(`шаблон «${templateId}» не умеет блок «${type}»: его нет в blocks манифеста`);
    }
    const auto = flag(block, 'auto', type);
    // A block cannot be both the page's own heading and a section of it. assemble.mjs has to pick
    // one, and whichever it picked, the other nature would be paid for and thrown away: the plan
    // still writes lead paragraphs for an h1 block, and a heading block still takes an entry from
    // the plan's sections. Refusing here costs nothing and leaves nothing to discover later.
    if (flag(block, 'h1', type) && flag(block, 'heading', type)) {
      throw new Error(
        `блок «${type}» шаблона «${templateId}» помечен и h1, и heading — заголовок страницы и заголовок раздела это разные вещи`,
      );
    }
    if (auto && (block.content !== undefined || block.h1 || block.image || block.heading)) {
      throw new Error(
        `блок «${type}» шаблона «${templateId}» помечен auto — фабрика заполняет его сама, остальные признаки ему не нужны`,
      );
    }

    const content = {};
    for (const [element, value] of Object.entries(isPlainObject(block.content) ? block.content : {})) {
      // A picture is a nature, not an element. Offered as one, the model gets to place it, names
      // one nothing declared, and the picture stage draws whatever the name happened to collide
      // with — which is exactly what `image: true` exists to make impossible.
      if (element === 'image') {
        throw new Error(
          `в блоке «${type}» шаблона «${templateId}» картинка задаётся признаком image: true, а не элементом content`,
        );
      }
      if (!knownElements.has(element)) {
        throw new Error(
          `шаблон «${templateId}» не умеет элемент «${element}»: его нет в elements манифеста`,
        );
      }
      content[element] = readRange(value, `блоке «${type}» шаблона «${templateId}», элементе «${element}»`);
    }

    blocks[type] = {
      type,
      auto,
      h1: flag(block, 'h1', type),
      image: placeOf(block.image, `блока «${type}» шаблона «${templateId}»`),
      heading: flag(block, 'heading', type),
      content,
    };
  }

  // Same [min, max] convention as the per-block element counts: only the upper bound is ever
  // enforced (trimPlan cuts down to it), the lower bound is descriptive. Missing entirely defaults
  // to 0 — the conservative default, not the permissive one: a template that says nothing about
  // links gets none, rather than an unstated unlimited budget.
  const linksRaw = isPlainObject(raw.links) ? raw.links : {};
  return {
    // Named so a layout refused against this theme can say which theme refused it.
    id: templateId,
    blocks,
    links: {
      perBlock: readRange(linksRaw.perBlock ?? 0, `links.perBlock шаблона «${templateId}»`),
      perPage: readRange(linksRaw.perPage ?? 0, `links.perPage шаблона «${templateId}»`),
    },
    lengths: isPlainObject(raw.lengths) ? raw.lengths : {},
    // What the theme can draw at all, which is a wider set than what blocks.json describes.
    // resolveLayout needs both to tell "this theme has no such block" apart from "it has one, but
    // nothing says what goes inside it".
    known: manifest.blocks,
  };
}

// pictures.json: the whole of what a theme still decides about a page in v2. Everything else —
// which blocks, in what order, what stands inside them, how long the text runs — is read off the
// example SEO supplied (factory/texts/example.mjs), because that is the thing being copied.
//
// Two things an example cannot say, which is why they are here:
//   pictures — where a picture goes. The example sites have none at all, on any of their pages, so
//              there is nothing to read; a picture exists because this file says a block carries one.
//   links    — how many links a block and a page may hold. Also absent from every example.
export function loadTemplatePictures(templateId, root = process.cwd()) {
  const file = join(root, TEMPLATES_DIR, templateId, 'pictures.json');
  if (!existsSync(file)) {
    throw new Error(`тема «${templateId}» не поддерживает генерацию текстов: нет файла ${file}`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`не удалось прочитать pictures.json темы «${templateId}»: ${error.message}`);
  }
  if (!isPlainObject(raw)) throw new Error(`pictures.json темы «${templateId}» должен быть объектом`);

  const manifest = readManifest(templateId, root);
  const knownBlocks = new Set(manifest.blocks);
  const pictures = {};
  for (const [type, value] of Object.entries(isPlainObject(raw.pictures) ? raw.pictures : {})) {
    if (!knownBlocks.has(type)) {
      throw new Error(`тема «${templateId}» не умеет блок «${type}»: его нет в blocks манифеста`);
    }
    pictures[type] = placeOf(value, `блока «${type}» темы «${templateId}»`);
  }

  // Same [min, max] convention as everywhere: only the upper bound is ever enforced (trimPlan cuts
  // down to it), the lower bound is descriptive. Missing entirely defaults to 0 — the conservative
  // default, not the permissive one: a theme that says nothing about links gets none, rather than
  // an unstated unlimited budget.
  const linksRaw = isPlainObject(raw.links) ? raw.links : {};
  return {
    // Named so an example refused against this theme can say which theme refused it.
    id: templateId,
    pictures,
    links: {
      perBlock: readRange(linksRaw.perBlock ?? 0, `links.perBlock темы «${templateId}»`),
      perPage: readRange(linksRaw.perPage ?? 0, `links.perPage темы «${templateId}»`),
    },
    // What the theme can draw at all. frameOf needs both lists to tell "this theme has no such
    // block" apart from "this theme has no such element" — two mistakes with two different fixes.
    known: manifest.blocks,
    elements: manifest.elements,
  };
}

export function loadTemplateExamples(templateId, root = process.cwd()) {
  const dir = join(root, TEMPLATES_DIR, templateId, 'examples');
  const names = existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
    : [];
  if (names.length === 0) {
    throw new Error(`у шаблона «${templateId}» нет ни одной страницы-образца в examples/`);
  }
  return names.map((name) => {
    try {
      return JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch (error) {
      throw new Error(`образец ${name} шаблона «${templateId}» не читается: ${error.message}`);
    }
  });
}

const plural = ([min, max]) => (min === max ? `exactly ${min}` : `between ${min} and ${max}`);

// The rules the model is shown, rendered from the same blocks.json a layout is resolved against.
// Auto blocks are left out on purpose: the factory builds those itself, and describing them would
// invite the model to write something that is then thrown away. What the factory supplies for a
// block — its h1, its heading, its picture — is named rather than omitted: unsaid, the model writes
// a heading of its own into the body and the page ends up with two.
//
// This text goes into `instructions`, which is what the prompt cache actually caches, so it may
// describe only the theme and never one page's composition — those differ from page to page now.
// Block order here is blocks.json's own key order (Object.entries walks insertion order, JSON.parse
// inserts in file order). It carries no meaning, but it must not be sorted or shuffled: one changed
// byte and every later request of the run pays full price.
export function describeBlocks(content) {
  const lines = [];
  for (const block of Object.values(content.blocks)) {
    if (block.auto) continue;
    const parts = Object.entries(block.content).map(([element, range]) => `${plural(range)} ${element}`);
    const given = [block.h1 && 'its h1', block.heading && 'its heading', block.image && 'its picture']
      .filter(Boolean);
    const written = given.length > 0
      ? `. ${given.join(' and ')} ${given.length > 1 ? 'are' : 'is'} written for you`
      : '';
    lines.push(`- ${block.type}: ${parts.join(', ')}${written}`);
  }
  for (const [name, value] of Object.entries(content.lengths)) {
    const range = Array.isArray(value) ? `${value[0]}–${value[1]}` : `up to ${value}`;
    lines.push(`- ${name}: ${range} characters or items`);
  }
  return lines.join('\n');
}
