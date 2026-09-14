import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, readOutput } from './helpers/build.mjs';
import {
  SERVICE_FILE_NAMES,
  isPageFileName,
  loadSiteDirInput,
  slugFromFileName,
} from '../src/lib/site-dir.mjs';

function makeSiteDir() {
  return mkdtempSync(join(tmpdir(), 'site-factory-site-dir-'));
}

function writeJson(dir, name, data) {
  writeFileSync(join(dir, name), JSON.stringify(data));
}

function outputPathFor(slug) {
  return slug === '/' ? 'index.html' : join(slug.slice(1), 'index.html');
}

// A folder of files, written from a { fileName: content } map. A string is written verbatim (for
// the "not valid JSON" case); anything else is written as JSON.
function writeFolder(files) {
  const dir = makeSiteDir();
  for (const [name, data] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof data === 'string' ? data : JSON.stringify(data));
  }
  return dir;
}

describe('a page address comes from its file name', () => {
  it('maps a file name to a route', () => {
    expect(slugFromFileName('casino.json')).toBe('/casino');
    expect(slugFromFileName('live-dealer.json')).toBe('/live-dealer');
  });

  it('treats home.json as the site root, in any case', () => {
    expect(slugFromFileName('home.json')).toBe('/');
    expect(slugFromFileName('Home.json')).toBe('/');
    expect(slugFromFileName('HOME.json')).toBe('/');
  });

  it('does not treat a name that merely contains "home" as the root', () => {
    expect(slugFromFileName('homepage.json')).toBe('/homepage');
    expect(slugFromFileName('my-home.json')).toBe('/my-home');
  });

  it('leaves the rest of the name alone — cleaning it is the slug rules\' job', () => {
    expect(slugFromFileName('Live Dealer.json')).toBe('/Live Dealer');
  });
});

describe('service files are not pages', () => {
  it('names exactly the two service files', () => {
    expect(SERVICE_FILE_NAMES).toEqual(['site.json', 'images.json']);
  });

  it('tells a page file from a service file or a non-JSON file', () => {
    expect(isPageFileName('casino.json')).toBe(true);
    expect(isPageFileName('site.json')).toBe(false);
    expect(isPageFileName('images.json')).toBe(false);
    expect(isPageFileName('notes.txt')).toBe(false);
  });
});

describe('loadSiteDirInput', () => {
  it('gives each page the address of its file, home first, the rest by file name', () => {
    const dir = writeFolder({
      'site.json': { brand: { name: 'Folder' } },
      'casino.json': { title: 'Casino' },
      'about.json': { title: 'About' },
      'home.json': { title: 'Home' },
    });
    try {
      const { input, warnings } = loadSiteDirInput(dir);
      expect(input.pages.map((page) => [page.slug, page.meta.title])).toEqual([
        ['/', 'Home'],
        ['/about', 'About'],
        ['/casino', 'Casino'],
      ]);
      expect(input.brand).toEqual({ name: 'Folder' });
      expect(warnings).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads images.json as the image registry, not as a page', () => {
    const registry = { main: { src: '/images/main.webp', alt: 'Main' } };
    const dir = writeFolder({ 'home.json': { title: 'Home' }, 'images.json': registry });
    try {
      const { input, images } = loadSiteDirInput(dir);
      expect(input.pages).toHaveLength(1);
      expect(images).toEqual(registry);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns no registry when the folder has no images.json', () => {
    const dir = writeFolder({ 'home.json': { title: 'Home' } });
    try {
      expect(loadSiteDirInput(dir).images).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores a slug field left in a page file, and says which file and which address won', () => {
    // A forgotten "slug": "/promo" in bonus.json would otherwise silently give /bonus, and the
    // reader would go looking for where /promo went.
    const dir = writeFolder({
      'home.json': { title: 'Home' },
      'bonus.json': { slug: '/promo', title: 'Bonus' },
    });
    try {
      const { input, warnings } = loadSiteDirInput(dir);
      expect(input.pages.map((page) => page.slug)).toEqual(['/', '/bonus']);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('bonus.json');
      expect(warnings[0]).toContain('/bonus');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns when the folder has no home.json', () => {
    const dir = writeFolder({ 'casino.json': { title: 'Casino' } });
    try {
      const { input, warnings } = loadSiteDirInput(dir);
      expect(input.pages.map((page) => page.slug)).toEqual(['/casino']);
      expect(warnings.join(' ')).toContain('home.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not read pages from subfolders, public/ included', () => {
    const dir = writeFolder({ 'home.json': { title: 'Home' } });
    try {
      mkdirSync(join(dir, 'bn'));
      writeFileSync(join(dir, 'bn', 'casino.json'), JSON.stringify({ title: 'Nested' }));
      mkdirSync(join(dir, 'public'));
      writeFileSync(join(dir, 'public', 'data.json'), '{}');
      expect(loadSiteDirInput(dir).input.pages.map((page) => page.slug)).toEqual(['/']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes a page file that is not an object through for the normalizer to drop', () => {
    const dir = writeFolder({ 'home.json': { title: 'Home' }, 'odd.json': '"just a string"' });
    try {
      expect(loadSiteDirInput(dir).input.pages[1]).toBe('just a string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails on an images.json that is not JSON, naming the file', () => {
    const dir = writeFolder({ 'home.json': { title: 'Home' }, 'images.json': '{ nope' });
    try {
      expect(() => loadSiteDirInput(dir)).toThrow(/images\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still fails on a folder with no pages, even one holding both service files', () => {
    const dir = writeFolder({ 'site.json': {}, 'images.json': {} });
    try {
      expect(() => loadSiteDirInput(dir)).toThrow(/no pages/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// SITE_DIR builds a site from a folder of pages. These tests cover the real client fixture
// (data/sites/899ok), SITE_DIR being required at all, the two folder-shaped edge cases (no
// site.json, no pages at all), a malformed shared setting, and — the point of the whole design —
// a page whose blocks are reordered or partially stripped by hand still building.
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

describe('a real build fails clearly when SITE_DIR is not set', () => {
  it('reports the missing variable instead of falling back to anything', () => {
    expect(() =>
      buildSite({
        outDir: join('output', 'test-site-dir-unset'),
        env: { SITE_DIR: undefined },
      }),
    ).toThrow(/SITE_DIR не задан/);
  });
});

describe('a folder with no site.json is still a usable site', () => {
  it('builds with default shared settings', () => {
    const dir = makeSiteDir();
    try {
      writeJson(dir, 'home.json', {
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
      writeJson(dir, 'home.json', { title: 'Home', description: 'd', blocks: [] });
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
        title: 'Home',
        description: 'd',
        blocks: [{ type: 'hero', heading: 'Home hero' }],
      });
      writeJson(dir, 'mixed.json', {
        title: 'Mixed',
        description: 'd',
        // Deliberately out of the "natural" hero-first order, missing fields a client rearranging
        // this by hand would plausibly leave out, and one block type ("cards") the review template
        // does not declare at all.
        blocks: [
          {
            type: 'faq',
            heading: 'Frequently Asked',
            items: [
              { q: 'Does this survive reordering?', a: 'Yes.' },
              { q: 'What about a stripped answer?' },
            ],
          },
          { type: 'cards', heading: 'Not a block review declares', items: [] },
          {
            type: 'section',
            content: [{ type: 'title', tag: 'h2', text: 'A stripped section with nothing else' }],
          },
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
      // A block reduced to just a heading still renders — a stripped block is not a crash.
      expect(html).toContain('A stripped section with nothing else');
      // "cards" is not a block the review template declares — dropped exactly like any other
      // unsupported block type, wherever it sits in the list, not a crash.
      expect(html).not.toContain('Not a block review declares');
      expect(log).toContain('cards');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
