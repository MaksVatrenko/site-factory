import { describe, it, expect } from 'vitest';
import { normalizeSite } from '../src/lib/normalize.mjs';

const BLOCKS = ['hero', 'richtext', 'cards', 'columns', 'faq', 'footer'];

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

  it('falls back to the brand name for a missing title', () => {
    const { site } = normalizeSite(
      { brand: { name: 'Acme' }, pages: [{ slug: '/' }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].meta.title).toBe('Acme');
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
