import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SITE_SETTINGS_FILE = 'site.json';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The ordering rule only ever needs to recognise the ONE spelling of the root normalizeSite's own
// buildSlugCandidate treats as "explicitly the root" before any sanitizing runs — see that
// function's own comment. A missing `slug` field is deliberately NOT treated as "home" here: which
// page is home is this adapter's job to decide from real content, not a side effect of whichever
// file happens to sort first.
function isHomeSlug(value) {
  return typeof value === 'string' && value.trim() === '/';
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read content from ${path}: ${error.message}`);
  }
}

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

// A folder page is `{ slug, title, description, blocks }` — the shape a spreadsheet-converted
// page actually has on disk (see scripts/sheet-to-json.mjs). normalizeSite already knows how to
// read a page shaped `{ slug, meta: { title, description }, blocks }` (see docs/content-format.md
// and tests/normalize.test.mjs) — this is the field-name half of the adapter, translating one into
// the other. A page that is not an object is returned untouched so normalizeSite's own
// `isPlainObject` filter — which already drops a page that is not an object, with its own warning
// — is the one thing that ever rejects it; this does not duplicate that check.
function toPageInput(raw) {
  if (!isPlainObject(raw)) return raw;
  const { slug, title, description, blocks } = raw;
  return {
    slug,
    meta: { title, description },
    blocks: Array.isArray(blocks) ? blocks.map(toBlockInput) : blocks,
  };
}

// Same translation one level down: a folder page's block is `{ type, ...fields }` — flat, which
// is what makes it easy for a client to rearrange or strip fields by hand — while normalizeSite
// reads a block's content from `props` (see normalizeSite's own per-block loop). Moving every
// field but "type" under `props` is exactly the shape normalizeSite already expects from any other
// content source. A block that is not an object is returned untouched for the same reason as
// toPageInput above: normalizeSite's own per-block `isPlainObject` check is what rejects it.
function toBlockInput(raw) {
  if (!isPlainObject(raw)) return raw;
  const { type, ...props } = raw;
  return { type, props };
}

// Reads a folder of pages into the single raw object normalizeSite already accepts: the shared
// settings from site.json (if present) spread at the top level, plus a `pages` array assembled
// from every other *.json file in the folder — home first (the page whose own slug is genuinely
// "/"), then the rest alphabetically by filename. Filenames are sorted with a plain string sort
// (not locale- or filesystem-dependent) so the result is the same on every platform.
//
// Only two failures are this loader's own to throw, matching the single-file (SITE_JSON) path's
// contract exactly: a file that cannot be read or parsed as JSON, and a folder with no page files
// at all. The latter is new here, and deliberate — an empty folder (or one holding only
// site.json) is not content shaped strangely, it is the operator pointing at the wrong path, so it
// fails the same way an unreadable content file already does rather than silently building an
// empty site.
export function loadSiteDirInput(dir) {
  const jsonFileNames = listJsonFileNames(dir);
  const pageFileNames = jsonFileNames.filter((name) => name !== SITE_SETTINGS_FILE);

  if (pageFileNames.length === 0) {
    throw new Error(
      `Site directory ${dir} has no pages: found no *.json file besides ${SITE_SETTINGS_FILE}`,
    );
  }

  const settingsRaw = jsonFileNames.includes(SITE_SETTINGS_FILE)
    ? readJsonFile(join(dir, SITE_SETTINGS_FILE))
    : {};
  const settings = isPlainObject(settingsRaw) ? settingsRaw : {};

  const pageRecords = pageFileNames.map((name) => readJsonFile(join(dir, name)));

  // Home first, if one of the pages actually claims "/"; the rest keep the alphabetical order
  // `pageFileNames` (and so `pageRecords`) was already sorted into. `homeIndex <= 0` covers both
  // "already first" (0) and "no page claims home" (-1) — in either case the existing order is
  // already correct and nothing needs to move.
  const homeIndex = pageRecords.findIndex(
    (raw) => isPlainObject(raw) && isHomeSlug(raw.slug),
  );
  const orderedRecords =
    homeIndex <= 0
      ? pageRecords
      : [pageRecords[homeIndex], ...pageRecords.filter((_, index) => index !== homeIndex)];

  return { ...settings, pages: orderedRecords.map(toPageInput) };
}
