import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ASTRO_BIN = join('node_modules', '.bin', 'astro');

export function buildSite({
  site = '899ok',
  template = 'review',
  scheme = 'dark',
  outDir,
  env = {},
} = {}) {
  const target = outDir || join('output', `test-${site}-${template}-${scheme}`);
  rmSync(target, { recursive: true, force: true });

  const sitePublic = join('data', 'sites', site, 'public');
  const result = spawnSync(ASTRO_BIN, ['build'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SITE_DIR: join('data', 'sites', site),
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

// Materializes a content object shaped like the old single-file format — `{ ...settings, pages: [
// { slug, meta: { title, description }, blocks: [{ type, props }] } ] }`, the nested shape
// normalizeSite itself accepts (see src/lib/normalize.mjs and tests/normalize.test.mjs) — as a
// SITE_DIR folder: `settings` becomes site.json, and each page becomes its own file in the flat
// shape a real site folder uses (slug/title/description/blocks, with each block's own fields
// spread alongside its "type" instead of nested under "props" — see the adapter in
// src/lib/site-dir.mjs). This lets a test written against the nested shape carry its fixture data
// over mechanically instead of every field being retyped by hand; the filename a page lands under
// carries no meaning for a real build (home is found by its own slug, not by filename — see
// loadSiteDirInput) — EXCEPT for a fixture that deliberately relies on processing order to pin
// which of two colliding slugs wins (see resolveSlugsByProof's two-phase claim order in
// normalize.mjs): loadSiteDirInput reads pages back in alphabetical-by-filename order, so the
// index is zero-padded here to keep that order identical to `pages`' own array order — plain
// `page-${index}.json` would sort "page-10" before "page-2", silently reordering any fixture
// past nine pages and changing which page of a colliding pair wins its claim.
export function writeSiteDirFromContent(dir, content) {
  const { pages, ...settings } = content;
  writeFileSync(join(dir, 'site.json'), JSON.stringify(settings));
  const width = String(pages.length).length;
  pages.forEach((page, index) => {
    const { slug, meta, blocks } = page;
    writeFileSync(
      join(dir, `page-${String(index).padStart(width, '0')}.json`),
      JSON.stringify({
        slug,
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
  });
}
