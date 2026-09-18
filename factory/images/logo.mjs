import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSiteDirInput } from '../../src/lib/site-dir.mjs';
import { fillBrand } from './prompts.mjs';
import { loadLogoPromptFile } from './logo-prompts.mjs';
import { generateLogoArtwork, removeBackground } from './runware.mjs';
import { makeHeaderLogo, makeSquareLogo } from './compose.mjs';
import { addEntries, readRegistry, uniqueFileName, writeUniqueFile } from './registry.mjs';

// Makes a site's logo before its build, when the site has none — or again from scratch when the
// form's "regenerate the logo" checkbox asks for it (see `force` below): the brand name drawn by a
// model chosen for lettering, its background removed, then trimmed into the header logo and set on a
// gradient square for schema.org, og:image and the favicon (see
// docs/specs/2026-09-15-logo-generation-design.md). Like the picture step, it never throws — every
// problem is one log line, and the site builds regardless.
export const LOGO_NAME = 'logo';
export const SQUARE_NAME = 'logo-square';
const IMAGES_URL_DIR = '/images';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const formatSeconds = (ms) => `${(ms / 1000).toFixed(1)} с`;
const formatCost = (cost) => `$${cost.toFixed(4)}`;

function pickGradient(gradients, random) {
  const index = Math.min(Math.floor(random() * gradients.length), gradients.length - 1);
  return gradients[index];
}

// Only a file the site itself ships can be rebuilt into a square: a remote logo would mean a
// download, and a missing file has nothing to rebuild from.
function localLogoPath(siteDir, entry) {
  const src = isPlainObject(entry) ? textOf(entry.src) : '';
  if (!src.startsWith(`${IMAGES_URL_DIR}/`) || src.includes('..')) return null;
  const path = join(siteDir, 'public', src);
  return existsSync(path) ? path : null;
}

async function rebuildSquare({ siteDir, registry, brand, promptFile, random, log }) {
  try {
    const path = localLogoPath(siteDir, registry[LOGO_NAME]);
    if (!path) throw new Error('у записи logo нет локального файла в public/images');
    const { gradients } = loadLogoPromptFile(promptFile);
    const square = await makeSquareLogo(readFileSync(path), pickGradient(gradients, random));
    const imagesDir = join(siteDir, 'public', 'images');
    const taken = new Set();
    const squareName = writeUniqueFile(imagesDir, uniqueFileName(imagesDir, SQUARE_NAME, taken, '.png'), SQUARE_NAME, taken, square, '.png');
    addEntries(siteDir, {
      [SQUARE_NAME]: { src: `${IMAGES_URL_DIR}/${squareName}`, alt: [brand, 'logo'].filter(Boolean).join(' '), width: 512, height: 512 },
    });
    log('Логотип: квадрат собран из готового логотипа');
  } catch (error) {
    log(`Логотип: квадрат не собран — ${error.message}`);
  }
}

export async function generateLogo({
  siteDir,
  brand = '',
  config,
  promptFile,
  fetchFn = fetch,
  sleep,
  random = Math.random,
  // The form's "regenerate the logo" checkbox. It only skips the two "already have one" shortcuts
  // below — everything that guards the money (a brand name, a usable key, a writable folder) is
  // checked exactly as it is for a first logo.
  force = false,
  log = () => {},
}) {
  const summary = { generated: false, cost: 0 };

  let siteBrand = '';
  try {
    const { input } = loadSiteDirInput(siteDir);
    const brandInput = isPlainObject(input.brand) ? input.brand : {};
    // A logo the owner named in site.json is theirs; the factory makes one only for a site without.
    // That holds even when the form asks to regenerate: the engine prefers brand.logo over the
    // registry either way (see resolveLogo in src/lib/normalize.mjs), so a paid-for replacement
    // would never be shown. Only then is it worth a line — a ticked checkbox that does nothing
    // should say so, rather than leave an empty log behind.
    if (textOf(brandInput.logo) !== '') {
      if (force) log('Логотип: у сайта свой логотип в site.json — перегенерация пропущена');
      return summary;
    }
    siteBrand = textOf(brandInput.name);
  } catch (error) {
    log(`Логотип: не удалось прочитать сайт — ${error.message}. Пропущен`);
    return summary;
  }

  let registry;
  try {
    registry = readRegistry(siteDir);
  } catch (error) {
    log(`Логотип: ${error.message} — пропущен, файл не тронут`);
    return summary;
  }

  const resolvedBrand = textOf(String(brand)) || siteBrand;
  // Both shortcuts below hang off `hasLogo`, so clearing it is all `force` needs to do: a site
  // with both pictures is no longer left alone, and one missing only the square no longer gets
  // the free rebuild — both fall through to the full paid pipeline instead.
  const hasLogo = !force && Object.hasOwn(registry, LOGO_NAME);
  if (hasLogo && Object.hasOwn(registry, SQUARE_NAME)) return summary;
  if (hasLogo) {
    await rebuildSquare({ siteDir, registry, brand: resolvedBrand, promptFile, random, log });
    return summary;
  }

  if (resolvedBrand === '') {
    log('Логотип: нет названия бренда — пропущен');
    return summary;
  }
  if (!config?.apiKey) {
    const reason = config?.apiKeyInvalid
      ? 'ключ Runware в .env записан неверно (недопустимые символы (пробелы, переносы строк, не-ASCII))'
      : 'ключ Runware не задан в .env';
    log(`Логотип: ${reason} — пропущен`);
    return summary;
  }

  let promptSet;
  try {
    promptSet = loadLogoPromptFile(promptFile);
  } catch (error) {
    log(`Логотип: ${error.message}. Пропущен`);
    return summary;
  }

  const imagesDir = join(siteDir, 'public', 'images');
  try {
    // Before anything is paid for: a folder that cannot be created means nothing could be saved.
    mkdirSync(imagesDir, { recursive: true });
  } catch (error) {
    log(`Логотип: ${error.message} — пропущен`);
    return summary;
  }

  log(`Логотип: делаю${force ? ' заново' : ''} для «${resolvedBrand}»`);
  const started = Date.now();
  const promptIndex = Math.min(Math.floor(random() * promptSet.prompts.length), promptSet.prompts.length - 1);
  try {
    const artwork = await generateLogoArtwork(
      {
        prompt: fillBrand(promptSet.prompts[promptIndex], resolvedBrand),
        width: promptSet.width,
        height: promptSet.height,
      },
      { config, fetchFn, sleep },
    );
    if (typeof artwork.cost === 'number') summary.cost += artwork.cost;
    // By address first, by identifier second. Both name the same picture and Runware's own error
    // text accepts either — but ideogram:remove-background@0 refuses the identifier outright, even
    // a valid UUID v4 it had handed back seconds earlier. Measured on a live run of 2026-09-18:
    // "Invalid value for 'inputImage' parameter", where the same wordmark went through by address
    // on the next call. The identifier is still tried when there is no address, and after an
    // address is refused, because a different cutout model may well be the other way round — this
    // one is a setting in .env, not a constant.
    const ways = [artwork.imageURL, artwork.imageUUID].filter(Boolean);
    let cutout;
    for (const [index, way] of ways.entries()) {
      try {
        cutout = await removeBackground(way, { config, fetchFn, sleep });
        break;
      } catch (error) {
        // Only a refusal of this picture is worth asking again for. A bad key or an empty balance
        // answers the same way whichever way the picture is named, and the last way left has
        // nothing to fall back to.
        if (error?.kind !== 'rejected' || index === ways.length - 1) throw error;
        log(`Логотип: «${way}» не принят — ${error.message}. Пробую иначе`);
      }
    }
    if (typeof cutout.cost === 'number') summary.cost += cutout.cost;

    // Both pictures are made in memory first and written only once both exist, so a failure
    // anywhere leaves no half-made logo on disk.
    const header = await makeHeaderLogo(cutout.bytes);
    const square = await makeSquareLogo(header.trimmed, pickGradient(promptSet.gradients, random));
    const taken = new Set();
    const logoName = writeUniqueFile(imagesDir, uniqueFileName(imagesDir, LOGO_NAME, taken, '.webp'), LOGO_NAME, taken, header.bytes, '.webp');
    const squareName = writeUniqueFile(imagesDir, uniqueFileName(imagesDir, SQUARE_NAME, taken, '.png'), SQUARE_NAME, taken, square, '.png');
    addEntries(siteDir, {
      [LOGO_NAME]: { src: `${IMAGES_URL_DIR}/${logoName}`, alt: resolvedBrand, width: header.width, height: header.height },
      [SQUARE_NAME]: { src: `${IMAGES_URL_DIR}/${squareName}`, alt: `${resolvedBrand} logo`, width: 512, height: 512 },
    });
    summary.generated = true;
    log(`Логотип готов — ${formatSeconds(Date.now() - started)}, ${formatCost(summary.cost)}`);
  } catch (error) {
    const spent = summary.cost > 0 ? `, потрачено ${formatCost(summary.cost)}` : '';
    log(`Логотип: ${error.message} — пропущен${spent}`);
  }
  return summary;
}
