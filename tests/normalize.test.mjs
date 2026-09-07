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
