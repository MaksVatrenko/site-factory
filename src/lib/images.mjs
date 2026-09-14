// The image registry. images.json maps a name to one picture's data, and content only ever refers
// to a picture by that name: { "image": "main" }. Keeping the data in one place is what lets a
// future generator fill pictures in by writing this one file, and lets the same picture appear on
// ten pages without its alt text being copied ten times.
//
// This module turns a name into a picture a template can render, or into the reason it cannot. It
// never throws and never touches the disk itself: whether a file exists is a question it asks
// through the `fileExists` function it is given, so the normalizer stays a pure function and its
// unit tests need no real files.

const EXTERNAL = /^https?:\/\//i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// width/height only help when they are real pixel counts; anything else is dropped rather than
// shipped as a broken attribute. A numeric string is accepted because a hand-edited JSON file
// will have "800" in it sooner or later.
function toDimension(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : undefined;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const number = Number(value.trim());
    return number > 0 ? number : undefined;
  }
  return undefined;
}

// A src is a web address, used as it stands; a path inside the site, which must exist in the
// public folder; or anything else, which is refused. "Anything else" is mostly data: and
// javascript: — this file is written by a third party — and "//host/…", which looks like a path but
// is someone else's site. A path is always rooted at "/", and may not climb out with "..".
function classifySrc(value) {
  const src = typeof value === 'string' ? value.trim() : '';
  if (src === '') return { kind: 'missing' };
  if (EXTERNAL.test(src)) return { kind: 'external', src };
  if (src.startsWith('//') || ANY_SCHEME.test(src)) return { kind: 'refused', src };
  const path = src.startsWith('/') ? src : `/${src}`;
  if (path.includes('\\') || path.split('/').includes('..')) return { kind: 'refused', src };
  return { kind: 'local', src: path };
}

export function createImageResolver(raw, { fileExists } = {}) {
  const exists = typeof fileExists === 'function' ? fileExists : () => true;
  const warnings = [];
  const entries = new Map();

  // No images.json at all is not a mistake — most sites have no pictures yet. Only a file that is
  // there but shaped wrong is reported.
  if (raw !== undefined) {
    if (!isPlainObject(raw)) {
      warnings.push('images.json должен быть объектом «имя → картинка» — картинки не выводятся');
    } else {
      for (const [name, entry] of Object.entries(raw)) {
        if (isPlainObject(entry)) entries.set(name, entry);
        else warnings.push(`images.json: запись «${name}» не объект — пропущена`);
      }
    }
  }

  function resolve(name) {
    const fail = (problem) => ({ image: null, problem, missingAlt: false });
    if (typeof name !== 'string' || name === '') return fail('у картинки не указано имя');

    const entry = entries.get(name);
    if (!entry) return fail(`картинки «${name}» нет в images.json`);

    const src = classifySrc(entry.src);
    if (src.kind === 'missing') return fail(`у картинки «${name}» в images.json нет src`);
    if (src.kind === 'refused') return fail(`у картинки «${name}» недопустимый src «${src.src}»`);
    if (src.kind === 'local' && !exists(src.src)) {
      return fail(`файл картинки «${name}» не найден: public${src.src}`);
    }

    // A picture with no alt text still renders — losing it would be worse than shipping it
    // undescribed — but the caller is told, because for search it is a real loss.
    const alt = typeof entry.alt === 'string' ? entry.alt.trim() : '';
    const image = { src: src.src, alt };
    const width = toDimension(entry.width);
    const height = toDimension(entry.height);
    if (width !== undefined) image.width = width;
    if (height !== undefined) image.height = height;
    return { image, problem: null, missingAlt: alt === '' };
  }

  return { resolve, warnings };
}
