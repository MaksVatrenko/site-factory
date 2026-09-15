import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSiteDirInput } from '../../src/lib/site-dir.mjs';
import { createPromptPicker, fillBrand, loadPromptFile } from './prompts.mjs';
import { generateImage, RunwareError } from './runware.mjs';

// Fills in the pictures a site's content asks for but its images.json does not have yet: each
// missing name gets one picture from a random prompt, saved under public/images, with its entry
// added to images.json straight away — so a run cut short keeps what it finished, and the next run
// only makes the rest. Nothing already in images.json or public/ is ever changed.
//
// It never throws. Every problem becomes a line in the log and the site builds anyway: a picture
// that did not appear is dropped from the page with a warning, the same as any unknown name.

const IMAGES_FILE = 'images.json';
const IMAGES_URL_DIR = '/images';
// After these, every further request would fail exactly the same way.
const STOPPING_KINDS = new Set(['auth', 'balance']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Every string an `image` key holds anywhere inside a page's blocks — a picture element, or a card
// in a list — which is exactly where the engine looks pictures up (resolveNested in
// src/lib/content.mjs). Names are kept exactly as written, since images.json is matched by that
// exact key.
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
    if (isPlainObject(page)) visit(page.blocks);
  }
  return [...names];
}

export function fileBaseFor(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'image';
}

export function altFor(name, brand) {
  const words = name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [brand, words].filter(Boolean).join(' ');
}

function uniqueFileName(imagesDir, base, taken) {
  let candidate = `${base}.webp`;
  let number = 2;
  while (taken.has(candidate) || existsSync(join(imagesDir, candidate))) {
    candidate = `${base}-${number}.webp`;
    number += 1;
  }
  taken.add(candidate);
  return candidate;
}

// Throws on a file that is not a JSON object: writing our entry into it would mean replacing the
// owner's file with one we made up.
// The try/catch covers a file that breaks while a run is in progress (addToRegistry re-reads it);
// loadSiteDirInput has already refused one broken from the start.
function readRegistry(siteDir) {
  const path = join(siteDir, IMAGES_FILE);
  if (!existsSync(path)) return {};
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`images.json сайта не читается как JSON (${error.message})`);
  }
  if (!isPlainObject(raw)) throw new Error('images.json сайта должен быть объектом');
  return raw;
}

// Read, add, write — synchronously, so two pictures finishing at once cannot interleave and lose
// one another's entry.
function addToRegistry(siteDir, name, entry) {
  const registry = readRegistry(siteDir);
  registry[name] = entry;
  writeFileSync(join(siteDir, IMAGES_FILE), `${JSON.stringify(registry, null, 2)}\n`);
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

  const missing = collectImageNames(pages).filter((name) => !Object.hasOwn(registry, name));
  if (missing.length === 0) return summary;

  if (!config?.apiKey) {
    log(`Картинки: ключ Runware не задан в .env — пропущено ${missing.length}: ${missing.join(', ')}`);
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
        const fileName = uniqueFileName(imagesDir, fileBaseFor(name), takenFiles);
        mkdirSync(imagesDir, { recursive: true });
        writeFileSync(join(imagesDir, fileName), bytes);
        addToRegistry(siteDir, name, {
          src: `${IMAGES_URL_DIR}/${fileName}`,
          alt: altFor(name, resolvedBrand),
          width: promptSet.width,
          height: promptSet.height,
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
