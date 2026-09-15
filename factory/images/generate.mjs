import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadSiteDirInput } from '../../src/lib/site-dir.mjs';
import { createPromptPicker, fillBrand, loadPromptFile } from './prompts.mjs';
import { generateImage, RunwareError } from './runware.mjs';
import { addEntries, readRegistry, uniqueFileName, writeUniqueFile } from './registry.mjs';

// Fills in the pictures a site's content asks for but its images.json does not have yet: each
// missing name gets one picture from a random prompt, saved under public/images, with its entry
// added to images.json straight away — so a run cut short keeps what it finished, and the next run
// only makes the rest. Nothing already in images.json or public/ is ever changed.
//
// It never throws. Every problem becomes a line in the log and the site builds anyway: a picture
// that did not appear is dropped from the page with a warning, the same as any unknown name.

const IMAGES_URL_DIR = '/images';
// After these, every further request would fail exactly the same way.
const STOPPING_KINDS = new Set(['auth', 'balance']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeOf(entry) {
  return typeof entry.type === 'string' ? entry.type.trim() : '';
}

// Every string an `image` key holds, but only where normalizePageContent in src/lib/content.mjs
// actually resolves one, so nothing gets paid for that the built page could never show — and
// only for a block normalizeSite in src/lib/normalize.mjs keeps in the first place:
//   - never a block whose `type` is missing or blank — normalizeSite drops it before the engine
//     ever sees it, with the same test used here (a non-blank string);
//   - only inside a block's props.content entries — never a field on the block itself, which the
//     engine never even looks at;
//   - never a `content` entry that is not a plain object — content.mjs's own entries loop skips
//     it outright, so an array (or any other non-object) sitting directly in `content` is never
//     resolved, even though the walk below does recurse into arrays nested deeper (a card's
//     `items`, and the like);
//   - never on a `content` entry of type 'title' — normalizeTitle only ever reads its h1–h6 key,
//     it never looks at `image` at all;
//   - anywhere else inside a content entry, at any depth (a picture element, a card in a list,
//     …) — exactly what resolveNested walks.
// Names are kept exactly as written, since images.json is matched by that exact key.
export function collectImageNames(pages) {
  const names = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isPlainObject(value)) return;
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'image') {
        if (typeof inner === 'string' && inner !== '') names.add(inner);
      } else {
        visit(inner);
      }
    }
  };
  for (const page of Array.isArray(pages) ? pages : []) {
    if (!isPlainObject(page)) continue;
    for (const block of Array.isArray(page.blocks) ? page.blocks : []) {
      if (!isPlainObject(block)) continue;
      if (typeOf(block) === '') continue;
      const props = isPlainObject(block.props) ? block.props : {};
      const entries = Array.isArray(props.content) ? props.content : [];
      for (const entry of entries) {
        if (!isPlainObject(entry)) continue;
        if (typeOf(entry) === 'title') continue;
        visit(entry);
      }
    }
  }
  return [...names];
}

// Capped, not just sanitised: an unbounded marker name would otherwise become an unbounded file
// name. The cut can leave a trailing hyphen behind (it lands mid-run of what was a separator), so
// that gets trimmed again afterwards.
const MAX_FILE_BASE_LENGTH = 100;

export function fileBaseFor(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_FILE_BASE_LENGTH)
    .replace(/-+$/g, '');
  return base || 'image';
}

export function altFor(name, brand) {
  const words = name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [brand, words].filter(Boolean).join(' ');
}

const formatSeconds = (ms) => `${(ms / 1000).toFixed(1)} с`;
const formatCost = (cost) => `$${cost.toFixed(4)}`;

export async function generateMissingImages({
  siteDir,
  brand = '',
  config,
  promptFile,
  fetchFn = fetch,
  sleep,
  random = Math.random,
  log = () => {},
}) {
  const summary = { generated: [], skipped: [], cost: 0 };

  let pages;
  let siteBrand = '';
  try {
    const { input } = loadSiteDirInput(siteDir);
    pages = input.pages;
    if (typeof input.brand?.name === 'string') siteBrand = input.brand.name.trim();
  } catch (error) {
    log(`Картинки: не удалось прочитать сайт — ${error.message}. Генерация пропущена`);
    return summary;
  }

  let registry;
  try {
    registry = readRegistry(siteDir);
  } catch (error) {
    log(`Картинки: ${error.message} — генерация пропущена, файл не тронут`);
    return summary;
  }

  const rawMissing = collectImageNames(pages).filter((name) => !Object.hasOwn(registry, name));
  if (rawMissing.length === 0) return summary;

  // `registry[name] = entry` on a plain object literal cannot make `__proto__` an own property —
  // it sets the object's prototype instead, so the entry would never actually land in
  // images.json and this name would be regenerated, and paid for, on every future build. Skip it
  // outright, before anything else runs or costs money.
  const missing = rawMissing.filter((name) => name !== '__proto__');
  if (rawMissing.length !== missing.length) {
    summary.skipped.push('__proto__');
    log('Картинка __proto__: такое имя нельзя записать в images.json — пропущена');
  }
  if (missing.length === 0) return summary;

  if (!config?.apiKey) {
    // A key env.mjs flagged as unusable (a space, line break, or any other non-visible-ASCII
    // character inside it) is a different situation from no key at all: the owner did set
    // something, it just cannot be sent safely, so this says so instead of claiming the .env is
    // empty.
    const reason = config?.apiKeyInvalid
      ? 'ключ Runware в .env записан неверно (недопустимые символы (пробелы, переносы строк, не-ASCII))'
      : 'ключ Runware не задан в .env';
    log(`Картинки: ${reason} — пропущено ${missing.length}: ${missing.join(', ')}`);
    summary.skipped = missing;
    return summary;
  }

  let promptSet;
  try {
    promptSet = loadPromptFile(promptFile);
  } catch (error) {
    log(`Картинки: ${error.message}. Генерация пропущена`);
    summary.skipped = missing;
    return summary;
  }

  const resolvedBrand = String(brand).trim() || siteBrand;
  const pick = createPromptPicker(promptSet.prompts, random);
  const imagesDir = join(siteDir, 'public', 'images');
  const takenFiles = new Set();
  log(`Картинки: нужно сгенерировать ${missing.length} — ${missing.join(', ')}`);

  const queue = [...missing];
  let stopped = false;
  const worker = async () => {
    while (queue.length > 0 && !stopped) {
      const name = queue.shift();
      const started = Date.now();

      // Reserved before Runware is ever asked for this picture: if the folder cannot even be
      // created (e.g. `public` already exists as a plain file), there is nothing generateImage
      // could produce that this could go on to save, so it is not worth paying for at all.
      // This reservation only holds within this run (see writeUniqueFile above for the other
      // half of the guarantee, against a concurrent run).
      let fileName;
      let base;
      try {
        mkdirSync(imagesDir, { recursive: true });
        base = fileBaseFor(name);
        fileName = uniqueFileName(imagesDir, base, takenFiles);
      } catch (error) {
        summary.skipped.push(name);
        log(`Картинка ${name}: ${error.message} — пропущена`);
        continue;
      }

      // Set once generateImage resolves: Runware has billed for the picture by then, so if
      // writing the file or images.json afterwards throws, the catch below still counts the cost
      // even though the picture ends up skipped.
      let paidCost;
      try {
        const { bytes, cost } = await generateImage(
          {
            prompt: fillBrand(pick(), resolvedBrand),
            negativePrompt: promptSet.negativePrompt,
            width: promptSet.width,
            height: promptSet.height,
          },
          { config, fetchFn, sleep },
        );
        paidCost = cost;
        const savedFileName = writeUniqueFile(imagesDir, fileName, base, takenFiles, bytes);
        addEntries(siteDir, {
          [name]: {
            src: `${IMAGES_URL_DIR}/${savedFileName}`,
            alt: altFor(name, resolvedBrand),
            width: promptSet.width,
            height: promptSet.height,
          },
        });
        summary.generated.push(name);
        if (typeof cost === 'number') summary.cost += cost;
        const costNote = typeof cost === 'number' ? `, ${formatCost(cost)}` : '';
        log(`Картинка ${name} готова — ${formatSeconds(Date.now() - started)}${costNote}`);
      } catch (error) {
        summary.skipped.push(name);
        if (error instanceof RunwareError && STOPPING_KINDS.has(error.kind)) {
          if (!stopped) log(`Картинки: ${error.message} — генерация остановлена`);
          stopped = true;
        } else {
          log(`Картинка ${name}: ${error.message} — пропущена`);
        }
        if (typeof paidCost === 'number') summary.cost += paidCost;
      }
    }
  };

  const workers = Math.max(1, Math.floor(config.concurrency) || 1);
  await Promise.all(Array.from({ length: workers }, worker));
  summary.skipped.push(...queue);

  const spent = summary.cost > 0 ? `, потрачено ${formatCost(summary.cost)}` : '';
  log(`Картинки: готово ${summary.generated.length} из ${missing.length}${spent}`);
  return summary;
}
