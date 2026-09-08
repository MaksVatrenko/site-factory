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
  function buildSingleBlockPage(blocks, { nav } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-review-'));
    const file = join(dir, 'site.json');
    writeFileSync(
      file,
      JSON.stringify({
        domain: 'example.com',
        brand: { name: 'Review Fixture' },
        ...(nav ? { nav } : {}),
        pages: [{ slug: '/', meta: { title: 'Fixture' }, blocks }],
      }),
    );
    return { dir, file };
  }

  it('still builds a section stripped down to just a heading', () => {
    const { dir, file } = buildSingleBlockPage([
      { type: 'section', props: { heading: 'Just a heading, nothing else' } },
    ]);
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-review-heading-only'),
        env: { SITE_JSON: file, TEMPLATE: 'review', SCHEME: 'night' },
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
    const { dir, file } = buildSingleBlockPage(
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
        env: { SITE_JSON: file, TEMPLATE: 'review', SCHEME: 'night' },
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

      // The toc item's text matches the section's heading exactly in this fixture, so the
      // generated anchor pair should actually resolve to each other.
      expect(html).toContain('href="#section-third"');
      expect(html).toContain('id="section-third"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
