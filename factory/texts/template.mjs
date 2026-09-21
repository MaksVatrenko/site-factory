import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest, TEMPLATES_DIR } from '../../src/lib/templates.mjs';

// A theme says what it can render — manifest.json: which blocks and which element types — and,
// for text generation, the one thing an example cannot say: where a picture goes, and how many
// links a block may carry. That is templates/<id>/pictures.json, read by loadTemplatePictures below.
//
// Everything else about a page — which blocks, in what order, what stands inside each of them, how
// long the text runs — is read off the example SEO supplied (factory/texts/example.mjs). In v1 it
// was described here, in blocks.json, and the model was shown that description in words; the words
// are gone, because a schema built from a real page says it exactly and a paragraph about it could
// only ever repeat that or contradict it.

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
