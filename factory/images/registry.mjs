import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// images.json helpers shared by every step that produces a picture: reading the registry, adding
// entries to it in one write, and picking a free file name under public/images. Split out of
// generate.mjs so the logo step (factory/images/logo.mjs) reuses this exact bookkeeping instead of
// a second copy that could drift from it.

const IMAGES_FILE = 'images.json';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Throws on a file that is not a JSON object: writing our entry into it would mean replacing the
// owner's file with one we made up.
// The try/catch covers a file that breaks while a run is in progress (addEntries re-reads it);
// loadSiteDirInput has already refused one broken from the start.
export function readRegistry(siteDir) {
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

// Read, merge, write — synchronously, so two runs finishing at once cannot interleave and lose one
// another's entries. Several entries land in one write, so a logo and its square never end up in
// images.json one without the other.
export function addEntries(siteDir, entries) {
  const registry = readRegistry(siteDir);
  Object.assign(registry, entries);
  writeFileSync(join(siteDir, IMAGES_FILE), `${JSON.stringify(registry, null, 2)}\n`);
}

export function uniqueFileName(imagesDir, base, taken, ext = '.webp') {
  let candidate = `${base}${ext}`;
  let number = 2;
  while (taken.has(candidate) || existsSync(join(imagesDir, candidate))) {
    candidate = `${base}-${number}${ext}`;
    number += 1;
  }
  taken.add(candidate);
  return candidate;
}

// A name reserved by uniqueFileName lives only in this run's memory (`taken`), so it does not
// stop a second run of the factory for the same site — a second build under a different domain,
// or the CLI alongside the form — from creating that exact file while this run is still waiting
// on Runware. `wx` makes the write itself the real check: it fails with EEXIST rather than
// silently overwriting a file someone else just claimed, and only then is the next free name
// tried. A bounded number of attempts, not an unbounded loop: past that, something other than an
// ordinary name clash is going on, and it is treated as any other write failure.
const MAX_WRITE_ATTEMPTS = 5;

export function writeUniqueFile(imagesDir, fileName, base, taken, bytes, ext = '.webp') {
  let candidate = fileName;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const target = join(imagesDir, candidate);
    try {
      writeFileSync(target, bytes, { flag: 'wx' });
      return candidate;
    } catch (error) {
      // `wx` reports EEXIST for a directory sitting at that path too, not only for a file a
      // concurrent run wrote there first — and a directory blocking the name is a write failure
      // like any other (what a plain write would have reported as EISDIR), not a clash worth
      // trying another name for.
      const blockedByDirectory = error.code === 'EEXIST' && statSync(target).isDirectory();
      if (error.code !== 'EEXIST' || blockedByDirectory) throw error;
      candidate = uniqueFileName(imagesDir, base, taken, ext);
    }
  }
  throw new Error(`не удалось подобрать свободное имя файла для «${base}»`);
}
