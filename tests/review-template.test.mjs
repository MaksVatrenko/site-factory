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
//   SITE_DIR=data/sites/899ok TEMPLATE=review SCHEME=dark OUT_DIR=output/899ok
//   SITE_URL=https://899ok-bd.net npm run build:site
describe('review template: the real client site (data/sites/899ok)', () => {
  let outDir;

  beforeAll(() => {
    outDir = buildSite({
      outDir: join('output', 'test-review-899ok'),
      env: { SITE_DIR, TEMPLATE: 'review', SCHEME: 'dark' },
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

// `blocks` uses the nested `{ type, props }` shape for readability here; this writes it out as a
// real SITE_DIR folder — a site.json plus one home page file — flattening each block's props
// alongside its "type" the way a real page file on disk does (see src/lib/site-dir.mjs). Shared
// by every describe block below that needs a single-purpose fixture site.
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

describe('review template: resilience to unusual content shapes', () => {
  it('still builds a section stripped down to just a heading', () => {
    const dir = buildSingleBlockPage([
      {
        type: 'section',
        props: { content: [{ type: 'title', tag: 'h2', text: 'Just a heading, nothing else' }] },
      },
    ]);
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-review-heading-only'),
        env: { SITE_DIR: dir, TEMPLATE: 'review', SCHEME: 'dark' },
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
          props: {
            content: [
              { type: 'title', tag: 'h2', text: 'Section third' },
              { type: 'text', text: 'Body text for section third.' },
            ],
          },
        },
        { type: 'toc', props: { heading: 'TOC fourth', items: ['Section third'] } },
        { type: 'hero', props: { heading: 'Hero last', paragraphs: ['Lead text.'] } },
      ],
      { nav: [{ label: 'Casino', href: '/casino' }, { label: 'Slots', href: '/slots' }] },
    );
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-review-scrambled'),
        env: { SITE_DIR: dir, TEMPLATE: 'review', SCHEME: 'dark' },
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

describe('review template: a section renders its content array in exactly the given order', () => {
  it('allows a paragraph after a table, two headings in a row, and a chosen heading level', () => {
    // This is the headline capability the content/element refactor exists for: the old fixed
    // field order (heading, paragraphs, list, table, subsections) could never produce this shape
    // at all. See templates/review/blocks/section.astro and src/components/ElementRenderer.astro.
    const dir = buildSingleBlockPage([
      {
        type: 'section',
        props: {
          content: [
            { type: 'title', tag: 'h2', text: 'First Heading' },
            { type: 'text', text: 'Paragraph before the table.' },
            { type: 'table', columns: ['A', 'B'], rows: [['1', '2']] },
            { type: 'text', text: 'Paragraph after the table.' },
            { type: 'title', tag: 'h2', text: 'Second Heading Right After' },
            { type: 'title', tag: 'h4', text: 'A Chosen Heading Level' },
            { type: 'list', items: ['Item one', 'Item two'] },
          ],
        },
      },
    ]);
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-review-content-order'),
        env: { SITE_DIR: dir, TEMPLATE: 'review', SCHEME: 'dark' },
      });
      const html = readOutput(outDir);

      // The tag each title asked for is the tag it got -- including h4, and including a second
      // h2 with nothing but another element between it and the first.
      expect(html).toMatch(/<h2[^>]*>First Heading<\/h2>/);
      expect(html).toMatch(/<h2[^>]*>Second Heading Right After<\/h2>/);
      expect(html).toMatch(/<h4[^>]*>A Chosen Heading Level<\/h4>/);

      const order = [
        'First Heading',
        'Paragraph before the table.',
        '<table',
        'Paragraph after the table.',
        'Second Heading Right After',
        'A Chosen Heading Level',
        'Item one',
      ].map((needle) => html.indexOf(needle));
      for (let i = 1; i < order.length; i += 1) {
        expect(order[i]).toBeGreaterThan(order[i - 1]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to h2 for a tag outside h2-h6, and never emits a second h1', () => {
    const dir = buildSingleBlockPage([
      { type: 'section', props: { content: [{ type: 'title', tag: 'h1', text: 'Not A Real H1' }] } },
    ]);
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-review-title-h1-guard'),
        env: { SITE_DIR: dir, TEMPLATE: 'review', SCHEME: 'dark' },
      });
      const html = readOutput(outDir);
      expect(html).toMatch(/<h2[^>]*>Not A Real H1<\/h2>/);
      expect(html).not.toMatch(/<h1[^>]*>Not A Real H1<\/h1>/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('review template: links inside body text, and card sets', () => {
  it('renders [label](/href) as a real link and leaves the rest of the sentence alone', () => {
    const dir = buildSingleBlockPage([
      {
        type: 'section',
        props: {
          content: [
            { type: 'title', tag: 'h2', text: 'Linked Section' },
            { type: 'text', text: 'Open the [full lobby](/casino) tonight.' },
            { type: 'list', items: ['Try the [Andar Bahar table](/casino)'] },
            {
              type: 'table',
              columns: ['What'],
              rows: [['Spins on [Gates of Olympus](/slots)']],
            },
          ],
        },
      },
    ]);
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-review-links'),
        env: { SITE_DIR: dir, TEMPLATE: 'review', SCHEME: 'dark' },
      });
      const html = readOutput(outDir);

      // A link in each of the three places a sentence can appear.
      expect(html).toMatch(/<a[^>]*href="\/casino"[^>]*>full lobby<\/a>/);
      expect(html).toMatch(/<a[^>]*href="\/casino"[^>]*>Andar Bahar table<\/a>/);
      expect(html).toMatch(/<a[^>]*href="\/slots"[^>]*>Gates of Olympus<\/a>/);

      // The words either side of the link are still there, and the markup itself is gone.
      expect(html).toContain('Open the ');
      expect(html).toContain(' tonight.');
      expect(html).not.toContain('](/casino)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to build a link out of an href that would run something', () => {
    const dir = buildSingleBlockPage([
      {
        type: 'section',
        props: {
          content: [
            { type: 'title', tag: 'h2', text: 'Unsafe' },
            { type: 'text', text: 'Tap [here](javascript:alert) to win.' },
          ],
        },
      },
    ]);
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-review-unsafe-link'),
        env: { SITE_DIR: dir, TEMPLATE: 'review', SCHEME: 'dark' },
      });
      const html = readOutput(outDir);
      expect(html).not.toContain('javascript:');
      // The sentence survives in full -- only the link does not.
      expect(html).toContain('Tap ');
      expect(html).toContain('here');
      expect(html).toContain(' to win.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders a cards element as framed items, each keeping its heading tag', () => {
    const dir = buildSingleBlockPage([
      {
        type: 'section',
        props: {
          content: [
            { type: 'title', tag: 'h2', text: 'Two Ways In' },
            {
              type: 'cards',
              items: [
                { title: 'BPL Markets', text: 'Thirty-five a match.' },
                { title: 'Live Floor', text: ['Teen Patti.', 'Andar Bahar.'] },
              ],
            },
          ],
        },
      },
    ]);
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-review-cards'),
        env: { SITE_DIR: dir, TEMPLATE: 'review', SCHEME: 'dark' },
      });
      const html = readOutput(outDir);
      expect(html).toContain('class="rcards"');
      expect(html).toMatch(/<h3[^>]*>BPL Markets<\/h3>/);
      expect(html).toMatch(/<h3[^>]*>Live Floor<\/h3>/);
      // A card given several sentences keeps them as separate paragraphs.
      expect(html).toContain('Teen Patti.');
      expect(html).toContain('Andar Bahar.');
      expect(html).not.toContain('Teen Patti.,');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('puts the contents heading outside the contents card, level with every other heading', () => {
    const { outDir } = buildSite({
      outDir: join('output', 'test-review-toc-heading'),
      env: { SITE_DIR, TEMPLATE: 'review', SCHEME: 'dark' },
    });
    const html = readOutput(outDir);
    const card = html.match(/<nav class="toc__card"[\s\S]*?<\/nav>/);
    expect(card).not.toBeNull();
    // The heading is on the page, but not inside the card: it sits in the section above it, on the
    // same left edge as every other section heading.
    expect(html).toMatch(/<h2[^>]*class="rheading"[^>]*>What&#39;s on This Page<\/h2>/);
    expect(card[0]).not.toContain('<h2');
  });
});
