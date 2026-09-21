import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ASTRO_BIN = join('node_modules', '.bin', 'astro');

export function buildSite({
  site = '899ok',
  template = 'template1',
  scheme = 'dark',
  outDir,
  siteDir,
  env = {},
} = {}) {
  const target = outDir || join('output', `test-${site}-${template}-${scheme}`);
  rmSync(target, { recursive: true, force: true });

  const SITE_DIR = siteDir || join('data', 'sites', site);
  const sitePublic = join(SITE_DIR, 'public');
  const result = spawnSync(ASTRO_BIN, ['build'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SITE_DIR,
      PUBLIC_DIR: existsSync(sitePublic) ? sitePublic : '',
      TEMPLATE: template,
      SCHEME: scheme,
      OUT_DIR: target,
      SITE_URL: 'https://example.com',
      ...env,
    },
  });

  if (result.error) {
    throw new Error(`Failed to start Astro build: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`Astro build exited with status ${result.status}\n${result.stdout}\n${result.stderr}`);
  }

  return { outDir: target, log: result.stdout + result.stderr };
}

export function readOutput(outDir, file = 'index.html') {
  return readFileSync(join(outDir, file), 'utf8');
}

// A page's address is its file name now (see slugFromFileName in src/lib/site-dir.mjs), so a
// fixture page is written to `<slug>.json`, with "/" going to home.json. A slug that cannot be one
// file name — a nested "/a/b", a missing slug, two slugs a case-insensitive filesystem would store
// as the same file — throws instead of being written somewhere else: a test whose scenario the
// folder format can no longer express must fail loudly, not keep passing while it checks something
// different. Those scenarios live on as unit tests of normalizeSite, which still takes a raw slug.
//
// Pages come back from a folder home first, then by file name — not in this array's order.
export function pageFileNameFor(slug) {
  if (slug === '/') return 'home.json';
  const name = typeof slug === 'string' ? slug.slice(1) : '';
  if (!String(slug).startsWith('/') || name === '' || name.includes('/')) {
    throw new Error(`writeSiteDirFromContent: slug ${JSON.stringify(slug)} cannot be a page file name`);
  }
  return `${name}.json`;
}

export function writeSiteDirFromContent(dir, content) {
  const { pages, ...settings } = content;
  writeFileSync(join(dir, 'site.json'), JSON.stringify(settings));
  const written = new Set();
  for (const page of pages) {
    const fileName = pageFileNameFor(page.slug);
    const key = fileName.toLowerCase();
    if (written.has(key)) {
      throw new Error(`writeSiteDirFromContent: two pages would share the file ${fileName}`);
    }
    written.add(key);
    const { meta, blocks } = page;
    writeFileSync(
      join(dir, fileName),
      JSON.stringify({
        title: meta?.title,
        description: meta?.description,
        blocks: Array.isArray(blocks)
          ? blocks.map((block) =>
              block && typeof block === 'object' && !Array.isArray(block)
                ? { type: block.type, ...(block.props ?? {}) }
                : block,
            )
          : blocks,
      }),
    );
  }
}
