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

// Astro resolves the params returned from getStaticPaths itself before writing any files, so a
// slug segment that still contains a traversal token, a backslash, a raw control character or
// an over-long name reaches that resolution step and either fails to match any declared static
// path (NoMatchingStaticPathFound) or blows up the eventual `mkdir` (ENAMETOOLONG, ENOTDIR).
// Every segment is sanitized independently and unusable segments are dropped outright, instead
// of treating the slug as one opaque string the way the old slash-collapsing logic did.
const MAX_SLUG_SEGMENT_LENGTH = 100; // mirrors safeName's cap in factory/server.mjs
// eslint-disable-next-line no-control-regex -- deliberately matching raw control bytes
const UNSAFE_SEGMENT_CHARS = /[\x00-\x1f\x7f\\]/g;

function sanitizeSlugSegment(segment) {
  return segment.replace(UNSAFE_SEGMENT_CHARS, '').slice(0, MAX_SLUG_SEGMENT_LENGTH);
}

function normalizeSlug(value, index, warnings) {
  const raw = toText(value, index === 0 ? '/' : `page-${index}`);
  const decoded = decodeSlug(raw);

  const segments = decoded
    .split('/')
    .map(sanitizeSlugSegment)
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..');

  // Astro's directory build format writes every page as "<slug>/index.html", so a slug whose
  // final segment is itself "index.html" would need that exact path to be a directory — which
  // collides with the plain index.html file Astro writes for the page one level up. There is no
  // safe rewrite that preserves intent, so the slug is refused outright.
  const collidesWithBuildOutput =
    segments.length > 0 && segments.at(-1).toLowerCase() === 'index.html';

  if (collidesWithBuildOutput) {
    const fallback = `/page-${index}`;
    warnings.push(`Слаг «${raw}» недопустим — использован «${fallback}»`);
    return fallback;
  }

  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
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

  const seenSlugs = new Set();
  const normalizedPages = [];

  pages.forEach((page, index) => {
    const slug = normalizeSlug(page.slug, index, warnings);
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
