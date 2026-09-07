import { readFileSync } from 'node:fs';
import { normalizeSite } from './normalize.mjs';
import { loadTemplate, missingBlockFiles } from './templates.mjs';
import { readScheme } from './schemes.mjs';

let cache = null;

export function resetContextCache() {
  cache = null;
}

export function loadContext(root = process.cwd()) {
  if (cache) return cache;

  const file = process.env.SITE_JSON;
  if (!file) {
    throw new Error('SITE_JSON is not set: point it at a content file');
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read content from ${file}: ${error.message}`);
  }

  const template = loadTemplate(process.env.TEMPLATE || '', root);
  const missing = missingBlockFiles(template, root);
  if (missing.length > 0) {
    throw new Error(
      `Template "${template.id}" declares blocks with no file: ${missing.join(', ')}`,
    );
  }

  const { site, warnings } = normalizeSite(raw, {
    supportedBlocks: template.blocks,
    overrides: {
      brand: process.env.BRAND || '',
      locale: process.env.LOCALE || '',
      geo: process.env.GEO || '',
      domain: process.env.DOMAIN || '',
      partnerUrl: process.env.PARTNER_URL || '',
    },
  });

  const scheme = readScheme(process.env.SCHEME || site.style || template.defaultScheme, root);

  for (const warning of warnings) console.warn(`[factory] ${warning}`);
  if (scheme.fellBack) {
    console.warn(`[factory] Схема не найдена, взята «${scheme.id}»`);
  }

  cache = { site, template, scheme };
  return cache;
}
