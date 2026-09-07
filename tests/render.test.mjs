import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, readOutput } from './helpers/build.mjs';
import { normalizeSite } from '../src/lib/normalize.mjs';

describe('engine build', () => {
  let outDir;

  beforeAll(() => {
    outDir = buildSite({ template: 't1', scheme: 'blue' }).outDir;
  });

  it('writes a home page', () => {
    expect(existsSync(join(outDir, 'index.html'))).toBe(true);
  });

  it('writes every page from the content file', () => {
    expect(existsSync(join(outDir, 'about', 'index.html'))).toBe(true);
  });

  it('renders the hero content', () => {
    expect(readOutput(outDir)).toContain('Find what actually works');
  });

  it('inlines the colour scheme', () => {
    const html = readOutput(outDir);
    expect(html).toContain('--c-primary');
    expect(html).toContain('#2563eb');
  });

  it('sets language and direction', () => {
    expect(readOutput(outDir)).toContain('lang="en"');
    expect(readOutput(outDir)).toContain('dir="ltr"');
  });

  it('copies files from the example public folder', () => {
    expect(existsSync(join(outDir, 'images', 'logo.svg'))).toBe(true);
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
    expect(html).toContain('Why this guide exists');
    expect(html).toContain('What we check');
    expect(html).toContain('Browse by topic');
    expect(html).toContain('Questions we get a lot');
    expect(html).toContain('Материалы носят информационный характер');
  });

  it('survives a broken content file', () => {
    const broken = buildSite({ example: 'broken', outDir: join('output', 'test-broken') });
    const html = readOutput(broken.outDir, join('sloppy', 'index.html'));
    expect(html).toContain('a single string');
    expect(html).toContain('only a question');
    expect(broken.log).toContain('carousel');
  });

  it('drops orphaned markup for empty collections and bad headings', () => {
    const broken = buildSite({ example: 'broken', outDir: join('output', 'test-broken') });
    const html = readOutput(broken.outDir, join('sloppy', 'index.html'));
    expect(html).not.toContain('[object Object]');
    expect(html).not.toContain('<h2>ab</h2>');
    expect(html).not.toContain('Still nothing to show');
    expect(html).not.toMatch(/<div class="cards__grid">\s*<\/div>/);
    expect(html).not.toMatch(/<ul>\s*<\/ul>/);
    expect(html).not.toMatch(/<p>\s*<\/p>/);
    expect(html).not.toMatch(/<dt>\s*<\/dt>\s*<dd>\s*<\/dd>/);
    expect(html).toContain('Also empty');
    expect(html).toContain('Broken links');
  });

  it('fails the build when the content file does not exist', () => {
    const missing = join('data', 'examples', 'default', 'does-not-exist.json');
    expect(() =>
      buildSite({ outDir: join('output', 'test-missing-json'), env: { SITE_JSON: missing } }),
    ).toThrow(missing);
  });

  it('fails the build when the content file is not valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-render-'));
    const file = join(dir, 'site.json');
    writeFileSync(file, '{ not valid json');
    try {
      expect(() =>
        buildSite({ outDir: join('output', 'test-invalid-json'), env: { SITE_JSON: file } }),
      ).toThrow(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('templates are interchangeable and distinct', () => {
  const rendered = {};

  beforeAll(() => {
    for (const template of ['t1', 't2', 't3']) {
      const { outDir } = buildSite({ template, scheme: 'blue' });
      rendered[template] = readOutput(outDir);
    }
  });

  it('renders the same content in every template', () => {
    for (const html of Object.values(rendered)) {
      expect(html).toContain('Find what actually works');
      expect(html).toContain('Why this guide exists');
      expect(html).toContain('Questions we get a lot');
    }
  });

  it('produces visibly different markup per template', () => {
    const [first, second, third] = Object.values(rendered);
    expect(first).not.toBe(second);
    expect(second).not.toBe(third);
    expect(first).not.toBe(third);
  });

  it('renders the FAQ as native disclosure widgets in t3 only', () => {
    expect(rendered.t3).toContain('<details');
    expect(rendered.t1).not.toContain('<details');
    expect(rendered.t2).not.toContain('<details');
  });

  it('ships no JavaScript in any template', () => {
    for (const html of Object.values(rendered)) {
      expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
    }
  });

  // Follow-up finding: correct today on all three templates (every affiliate anchor is already
  // gated behind `site?.partnerUrl &&`), but nothing pinned it — and the review calls an empty or
  // "#" affiliate href worse than no link at all. The `default` example this suite builds from
  // sets no partnerUrl at all, so `rendered` here already exercises exactly that case; every
  // affiliate anchor across every template shares the "button" class and nothing else in any
  // template ever renders one, so its absence is a direct proxy for "no CTA anchor at all".
  it('renders no CTA anchor at all when partnerUrl is unset, in every template', () => {
    for (const [template, html] of Object.entries(rendered)) {
      expect(html, `template ${template} rendered a CTA with no partnerUrl set`).not.toMatch(
        /<a\b[^>]*class="[^"]*\bbutton\b/,
      );
    }
  });
});

describe('hero survives junk props', () => {
  it('does not leak object junk into t1 hero markup', () => {
    const { outDir } = buildSite({ example: 'broken', template: 't1' });
    const html = readOutput(outDir, join('sloppy', 'index.html'));
    expect(html).not.toContain('[object Object]');
    expect(html).not.toMatch(/<img[^>]*\ssrc="\[object Object\]"/);
  });

  it('does not leak object junk into t2 hero markup', () => {
    const { outDir } = buildSite({ example: 'broken', template: 't2' });
    const html = readOutput(outDir, join('sloppy', 'index.html'));
    expect(html).not.toContain('[object Object]');
    expect(html).not.toMatch(/<img[^>]*\ssrc="\[object Object\]"/);
  });
});

describe('percent-encoded slugs', () => {
  it('builds a page for a slug containing a percent-encoded sequence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-slug-'));
    const file = join(dir, 'site.json');
    writeFileSync(
      file,
      JSON.stringify({
        domain: 'example.com',
        locale: 'en-US',
        brand: { name: 'Encoded' },
        pages: [
          { slug: '/', meta: { title: 'Home' }, blocks: [] },
          { slug: '/%41', meta: { title: 'Decoded Page' }, blocks: [] },
        ],
      }),
    );
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-encoded-slug'),
        env: { SITE_JSON: file },
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
    const file = join(dir, 'site.json');
    writeFileSync(
      file,
      JSON.stringify({
        domain: 'example.com',
        locale: 'en-US',
        brand: { name: 'DoubleEncoded' },
        pages: [
          { slug: '/', meta: { title: 'Home' }, blocks: [] },
          { slug: '/%2541', meta: { title: 'Double Encoded Page' }, blocks: [] },
        ],
      }),
    );
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-double-encoded-slug'),
        env: { SITE_JSON: file },
      });
      expect(existsSync(join(outDir, '2541', 'index.html'))).toBe(true);
      expect(readOutput(outDir, join('2541', 'index.html'))).toContain('Double Encoded Page');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Finding C1: normalizeSlug only collapsed/trimmed slashes and never inspected segment
// *content*, so these six hostile shapes reached Astro's own path resolution unexamined and
// crashed the build outright (NoMatchingStaticPathFound from Astro's static-path matcher, or
// ENAMETOOLONG / ENOTDIR from the eventual mkdir) — a red, exit-1 build with no site at all,
// even though "content can never fail a build" is supposed to hold no matter what a slug
// contains. A unit test on normalizeSlug alone would not catch this: the failure is in how
// Astro resolves the normalized value, not in the return value by itself, so each case here
// goes through a real `astro build`.
describe('hostile slugs that used to crash the build (C1)', () => {
  function buildWithSlug(slug, dirName) {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-hostile-slug-'));
    const file = join(dir, 'site.json');
    writeFileSync(
      file,
      JSON.stringify({
        domain: 'example.com',
        locale: 'en-US',
        brand: { name: 'Hostile' },
        pages: [
          { slug: '/', meta: { title: 'Home' }, blocks: [] },
          { slug, meta: { title: 'Hostile Page' }, blocks: [] },
        ],
      }),
    );
    try {
      return buildSite({ outDir: join('output', dirName), env: { SITE_JSON: file } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('resolves a path-traversal slug instead of escaping the routing tree', () => {
    const { outDir } = buildWithSlug('/../../ESCAPED', 'test-slug-traversal');
    expect(existsSync(join(outDir, 'ESCAPED', 'index.html'))).toBe(true);
    expect(readOutput(outDir, join('ESCAPED', 'index.html'))).toContain('Hostile Page');
  });

  it('resolves a slug containing a bare "." segment', () => {
    const { outDir } = buildWithSlug('/./x', 'test-slug-dot-segment');
    expect(existsSync(join(outDir, 'x', 'index.html'))).toBe(true);
    expect(readOutput(outDir, join('x', 'index.html'))).toContain('Hostile Page');
  });

  it('strips a backslash out of a slug segment', () => {
    const { outDir } = buildWithSlug('/a\\b', 'test-slug-backslash');
    expect(existsSync(join(outDir, 'ab', 'index.html'))).toBe(true);
    expect(readOutput(outDir, join('ab', 'index.html'))).toContain('Hostile Page');
  });

  it('strips a newline control character out of a slug segment', () => {
    const { outDir } = buildWithSlug('/a\nb', 'test-slug-control-newline');
    expect(existsSync(join(outDir, 'ab', 'index.html'))).toBe(true);
    expect(readOutput(outDir, join('ab', 'index.html'))).toContain('Hostile Page');
  });

  it('strips a tab control character out of a slug segment', () => {
    const { outDir } = buildWithSlug('/a\tb', 'test-slug-control-tab');
    expect(existsSync(join(outDir, 'ab', 'index.html'))).toBe(true);
    expect(readOutput(outDir, join('ab', 'index.html'))).toContain('Hostile Page');
  });

  it('caps an oversized slug segment instead of letting mkdir hit ENAMETOOLONG', () => {
    const longSegment = 'a'.repeat(300);
    const { outDir } = buildWithSlug(`/${longSegment}`, 'test-slug-too-long');
    const capped = longSegment.slice(0, 100);
    expect(existsSync(join(outDir, capped, 'index.html'))).toBe(true);
    expect(readOutput(outDir, join(capped, 'index.html'))).toContain('Hostile Page');
  });

  it('refuses a slug that would collide with the index.html Astro writes, falling back to page-N', () => {
    const { outDir, log } = buildWithSlug('/index.html', 'test-slug-index-html');
    expect(existsSync(join(outDir, 'page-1', 'index.html'))).toBe(true);
    expect(readOutput(outDir, join('page-1', 'index.html'))).toContain('Hostile Page');
    expect(log).toContain('index.html');
  });
});

// Follow-up review: the fix above pinned exactly the six shapes the original finding listed
// rather than the invariant behind them, and one of the four new crashes it missed was
// introduced by that very fix (`.slice(0, 100)` truncating by UTF-16 code unit). The point of
// this test is that NONE of the individual shapes matter — a single real build carrying a wide,
// deliberately hostile range of slugs (long, deep, empty, dot-only, control characters, lone
// surrogates, astral characters sitting right on the truncation boundary, "index.html" in every
// position, mixed percent/Unicode encoding, separators only) must still succeed, and every page
// must be accounted for: either it made it into the output, or normalizeSite's own warnings say
// why it did not (a genuine duplicate). `normalizeSite` is called directly on the exact same
// content as the oracle for "what should happen" — the real `astro build` then either agrees
// with it (proving the invariant holds end to end) or crashes (proving it does not), which a
// pure unit test on normalizeSite alone could never observe.
describe('normalizeSlug holds as an invariant across a wide range of hostile slugs, not six special cases (final-fix-3)', () => {
  const longSegment = 'q'.repeat(300);
  const deepSegment = 'd'.repeat(100);
  // Built via String.fromCharCode rather than source-level escapes, so the exact
  // characters are unambiguous and the file itself stays plain, readable ASCII.
  const NUL = String.fromCharCode(0);
  const SOH = String.fromCharCode(1);
  const STX = String.fromCharCode(2);
  const BEL = String.fromCharCode(7);
  const UNIT_SEPARATOR = String.fromCharCode(31);
  const DEL = String.fromCharCode(127);
  const HIGH_SURROGATE = String.fromCharCode(0xd800);
  const LOW_SURROGATE = String.fromCharCode(0xdc00);

  const hostilePages = [
    { label: 'long segment', slug: `/${longSegment}` },
    { label: 'deep path', slug: `/${Array(12).fill(deepSegment).join('/')}` },
    { label: 'separators only', slug: '///' },
    { label: 'dot only', slug: '..' },
    { label: 'dot segment', slug: '/./' },
    { label: 'lone backslash', slug: '/\\' },
    { label: 'only control characters', slug: `/${NUL}${SOH}${STX}` },
    { label: 'control characters amid text', slug: `/ctrl${NUL}${BEL}${UNIT_SEPARATOR}${DEL}name` },
    { label: 'lone high surrogate', slug: `/high${HIGH_SURROGATE}surrogate` },
    { label: 'lone low surrogate', slug: `/low${LOW_SURROGATE}surrogate` },
    { label: 'astral character exactly at the cap', slug: `/${'x'.repeat(99)}😀` },
    { label: 'astral character just past the cap', slug: `/${'y'.repeat(100)}😀` },
    { label: 'index.html alone', slug: '/index.html' },
    { label: 'index.html first of two', slug: '/index.html/tail' },
    { label: 'index.html last of two', slug: '/head/index.html' },
    { label: 'index.html in the middle', slug: '/head/index.html/tail' },
    { label: 'index.html mixed case', slug: '/InDeX.HtMl' },
    { label: 'percent-encoding mixed with literal Unicode', slug: '/%41/café' },
    { label: 'path traversal', slug: '/../../ESCAPED' },
    { label: 'dot segment in the middle', slug: '/a/../b' },
    { label: 'duplicate of a later page via percent-encoding (first)', slug: '/Dup' },
    { label: 'duplicate of an earlier page via percent-encoding (second)', slug: '/%44up' },
    // final-fix-4 (C1): sitemap.xml/robots.txt are root-level files the engine always writes,
    // exactly like index.html — a segment matching either name collides with them the same way,
    // in any position and regardless of case. None of these collide with each other or with
    // anything else in this list, so they only add to the page count, they do not change the
    // "exactly one genuine duplicate" arithmetic below.
    { label: 'sitemap.xml first of two segments', slug: '/sitemap.xml/deep' },
    { label: 'sitemap.xml alone, exact match', slug: '/sitemap.xml' },
    { label: 'robots.txt in the middle, mixed case', slug: '/a/ROBOTS.TXT/b' },
    { label: 'robots.txt alone, mixed case', slug: '/ROBOTS.TXT' },
    // final-fix-4 (M1): each of these decodes/strips down to nothing, which must land on its
    // own page-N fallback, never on the real home page above.
    { label: 'percent only, reduces to nothing', slug: '%' },
    { label: 'slash plus percent, reduces to nothing', slug: '/%' },
    { label: 'triple percent, reduces to nothing', slug: '%%%' },
  ];

  function content() {
    return {
      domain: 'example.com',
      locale: 'en-US',
      brand: { name: 'Hostile Wide' },
      pages: [
        { slug: '/', meta: { title: 'Hostile Wide Home' }, blocks: [] },
        ...hostilePages.map((page, i) => ({
          slug: page.slug,
          meta: { title: `Hostile page ${i}: ${page.label}` },
          blocks: [],
        })),
      ],
    };
  }

  function outputPathFor(outDir, slug) {
    const parts = slug === '/' ? [] : slug.slice(1).split('/');
    return join(outDir, ...parts, 'index.html');
  }

  function countIndexHtmlFiles(dir) {
    let count = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) count += countIndexHtmlFiles(full);
      else if (entry.name === 'index.html') count += 1;
    }
    return count;
  }

  it('builds successfully and accounts for every page, hostile or not', () => {
    // Exactly one genuine collision is deliberately included above (two different encodings of
    // the same real slug, "/Dup") to prove the "or was warned about" branch of the invariant —
    // everything else here must survive as its own distinct page.
    const { site, warnings } = normalizeSite(content(), {});
    // 1 home page is added, 1 duplicate pair collapses to 1 survivor: net count is unchanged.
    expect(site.pages.length).toBe(hostilePages.length);

    const dir = mkdtempSync(join(tmpdir(), 'site-factory-hostile-wide-'));
    const file = join(dir, 'site.json');
    writeFileSync(file, JSON.stringify(content()));

    try {
      // The real build succeeding at all — no ENAMETOOLONG, no ENOTDIR, no "URI malformed" —
      // is the core of the invariant. buildSite throws with the process's exit code and full
      // output if it does not.
      const { outDir, log } = buildSite({
        outDir: join('output', 'test-hostile-wide'),
        env: { SITE_JSON: file },
      });

      // Every surviving page (per normalizeSite, the same function the real build itself uses)
      // must exist on disk at exactly the path its slug implies, carrying its own title.
      for (const page of site.pages) {
        const target = outputPathFor(outDir, page.slug);
        expect(existsSync(target), `expected ${target} for slug ${page.slug}`).toBe(true);
        expect(readOutput(outDir, target.slice(outDir.length + 1))).toContain(page.meta.title);
      }

      // No extra pages leaked out, and none went missing.
      expect(countIndexHtmlFiles(outDir)).toBe(site.pages.length);

      // The one deliberate duplicate must be reported as a duplicate — and everything else that
      // needed a fallback must be reported as invalid, never folded into the duplicate warning.
      const droppedTitles = content()
        .pages.map((p) => p.meta.title)
        .filter((title) => !site.pages.some((p) => p.meta.title === title));
      expect(droppedTitles).toHaveLength(1);
      expect(warnings.filter((w) => w.includes('дубликат'))).toHaveLength(1);
      for (const title of droppedTitles) {
        expect(readOutput(outDir)).not.toContain(title);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Finding M2: resolvePageSlugs reserves every real (content-given) slug before handing out
// fallbacks, which works — but the synthesized default for a page with NO slug at all
// ("page-${index}", built inside buildSlugCandidate) used to bypass that reservation entirely:
// it was treated exactly like a slug a content author had typed, so it could silently steal a
// slug some other page in the same file genuinely asked for. This drives the exact repro from
// the finding through a real build, via a temp content file, per the prescribed method.
describe('a missing slug\'s generated default cannot steal a slug another page really asked for (M2)', () => {
  it('keeps the real "/page-1" page\'s own content there instead of the blank page\'s', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-missing-slug-'));
    const file = join(dir, 'site.json');
    writeFileSync(
      file,
      JSON.stringify({
        domain: 'example.com',
        locale: 'en-US',
        brand: { name: 'MissingSlug' },
        pages: [
          { slug: '/', meta: { title: 'Home' }, blocks: [] },
          { meta: { title: 'Blank Slug Page' }, blocks: [] }, // slug field omitted entirely
          { slug: '/page-1', meta: { title: 'Real Page One' }, blocks: [] },
        ],
      }),
    );
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-missing-slug-default'),
        env: { SITE_JSON: file },
      });
      expect(existsSync(join(outDir, 'page-1', 'index.html'))).toBe(true);
      expect(readOutput(outDir, join('page-1', 'index.html'))).toContain('Real Page One');
      expect(readOutput(outDir, join('page-1', 'index.html'))).not.toContain('Blank Slug Page');
      // The blank page is still built — reserved fallback numbering bumps it to the next free
      // "page-N" (page-2) instead of dropping it, exactly like any other fallback collision.
      expect(existsSync(join(outDir, 'page-2', 'index.html'))).toBe(true);
      expect(readOutput(outDir, join('page-2', 'index.html'))).toContain('Blank Slug Page');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Finding M3: normalizeSite's duplicate-slug detection used to compare slugs case-sensitively,
// so "/about", "/About" and "/ABOUT" all survived as three distinct pages — right up until
// Astro tried to write all three to the same directory on a case-insensitive filesystem (APFS,
// macOS's default), which is exactly what this test runs on. Without normalizeSite's own
// case-insensitive dedup, the three pages would race to write "about/index.html", and whichever
// one Astro happens to generate last would silently overwrite the others with no warning at
// all — so this checks not just that the build survives, but specifically that the *first*
// page's content is what ends up on disk, proving the collision never reached Astro to begin
// with.
describe('case-insensitive slug duplicates are collapsed before Astro ever writes them (M3)', () => {
  it('keeps only the first of /about, /About and /ABOUT, with its own content intact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-case-dup-'));
    const file = join(dir, 'site.json');
    writeFileSync(
      file,
      JSON.stringify({
        domain: 'example.com',
        locale: 'en-US',
        brand: { name: 'CaseDup' },
        pages: [
          { slug: '/', meta: { title: 'Home' }, blocks: [] },
          { slug: '/about', meta: { title: 'First About' }, blocks: [] },
          { slug: '/About', meta: { title: 'Second About' }, blocks: [] },
          { slug: '/ABOUT', meta: { title: 'Third About' }, blocks: [] },
        ],
      }),
    );
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-case-insensitive-duplicate'),
        env: { SITE_JSON: file },
      });
      expect(existsSync(join(outDir, 'about', 'index.html'))).toBe(true);
      const html = readOutput(outDir, join('about', 'index.html'));
      expect(html).toContain('First About');
      expect(html).not.toContain('Second About');
      expect(html).not.toContain('Third About');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Findings M1/W1/W2/carried-minor: the affiliate CTA reached only the hero (one placement, and
// only on pages that declare one), site.brand.logo was normalized and shipped in every example
// but rendered by nothing, t3 dropped hero.image outright, and cards/faq rendered an empty
// secondary element (<p> / <dd>) whenever only one of a record's two text fields was filled.
// One content file — a partnerUrl, a brand logo, a hero image, a second page with no hero block
// at all, and cards/faq records with only one field set — is built through all three templates
// so every fix is checked against real markup, not just against the source.
describe('affiliate CTA reaches every placement, brand logo renders, no empty partner elements (M1/W1/W2/carried minor)', () => {
  const partnerUrl = 'https://partner.example/go';
  const logoPath = 'images/logo.svg';
  const heroImagePath = 'images/hero.jpg';

  function contentWithSecondPageMissingHero() {
    return {
      domain: 'example.com',
      locale: 'en-US',
      partnerUrl,
      brand: { name: 'CTA Test', logo: logoPath },
      pages: [
        {
          slug: '/',
          meta: { title: 'Home' },
          blocks: [
            { type: 'hero', props: { title: 'Home hero', image: heroImagePath } },
            {
              type: 'cards',
              props: {
                heading: 'Cards',
                items: [
                  { title: 'Card One', text: 'First card text' },
                  { title: 'Only Title Card' },
                ],
              },
            },
            {
              type: 'faq',
              props: {
                heading: 'FAQ',
                items: [
                  { q: 'Answered question', a: 'An answer' },
                  { q: 'Only Question FAQ' },
                ],
              },
            },
          ],
        },
        {
          // No hero block at all — this is the page M1 found unmonetised.
          slug: '/about',
          meta: { title: 'About' },
          blocks: [{ type: 'richtext', props: { heading: 'About', paragraphs: ['Some text.'] } }],
        },
      ],
    };
  }

  function buildWithContent(template, dirName) {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-cta-'));
    const file = join(dir, 'site.json');
    writeFileSync(file, JSON.stringify(contentWithSecondPageMissingHero()));
    try {
      return buildSite({
        template,
        scheme: 'blue',
        outDir: join('output', dirName),
        env: { SITE_JSON: file },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // Attribute order on a tag is not guaranteed (Astro may inject its own scoped-style attribute
  // alongside `class`), so this matches on the class prefix wherever it lands rather than
  // assuming `class` is the first attribute.
  function extractElement(html, tag, classPrefix) {
    const re = new RegExp(`<${tag}[^>]*class="${classPrefix}[^"]*"[^>]*>([\\s\\S]*?)<\\/${tag}>`);
    return html.match(re)?.[0] || '';
  }

  for (const template of ['t1', 't2', 't3']) {
    describe(`template ${template}`, () => {
      let homeHtml;
      let aboutHtml;

      beforeAll(() => {
        const { outDir } = buildWithContent(template, `test-cta-${template}`);
        homeHtml = readOutput(outDir);
        aboutHtml = readOutput(outDir, join('about', 'index.html'));
      });

      it('reaches a page with no hero at all (M1 regression)', () => {
        expect(aboutHtml).not.toContain('Home hero');
        expect(aboutHtml).toContain(partnerUrl);
      });

      it('appears in the footer', () => {
        const footer = extractElement(aboutHtml, 'footer', 'footer');
        expect(footer).not.toBe('');
        expect(footer).toContain(partnerUrl);
      });

      it('appears after the card grid', () => {
        const cardsSection = extractElement(homeHtml, 'section', 'cards');
        expect(cardsSection).not.toBe('');
        expect(cardsSection).toContain(partnerUrl);
        const lastCardIndex = cardsSection.indexOf('Only Title Card');
        const ctaIndex = cardsSection.indexOf(partnerUrl);
        expect(lastCardIndex).toBeGreaterThan(-1);
        expect(ctaIndex).toBeGreaterThan(lastCardIndex);
      });

      it('renders the brand logo', () => {
        expect(homeHtml).toMatch(/<img[^>]*\ssrc="images\/logo\.svg"/);
      });

      it('renders a hero image suited to the template layout', () => {
        expect(homeHtml).toContain(heroImagePath);
      });

      it('emits no empty secondary element when only one of two text fields is filled', () => {
        expect(homeHtml).toContain('Only Title Card');
        expect(homeHtml).toContain('Only Question FAQ');
        expect(homeHtml).not.toMatch(/<p[^>]*><\/p>/);
        expect(homeHtml).not.toMatch(/<dd[^>]*><\/dd>/);
      });

      // Follow-up finding: search engines expect outbound paid/affiliate links to be marked, and
      // an unmarked affiliate network is a real SEO liability. `homeHtml` carries the hero and
      // cards CTAs (this content's home page has both); `aboutHtml` — the hero-less page — still
      // carries the footer CTA every page gets. Together they cover all three placements.
      it('marks every affiliate link as nofollow sponsored', () => {
        const anchorPattern = /<a\b[^>]*class="[^"]*\bbutton\b[^"]*"[^>]*>/g;
        const anchors = [
          ...homeHtml.matchAll(anchorPattern),
          ...aboutHtml.matchAll(anchorPattern),
        ].map((match) => match[0]);
        // Sanity check that this actually found the hero, cards AND footer CTAs, not zero anchors
        // vacuously "passing" the loop below.
        expect(anchors.length).toBeGreaterThanOrEqual(3);
        for (const anchor of anchors) {
          expect(anchor).toMatch(/\srel="nofollow sponsored"/);
        }
      });
    });
  }
});
