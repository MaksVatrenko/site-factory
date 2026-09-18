import { readFileSync } from 'node:fs';

// The country → locale table used to live inside factory/prompts/texts.json, alongside the
// writing rules. It moved into its own file because it has nothing to do with how the model
// writes: it is a plain reference list the owner extends by adding a line, and it is also what
// fills the geo/language dropdowns in the form — a job the texts-prompt file has no business in.

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function loadGeos(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`не удалось прочитать файл гео ${path}: ${error.message}`);
  }
  if (
    !isPlainObject(raw) ||
    Object.values(raw).some((locale) => typeof locale !== 'string' || locale.trim() === '')
  ) {
    throw new Error(`файл гео ${path} должен быть объектом «страна → язык», где язык — непустая строка`);
  }

  // Object.entries/keys walk a string-keyed object in the order its keys were inserted, and
  // JSON.parse inserts them in the order they appear in the source text — so reading the table
  // straight off `raw` already preserves the file's own order. Nothing here may sort it: the
  // owner puts the countries used most at the top, on purpose, and that order is meant to reach
  // the dropdown unchanged.
  const languageByGeo = Object.fromEntries(
    Object.entries(raw).map(([geo, locale]) => [geo, locale.trim()]),
  );
  const countries = Object.keys(languageByGeo);
  // A Set remembers insertion order and drops repeats, which is exactly "distinct locales in the
  // order they first appear" — several countries sharing one locale must not add it twice.
  const locales = [...new Set(countries.map((geo) => languageByGeo[geo]))];

  return { languageByGeo, countries, locales };
}
