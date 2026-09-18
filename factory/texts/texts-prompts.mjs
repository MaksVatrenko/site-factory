import { readFileSync } from 'node:fs';

// The half of the prompt that does not depend on the template: what to write like and what never
// to invent. Editable without touching code, like the other files in factory/prompts/.
//
// Everything about *structure* lives with the template instead (templates/<id>/content.json), so
// adding a template never means editing this file. The country → locale table this stage also
// needs lives separately, in factory/geos.mjs/geos.json — it is a reference list, not a writing
// rule, and languageFor below works on it unchanged no matter where it came from.

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DEFAULT_LOCALE = 'en-US';

export function loadTextsPromptFile(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`не удалось прочитать файл правил ${path}: ${error.message}`);
  }
  if (!isPlainObject(raw)) throw new Error(`файл правил ${path} должен быть объектом`);

  const { rules } = raw;
  if (
    !Array.isArray(rules) ||
    rules.length === 0 ||
    rules.some((rule) => typeof rule !== 'string' || rule.trim() === '')
  ) {
    throw new Error(`в файле правил ${path} нужен непустой список rules из непустых строк`);
  }
  return {
    rules: rules.map((rule) => rule.trim()),
  };
}

// The form's own language field wins over this; it is consulted only when that field is empty.
// An unknown geo is not an error — English is a defensible default for the markets this factory
// serves — but the caller is told, so it can say so in the log instead of quietly guessing.
//
// Looks up the geo by scanning the table's own entries with a case/space-insensitive comparison,
// rather than lower-casing the input and indexing straight into languageByGeo: object property
// lookup is case-sensitive, so a direct index would silently miss any table whose keys are not
// already all-lowercase (including the one factory/geos.mjs hands back, which keeps the file's
// original spelling — see the comment there). languageFor does not care where languageByGeo came
// from, only that it maps a geo name to a locale, so it stays put here even though the table
// itself now lives in a different file.
export function languageFor(geo, languageByGeo) {
  const key = String(geo ?? '').trim().toLowerCase();
  if (key !== '') {
    for (const [geoName, locale] of Object.entries(languageByGeo)) {
      if (geoName.trim().toLowerCase() === key) return { locale, known: true };
    }
  }
  return { locale: DEFAULT_LOCALE, known: false };
}
