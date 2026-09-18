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
      image: flag(block, 'image', type),
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
