import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Files in a site folder that configure the site rather than being one of its pages. Listed once,
// here: factory/server.mjs counts pages with isPageFileName below instead of keeping its own copy
// of the rule, which is exactly how the two would drift the day a third service file appears.
export const SERVICE_FILE_NAMES = Object.freeze(['site.json', 'images.json']);

const SITE_SETTINGS_FILE = 'site.json';
const IMAGES_FILE = 'images.json';
const HOME_FILE_BASE = 'home';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A file named only ".json" is not a page: its name without the extension is empty, and an empty
// name would become "/" — taking the home page from home.json, and from a dot-file Finder hides.
export function isPageFileName(name) {
  return (
    typeof name === 'string' &&
    name.endsWith('.json') &&
    name !== '.json' &&
    !SERVICE_FILE_NAMES.includes(name)
  );
}

// A page's address is its file name: casino.json is /casino. home.json is the site root, matched
// without regard to case — Home.json and home.json cannot even coexist on a case-insensitive
// filesystem, so treating them differently would make the answer depend on the machine. Nothing
// else about the name is touched here: the result goes through normalizeSite's own slug rules and
// the filesystem prober exactly like a hand-written slug used to, which is what still stops a
// file called sitemap.xml.json from overwriting the sitemap.
export function slugFromFileName(name) {
  const base = name.slice(0, -'.json'.length);
  return base.toLowerCase() === HOME_FILE_BASE ? '/' : `/${base}`;
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read content from ${path}: ${error.message}`);
  }
}

// Files only, never directories: a site folder holds public/ (and, once languages arrive, one
// subfolder per language), and none of what sits inside those is a page of this site's root.
function listJsonFileNames(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Cannot read site directory ${dir}: ${error.message}`);
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
}

// A page file is `{ title, description, blocks }`; normalizeSite reads a page shaped
// `{ slug, meta: { title, description }, blocks }`. The slug is the file's own address, never a
// field of the file. A page that is not an object is passed through untouched so normalizeSite's
// own check — which already drops it with a warning naming its position — stays the one thing
// that rejects it.
function toPageInput({ raw, slug }) {
  if (!isPlainObject(raw)) return raw;
  const { title, description, blocks } = raw;
  return {
    slug,
    meta: { title, description },
    blocks: Array.isArray(blocks) ? blocks.map(toBlockInput) : blocks,
  };
}

// Same translation one level down: a block on disk is `{ type, ...fields }` — flat, which is what
// makes it easy to rearrange by hand — while normalizeSite reads a block's fields from `props`.
function toBlockInput(raw) {
  if (!isPlainObject(raw)) return raw;
  const { type, ...props } = raw;
  return { type, props };
}

// Reads a site folder into what the engine needs: the shared settings from site.json spread at the
// top level with the pages beside them (home first, then the rest by file name — a plain string
// sort, so the order is the same on every platform), the raw image registry from images.json, and
// the warnings only this loader is in a position to give.
//
// Only two failures are this loader's to throw — the two content-side failures the engine allows
// at all: a file that cannot be read or parsed as JSON, and a folder with no page files. The
// latter is deliberate: an empty folder is not content shaped strangely, it is the operator
// pointing at the wrong path.
export function loadSiteDirInput(dir) {
  const jsonFileNames = listJsonFileNames(dir);
  const pageFileNames = jsonFileNames.filter(isPageFileName);

  if (pageFileNames.length === 0) {
    throw new Error(
      `Site directory ${dir} has no pages: found no *.json file besides ${SERVICE_FILE_NAMES.join(', ')}`,
    );
  }

  const settingsRaw = jsonFileNames.includes(SITE_SETTINGS_FILE)
    ? readJsonFile(join(dir, SITE_SETTINGS_FILE))
    : {};
  const settings = isPlainObject(settingsRaw) ? settingsRaw : {};
  const images = jsonFileNames.includes(IMAGES_FILE)
    ? readJsonFile(join(dir, IMAGES_FILE))
    : undefined;

  const warnings = [];
  const records = pageFileNames.map((name) => {
    const raw = readJsonFile(join(dir, name));
    const slug = slugFromFileName(name);
    if (isPlainObject(raw) && raw.slug !== undefined) {
      warnings.push(`${slug}: поле slug больше не используется — адрес берётся из имени файла ${name}`);
    }
    return { raw, slug };
  });

  const homeIndex = records.findIndex((record) => record.slug === '/');
  if (homeIndex === -1) {
    warnings.push('В папке нет home.json — у сайта не будет главной страницы');
  }
  const ordered =
    homeIndex <= 0
      ? records
      : [records[homeIndex], ...records.filter((_, index) => index !== homeIndex)];

  return { input: { ...settings, pages: ordered.map(toPageInput) }, images, warnings };
}
