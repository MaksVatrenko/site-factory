import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, readOutput } from './helpers/build.mjs';

const SITE_DIR = join('data', 'sites', '899ok');
const PAGE_SLUGS = ['/', '/casino', '/slots', '/games', '/betting', '/bonus', '/app', '/login'];

function outputPathFor(slug) {
  return slug === '/' ? 'index.html' : join(slug.slice(1), 'index.html');
}

// Mirrors the exact command the spec asks a human to run to check this template by hand:
//   SITE_DIR=data/sites/899ok TEMPLATE=template1 SCHEME=dark OUT_DIR=output/899ok
//   SITE_URL=https://899ok-bd.net npm run build:site
describe('тема template1: the real client site (data/sites/899ok)', () => {
  let outDir;

  beforeAll(() => {
    outDir = buildSite({
      outDir: join('output', 'test-template1-899ok'),
      env: { SITE_DIR, TEMPLATE: 'template1', SCHEME: 'dark' },
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
  const dir = mkdtempSync(join(tmpdir(), 'site-factory-template1-'));
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
      title: 'Fixture',
      blocks: blocks.map(({ type, props }) => ({ type, ...props })),
    }),
  );
  return dir;
}

describe('тема template1: resilience to unusual content shapes', () => {
  it('still builds a section stripped down to just a heading', () => {
    const dir = buildSingleBlockPage([
      {
        type: 'section',
        props: { content: [{ type: 'title', h2: 'Just a heading, nothing else' }] },
      },
    ]);
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-template1-heading-only'),
        env: { SITE_DIR: dir, TEMPLATE: 'template1', SCHEME: 'dark' },
      });
      const html = readOutput(outDir);
      expect(html).toContain('Just a heading, nothing else');
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
        {
          type: 'faq',
          props: {
            content: [
              { type: 'title', h2: 'FAQ first' },
              { type: 'toggle', title: 'Q?', text: 'A.' },
            ],
          },
        },
        { type: 'links', props: { content: [{ type: 'title', h2: 'Links second' }] } },
        {
          type: 'section',
          props: {
            content: [
              { type: 'title', h2: 'Section third' },
              { type: 'text', text: 'Body text for section third.' },
            ],
          },
        },
        {
          type: 'toc',
          props: {
            content: [
              { type: 'title', h2: 'TOC fourth' },
              { type: 'list', items: ['Section third'] },
            ],
          },
        },
        {
          type: 'hero',
          props: {
            content: [
              { type: 'title', h1: 'Hero last' },
              { type: 'text', text: 'Lead text.' },
            ],
          },
        },
      ],
      { nav: [{ label: 'Casino', href: '/casino' }, { label: 'Slots', href: '/slots' }] },
    );
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-template1-scrambled'),
        env: { SITE_DIR: dir, TEMPLATE: 'template1', SCHEME: 'dark' },
      });
      const html = readOutput(outDir);

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

describe('тема template1: a section renders its content array in exactly the given order', () => {
  it('allows a paragraph after a table, two headings in a row, and a chosen heading level', () => {
    // This is the headline capability the content/element refactor exists for: the old fixed
    // field order (heading, paragraphs, list, table, subsections) could never produce this shape
    // at all. See templates/template1/blocks/section.astro and src/components/ElementRenderer.astro.
    const dir = buildSingleBlockPage([
      {
        type: 'section',
        props: {
          content: [
            { type: 'title', h2: 'First Heading' },
            { type: 'text', text: 'Paragraph before the table.' },
            { type: 'table', columns: ['A', 'B'], rows: [['1', '2']] },
            { type: 'text', text: 'Paragraph after the table.' },
            { type: 'title', h2: 'Second Heading Right After' },
            { type: 'title', h4: 'A Chosen Heading Level' },
            { type: 'list', items: ['Item one', 'Item two'] },
          ],
        },
      },
    ]);
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-template1-content-order'),
        env: { SITE_DIR: dir, TEMPLATE: 'template1', SCHEME: 'dark' },
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

  it('keeps one h1 per page: the first stays, a later one becomes h2', () => {
    const dir = buildSingleBlockPage([
      { type: 'hero', props: { content: [{ type: 'title', h1: 'The Page Title' }] } },
      { type: 'section', props: { content: [{ type: 'title', h1: 'Not A Second H1' }] } },
    ]);
    try {
      const { outDir, log } = buildSite({
        outDir: join('output', 'test-template1-title-h1-guard'),
        env: { SITE_DIR: dir, TEMPLATE: 'template1', SCHEME: 'dark' },
      });
      const html = readOutput(outDir);
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html).toMatch(/<h1[^>]*>The Page Title<\/h1>/);
      expect(html).toMatch(/<h2[^>]*>Not A Second H1<\/h2>/);
      expect(log).toContain('второй h1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders a toggle as a native disclosure in an ordinary section', () => {
    const dir = buildSingleBlockPage([
      {
        type: 'section',
        props: {
          content: [
            { type: 'title', h2: 'Not an FAQ' },
            { type: 'toggle', title: 'Can a toggle live here?', text: 'Yes, [anywhere](/casino).' },
          ],
        },
      },
    ]);
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-template1-toggle'),
        env: { SITE_DIR: dir, TEMPLATE: 'template1', SCHEME: 'dark' },
      });
      const html = readOutput(outDir);
      expect(html).toMatch(/<details[^>]*class="rtoggle"/);
      expect(html).toMatch(/<summary[^>]*>Can a toggle live here\?<\/summary>/);
      expect(html).toMatch(/<a[^>]*href="\/casino"[^>]*>anywhere<\/a>/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shows a block type it has no shell for as an ordinary section', () => {
    const dir = buildSingleBlockPage([
      {
        type: 'promo',
        props: {
          content: [
            { type: 'title', h2: 'Promo Heading' },
            { type: 'text', text: 'Promo body.' },
          ],
        },
      },
    ]);
    try {
      const { outDir, log } = buildSite({
        outDir: join('output', 'test-template1-unknown-block'),
        env: { SITE_DIR: dir, TEMPLATE: 'template1', SCHEME: 'dark' },
      });
      const html = readOutput(outDir);
      expect(html).toContain('Promo Heading');
      expect(html).toContain('Promo body.');
      expect(log).toContain('«promo» — выведен как обычная секция');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('тема template1: links inside body text, and card sets', () => {
  it('renders [label](/href) as a real link and leaves the rest of the sentence alone', () => {
    const dir = buildSingleBlockPage([
      {
        type: 'section',
        props: {
          content: [
            { type: 'title', h2: 'Linked Section' },
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
        outDir: join('output', 'test-template1-links'),
        env: { SITE_DIR: dir, TEMPLATE: 'template1', SCHEME: 'dark' },
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
            { type: 'title', h2: 'Unsafe' },
            { type: 'text', text: 'Tap [here](javascript:alert) to win.' },
          ],
        },
      },
    ]);
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-template1-unsafe-link'),
        env: { SITE_DIR: dir, TEMPLATE: 'template1', SCHEME: 'dark' },
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
            { type: 'title', h2: 'Two Ways In' },
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
        outDir: join('output', 'test-template1-cards'),
        env: { SITE_DIR: dir, TEMPLATE: 'template1', SCHEME: 'dark' },
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
      outDir: join('output', 'test-template1-toc-heading'),
      env: { SITE_DIR, TEMPLATE: 'template1', SCHEME: 'dark' },
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

describe('тема template1: pictures from images.json', () => {
  // A single-page site with three real picture files in its public folder and a registry naming
  // them — the shape a real site folder has once it carries pictures.
  function buildWithPictures(blocks, outName) {
    const dir = buildSingleBlockPage(blocks);
    const publicDir = join(dir, 'public');
    mkdirSync(join(publicDir, 'images'), { recursive: true });
    for (const name of ['hero.webp', 'section.webp', 'card.webp']) {
      writeFileSync(join(publicDir, 'images', name), 'not really a picture');
    }
    writeFileSync(
      join(dir, 'images.json'),
      JSON.stringify({
        hero: { src: '/images/hero.webp', alt: 'Hero picture', width: 1200, height: 600 },
        section: { src: '/images/section.webp', alt: 'Section picture' },
        card: { src: '/images/card.webp', alt: 'Card picture' },
      }),
    );
    try {
      return buildSite({
        outDir: join('output', outName),
        env: { SITE_DIR: dir, PUBLIC_DIR: publicDir, TEMPLATE: 'template1', SCHEME: 'dark' },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('loads a picture in a section lazily, and one in the hero at once', () => {
    const { outDir } = buildWithPictures(
      [
        { type: 'hero', props: { content: [{ type: 'title', h1: 'Pictures' }, { image: 'hero' }] } },
        { type: 'section', props: { content: [{ type: 'title', h2: 'Below' }, { image: 'section' }] } },
      ],
      'test-template1-pictures',
    );
    const html = readOutput(outDir);
    const hero = html.match(/<img[^>]*src="\/images\/hero\.webp"[^>]*>/)?.[0] ?? '';
    const section = html.match(/<img[^>]*src="\/images\/section\.webp"[^>]*>/)?.[0] ?? '';
    expect(hero).toContain('alt="Hero picture"');
    expect(hero).toContain('loading="eager"');
    expect(hero).toContain('fetchpriority="high"');
    expect(hero).toContain('width="1200"');
    expect(section).toContain('alt="Section picture"');
    expect(section).toContain('loading="lazy"');
    expect(section).not.toContain('fetchpriority');
    expect(existsSync(join(outDir, 'images', 'hero.webp'))).toBe(true);
  });

  it('renders the picture of a card', () => {
    const { outDir } = buildWithPictures(
      [
        {
          type: 'section',
          props: {
            content: [
              { type: 'title', h1: 'Cards' },
              { type: 'cards', items: [{ title: 'With picture', text: 'A', image: 'card' }] },
            ],
          },
        },
      ],
      'test-template1-card-picture',
    );
    expect(readOutput(outDir)).toMatch(/<img[^>]*src="\/images\/card\.webp"[^>]*alt="Card picture"/);
  });

  it('leaves out a picture it cannot find, and says so in the log', () => {
    const { outDir, log } = buildWithPictures(
      [{ type: 'section', props: { content: [{ type: 'title', h1: 'Gap' }, { image: 'nowhere' }] } }],
      'test-template1-missing-picture',
    );
    expect(readOutput(outDir)).not.toMatch(/<img\b/);
    expect(log).toContain('картинки «nowhere» нет в images.json');
  });
});

describe('тема template1: the block cut in half', () => {
  let html;

  // Its own fixture rather than buildSingleBlockPage's: this block is half picture, and a picture
  // only survives normalisation when images.json declares it and the file is where it says.
  function pageWithPictures(blocks) {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-split-'));
    mkdirSync(join(dir, 'public', 'images'), { recursive: true });
    const names = ['one', 'two'];
    for (const name of names) writeFileSync(join(dir, 'public', 'images', `${name}.webp`), '');
    writeFileSync(
      join(dir, 'images.json'),
      JSON.stringify(
        Object.fromEntries(
          names.map((name) => [name, { src: `/images/${name}.webp`, alt: name, width: 800, height: 450 }]),
        ),
      ),
    );
    writeFileSync(join(dir, 'site.json'), JSON.stringify({ domain: 'example.com', brand: { name: 'Split Fixture' } }));
    writeFileSync(
      join(dir, 'home.json'),
      JSON.stringify({ title: 'Fixture', blocks: blocks.map(({ type, props }) => ({ type, ...props })) }),
    );
    return dir;
  }

  function buildWith(blocks, outName) {
    const dir = pageWithPictures(blocks);
    try {
      const { outDir } = buildSite({
        outDir: join('output', outName),
        env: { SITE_DIR: dir, PUBLIC_DIR: join(dir, 'public'), TEMPLATE: 'template1', SCHEME: 'dark' },
      });
      return readOutput(outDir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  beforeAll(() => {
    html = buildWith([
      {
        type: 'split',
        props: {
          content: [
            { type: 'title', h2: 'Words on the left' },
            { image: 'one' },
            { type: 'text', text: 'A paragraph beside the picture.' },
          ],
        },
      },
      {
        type: 'split-left',
        props: {
          content: [
            { type: 'title', h2: 'Words on the right' },
            { image: 'two' },
            { type: 'text', text: 'Another paragraph.' },
          ],
        },
      },
    ], 'test-template1-split');
  });

  // The picture is not an element among the words — it is the other half of the block. Left in
  // place it would render inside the column of prose, which is the ordinary section's behaviour and
  // the one thing this block exists not to do.
  it('takes the picture out of the words and gives it its own half', () => {
    const block = html.match(/<section class="rsplit section"[\s\S]*?<\/section>/)[0];
    const wordsAt = block.indexOf('rsplit__words');
    const imageAt = block.indexOf('rsplit__image');
    expect(wordsAt).toBeGreaterThan(-1);
    expect(imageAt).toBeGreaterThan(wordsAt);
    // Up to the picture's own tag, not to its class: the class name sits inside the <img, so
    // slicing there would leave the tag's opening in the words half and fail on its own boundary.
    const words = block.slice(wordsAt, block.indexOf('<img'));
    expect(words).not.toContain('<img');
    expect(words).toContain('A paragraph beside the picture.');
  });

  // Mirrored by moving the halves, not by reordering the markup: the words come first in the
  // document either way, so a screen reader and a search engine read the block the same however it
  // is drawn. Swapping the markup instead would make the mirrored one read picture-first.
  it('mirrors the halves with a class, leaving the reading order alone', () => {
    const blocks = [...html.matchAll(/<section class="rsplit section"[\s\S]*?<\/section>/g)]
      .map((match) => match[0]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).not.toContain('rsplit__inner--flipped');
    expect(blocks[1]).toContain('rsplit__inner--flipped');
    // Words before picture in both, in the document itself.
    for (const block of blocks) {
      expect(block.indexOf('rsplit__words')).toBeLessThan(block.indexOf('rsplit__image'));
    }
    // And the flip is a matter of CSS order, which only applies once there are two columns to
    // swap — on a phone both halves stack, words first, and a rule that reordered them there
    // would put a picture above the heading it belongs to.
    expect(html).toMatch(/--flipped[^{]*\{\s*order:\s*2/);
  });

  it('draws a half with no picture in it at all rather than an empty column', () => {
    const alone = buildWith(
      [{ type: 'split', props: { content: [{ type: 'text', text: 'Words alone.' }] } }],
      'test-template1-split-nopic',
    );
    expect(alone).toContain('Words alone.');
    expect(alone.match(/<section class="rsplit section"[\s\S]*?<\/section>/)[0]).not.toContain('<img');
  });
});
