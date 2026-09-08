import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, readOutput } from './helpers/build.mjs';

function makeSiteDir() {
  return mkdtempSync(join(tmpdir(), 'site-factory-site-dir-'));
}

function writeJson(dir, name, data) {
  writeFileSync(join(dir, name), JSON.stringify(data));
}

function outputPathFor(slug) {
  return slug === '/' ? 'index.html' : join(slug.slice(1), 'index.html');
}

// SITE_DIR builds a site from a folder of pages instead of one content file. These tests cover
// the real client fixture (data/sites/899ok), the SITE_JSON path staying untouched, the two
// folder-shaped edge cases (no site.json, no pages at all), a malformed shared setting, and —
// the point of the whole design — a page whose blocks are reordered or partially stripped by
// hand still building.
describe('loadContext with SITE_DIR: a real client folder (data/sites/899ok)', () => {
  const SITE_DIR = join('data', 'sites', '899ok');
  let outDir;

  beforeAll(() => {
    outDir = buildSite({
      outDir: join('output', 'test-site-dir-899ok'),
      env: { SITE_DIR },
    }).outDir;
  });

  it('builds all eight pages at their own slugs', () => {
    const slugs = ['/', '/casino', '/slots', '/games', '/betting', '/bonus', '/app', '/login'];
    for (const slug of slugs) {
      expect(existsSync(join(outDir, outputPathFor(slug))), `expected ${slug} to exist`).toBe(true);
    }
  });

  it('lands the home page at the site root with its own title', () => {
    const html = readOutput(outDir);
    // Astro HTML-escapes text nodes, so "&" in the source title becomes "&amp;" here.
    expect(html).toContain('<title>899OK | Bangladesh Casino &amp; Cricket Betting Site</title>');
  });

  it('orders the sitemap with the home page first, then the rest alphabetically by filename', () => {
    // Filenames sorted alphabetically are app, betting, bonus, casino, games, home, login, slots —
    // home.json must jump to the front despite not sorting first, and everyone else keeps their
    // alphabetical order.
    const sitemap = readOutput(outDir, 'sitemap.xml');
    const order = ['/', '/app', '/betting', '/bonus', '/casino', '/games', '/login', '/slots'];
    const positions = order.map((slug) => {
      const loc = `https://example.com${slug === '/' ? '/' : slug}`;
      const index = sitemap.indexOf(`<loc>${loc}</loc>`);
      expect(index, `expected ${loc} in sitemap.xml`).toBeGreaterThan(-1);
      return index;
    });
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });
});

describe('SITE_JSON keeps working unchanged when SITE_DIR is not set', () => {
  it('still builds the default single-file example', () => {
    const { outDir } = buildSite({ outDir: join('output', 'test-site-dir-regression-site-json') });
    expect(readOutput(outDir)).toContain('Find what actually works');
  });
});

describe('a folder with no site.json is still a usable site', () => {
  it('builds with default shared settings', () => {
    const dir = makeSiteDir();
    try {
      writeJson(dir, 'home.json', {
        slug: '/',
        title: 'Only Page, No Settings',
        description: 'A folder with no site.json at all.',
        blocks: [{ type: 'hero', heading: 'Hello' }],
      });
      const { outDir } = buildSite({
        outDir: join('output', 'test-site-dir-no-settings'),
        env: { SITE_DIR: dir },
      });
      expect(existsSync(join(outDir, 'index.html'))).toBe(true);
      expect(readOutput(outDir)).toContain('Only Page, No Settings');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a folder with no pages at all is an error, like unreadable content', () => {
  it('fails the build clearly instead of inventing an empty site', () => {
    const dir = makeSiteDir();
    try {
      writeJson(dir, 'site.json', { domain: 'example.com', brand: { name: 'NoPages' } });
      expect(() =>
        buildSite({ outDir: join('output', 'test-site-dir-no-pages'), env: { SITE_DIR: dir } }),
      ).toThrow(/no pages/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a malformed nav in site.json does not throw', () => {
  it('builds successfully and warns instead of crashing', () => {
    const dir = makeSiteDir();
    try {
      writeJson(dir, 'site.json', { brand: { name: 'MalformedNav' }, nav: 'not a list' });
      writeJson(dir, 'home.json', { slug: '/', title: 'Home', description: 'd', blocks: [] });
      const { outDir, log } = buildSite({
        outDir: join('output', 'test-site-dir-bad-nav'),
        env: { SITE_DIR: dir },
      });
      expect(existsSync(join(outDir, 'index.html'))).toBe(true);
      expect(log).toContain('«nav»');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a page whose blocks are reordered or partially stripped still builds', () => {
  it('renders what a supported block can show and drops the rest, in whatever order they arrive', () => {
    const dir = makeSiteDir();
    try {
      writeJson(dir, 'site.json', { brand: { name: 'Reorder' } });
      writeJson(dir, 'home.json', {
        slug: '/',
        title: 'Home',
        description: 'd',
        blocks: [{ type: 'hero', heading: 'Home hero' }],
      });
      writeJson(dir, 'mixed.json', {
        slug: '/mixed',
        title: 'Mixed',
        description: 'd',
        // Deliberately out of the "natural" hero-first order, and missing fields a client
        // rearranging this by hand would plausibly leave out.
        blocks: [
          {
            type: 'faq',
            heading: 'Frequently Asked',
            items: [
              { q: 'Does this survive reordering?', a: 'Yes.' },
              { q: 'What about a stripped answer?' },
            ],
          },
          { type: 'toc', heading: 'On this page', items: ['Intro', 'Details'] },
          { type: 'section', heading: 'A stripped section with nothing else' },
          { type: 'hero', heading: 'Reordered hero' },
        ],
      });
      const { outDir, log } = buildSite({
        outDir: join('output', 'test-site-dir-reordered-blocks'),
        env: { SITE_DIR: dir },
      });
      expect(existsSync(join(outDir, 'mixed', 'index.html'))).toBe(true);
      const html = readOutput(outDir, join('mixed', 'index.html'));
      expect(html).toContain('Frequently Asked');
      expect(html).toContain('Does this survive reordering?');
      // "section" and "toc" are not blocks any current template declares — they are dropped
      // exactly like any other unsupported block type, not a crash.
      expect(html).not.toContain('A stripped section with nothing else');
      expect(log).toContain('toc');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
