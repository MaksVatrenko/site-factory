import { readFileSync } from 'node:fs';

// The half of the prompt that does not depend on the template: what to write like, what never to
// invent, and which language a geo speaks. Editable without touching code, like the other files in
// factory/prompts/.
//
// Everything about *structure* lives with the template instead (templates/<id>/content.json), so
// adding a template never means editing this file.

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

  const { rules, languageByGeo } = raw;
  if (
    !Array.isArray(rules) ||
    rules.length === 0 ||
    rules.some((rule) => typeof rule !== 'string' || rule.trim() === '')
  ) {
    throw new Error(`в файле правил ${path} нужен непустой список rules из непустых строк`);
  }
  if (
    !isPlainObject(languageByGeo) ||
    Object.values(languageByGeo).some((locale) => typeof locale !== 'string' || locale.trim() === '')
  ) {
    throw new Error(`в файле правил ${path} languageByGeo должен быть объектом «гео → язык»`);
  }
  return {
    rules: rules.map((rule) => rule.trim()),
    // Geo names keep their exact spelling from the file here. Matching ignores case and spacing
    // over in languageFor, the one place that needs it — this loader stays a plain read-and-validate
    // step instead of a second place with its own normalization rules that could drift from the first.
    languageByGeo: Object.fromEntries(
      Object.entries(languageByGeo).map(([geo, locale]) => [geo, locale.trim()]),
    ),
  };
}

// The form's own language field wins over this; it is consulted only when that field is empty.
// An unknown geo is not an error — English is a defensible default for the markets this factory
// serves — but the caller is told, so it can say so in the log instead of quietly guessing.
//
// Looks up the geo by scanning the table's own entries with a case/space-insensitive comparison,
// rather than lower-casing the input and indexing straight into languageByGeo: object property
// lookup is case-sensitive, so a direct index would silently miss any table whose keys are not
// already all-lowercase (including the one loadTextsPromptFile hands back, which keeps the file's
// original spelling — see the comment there).
export function languageFor(geo, languageByGeo) {
  const key = String(geo ?? '').trim().toLowerCase();
  if (key !== '') {
    for (const [geoName, locale] of Object.entries(languageByGeo)) {
      if (geoName.trim().toLowerCase() === key) return { locale, known: true };
    }
  }
  return { locale: DEFAULT_LOCALE, known: false };
}
