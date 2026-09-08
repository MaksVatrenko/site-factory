import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, readOutput } from './helpers/build.mjs';

const SITE_DIR = join('data', 'sites', '899ok');
const PAGE_SLUGS = ['/', '/casino', '/slots', '/games', '/betting', '/bonus', '/app', '/login'];

function outputPathFor(slug) {
  return slug === '/' ? 'index.html' : join(slug.slice(1), 'index.html');
}

// Mirrors the exact command the spec asks a human to run to check this template by hand:
//   SITE_DIR=data/sites/899ok TEMPLATE=review SCHEME=night OUT_DIR=output/899ok
//   SITE_URL=https://899ok-bd.net npm run build:site
describe('review template: the real client site (data/sites/899ok)', () => {
  let outDir;

  beforeAll(() => {
    outDir = buildSite({
      outDir: join('output', 'test-review-899ok'),
      env: { SITE_DIR, TEMPLATE: 'review', SCHEME: 'night' },
    }).outDir;
  });

  it('builds all eight pages', () => {
    for (const slug of PAGE_SLUGS) {
      expect(existsSync(join(outDir, outputPathFor(slug))), `expected ${slug} to exist`).toBe(
        true,
      );
    }
  });

  it('renders the header and footer, built from site.nav / site.footer, on every page', () => {
    for (const slug of PAGE_SLUGS) {
      const html = readOutput(outDir, outputPathFor(slug));
      expect(html, `${slug}: missing header`).toContain('class="site-header"');
      expect(html, `${slug}: missing footer`).toContain('class="site-footer"');
      // Nav labels reach the header; footer.copyright and the brand name reach the footer.
      expect(html, `${slug}: header nav missing a site.nav label`).toContain('>Casino<');
      expect(html, `${slug}: footer missing copyright`).toContain(
        '© 899OK. All rights reserved 2026.',
      );
    }
  });

  it('renders a table (columns + rows) for a section that carries one', () => {
    const html = readOutput(outDir);
    expect(html).toContain('<table');
    expect(html).toContain('<thead');
    expect(html).toContain('<tbody');
    // A header cell and a body cell from the actual welcome-bonus table in home.json.
    expect(html).toContain('Amount');
    expect(html).toContain('First deposit match');
    // The spec requires the table to sit in its own horizontally scrollable wrapper rather than
    // stretching the page.
    expect(html).toMatch(/class="rsection__table-wrap"[^>]*>\s*<table/);
  });

  it('renders FAQ items as native <details>/<summary> disclosure widgets', () => {
    const html = readOutput(outDir);
    expect(html).toMatch(/<details\b/);
    expect(html).toContain('<summary');
    expect(html).toContain('Is 899OK legit in Bangladesh?');
  });

  it('ships no client-side JavaScript on any page', () => {
    for (const slug of PAGE_SLUGS) {
      const html = readOutput(outDir, outputPathFor(slug));
      expect(html, `${slug} shipped a <script> tag`).not.toMatch(/<script\b/i);
    }
  });

  it('inlines every stylesheet instead of linking one', () => {
    const html = readOutput(outDir);
    expect(html).not.toMatch(/<link\b[^>]*\srel=["']?stylesheet["']?/i);
  });
});

describe('review template: resilience to unusual content shapes', () => {
  // `blocks` uses the nested `{ type, props }` shape for readability here; this writes it out as
  // a real SITE_DIR folder — a site.json plus one home page file — flattening each block's props
  // alongside its "type" the way a real page file on disk does (see src/lib/site-dir.mjs).
  function buildSingleBlockPage(blocks, { nav } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-review-'));
    writeFileSync(
      join(dir, 'site.json'),
      JSON.stringify({
        domain: 'example.com',
        brand: { name: 'Review Fixture' },
        ...(nav ? { nav } : {}),
      }),
    );
    writeFileSync(
      join(dir, 'home.json'),
      JSON.stringify({
        slug: '/',
        title: 'Fixture',
        blocks: blocks.map(({ type, props }) => ({ type, ...props })),
      }),
    );
    return dir;
  }

  it('still builds a section stripped down to just a heading', () => {
    const dir = buildSingleBlockPage([
      { type: 'section', props: { heading: 'Just a heading, nothing else' } },
    ]);
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-review-heading-only'),
        env: { SITE_DIR: dir, TEMPLATE: 'review', SCHEME: 'night' },
      });
      const html = readOutput(outDir);
      expect(html).toContain('Just a heading, nothing else');
      expect(html).not.toMatch(/<script\b/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still builds when the five block types arrive in a scrambled order', () => {
    // Deliberately not hero-first, toc-second: the "natural" order every real 899ok page
    // happens to use. Each component only ever sees its own props (see BlockRenderer.astro), so
    // nothing here depends on what came before or after it in the list.
    const dir = buildSingleBlockPage(
      [
        { type: 'faq', props: { heading: 'FAQ first', items: [{ q: 'Q?', a: 'A.' }] } },
        { type: 'links', props: { heading: 'Links second' } },
        {
          type: 'section',
          props: { heading: 'Section third', paragraphs: ['Body text for section third.'] },
        },
        { type: 'toc', props: { heading: 'TOC fourth', items: ['Section third'] } },
        { type: 'hero', props: { heading: 'Hero last', paragraphs: ['Lead text.'] } },
      ],
      { nav: [{ label: 'Casino', href: '/casino' }, { label: 'Slots', href: '/slots' }] },
    );
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-review-scrambled'),
        env: { SITE_DIR: dir, TEMPLATE: 'review', SCHEME: 'night' },
      });
      const html = readOutput(outDir);
      expect(html).not.toMatch(/<script\b/i);

      // Every block rendered its own content...
      expect(html).toContain('FAQ first');
      expect(html).toContain('Links second');
      expect(html).toContain('Section third');
      expect(html).toContain('TOC fourth');
      expect(html).toContain('Hero last');

      // ...in the order the content gave them, not reshuffled by the engine or the template.
      const positions = ['FAQ first', 'Links second', 'Section third', 'TOC fourth', 'Hero last']
        .map((needle) => html.indexOf(needle));
      for (let i = 1; i < positions.length; i += 1) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      }

      // Contents entries are paired with the sections that follow them by position, not by
      // wording (see src/lib/anchors.mjs). Here the toc sits fourth, so its single entry points at
      // the one heading-bearing block after it. Whatever the pairing picks, the link must resolve:
      // an anchor pointing at nothing is the failure this whole mechanism exists to prevent.
      const href = html.match(/class="toc__link" href="#([^"]+)"/);
      expect(href).not.toBeNull();
      expect(html).toContain(`id="${href[1]}"`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
