import { isReservedOutputName } from './reserved-output-names.mjs';

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
//      can cut a surrogate pair in half and leave the lone half behind. A second, independent cap
//      then trims by MAX_SLUG_SEGMENT_BYTES *UTF-8 bytes* — macOS is comfortable with a
//      100-character segment, but a single CJK or emoji character can take up to 4 UTF-8 bytes,
//      so a 100-character segment can be 400 bytes, well past the 255-byte-per-component limit
//      ext4 and most Linux filesystems enforce. Both caps drop whole characters from the end,
//      never slicing one apart, for the same reason as the code-point cap above.
//   3. The path as a whole — not just each segment — is capped at MAX_SLUG_PATH_LENGTH
//      *characters* (the same code-point unit as the segment cap, not UTF-16 code units — the
//      two must agree, or an astral-heavy path gets truncated more aggressively than an
//      ASCII path of the same visible length), because a chain of individually-legal segments
//      can still add up to a path long enough for mkdir to reject with ENAMETOOLONG. Segments
//      are dropped whole, never sliced mid-segment, once the budget runs out.
//   4. A segment matching any name in RESERVED_ROOT_OUTPUT_NAMES (case-insensitively) is refused
//      in ANY position, not only the last: Astro always writes each of those names as a plain
//      FILE at the output root — the home page's own `index.html`, plus every root-level
//      endpoint route such as `sitemap.xml`/`robots.txt` — so a segment with that name collides
//      with it (ENOTDIR, or the same thing via a case-insensitive filesystem such as macOS's
//      default APFS) regardless of where in the slug it appears.
//
// A slug that has nothing left after these rules, or that still contains a reserved name
// anywhere, cannot be rewritten safely and is refused outright; resolvePageSlugs (below) picks a
// page-N fallback for it that cannot collide with any other page in the file.
const MAX_SLUG_SEGMENT_LENGTH = 100; // mirrors safeName's cap in factory/server.mjs
const MAX_SLUG_SEGMENT_BYTES = 255; // the per-path-component byte limit ext4 and most Linux
// filesystems enforce; see point 2 above.
const MAX_SLUG_PATH_LENGTH = 200; // a generous multiple of the segment cap — comfortably under
// every OS's real path-length limit even once the output dir and domain are prepended, since
// each individual segment is separately held to MAX_SLUG_SEGMENT_BYTES regardless of how many
// code points it took to get there.
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
// can. Shared by both the segment cap and the path cap below so the two always count the same
// unit (finding m2 — a regression two rounds ago was exactly the two disagreeing).
function toCharacters(value) {
  return Array.from(value);
}

function sanitizeSlugSegment(segment) {
  const cleaned = toCharacters(segment.replace(UNSAFE_SEGMENT_CHARS, '')).filter(
    (char) => !isLoneSurrogate(char),
  );
  const characters = cleaned.slice(0, MAX_SLUG_SEGMENT_LENGTH);

  // A filesystem byte cap can't just `.slice()` the joined string — that counts UTF-16 units and
  // can split a multi-byte character in half. Instead, whole characters are dropped from the end
  // one at a time until the UTF-8 encoding fits, which can never produce a partial character.
  while (characters.length > 0 && byteLength(characters) > MAX_SLUG_SEGMENT_BYTES) {
    characters.pop();
  }

  return characters.join('');
}

function byteLength(characters) {
  return Buffer.byteLength(characters.join(''), 'utf8');
}

// Keeps whole segments — never slices inside one, since each was already capped individually —
// while their combined length stays within budget, and drops the rest. A slug that loses its
// tail this way still resolves to a real, distinct directory; it just cannot demand unlimited
// nesting.
function limitPathLength(segments) {
  const kept = [];
  let length = 0;
  for (const segment of segments) {
    // Counts code points via the same `toCharacters` the segment cap uses above — not
    // `segment.length`, which counts UTF-16 code units and would overcount any segment holding
    // an astral character relative to how that segment's own cap measured it (finding m2).
    const segmentLength = toCharacters(segment).length;
    const nextLength = length + segmentLength + (kept.length > 0 ? 1 : 0);
    if (nextLength > MAX_SLUG_PATH_LENGTH) break;
    kept.push(segment);
    length = nextLength;
  }
  return kept;
}

// Pure: decides whether one page's raw slug value resolves to a usable slug and, if so, what it
// is. Returns `slug: null` when nothing safe can be built from it — the field was empty or
// missing on a page other than the first, there is nothing left after sanitizing, or a reserved
// name survives somewhere in the path — leaving resolvePageSlugs (which sees every page, not
// just this one) to pick a fallback that cannot collide with anything else in the file.
// `missing: true` marks the "nothing was actually provided" case specifically, so
// resolvePageSlugs can skip the "invalid slug" warning for it: a page with no slug at all is not
// a content error the way unusable slug text is.
function buildSlugCandidate(value, index) {
  const provided = toText(value, '');

  // Nothing was provided at all (the field was absent, or blank/whitespace-only, which toText
  // above already collapsed to ''). The first page keeps its natural home-page address; every
  // other page needs its own "page-N" placeholder — built here from the page's own index purely
  // as a *label*, not yet as a claimed slug: it still has to go through the exact same
  // reservation as any other fallback below (finding M2), so it can never silently steal a slug
  // some other page in the file genuinely asked for.
  if (provided === '') {
    if (index === 0) return { slug: '/', raw: provided };
    return { slug: null, raw: provided, missing: true };
  }

  // A slug that is explicitly "/" keeps its natural home-page address. This check runs on the
  // ORIGINAL text, before any decoding or percent-stripping below, so a slug that merely reduces
  // to "/" or "" *after* a lossy sanitizing step (e.g. "%", which decodeSlug strips down to "")
  // can never be mistaken for a genuine spelling of the root (finding M1) — garbage like "///" or
  // "%" is not a spelling of the root, so it must not silently collide with the real home page.
  if (provided === '/') {
    return { slug: '/', raw: provided };
  }

  const decoded = decodeSlug(provided);

  const segments = limitPathLength(
    decoded
      .split('/')
      .map(sanitizeSlugSegment)
      .filter((segment) => segment !== '' && segment !== '.' && segment !== '..'),
  );

  if (segments.length === 0 || segments.some(isReservedOutputName)) {
    return { slug: null, raw: provided };
  }

  return { slug: `/${segments.join('/')}`, raw: provided };
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
    // A page whose slug was simply never provided is not reporting a content error — only a
    // slug that was provided but turned out unusable gets the "invalid slug" warning.
    if (!candidate.missing) {
      warnings.push(`Слаг «${candidate.raw}» недопустим — использован «${fallback}»`);
    }
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
  // Keyed by lower-cased slug: a case-insensitive filesystem (macOS's default APFS) collapses
  // "/about", "/About" and "/ABOUT" into the exact same directory regardless of what
  // normalizeSite thinks they are, so duplicate detection has to agree with the filesystem
  // (finding M3). Each surviving page still keeps its own slug's original casing below — only
  // the comparison is case-folded, not the stored value.
  const seenSlugs = new Set();
  const normalizedPages = [];

  pages.forEach((page, index) => {
    const slug = slugs[index];
    const dedupeKey = slug.toLowerCase();
    if (seenSlugs.has(dedupeKey)) {
      warnings.push(`${slug}: дубликат слага — страница пропущена`);
      return;
    }
    seenSlugs.add(dedupeKey);

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
