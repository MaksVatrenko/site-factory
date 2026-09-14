import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, readOutput, writeSiteDirFromContent } from './helpers/build.mjs';

describe('engine build', () => {
  let outDir;

  beforeAll(() => {
    outDir = buildSite({ scheme: 'dark' }).outDir;
  });

  it('writes a home page', () => {
    expect(existsSync(join(outDir, 'index.html'))).toBe(true);
  });

  it('writes every page from the content folder', () => {
    expect(existsSync(join(outDir, 'casino', 'index.html'))).toBe(true);
  });

  it('renders the hero content', () => {
    expect(readOutput(outDir)).toContain('Everyday Casino');
  });

  it('inlines the colour scheme', () => {
    const html = readOutput(outDir);
    expect(html).toContain('--c-primary');
    // The value the scheme file itself assigns, read from disk rather than written out here: the
    // name --c-primary also appears in styles/base.css as `var(--c-primary)`, so only the literal
    // colour proves the scheme was inlined and not merely referenced.
    const primary = readFileSync(join('styles', 'schemes', 'dark.css'), 'utf8').match(
      /--c-primary:\s*([^;]+);/,
    )[1];
    expect(html).toContain(primary);
  });

  it('sets language and direction', () => {
    expect(readOutput(outDir)).toContain('lang="en"');
    expect(readOutput(outDir)).toContain('dir="ltr"');
  });

  it('ships no JavaScript bundles', () => {
    const html = readOutput(outDir);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<link\b[^>]*\srel=["']?modulepreload["']?/i);
  });

  it('inlines all stylesheets', () => {
    const html = readOutput(outDir);
    expect(html).not.toMatch(/<link\b[^>]*\srel=["']?stylesheet["']?/i);
    expect(html).not.toContain('/_astro/');
  });

  it('renders every block type the template declares', () => {
    const html = readOutput(outDir);
    expect(html).toContain('Everyday Casino'); // hero
    expect(html).toContain("What's on This Page"); // toc
    expect(html).toContain('Why 899OK Actually Works for Me'); // section
    expect(html).toContain('899OK — More Pages'); // links
    expect(html).toContain('899OK FAQ — Payments, Safety, Signup'); // faq
  });

  it('fails the build when SITE_DIR does not point at a real folder', () => {
    const missing = join('data', 'sites', '899ok', 'does-not-exist');
    expect(() =>
      buildSite({ outDir: join('output', 'test-missing-site-dir'), env: { SITE_DIR: missing } }),
    ).toThrow(missing);
  });

  it('fails the build when a page file is not valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-render-'));
    const file = join(dir, 'home.json');
    writeFileSync(file, '{ not valid json');
    try {
      expect(() =>
        buildSite({ outDir: join('output', 'test-invalid-json'), env: { SITE_DIR: dir } }),
      ).toThrow(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// data/sites/broken is a site folder broken in every way the content format allows. It must still
// build; everything that could be shown is shown, and everything that could not is named in the log.
describe('a content folder broken in every way the format allows', () => {
  let html;
  let log;

  beforeAll(() => {
    const built = buildSite({ site: 'broken', outDir: join('output', 'test-broken') });
    html = readOutput(built.outDir, join('sloppy', 'index.html'));
    log = built.log;
  });

  it('still builds the page, down to the last entry', () => {
    expect(html).toContain('Text still renders after every broken entry above it');
    expect(html).toContain('only a question');
  });

  it('shows an unknown block type as an ordinary section', () => {
    expect(html).toContain('An unknown block type still shows its content');
    expect(log).toContain('«carousel» — выведен как обычная секция');
  });

  it('names an element type the template does not declare instead of throwing', () => {
    expect(log).toContain('quote');
  });

  it('reports a slug left in the file, which no longer decides anything', () => {
    expect(log).toContain('поле slug больше не используется');
  });

  it('reports what a block written the old way leaves behind', () => {
    expect(html).not.toContain('Old-style heading nobody reads');
    expect(log).toContain('поля heading, paragraphs не используются');
  });

  it('drops a title with no heading key, and takes the first of several', () => {
    expect(html).not.toContain('Old-style title with no heading key');
    expect(log).toContain('нет ключа h1–h6');
    expect(html).toMatch(/<h2[^>]*>First heading key wins<\/h2>/);
    expect(html).not.toContain('Second key ignored');
  });

  it('keeps one h1 on the page', () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>The one real h1<\/h1>/);
    expect(html).toMatch(/<h2[^>]*>A second h1 becomes h2<\/h2>/);
    expect(log).toContain('второй h1');
  });

  it('leaves no orphaned markup behind', () => {
    expect(html).not.toContain('[object Object]');
    expect(html).not.toMatch(/<ul[^>]*>\s*<\/ul>/);
    expect(html).not.toMatch(/<table[^>]*>\s*<\/table>/);
    expect(html).not.toMatch(/<p>\s*<\/p>/);
    // A `list` whose `items` is a single string is coerced into a one-item list, not dropped.
    expect(html).toContain('Coerced into a single list item');
  });

  it('shows a picture it can find and names every one it cannot', () => {
    expect(html).toMatch(/<img[^>]*src="https:\/\/example\.com\/picture\.webp"/);
    expect(log).toContain('у картинки «no-alt» нет alt');
    expect(log).toContain('картинки «not-in-registry» нет в images.json');
    expect(log).toContain('файл картинки «missing-file» не найден');
    expect(log).toContain('у картинки «no-src» в images.json нет src');
    expect(log).toContain('у картинки «script» недопустимый src');
    expect(log).toContain('поле image должно быть именем картинки');
    expect(log).toContain('images.json: запись «not-an-object» не объект');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('/images/missing.webp');
  });
});

describe('the header marks the page you are on', () => {
  it('accents the nav entry for the current page and says so to a screen reader', () => {
    const outDir = buildSite({ outDir: join('output', 'test-nav-active') }).outDir;

    const casino = readOutput(outDir, join('casino', 'index.html'));
    expect(casino).toMatch(/<a href="\/casino"[^>]*class="is-active"[^>]*aria-current="page"/);
    // Exactly one entry is marked -- the others are still plain links.
    expect(casino.match(/aria-current="page"/g)).toHaveLength(1);

    // The home page marks nothing: the brand in the corner already leads there.
    expect(readOutput(outDir)).not.toContain('aria-current');
  });

  it('matches a nav href to the page it names even when one of them carries a trailing slash', () => {
    // The two are written by different people -- site.json's nav by hand, the slug by the page
    // file -- so "/casino/" against "/casino" is not a hypothetical, and a raw string comparison
    // would leave the menu silently unmarked on any site that spells them differently.
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-nav-'));
    writeSiteDirFromContent(dir, {
      brand: { name: 'Trailing' },
      nav: [{ label: 'Casino', href: '/casino/' }],
      pages: [
        { slug: '/', meta: {}, blocks: [{ type: 'hero', props: { content: [{ type: 'title', h1: 'Home' }] } }] },
        { slug: '/casino', meta: {}, blocks: [{ type: 'hero', props: { content: [{ type: 'title', h1: 'Casino' }] } }] },
      ],
    });
    try {
      const outDir = buildSite({
        outDir: join('output', 'test-nav-active-slash'),
        env: { SITE_DIR: dir },
      }).outDir;
      expect(readOutput(outDir, join('casino', 'index.html'))).toContain('aria-current="page"');
      expect(readOutput(outDir)).not.toContain('aria-current');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('brand logo, named in site.json and found through images.json', () => {
  let dir;
  let outDir;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'site-factory-logo-'));
    const publicDir = join(dir, 'public');
    mkdirSync(join(publicDir, 'images'), { recursive: true });
    writeFileSync(join(publicDir, 'images', 'logo.svg'), '<svg/>');
    writeSiteDirFromContent(dir, {
      // The logo renders in the header, and the header renders only when there is a nav to show
      // (see Base.astro's `showHeader`) — so a nav entry is needed to see the logo at all.
      brand: { name: 'Has Logo', logo: 'logo' },
      nav: [{ label: 'Home', href: '/' }],
      pages: [
        {
          slug: '/',
          meta: {},
          blocks: [{ type: 'hero', props: { content: [{ type: 'title', h1: 'Hero' }] } }],
        },
      ],
    });
    writeFileSync(
      join(dir, 'images.json'),
      JSON.stringify({
        logo: { src: '/images/logo.svg', alt: 'Has Logo mark', width: 120, height: 36 },
      }),
    );
    outDir = buildSite({
      outDir: join('output', 'test-logo-present'),
      env: { SITE_DIR: dir, PUBLIC_DIR: publicDir },
    }).outDir;
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('puts the logo in the header with the alt text from images.json', () => {
    expect(readOutput(outDir)).toMatch(
      /<img[^>]*src="\/images\/logo\.svg"[^>]*alt="Has Logo mark"[^>]*width="120"/,
    );
  });

  it('copies the logo file into the output', () => {
    expect(existsSync(join(outDir, 'images', 'logo.svg'))).toBe(true);
  });
});

describe('a logo that does not resolve', () => {
  it('is dropped, with a warning in the log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-logo-missing-'));
    try {
      writeSiteDirFromContent(dir, {
        brand: { name: 'No Logo Here', logo: 'missing' },
        nav: [{ label: 'Home', href: '/' }],
        pages: [
          {
            slug: '/',
            meta: {},
            blocks: [{ type: 'hero', props: { content: [{ type: 'title', h1: 'Hero' }] } }],
          },
        ],
      });
      writeFileSync(
        join(dir, 'images.json'),
        JSON.stringify({ missing: { src: '/images/missing.svg', alt: 'Missing' } }),
      );
      const built = buildSite({ outDir: join('output', 'test-missing-logo'), env: { SITE_DIR: dir } });
      expect(readOutput(built.outDir)).not.toContain('/images/missing.svg');
      expect(built.log).toContain('Логотип: файл картинки «missing» не найден');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('percent-encoded slugs', () => {
  it('builds a page for a slug containing a percent-encoded sequence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-slug-'));
    writeSiteDirFromContent(dir, {
      domain: 'example.com',
      locale: 'en-US',
      brand: { name: 'Encoded' },
      pages: [
        { slug: '/', meta: { title: 'Home' }, blocks: [] },
        { slug: '/%41', meta: { title: 'Decoded Page' }, blocks: [] },
      ],
    });
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-encoded-slug'),
        env: { SITE_DIR: dir },
      });
      expect(existsSync(join(outDir, 'A', 'index.html'))).toBe(true);
      expect(readOutput(outDir, join('A', 'index.html'))).toContain('Decoded Page');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('double-encoded slugs', () => {
  it('builds a page for a double-encoded slug instead of crashing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-slug-'));
    writeSiteDirFromContent(dir, {
      domain: 'example.com',
      locale: 'en-US',
      brand: { name: 'DoubleEncoded' },
      pages: [
        { slug: '/', meta: { title: 'Home' }, blocks: [] },
        { slug: '/%2541', meta: { title: 'Double Encoded Page' }, blocks: [] },
      ],
    });
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-double-encoded-slug'),
        env: { SITE_DIR: dir },
      });
      expect(existsSync(join(outDir, '2541', 'index.html'))).toBe(true);
      expect(readOutput(outDir, join('2541', 'index.html'))).toContain('Double Encoded Page');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Finding C1: hostile names reached Astro's own path resolution unexamined and crashed the build
// outright. The page address comes from the file name now, so each case is a real file in a real
// folder going through a real `astro build`. Two of the original six — a path-traversal slug and a
// "." segment — cannot be a file name at all (a name cannot contain "/"), so they are gone from here
// and stay pinned by the normalizeSite unit tests.
describe('hostile page names that used to crash the build (C1)', () => {
  function buildWithSlug(slug, dirName) {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-hostile-slug-'));
    writeSiteDirFromContent(dir, {
      domain: 'example.com',
      locale: 'en-US',
      brand: { name: 'Hostile' },
      pages: [
        { slug: '/', meta: { title: 'Home' }, blocks: [] },
        { slug, meta: { title: 'Hostile Page' }, blocks: [] },
      ],
    });
    try {
      return buildSite({ outDir: join('output', dirName), env: { SITE_DIR: dir } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('strips a backslash out of a page name', () => {
    const { outDir } = buildWithSlug('/a\\b', 'test-slug-backslash');
    expect(readOutput(outDir, join('ab', 'index.html'))).toContain('Hostile Page');
  });

  it('strips a newline control character out of a page name', () => {
    const { outDir } = buildWithSlug('/a\nb', 'test-slug-control-newline');
    expect(readOutput(outDir, join('ab', 'index.html'))).toContain('Hostile Page');
  });

  it('strips a tab control character out of a page name', () => {
    const { outDir } = buildWithSlug('/a\tb', 'test-slug-control-tab');
    expect(readOutput(outDir, join('ab', 'index.html'))).toContain('Hostile Page');
  });

  it('caps an oversized page name instead of letting mkdir hit ENAMETOOLONG', () => {
    // 250 characters plus ".json" is 255 bytes — the longest name the filesystem will hold.
    const longName = 'a'.repeat(250);
    const { outDir } = buildWithSlug(`/${longName}`, 'test-slug-too-long');
    expect(readOutput(outDir, join(longName.slice(0, 100), 'index.html'))).toContain('Hostile Page');
  });

  it('refuses a page named index.html, which would collide with the home page, falling back to page-N', () => {
    const { outDir, log } = buildWithSlug('/index.html', 'test-slug-index-html');
    expect(readOutput(outDir, join('page-1', 'index.html'))).toContain('Hostile Page');
    expect(log).toContain('index.html');
  });
});

// The folder format gives every page its address from its file name, so the hostile inputs that
// can reach a real build are hostile FILE NAMES now. Much of what this test used to feed in cannot
// be a file name at all — a "/" inside the slug, a NUL byte, a 300-character segment, a lone
// surrogate, a code point APFS refuses — and on a filesystem that folds case and NFC/NFD (APFS,
// which this runs on) neither can two names differing only that way. Those shapes stay pinned by
// tests/normalize.test.mjs, which hands normalizeSite a raw slug directly. Everything a real folder
// CAN hold is here, in one real build, and every page is accounted for: it landed at the route its
// own name implies with no warning, or it landed at a fallback and the log says why.
describe('hostile page file names, all in one real build', () => {
  const BEL = String.fromCharCode(7);
  const UNIT_SEPARATOR = String.fromCharCode(31);
  const DEL = String.fromCharCode(127);
  const SOH = String.fromCharCode(1);
  const STX = String.fromCharCode(2);

  // `route`: where the page must land, unwarned. `null`: the name is unusable or already taken, so
  // the page must fall back to a page-N address and the log must say so.
  const pages = [
    { file: 'home.json', route: '/', label: 'home' },
    { file: 'about.json', route: '/about', label: 'plain name' },
    { file: `${'café'.normalize('NFC')}.json`, route: '/café', label: 'non-ASCII name' },
    { file: '日本語.json', route: '/日本語', label: 'non-Latin name' },
    { file: '%41.json', route: '/A', label: 'percent escape decoded' },
    { file: 'Page-1.json', route: '/Page-1', label: 'name shaped like a fallback' },
    { file: `${'x'.repeat(99)}😀.json`, route: `/${'x'.repeat(99)}😀`, label: 'astral character exactly at the cap' },
    { file: `${'y'.repeat(100)}😀.json`, route: `/${'y'.repeat(100)}`, label: 'astral character just past the cap' },
    // 250 + ".json" is 255 bytes, the longest name the filesystem holds; the slug rules cap at 100.
    { file: `${'q'.repeat(250)}.json`, route: `/${'q'.repeat(100)}`, label: 'longest possible name' },
    { file: `ctrl${BEL}${UNIT_SEPARATOR}${DEL}name.json`, route: '/ctrlname', label: 'control characters amid text' },
    // Pages are claimed home first, then in file-name order, and "%" (0x25) sorts before "D"
    // (0x44): this one decodes to /Dup and claims it first, so Dup.json is the one that loses.
    { file: '%44up.json', route: '/Dup', label: 'percent escape decoding onto another page' },
    { file: 'Dup.json', route: null, label: 'name another page already decoded onto' },
    { file: 'index.html.json', route: null, label: 'index.html' },
    { file: 'sitemap.xml.json', route: null, label: 'sitemap.xml' },
    { file: 'ROBOTS.TXT.json', route: null, label: 'robots.txt in upper case' },
    { file: '.prerender.json', route: null, label: 'Astro build staging directory' },
    { file: '%.json', route: null, label: 'percent only' },
    { file: '%%%.json', route: null, label: 'triple percent' },
    { file: '...json', route: null, label: 'dot dot' },
    { file: '\\.json', route: null, label: 'lone backslash' },
    { file: `${SOH}${STX}.json`, route: null, label: 'only control characters' },
    // A file the public folder copies to the output root. Not a name the engine reserves — it
    // depends on this build's public folder — so only the live filesystem prober refuses it.
    { file: 'banner.png.json', route: null, label: 'same name as a public file' },
  ];

  const titleOf = (index) => `Hostile page ${index}: ${pages[index].label}`;
  const rawSlugOf = (file) => `/${file.slice(0, -'.json'.length)}`;
  const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pageFile = (route) =>
    route === '/' ? 'index.html' : join(...route.slice(1).split('/'), 'index.html');

  function countIndexHtmlFiles(dir) {
    let count = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) count += countIndexHtmlFiles(full);
      else if (entry.name === 'index.html') count += 1;
    }
    return count;
  }

  function readAllPageHtml(dir) {
    const htmls = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) htmls.push(...readAllPageHtml(full));
      else if (entry.name === 'index.html') htmls.push(readFileSync(full, 'utf8'));
    }
    return htmls;
  }

  // Reverses what src/pages/sitemap.xml.js and src/lib/urls.mjs do to build each <loc>, to recover
  // the on-disk path each sitemap entry claims to point at.
  function sitemapLocPaths(outDir) {
    const xml = readOutput(outDir, 'sitemap.xml');
    return [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((match) => {
      const unescaped = match[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
      const { pathname } = new URL(unescaped);
      const segments =
        pathname === '/' ? [] : pathname.slice(1).split('/').map((part) => decodeURIComponent(part));
      return join(outDir, ...segments, 'index.html');
    });
  }

  it('builds, and puts every page at its own route or at a fallback the log reports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-hostile-names-'));
    const publicDir = join(dir, 'public');
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(join(publicDir, 'banner.png'), 'not really a png');
    writeFileSync(
      join(dir, 'site.json'),
      JSON.stringify({ domain: 'example.com', locale: 'en-US', brand: { name: 'Hostile Names' } }),
    );
    pages.forEach((page, index) => {
      writeFileSync(join(dir, page.file), JSON.stringify({ title: titleOf(index), blocks: [] }));
    });

    try {
      // One file per entry, or every count below is meaningless: a name the filesystem folded onto
      // another would silently have overwritten it.
      expect(
        readdirSync(dir).filter((name) => name.endsWith('.json') && name !== 'site.json'),
      ).toHaveLength(pages.length);

      const { outDir, log } = buildSite({
        outDir: join('output', 'test-hostile-names'),
        env: { SITE_DIR: dir, PUBLIC_DIR: publicDir },
      });

      // Nothing lost and nothing duplicated: exactly one index.html per page file.
      expect(countIndexHtmlFiles(outDir)).toBe(pages.length);

      const allHtml = readAllPageHtml(outDir);
      pages.forEach((page, index) => {
        const title = titleOf(index);
        const warning = new RegExp(
          `Слаг «${escapeRegExp(rawSlugOf(page.file))}» (?:недопустим|уже занят)`,
        );
        if (page.route) {
          expect(readOutput(outDir, pageFile(page.route)), `${page.label} at ${page.route}`).toContain(title);
          expect(log, `${page.label} should not be warned about`).not.toMatch(warning);
        } else {
          expect(allHtml.some((html) => html.includes(title)), `${page.label} must be built`).toBe(true);
          expect(log, `${page.label} must be reported`).toMatch(warning);
        }
      });

      // Every fallback reported exactly once, and never as the dropping path's "дубликат".
      const fallbacks = pages.filter((page) => page.route === null).length;
      expect((log.match(/Слаг «[^»]*» (?:недопустим|уже занят)/g) || []).length).toBe(fallbacks);
      expect(log).not.toContain('дубликат');

      // No URL the sitemap advertises may be missing its page on disk (final-fix-6, F1).
      for (const target of sitemapLocPaths(outDir)) {
        expect(existsSync(target), `sitemap.xml advertises a page not on disk: ${target}`).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Final-fix-6, F2: createOutputProber used to seed its reserved-name marker files before mirroring
// publicDir in, so a public/ directory named like a reserved name (here: sitemap.xml/) crashed the
// mirror copy and took the whole prober down with it — handing slug resolution back to the old
// predictive path, which cannot save a page only the filesystem can judge. Reproduced exactly that
// way: one public/sitemap.xml directory plus one such page, in the same real build.
describe('a publicDir asset sharing a reserved name cannot disable the whole prober (final-fix-6, F2)', () => {
  it('still builds, still mirrors the publicDir asset, and still saves a page only a live prober can catch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-prober-publicdir-'));
    const publicDir = join(dir, 'public');
    mkdirSync(join(publicDir, 'sitemap.xml'), { recursive: true });
    writeFileSync(join(publicDir, 'sitemap.xml', 'note.txt'), 'not actually a sitemap');
    // The page only a live prober can save is named like a file this public folder copies to the
    // output root. The engine does not reserve that name — it depends on what this build's public
    // folder holds — so no predictive rule refuses it. (This used to be a slug with an unassigned
    // code point; APFS will not create a FILE with such a name, so a folder cannot carry it.)
    writeFileSync(join(publicDir, 'banner.png'), 'not really a png');

    writeSiteDirFromContent(dir, {
      domain: 'example.com',
      locale: 'en-US',
      brand: { name: 'ProberPublicDir' },
      pages: [
        { slug: '/', meta: { title: 'ProberPublicDir Home' }, blocks: [] },
        { slug: '/banner.png', meta: { title: 'Public Asset Collision Page' }, blocks: [] },
      ],
    });

    try {
      const { outDir, log } = buildSite({
        outDir: join('output', 'test-prober-publicdir-collision'),
        env: { SITE_DIR: dir, PUBLIC_DIR: publicDir },
      });

      expect(existsSync(join(outDir, 'index.html'))).toBe(true);

      // The colliding page survived at a page-N fallback and was reported as invalid — proof the
      // PROBER resolved it: the predictive path has no rule for a public file at all.
      expect(log).toContain('недопустим');
      const fallbackTitles = readdirSync(outDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('page-'))
        .map((entry) => readOutput(outDir, join(entry.name, 'index.html')));
      expect(fallbackTitles.some((html) => html.includes('Public Asset Collision Page'))).toBe(true);

      // The degradation warning (final-fix-6, F5) is absent: the prober was never disabled.
      expect(log).not.toContain('Проверка слагов через файловую систему недоступна');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
