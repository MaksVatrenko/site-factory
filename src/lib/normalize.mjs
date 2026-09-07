const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur']);
const DEFAULT_BRAND = 'Site';
const DEFAULT_DOMAIN = 'example.com';
const DEFAULT_LOCALE = 'en-US';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function toText(value, fallback = '') {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function stripPercent(value) {
  return value.replace(/%/g, '');
}

function decodeSlug(value) {
  try {
    const decoded = decodeURIComponent(value);
    return /%[0-9a-fA-F]{2}/.test(decoded) ? stripPercent(value) : decoded;
  } catch {
    return stripPercent(value);
  }
}

// --- Slug -> filesystem-path invariant -------------------------------------------------------
//
// Astro resolves the params returned from getStaticPaths itself before writing any files, and
// its "directory" build format turns every page into "<slug>/index.html" on disk. A normalized
// slug therefore has to double as BOTH a route param AND a chain of real directory names, no
// matter what the content author typed — so rather than special-case whichever hostile shapes a
// review happened to find, every segment and the path as a whole are put through the same small
// set of construction rules, so the result is valid by construction instead of by enumeration:
//
//   1. Unsafe bytes (raw control characters, backslash) and unpaired UTF-16 surrogates are
//      removed from every segment. An unpaired surrogate has no valid UTF-8/URI encoding at
//      all — Astro's own `encodeURI` call while writing routes throws "URI malformed" on one —
//      so it is dropped like any other unusable character rather than carried through.
//   2. Each segment is capped at MAX_SLUG_SEGMENT_LENGTH *characters* (Unicode code points, not
//      UTF-16 code units), so a multi-unit astral character is never split. Splitting one is
//      exactly how the previous fix's `.slice(0, 100)` created a fresh "URI malformed" crash: it
//      can cut a surrogate pair in half and leave the lone half behind.
//   3. The path as a whole — not just each segment — is capped at MAX_SLUG_PATH_LENGTH
//      characters, because a chain of individually-legal segments can still add up to a path
//      long enough for mkdir to reject with ENAMETOOLONG. Segments are dropped whole, never
//      sliced mid-segment, once the budget runs out.
//   4. "index.html" is refused as a segment in ANY position, not only the last: Astro's home
//      page always writes a plain `index.html` FILE at the output root, so a first segment named
//      "index.html" collides with it (ENOTDIR) exactly the way a last segment collides with a
//      sibling page's own file — there is no position where the name is safe.
//
// A slug that has nothing left after these rules, or that still contains "index.html" anywhere,
// cannot be rewritten safely and is refused outright; resolvePageSlugs (below) picks a page-N
// fallback for it that cannot collide with any other page in the file.
const MAX_SLUG_SEGMENT_LENGTH = 100; // mirrors safeName's cap in factory/server.mjs
const MAX_SLUG_PATH_LENGTH = 200; // a generous multiple of the segment cap, comfortably under
// every OS's real path-length limit even once the output dir and domain are prepended
// eslint-disable-next-line no-control-regex -- deliberately matching raw control bytes
const UNSAFE_SEGMENT_CHARS = /[\x00-\x1f\x7f\\]/g;

// `Array.from`/the spread operator iterate a string by Unicode code point: a valid surrogate
// pair becomes one element, and a surrogate that could not be paired is left as its own
// one-unit element — the only situation in which an element's own code point lands in the
// surrogate range. That makes this filterable the same way as any other unusable character.
function isLoneSurrogate(char) {
  const code = char.codePointAt(0);
  return code >= 0xd800 && code <= 0xdfff;
}

// Splits into Unicode characters (code points) rather than UTF-16 code units, so a length cap
// applied against the result can never land inside a surrogate pair the way `str.slice(0, n)`
// can.
function toCharacters(value) {
  return Array.from(value);
}

function sanitizeSlugSegment(segment) {
  const characters = toCharacters(segment.replace(UNSAFE_SEGMENT_CHARS, '')).filter(
    (char) => !isLoneSurrogate(char),
  );
  return characters.slice(0, MAX_SLUG_SEGMENT_LENGTH).join('');
}

// Keeps whole segments — never slices inside one, since each was already capped individually —
// while their combined length stays within budget, and drops the rest. A slug that loses its
// tail this way still resolves to a real, distinct directory; it just cannot demand unlimited
// nesting.
function limitPathLength(segments) {
  const kept = [];
  let length = 0;
  for (const segment of segments) {
    const nextLength = length + segment.length + (kept.length > 0 ? 1 : 0);
    if (nextLength > MAX_SLUG_PATH_LENGTH) break;
    kept.push(segment);
    length = nextLength;
  }
  return kept;
}

function isReservedSegment(segment) {
  return segment.toLowerCase() === 'index.html';
}

// Pure: decides whether one page's raw slug value resolves to a usable slug and, if so, what it
// is. Returns `slug: null` when nothing safe can be built from it — either there is nothing left
// after sanitizing, or an "index.html" segment survives somewhere in the path — leaving
// resolvePageSlugs (which sees every page, not just this one) to pick a fallback that cannot
// collide with anything else in the file.
function buildSlugCandidate(value, index) {
  const raw = toText(value, index === 0 ? '/' : `page-${index}`);
  const decoded = decodeSlug(raw);

  // A slug that genuinely IS the root — explicitly "/", or empty/missing content, which toText
  // above already turned into "/" — keeps its natural home-page address. This is deliberately
  // narrower than "resolves to nothing after sanitizing" below: garbage like "///" is not a
  // spelling of the root, so it must not silently collide with the real home page.
  if (decoded === '/' || decoded === '') {
    return { slug: '/', raw };
  }

  const segments = limitPathLength(
    decoded
      .split('/')
      .map(sanitizeSlugSegment)
      .filter((segment) => segment !== '' && segment !== '.' && segment !== '..'),
  );

  if (segments.length === 0 || segments.some(isReservedSegment)) {
    return { slug: null, raw };
  }

  return { slug: `/${segments.join('/')}`, raw };
}

// A fallback slug must not collide with any real slug in the file — not just the ones already
// assigned by the time this page is reached, but ones later pages are still going to produce —
// nor with a fallback already handed to an earlier page. `reserved` carries all of the above.
function pickFallbackSlug(index, reserved) {
  let n = index;
  let candidate = `/page-${n}`;
  while (reserved.has(candidate)) {
    n += 1;
    candidate = `/page-${n}`;
  }
  return candidate;
}

// Resolves every page's slug in one pass so fallback numbering can see the whole file: every
// real (non-fallback) slug across ALL pages is reserved up front, so an invalid slug's page-N
// fallback can never collide with a page that has not been reached yet, nor with another page's
// own fallback. Without this, a naive `page-${index}` could reuse a string some other page in
// the file already uses as its real, content-given slug — which used to silently drop that
// page's content as a "duplicate" of the real one instead of reporting the actual problem: an
// invalid slug. Genuine repeats among these resolved slugs are still left for the caller's
// existing duplicate check, which runs afterward with full knowledge of the final values.
function resolvePageSlugs(pages, warnings) {
  const candidates = pages.map((page, index) => buildSlugCandidate(page.slug, index));
  const reserved = new Set(
    candidates.filter((candidate) => candidate.slug !== null).map((candidate) => candidate.slug),
  );

  return candidates.map((candidate, index) => {
    if (candidate.slug !== null) return candidate.slug;
    const fallback = pickFallbackSlug(index, reserved);
    reserved.add(fallback);
    warnings.push(`Слаг «${candidate.raw}» недопустим — использован «${fallback}»`);
    return fallback;
  });
}

function pickOverride(override, fromFile, fallback) {
  return toText(override, toText(fromFile, fallback));
}

export function normalizeSite(raw, options = {}) {
  const warnings = [];
  const overrides = options.overrides || {};
  const supported = Array.isArray(options.supportedBlocks)
    ? new Set(options.supportedBlocks)
    : null;

  let input = raw;
  if (!isPlainObject(input)) {
    warnings.push('Корень файла контента не объект — взяты значения по умолчанию');
    input = {};
  }

  const brandInput = isPlainObject(input.brand) ? input.brand : {};
  const brand = {
    name: pickOverride(overrides.brand, brandInput.name, DEFAULT_BRAND),
    logo: toText(brandInput.logo, ''),
  };

  const locale = pickOverride(overrides.locale, input.locale, DEFAULT_LOCALE);
  const lang = locale.split(/[-_]/)[0].toLowerCase();

  const site = {
    domain: pickOverride(overrides.domain, input.domain, DEFAULT_DOMAIN),
    locale,
    lang,
    dir: RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr',
    geo: pickOverride(overrides.geo, input.geo, ''),
    partnerUrl: pickOverride(overrides.partnerUrl, input.partnerUrl, ''),
    style: pickOverride(overrides.style, input.style, ''),
    brand,
    pages: [],
  };

  let pages = toArray(input.pages).filter(isPlainObject);
  if (pages.length === 0) {
    warnings.push('В контенте нет страниц — создана пустая главная страница');
    pages = [{}];
  }

  const slugs = resolvePageSlugs(pages, warnings);
  const seenSlugs = new Set();
  const normalizedPages = [];

  pages.forEach((page, index) => {
    const slug = slugs[index];
    if (seenSlugs.has(slug)) {
      warnings.push(`${slug}: дубликат слага — страница пропущена`);
      return;
    }
    seenSlugs.add(slug);

    const meta = isPlainObject(page.meta) ? page.meta : {};
    const blocks = [];

    for (const candidate of toArray(page.blocks)) {
      if (!isPlainObject(candidate)) {
        warnings.push(`${slug}: пропущен блок — это не объект`);
        continue;
      }
      const type = toText(candidate.type, '');
      if (type === '') {
        warnings.push(`${slug}: пропущен блок без поля type`);
        continue;
      }
      if (supported && !supported.has(type)) {
        warnings.push(`${slug}: шаблон не поддерживает блок «${type}» — пропущен`);
        continue;
      }
      blocks.push({
        type,
        props: isPlainObject(candidate.props) ? candidate.props : {},
      });
    }

    const canRenderFooter = !supported || supported.has('footer');
    if (canRenderFooter && !blocks.some((block) => block.type === 'footer')) {
      blocks.push({ type: 'footer', props: {} });
    }

    normalizedPages.push({
      slug,
      meta: {
        title: toText(meta.title, brand.name),
        description: toText(meta.description, ''),
      },
      blocks,
    });
  });

  site.pages = normalizedPages;

  return { site, warnings };
}
