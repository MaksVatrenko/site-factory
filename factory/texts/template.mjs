import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest, TEMPLATES_DIR } from '../../src/lib/templates.mjs';

// A template says what it can render (manifest.json: blocks and elements) and, for text
// generation, what a page made with it looks like (content.json: order, counts, lengths).
//
// content.json is the single source for both halves of the job: the factory rolls a site's
// skeleton from it, and describeTemplate() below renders the same file as the rules the model is
// given. Written twice, the two would drift; derived from one file, they cannot. That is what lets
// a new template arrive with a correct prompt and no prompt editing at all.

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

function contentPath(templateId, root) {
  return join(root, TEMPLATES_DIR, templateId, 'content.json');
}

export function loadTemplateContent(templateId, root = process.cwd()) {
  const file = contentPath(templateId, root);
  if (!existsSync(file)) {
    throw new Error(
      `шаблон «${templateId}» не поддерживает генерацию текстов: нет файла ${file}`,
    );
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`не удалось прочитать content.json шаблона «${templateId}»: ${error.message}`);
  }
  if (!isPlainObject(raw)) throw new Error(`content.json шаблона «${templateId}» должен быть объектом`);

  const manifest = readManifest(templateId, root);
  const knownBlocks = new Set(manifest.blocks);
  const knownElements = new Set(manifest.elements);

  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) {
    throw new Error(`в content.json шаблона «${templateId}» нужен непустой список blocks`);
  }
  const blocks = raw.blocks.map((block) => {
    if (!isPlainObject(block) || typeof block.type !== 'string' || block.type === '') {
      throw new Error(`в blocks шаблона «${templateId}» каждый блок должен иметь строковый type`);
    }
    if (!knownBlocks.has(block.type)) {
      throw new Error(
        `шаблон «${templateId}» не умеет блок «${block.type}»: его нет в blocks манифеста`,
      );
    }
    if (block.auto === true) return { type: block.type, auto: true, count: [1, 1], content: {} };
    const content = {};
    for (const [element, value] of Object.entries(isPlainObject(block.content) ? block.content : {})) {
      if (!knownElements.has(element)) {
        throw new Error(
          `шаблон «${templateId}» не умеет элемент «${element}»: его нет в elements манифеста`,
        );
      }
      content[element] = readRange(value, `блоке «${block.type}» шаблона «${templateId}»`);
    }
    return {
      type: block.type,
      auto: false,
      count: readRange(block.count ?? 1, `блоке «${block.type}» шаблона «${templateId}»`),
      content,
    };
  });

  const lengths = isPlainObject(raw.lengths) ? raw.lengths : {};
  return {
    blocks,
    images: readRange(raw.images ?? 0, `images шаблона «${templateId}»`),
    lengths,
    home: { sectionsBonus: Number(raw.home?.sectionsBonus) || 0 },
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

// The rules the model is shown, rendered from the same content.json the skeleton is rolled from.
// Blocks marked `auto` are left out on purpose: the factory builds those itself, and describing
// them would invite the model to write something that is then thrown away.
export function describeTemplate(content) {
  const lines = [];
  for (const block of content.blocks) {
    if (block.auto) continue;
    const parts = Object.entries(block.content).map(([element, range]) => `${plural(range)} ${element}`);
    const count = block.count[0] === 1 && block.count[1] === 1 ? '' : ` (${plural(block.count)} of them)`;
    lines.push(`- ${block.type}${count}: ${parts.join(', ')}`);
  }
  for (const [name, value] of Object.entries(content.lengths)) {
    const range = Array.isArray(value) ? `${value[0]}–${value[1]}` : `up to ${value}`;
    lines.push(`- ${name}: ${range} characters or items`);
  }
  return lines.join('\n');
}
