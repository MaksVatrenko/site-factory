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

function normalizeSlug(value, index) {
  const raw = toText(value, index === 0 ? '/' : `page-${index}`);
  const trimmed = raw.replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed === '' ? '/' : `/${trimmed}`;
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
    const slug = normalizeSlug(page.slug, index);
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
