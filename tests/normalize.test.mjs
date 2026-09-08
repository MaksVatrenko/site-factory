import { describe, it, expect } from 'vitest';
import { normalizeSite } from '../src/lib/normalize.mjs';

const BLOCKS = ['hero', 'toc', 'section', 'links', 'faq', 'footer'];

describe('normalizeSite', () => {
  it('builds an empty home page when there are no pages', () => {
    const { site, warnings } = normalizeSite({}, { supportedBlocks: BLOCKS });
    expect(site.pages).toHaveLength(1);
    expect(site.pages[0].slug).toBe('/');
    expect(warnings.join(' ')).toContain('нет страниц');
  });

  it('accepts a non-object root without throwing', () => {
    const { site } = normalizeSite('broken', { supportedBlocks: BLOCKS });
    expect(site.pages).toHaveLength(1);
    expect(site.brand.name).toBe('Site');
  });

  it('wraps a single page object into an array', () => {
    const { site } = normalizeSite({ pages: { slug: '/' } }, { supportedBlocks: BLOCKS });
    expect(site.pages).toHaveLength(1);
  });

  it('gives every block a props object', () => {
    const { site } = normalizeSite(
      { pages: [{ blocks: [{ type: 'hero' }] }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].blocks[0].props).toEqual({});
  });

  it('drops blocks the template does not support', () => {
    const { site, warnings } = normalizeSite(
      { pages: [{ blocks: [{ type: 'hero' }, { type: 'carousel' }] }] },
      { supportedBlocks: BLOCKS },
    );
    const types = site.pages[0].blocks.map((b) => b.type);
    expect(types).toContain('hero');
    expect(types).not.toContain('carousel');
    expect(warnings.join(' ')).toContain('carousel');
  });

  it('drops blocks without a type', () => {
    const { site, warnings } = normalizeSite(
      { pages: [{ blocks: [{ props: {} }, 'nonsense'] }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].blocks.filter((b) => b.type !== 'footer')).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('drops a page that is not a plain object, reporting its position', () => {
    // A SITE_DIR page file can parse as valid JSON without being a JSON object at all (a bare
    // string, a number, an array) — see data/sites/broken/not-an-object.json. Such a page has no
    // slug, meta or blocks to work with, so it is dropped the same way an unsupported block is,
    // identified by its position since it has no other identity yet.
    const { site, warnings } = normalizeSite(
      { pages: [{ slug: '/', meta: { title: 'Real' } }, 'not an object', 42] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages).toHaveLength(1);
    expect(site.pages[0].meta.title).toBe('Real');
    expect(warnings.some((w) => w.includes('Страница 2'))).toBe(true);
    expect(warnings.some((w) => w.includes('Страница 3'))).toBe(true);
  });

  it('falls back to the brand name for a missing title', () => {
    const { site } = normalizeSite(
      { brand: { name: 'Acme' }, pages: [{ slug: '/' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].meta.title).toBe('Acme');
  });

  it('trims whitespace so disk name and URL cannot disagree', () => {
    const { site } = normalizeSite(
      { pages: [{ slug: '/about' }, { slug: '/about /' }, { slug: '/  ' }] },
      { supportedBlocks: BLOCKS },
    );
    const slugs = site.pages.map((page) => page.slug);
    expect(slugs[0]).toBe('/about');
    expect(slugs).not.toContain('/about ');
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toBe(new URL(slug, 'https://example.com').pathname);
    }
  });

  it('normalizes slugs to a single leading slash', () => {
    const { site } = normalizeSite(
      { pages: [{ slug: '/' }, { slug: 'about/' }, { slug: '//guide' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages.map((p) => p.slug)).toEqual(['/', '/about', '/guide']);
  });

  it('lets overrides win over file values', () => {
    const { site } = normalizeSite(
      { domain: 'from-file.com', brand: { name: 'FromFile' }, locale: 'en-US' },
      {
        supportedBlocks: BLOCKS,
        overrides: { brand: 'FromForm', domain: 'from-form.com', geo: 'ID' },
      },
    );
    expect(site.brand.name).toBe('FromForm');
    expect(site.domain).toBe('from-form.com');
    expect(site.geo).toBe('ID');
    expect(site.locale).toBe('en-US');
  });

  it('ignores empty overrides', () => {
    const { site } = normalizeSite(
      { brand: { name: 'FromFile' } },
      { supportedBlocks: BLOCKS, overrides: { brand: '' } },
    );
    expect(site.brand.name).toBe('FromFile');
  });

  it('marks right-to-left locales', () => {
    const ltr = normalizeSite({ locale: 'en-US' }, { supportedBlocks: BLOCKS });
    const rtl = normalizeSite({ locale: 'ar-AE' }, { supportedBlocks: BLOCKS });
    expect(ltr.site.dir).toBe('ltr');
    expect(ltr.site.lang).toBe('en');
    expect(rtl.site.dir).toBe('rtl');
    expect(rtl.site.lang).toBe('ar');
  });

  it('appends a footer block when the template supports one', () => {
    const { site } = normalizeSite(
      { pages: [{ blocks: [{ type: 'hero' }] }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].blocks.at(-1).type).toBe('footer');
  });

  it('does not append a footer the template cannot render', () => {
    const { site } = normalizeSite(
      { pages: [{ blocks: [{ type: 'hero' }] }] },
      { supportedBlocks: ['hero'] },
    );
    expect(site.pages[0].blocks.map((b) => b.type)).toEqual(['hero']);
  });

  it('never appends a second footer', () => {
    const { site } = normalizeSite(
      { pages: [{ blocks: [{ type: 'hero' }, { type: 'footer' }] }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].blocks.filter((b) => b.type === 'footer')).toHaveLength(1);
  });

  it('keeps the first page when two pages share a slug', () => {
    const { site, warnings } = normalizeSite(
      {
        pages: [
          { slug: '/about', meta: { title: 'First' } },
          { slug: '/about', meta: { title: 'Second' } },
        ],
      },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages).toHaveLength(1);
    expect(site.pages[0].meta.title).toBe('First');
    expect(warnings.join(' ')).toContain('/about');
  });

  it('trims returned text values', () => {
    const { site } = normalizeSite({ locale: ' ar-AE' }, { supportedBlocks: BLOCKS });
    expect(site.lang).toBe('ar');
    expect(site.dir).toBe('rtl');
  });

  it('collapses embedded double slashes inside a slug', () => {
    const { site } = normalizeSite(
      { pages: [{ slug: 'a//b' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].slug).toBe('/a/b');
  });

  it('decodes percent-encoded escapes in a slug', () => {
    const { site } = normalizeSite(
      { pages: [{ slug: '/%41' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].slug).toBe('/A');
  });

  it('leaves non-ASCII slug characters untouched', () => {
    const { site } = normalizeSite(
      { pages: [{ slug: '/café' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].slug).toBe('/café');
  });

  it('falls back to stripping % when a slug has a malformed percent-escape', () => {
    const { site } = normalizeSite(
      { pages: [{ slug: '/50% off' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].slug).toBe('/50 off');
    expect(site.pages[0].slug).not.toContain('%');
  });

  it('treats two encodings of the same slug as duplicates', () => {
    const { site, warnings } = normalizeSite(
      {
        pages: [
          { slug: '/A', meta: { title: 'First' } },
          { slug: '/%41', meta: { title: 'Second' } },
        ],
      },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages).toHaveLength(1);
    expect(site.pages[0].meta.title).toBe('First');
    expect(warnings.join(' ')).toContain('/A');
  });

  it('falls back to stripping % for a double-encoded slug that would re-decode further', () => {
    const { site } = normalizeSite(
      { pages: [{ slug: '/%2541' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].slug).toBe('/2541');
    expect(site.pages[0].slug).not.toMatch(/%[0-9a-fA-F]{2}/);
  });

  it('falls back to stripping % for a triple-encoded slug no matter how deep the nesting', () => {
    const { site } = normalizeSite(
      { pages: [{ slug: '/%252541' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].slug).toBe('/252541');
    expect(site.pages[0].slug).not.toMatch(/%[0-9a-fA-F]{2}/);
  });
});

// Finding C1: normalizeSlug used to only collapse/trim slashes on the slug as a single string,
// so it never inspected segment *content* — a traversal token, a backslash, a raw control
// character, an over-long segment, or a segment that collides with the "index.html" Astro
// itself writes all passed straight through unexamined. These crashed real builds (verified in
// tests/render.test.mjs, which exercises the actual Astro path resolution); the tests below
// pin down the pure normalizeSlug behaviour that the fix relies on.
describe('normalizeSlug hardening for hostile content (C1)', () => {
  it('drops "." and ".." segments instead of letting them escape the routing tree', () => {
    const { site } = normalizeSite(
      { pages: [{ slug: '/../../ESCAPED' }, { slug: '/./x' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages.map((p) => p.slug)).toEqual(['/ESCAPED', '/x']);
  });

  it('strips backslashes and control characters out of a slug segment', () => {
    const { site } = normalizeSite(
      { pages: [{ slug: '/a\\b' }, { slug: '/a\nb' }, { slug: '/a\tb' }] },
      { supportedBlocks: BLOCKS },
    );
    // All three sanitize down to the same value, so the last two are dropped as duplicates —
    // proof that the existing dedup logic runs on the sanitized result, not the raw one.
    expect(site.pages).toHaveLength(1);
    expect(site.pages[0].slug).toBe('/ab');
  });

  it('caps an oversized slug segment at 100 characters', () => {
    const { site } = normalizeSite(
      { pages: [{ slug: `/${'a'.repeat(300)}` }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].slug).toBe(`/${'a'.repeat(100)}`);
  });

  it('refuses a slug that would collide with the index.html Astro writes, falling back to page-N', () => {
    const { site, warnings } = normalizeSite(
      { pages: [{ slug: '/' }, { slug: '/index.html' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages.map((p) => p.slug)).toEqual(['/', '/page-1']);
    expect(warnings.join(' ')).toContain('/index.html');
  });

  it('leaves non-Latin slug characters such as Japanese untouched', () => {
    const { site } = normalizeSite(
      { pages: [{ slug: '/日本語' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].slug).toBe('/日本語');
  });
});

// Follow-up review: the C1 hardening above pinned exactly the six shapes the original finding
// named instead of the invariant behind them — it capped a segment but not the whole path,
// checked only the last segment for "index.html", and truncated with `.slice(0, 100)`, which
// counts UTF-16 code units rather than characters. These tests pin the invariant itself — "a
// normalized slug is always usable as a static route and a directory path" — rather than any one
// shape, so a fifth or sixth hostile input does not need a fifth or sixth special case.
describe('normalizeSlug establishes the invariant, not six special cases (final-fix-3)', () => {
  it('refuses "index.html" as the first of two segments, not only the last', () => {
    // This exact shape (index.html first) is the one the previous fix's last-segment-only check
    // missed: Astro's home page always writes a plain `index.html` FILE at the output root, so a
    // *first* segment named "index.html" collides with it just as surely as a last segment
    // collides with a sibling page's own file.
    const { site, warnings } = normalizeSite(
      { pages: [{ slug: '/' }, { slug: '/index.html/x' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages.map((p) => p.slug)).toEqual(['/', '/page-1']);
    expect(warnings.join(' ')).toContain('недопустим');
  });

  it('refuses "index.html" in a middle segment too', () => {
    const { site, warnings } = normalizeSite(
      { pages: [{ slug: '/' }, { slug: '/a/index.html/b' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages.map((p) => p.slug)).toEqual(['/', '/page-1']);
    expect(warnings.join(' ')).toContain('недопустим');
  });

  it('caps the whole path length, not just one segment, for a slug many segments deep', () => {
    const segment = 'a'.repeat(100);
    const deepSlug = `/${Array(12).fill(segment).join('/')}`; // 12 × 100 chars — the exact
    // shape that used to reach mkdir as ENAMETOOLONG even though each individual segment was
    // already under the old per-segment cap.
    const { site } = normalizeSite(
      { pages: [{ slug: deepSlug }] },
      { supportedBlocks: BLOCKS },
    );
    const slug = site.pages[0].slug;
    // 12 full segments would be 12 * 100 + 11 separators = 1211 characters; a real cap keeps
    // this far short of that regardless of the exact number chosen.
    expect(slug.length).toBeLessThan(300);
    // Whole segments are dropped, never sliced mid-segment: what survives starts with the first
    // complete 100-character segment untouched.
    expect(slug.startsWith(`/${segment}`)).toBe(true);
  });

  it('truncates a segment by character, not by UTF-16 code unit, at an astral boundary', () => {
    // 99 ASCII characters + one astral emoji (a surrogate pair) is exactly 100 *characters* but
    // 101 UTF-16 code units. `.slice(0, 100)` — the previous fix's approach — cuts after the
    // 100th code unit, landing inside the surrogate pair and leaving a lone high surrogate that
    // later throws "URI malformed". A character-aware cap must keep the emoji whole.
    const segment = `${'x'.repeat(99)}😀`;
    const { site } = normalizeSite(
      { pages: [{ slug: `/${segment}` }] },
      { supportedBlocks: BLOCKS },
    );
    // Exact equality already proves the emoji survived as one whole, unsplit character — a
    // split would leave a lone surrogate behind and change this string.
    expect(site.pages[0].slug).toBe(`/${segment}`);
  });

  it('drops an astral character entirely, never split, once it falls past the cap', () => {
    const segment = `${'x'.repeat(100)}😀`; // 101 characters — one past the cap
    const { site } = normalizeSite(
      { pages: [{ slug: `/${segment}` }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].slug).toBe(`/${'x'.repeat(100)}`);
    expect(site.pages[0].slug).not.toMatch(/[\uD800-\uDFFF]/);
  });

  it('removes an unpaired surrogate from valid JSON content instead of letting it through', () => {
    // JSON.parse('"a\\ud800b"') is valid JSON and produces a JS string containing a lone,
    // unpaired surrogate — nothing in the JSON spec forbids it. That surrogate has no UTF-8
    // representation, so it must be stripped like any other unusable character rather than
    // carried into a route param that later throws "URI malformed".
    const raw = JSON.parse('{"slug": "/a\\ud800b"}').slug;
    const { site } = normalizeSite({ pages: [{ slug: raw }] }, { supportedBlocks: BLOCKS });
    expect(site.pages[0].slug).toBe('/ab');
    expect(site.pages[0].slug).not.toMatch(/[\uD800-\uDFFF]/);
  });

  it('keeps the home page at "/" only when the slug is genuinely "/" or empty', () => {
    const { site, warnings } = normalizeSite(
      { pages: [{ slug: '/' }, { slug: '///' }, { slug: '..' }, { slug: '/./' }, { slug: '/\\' }] },
      { supportedBlocks: BLOCKS },
    );
    // None of the four garbage slugs are a spelling of the root, so none of them may silently
    // collapse onto it — every one gets its own page-N fallback instead, and each is distinct
    // (the review's data-loss case: four different unusable slugs must not all collide).
    const slugs = site.pages.map((p) => p.slug);
    expect(slugs[0]).toBe('/');
    expect(new Set(slugs).size).toBe(5);
    for (const slug of slugs.slice(1)) {
      expect(slug).toMatch(/^\/page-\d+$/);
    }
    // Every fallback is reported as an invalid slug, never as a duplicate of the home page.
    expect(warnings.filter((w) => w.includes('недопустим'))).toHaveLength(4);
    expect(warnings.some((w) => w.includes('дубликат'))).toBe(false);
  });

  it('still keeps a genuinely empty or "/" slug as the home page, not a page-N fallback', () => {
    const { site, warnings } = normalizeSite(
      { pages: [{ slug: '' }, { slug: '/about' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].slug).toBe('/');
    expect(warnings.some((w) => w.includes('недопустим') || w.includes('page-0'))).toBe(false);
  });

  it('picks a fallback that does not collide with a real slug elsewhere in the file, in either order', () => {
    // Naively numbering fallbacks by array position alone can produce a string ("page-1") that a
    // different page in the same file already uses as its real, content-given slug. When that
    // happens the invalid page's content used to be silently dropped as a "duplicate" of the
    // real page — data loss reported as the wrong kind of warning.
    const orderA = normalizeSite(
      { pages: [{ slug: '/index.html' }, { slug: '/page-1' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(orderA.site.pages).toHaveLength(2);
    expect(new Set(orderA.site.pages.map((p) => p.slug)).size).toBe(2);
    expect(orderA.site.pages.map((p) => p.slug)).toContain('/page-1');

    const orderB = normalizeSite(
      { pages: [{ slug: '/page-1' }, { slug: '/index.html' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(orderB.site.pages).toHaveLength(2);
    expect(new Set(orderB.site.pages.map((p) => p.slug)).size).toBe(2);
    expect(orderB.site.pages.map((p) => p.slug)).toContain('/page-1');
    // The invalid page must be reported as invalid, never folded into a "duplicate slug" warning
    // that blames the wrong page for the collision.
    expect(orderB.warnings.some((w) => w.includes('недопустим'))).toBe(true);
    expect(orderB.warnings.some((w) => w.includes('дубликат'))).toBe(false);
  });
});

// final-fix-4: three more review rounds found the same pattern — each fix generalized one
// dimension of the slug invariant and left another as a list. The previous round (above) made
// the *character* rules (control bytes, length, index.html) a real invariant; these findings
// close the same gap for *names* (C1), for what counts as "genuinely the root" (M1), for the
// synthesized default a missing slug gets (M2), for how duplicates are detected (M3), and for
// what "long enough to cap" actually means on a real filesystem (m1/m2).
describe('final-fix-4: reserved names are a set, not one string (C1)', () => {
  it('refuses a slug that would collide with sitemap.xml, falling back to page-N', () => {
    const { site, warnings } = normalizeSite(
      { pages: [{ slug: '/' }, { slug: '/sitemap.xml/deep' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages.map((p) => p.slug)).toEqual(['/', '/page-1']);
    expect(warnings.join(' ')).toContain('sitemap.xml');
  });

  it('refuses "robots.txt" as a middle segment, case-insensitively', () => {
    // Astro's own endpoint route only ever writes the lowercase `robots.txt`, but a
    // case-insensitive filesystem (macOS's default APFS) treats "ROBOTS.TXT" as the exact same
    // path — the collision is real regardless of the casing a content author typed.
    const { site, warnings } = normalizeSite(
      { pages: [{ slug: '/' }, { slug: '/a/ROBOTS.TXT/b' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages.map((p) => p.slug)).toEqual(['/', '/page-1']);
    expect(warnings.join(' ')).toContain('недопустим');
  });

  it('refuses an exact single-segment sitemap.xml or robots.txt slug instead of letting the endpoint route swallow it silently', () => {
    // Before this fix, `/sitemap.xml` and `/robots.txt` did not crash the build — Astro's own
    // literal endpoint route for that exact path wins over the catch-all's generated page, so
    // the content page simply vanished from the output with no warning at all.
    const { site, warnings } = normalizeSite(
      { pages: [{ slug: '/' }, { slug: '/sitemap.xml' }, { slug: '/robots.txt' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages.map((p) => p.slug)).toEqual(['/', '/page-1', '/page-2']);
    expect(warnings.filter((w) => w.includes('недопустим'))).toHaveLength(2);
  });
});

describe('final-fix-4: only an actual "/" or absent slug may claim the root (M1)', () => {
  it('does not let a percent-only slug that decodes to nothing hijack the real home page', () => {
    // Reproduces the exact finding: a garbage "%" slug used to reduce to "" during decoding and
    // silently pass the (buggy) "genuinely the root" check, stealing index.html from the page
    // that actually asked for "/" — which was then dropped as a "duplicate" of it.
    const { site, warnings } = normalizeSite(
      {
        pages: [
          { slug: '%', meta: { title: 'GARBAGE' } },
          { slug: '/', meta: { title: 'REAL-HOME' } },
        ],
      },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages).toHaveLength(2);
    const home = site.pages.find((p) => p.slug === '/');
    expect(home).toBeTruthy();
    expect(home.meta.title).toBe('REAL-HOME');
    const garbage = site.pages.find((p) => p.meta.title === 'GARBAGE');
    expect(garbage).toBeTruthy();
    expect(garbage.slug).toMatch(/^\/page-\d+$/);
    expect(warnings.some((w) => w.includes('недопустим'))).toBe(true);
    expect(warnings.some((w) => w.includes('дубликат'))).toBe(false);
  });

  it('treats "/%" and "%%%" the same way — reducing to nothing is not a spelling of the root', () => {
    const { site, warnings } = normalizeSite(
      {
        pages: [
          { slug: '/', meta: { title: 'REAL-HOME' } },
          { slug: '/%', meta: { title: 'A' } },
          { slug: '%%%', meta: { title: 'B' } },
        ],
      },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages).toHaveLength(3);
    expect(site.pages[0].slug).toBe('/');
    expect(new Set(site.pages.map((p) => p.slug)).size).toBe(3);
    expect(warnings.filter((w) => w.includes('недопустим'))).toHaveLength(2);
    expect(warnings.some((w) => w.includes('дубликат'))).toBe(false);
  });
});

describe('final-fix-4: a missing slug\'s generated default is reserved like any other fallback (M2)', () => {
  it('does not let a blank slug\'s "page-N" placeholder steal a slug another page really asked for', () => {
    const { site, warnings } = normalizeSite(
      {
        pages: [
          { slug: '/', meta: { title: 'Home' } },
          { slug: '', meta: { title: 'Blank' } },
          { slug: '/page-1', meta: { title: 'RealPageOne' } },
        ],
      },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages).toHaveLength(3);
    expect(new Set(site.pages.map((p) => p.slug)).size).toBe(3);

    const realPageOne = site.pages.find((p) => p.meta.title === 'RealPageOne');
    expect(realPageOne.slug).toBe('/page-1');
    const blank = site.pages.find((p) => p.meta.title === 'Blank');
    expect(blank.slug).not.toBe('/page-1');

    // A page with no slug at all is not a content error — it must not be reported the way
    // garbage, unusable slug text is.
    expect(warnings.some((w) => w.includes('недопустим'))).toBe(false);
    expect(warnings.some((w) => w.includes('дубликат'))).toBe(false);
  });
});

describe('final-fix-4: duplicate slugs are detected case-insensitively (M3)', () => {
  it('collapses /about, /About and /ABOUT into one survivor, warning for each dropped case', () => {
    const { site, warnings } = normalizeSite(
      {
        pages: [
          { slug: '/about', meta: { title: 'First' } },
          { slug: '/About', meta: { title: 'Second' } },
          { slug: '/ABOUT', meta: { title: 'Third' } },
        ],
      },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages).toHaveLength(1);
    // The survivor keeps its own original casing rather than being forced to lower case.
    expect(site.pages[0].slug).toBe('/about');
    expect(site.pages[0].meta.title).toBe('First');
    expect(warnings.filter((w) => w.includes('дубликат'))).toHaveLength(2);
  });
});

describe('final-fix-4: a slug segment is also capped by UTF-8 byte length (m1)', () => {
  it('caps a 100-code-point CJK segment at 255 bytes, not just 100 characters', () => {
    const segment = '日'.repeat(100); // 100 code points (exactly at the character cap) but 300
    // UTF-8 bytes (3 bytes each) — comfortably under macOS's 255-*character* limit, but over a
    // 255-*byte* per-component limit that ext4 and most Linux filesystems enforce.
    const { site } = normalizeSite({ pages: [{ slug: `/${segment}` }] }, { supportedBlocks: BLOCKS });
    const resultSegment = site.pages[0].slug.slice(1);
    expect(resultSegment).toBe('日'.repeat(85)); // floor(255 / 3) = 85 whole characters = 255 bytes
    expect(Buffer.byteLength(resultSegment, 'utf8')).toBe(255);
  });

  it('drops a trailing emoji whole rather than splitting its surrogate pair once the byte cap is hit', () => {
    const segment = '😀'.repeat(64); // 64 code points (well under the 100-character cap) but
    // 256 UTF-8 bytes (4 bytes each) — one byte over the cap.
    const { site } = normalizeSite({ pages: [{ slug: `/${segment}` }] }, { supportedBlocks: BLOCKS });
    const resultSegment = site.pages[0].slug.slice(1);
    expect(resultSegment).toBe('😀'.repeat(63));
    expect(Buffer.byteLength(resultSegment, 'utf8')).toBe(252);
    // 63 emoji × 2 UTF-16 units each = an even length; a mid-character split would leave a lone
    // surrogate behind and produce an odd one instead.
    expect(resultSegment.length).toBe(126);
  });
});

describe('final-fix-4: the path-length cap counts the same unit as the segment cap (m2)', () => {
  it('keeps all three 60-emoji segments instead of dropping the last two to a UTF-16-unit overcount', () => {
    // Each segment is 60 code points (well under the 100 cap) and 120 UTF-16 units. Counted in
    // code points the whole path is 60+1+60+1+60 = 182, under the 200-character path cap, so all
    // three must survive. The old `.length`-based count (UTF-16 units) would put the running
    // total over 200 while still inside the second segment, silently dropping the third.
    const segment = '😀'.repeat(60);
    const deepSlug = `/${segment}/${segment}/${segment}`;
    const { site } = normalizeSite({ pages: [{ slug: deepSlug }] }, { supportedBlocks: BLOCKS });
    const segments = site.pages[0].slug.slice(1).split('/');
    expect(segments).toHaveLength(3);
    for (const s of segments) {
      expect([...s]).toHaveLength(60);
    }
  });
});

// final-fix-5: four rounds of generalizing one predictive dimension at a time (character rules,
// then names, then case folding) still left a gap no amount of listing closes — a rejected code
// point, a public asset one level down, a fallback numbering scheme that disagreed with the
// dedupe check about case, and a filesystem that folds more than `.toLowerCase()` does. The way
// out is to stop predicting: normalizeSite now accepts an optional `options.prober`, a
// `(segments) => boolean` function that PROVES a slug's directory can be created instead of
// guessing — src/lib/slug-prober.mjs supplies a real one (see tests/slug-prober.test.mjs and the
// real-`astro build` property test in tests/render.test.mjs); these tests pin the two-phase
// resolution algorithm itself with a fast, in-memory fake so the ordering logic is checked
// without touching a real filesystem. Calling normalizeSite with no `prober` at all — every test
// above this one in this file — must keep behaving exactly as it does today; that is the entire
// point of making it optional rather than replacing the old path outright.
describe('final-fix-5: normalizeSite proves a slug against a prober instead of predicting it', () => {
  // A minimal stand-in for the real tryClaim: tracks claimed paths in memory and, when
  // `foldCase` is set, folds them the way a case-insensitive filesystem (APFS) would — just
  // enough to exercise the *ordering* logic. `refuse` lets a test force a specific claim to fail
  // outright, standing in for an OS-level refusal (a bad code point, a reserved file).
  function fakeProber({ foldCase = false, refuse = () => false } = {}) {
    const claimed = new Set();
    return (segments) => {
      const path = segments.join('/');
      if (refuse(path)) return false;
      const key = foldCase ? path.toLowerCase() : path;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    };
  }

  it('claims every ordinary slug in order and reports no warnings', () => {
    const { site, warnings } = normalizeSite(
      { pages: [{ slug: '/' }, { slug: '/about' }, { slug: '/contact' }] },
      { supportedBlocks: BLOCKS, prober: fakeProber() },
    );
    expect(site.pages.map((p) => p.slug)).toEqual(['/', '/about', '/contact']);
    expect(warnings).toHaveLength(0);
  });

  it('lets a real, explicit slug win over an earlier-processed placeholder fallback (finding 4)', () => {
    // The exact repro: a page with no slug at all sits BEFORE the page that genuinely asked for
    // "/Page-1". A prober that folds case (as APFS does) must still let the real page keep its
    // own name — the placeholder is the one bumped to a different number, regardless of array
    // order, unlike the pure path's case-sensitive `reserved` Set (see resolvePageSlugs above).
    const { site, warnings } = normalizeSite(
      {
        pages: [
          { slug: '/', meta: { title: 'Home' } },
          { meta: { title: 'Blank' } },
          { slug: '/Page-1', meta: { title: 'RealPageOne' } },
        ],
      },
      { supportedBlocks: BLOCKS, prober: fakeProber({ foldCase: true }) },
    );
    expect(site.pages).toHaveLength(3);
    expect(new Set(site.pages.map((p) => p.slug)).size).toBe(3);

    const real = site.pages.find((p) => p.meta.title === 'RealPageOne');
    expect(real.slug).toBe('/Page-1');
    const blank = site.pages.find((p) => p.meta.title === 'Blank');
    expect(blank.slug.toLowerCase()).not.toBe('/page-1');
    // The blank page never asked for anything, so it is not a content error — same rule as the
    // pure path (M2 above).
    expect(warnings.some((w) => w.includes('недопустим'))).toBe(false);
  });

  it('says a slug is taken, not invalid, when another page already claimed it', () => {
    // The two faults are fixed differently: one is a bad value, the other is two pages declaring
    // the same good value. Calling the second "недопустим" sends the reader hunting in the wrong
    // place — the case that actually happened when a site's second page kept slug "/".
    const { warnings } = normalizeSite(
      { pages: [{ slug: '/' }, { slug: '/' }] },
      { supportedBlocks: BLOCKS, prober: fakeProber() },
    );
    const text = warnings.join(' ');
    expect(text).toMatch(/занят/);
    expect(text).not.toMatch(/недопустим/);
  });

  it('falls back to page-N and warns "invalid", never "duplicate", when a claim fails', () => {
    const { site, warnings } = normalizeSite(
      {
        pages: [
          { slug: '/', meta: { title: 'Home' } },
          { slug: '/about', meta: { title: 'First' } },
          { slug: '/about', meta: { title: 'Second' } },
        ],
      },
      { supportedBlocks: BLOCKS, prober: fakeProber() },
    );
    // Unlike the pure (no-prober) path, a claim failure is never a silent drop: the page is
    // still built, just under the next name the prober actually grants.
    expect(site.pages).toHaveLength(3);
    const second = site.pages.find((p) => p.meta.title === 'Second');
    expect(second.slug).not.toBe('/about');
    // The page must be reported, and the wording must not be the one the dropping path used:
    // "дубликат слага — страница пропущена" would tell the reader their page is gone when it is
    // not. Which of the two surviving wordings appears (taken vs invalid) depends on whether the
    // collision was provable, and is asserted separately.
    expect(warnings.some((w) => w.includes('/about'))).toBe(true);
    expect(warnings.some((w) => w.includes('пропущена'))).toBe(false);
  });

  it('keeps two slugs distinct when the prober does not fold them, even though JS toLowerCase would', () => {
    // Regression guard for the opposite mistake: with a prober present, the OLD case-folded
    // seenSlugs dedupe inside normalizeSite must not also run, or it would drop a page the
    // filesystem itself was perfectly happy to keep (Turkish İ/ı, fullwidth forms all behave
    // this way on real APFS — see tests/slug-prober.test.mjs) even though nothing here collided.
    const { site, warnings } = normalizeSite(
      {
        pages: [
          { slug: '/', meta: { title: 'Home' } },
          { slug: '/About', meta: { title: 'Upper' } },
          { slug: '/about', meta: { title: 'Lower' } },
        ],
      },
      { supportedBlocks: BLOCKS, prober: fakeProber({ foldCase: false }) },
    );
    expect(site.pages).toHaveLength(3);
    expect(site.pages.map((p) => p.slug)).toEqual(['/', '/About', '/about']);
    expect(warnings).toHaveLength(0);
  });

  it('retries past an already-claimed page-N fallback until it finds one the prober grants', () => {
    const { site, warnings } = normalizeSite(
      { pages: [{ slug: '/' }, { slug: '/index.html' }] },
      { supportedBlocks: BLOCKS, prober: fakeProber({ refuse: (p) => p === 'page-1' }) },
    );
    expect(site.pages.map((p) => p.slug)).toEqual(['/', '/page-2']);
    expect(warnings.join(' ')).toContain('/index.html');
  });

  it('still runs the old predictive path when no prober is given at all', () => {
    // Same content as the "invalid, never duplicate" test above, but with no prober option at
    // all — must reproduce today's pure behaviour exactly: the second page is dropped outright,
    // not given a fallback, and reported as a duplicate.
    const { site, warnings } = normalizeSite(
      {
        pages: [
          { slug: '/about', meta: { title: 'First' } },
          { slug: '/about', meta: { title: 'Second' } },
        ],
      },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages).toHaveLength(1);
    expect(warnings.join(' ')).toContain('дубликат');
  });
});

// A site folder's site.json carries nav, headerButton, footer and brand.tagline as shared
// settings alongside everything else. They must reach `site` the same way everything else in this
// module does: coerced defensively, never throwing — a site.json that leaves these fields unset
// (or a site with no site.json at all) gets the defaults below.
describe('normalizeSite: shared settings for folder-based sites (nav, headerButton, footer, brand.tagline)', () => {
  it('defaults nav, headerButton, footer and brand.tagline when absent', () => {
    const { site, warnings } = normalizeSite(
      { pages: [{ slug: '/' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.nav).toEqual([]);
    expect(site.headerButton).toEqual({ label: '', href: '' });
    expect(site.footer).toEqual({
      ageWarning: '',
      ageText: '',
      quickLinksTitle: '',
      paymentsTitle: '',
      payments: [],
      copyright: '',
    });
    expect(site.brand.tagline).toBe('');
    expect(warnings).toHaveLength(0);
  });

  it('carries a well-formed nav, headerButton, footer and tagline through onto site', () => {
    const { site, warnings } = normalizeSite(
      {
        brand: { name: 'Acme', tagline: 'Acme does it all' },
        pages: [{ slug: '/' }],
        nav: [
          { label: 'Casino', href: '/casino' },
          { label: 'Slots', href: '/slots' },
        ],
        headerButton: { label: 'Download', href: '/app.apk' },
        footer: {
          ageWarning: '18+',
          ageText: 'Must be an adult.',
          quickLinksTitle: 'Quick links',
          paymentsTitle: 'Payments',
          payments: ['bKash', 'Nagad'],
          copyright: '© Acme',
        },
      },
      { supportedBlocks: BLOCKS },
    );
    expect(site.brand.tagline).toBe('Acme does it all');
    expect(site.nav).toEqual([
      { label: 'Casino', href: '/casino' },
      { label: 'Slots', href: '/slots' },
    ]);
    expect(site.headerButton).toEqual({ label: 'Download', href: '/app.apk' });
    expect(site.footer).toEqual({
      ageWarning: '18+',
      ageText: 'Must be an adult.',
      quickLinksTitle: 'Quick links',
      paymentsTitle: 'Payments',
      payments: ['bKash', 'Nagad'],
      copyright: '© Acme',
    });
    expect(warnings).toHaveLength(0);
  });

  it('does not throw when nav is a string, and warns instead', () => {
    const { site, warnings } = normalizeSite({ nav: 'oops' }, { supportedBlocks: BLOCKS });
    expect(site.nav).toEqual([]);
    expect(warnings.join(' ')).toContain('«nav»');
  });

  it('drops a nav item that is not an object instead of throwing', () => {
    const { site, warnings } = normalizeSite(
      { nav: [{ label: 'Real', href: '/real' }, 'garbage', 42] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.nav).toEqual([{ label: 'Real', href: '/real' }]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('defaults a nav item missing a label instead of throwing', () => {
    const { site } = normalizeSite({ nav: [{ href: '/only-href' }] }, { supportedBlocks: BLOCKS });
    expect(site.nav).toEqual([{ label: '', href: '/only-href' }]);
  });

  it('does not throw when headerButton is not an object, and warns instead', () => {
    const { site, warnings } = normalizeSite({ headerButton: 'oops' }, { supportedBlocks: BLOCKS });
    expect(site.headerButton).toEqual({ label: '', href: '' });
    expect(warnings.join(' ')).toContain('«headerButton»');
  });

  it('does not throw when footer is not an object, and warns instead', () => {
    const { site, warnings } = normalizeSite({ footer: 'oops' }, { supportedBlocks: BLOCKS });
    expect(site.footer).toEqual({
      ageWarning: '',
      ageText: '',
      quickLinksTitle: '',
      paymentsTitle: '',
      payments: [],
      copyright: '',
    });
    expect(warnings.join(' ')).toContain('«footer»');
  });

  it('drops non-string and blank entries from footer.payments', () => {
    const { site } = normalizeSite(
      { footer: { payments: ['bKash', 42, null, '  Nagad  ', '   '] } },
      { supportedBlocks: BLOCKS },
    );
    expect(site.footer.payments).toEqual(['bKash', 'Nagad']);
  });
});
