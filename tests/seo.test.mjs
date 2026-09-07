import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildSite, readOutput } from './helpers/build.mjs';

function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function writeTempSiteJson(content) {
  const file = join(tmpdir(), `site-factory-${randomUUID()}.json`);
  writeFileSync(file, JSON.stringify(content));
  return file;
}

describe('SEO artefacts', () => {
  let outDir;

  beforeAll(() => {
    outDir = buildSite({
      template: 't1',
      scheme: 'blue',
      outDir: 'output/test-seo',
      env: {},
    }).outDir;
  });

  it('lists every page in the sitemap', () => {
    const xml = readOutput(outDir, 'sitemap.xml');
    expect(xml).toContain('<urlset');
    expect(xml).toContain('https://example.com/');
    expect(xml).toContain('https://example.com/about');
  });

  it('points robots.txt at the sitemap', () => {
    const txt = readOutput(outDir, 'robots.txt');
    expect(txt).toContain('User-agent: *');
    expect(txt).toContain('Allow: /');
    expect(txt).toContain('Sitemap: https://example.com/sitemap.xml');
  });

  it('sets a canonical link on every page', () => {
    expect(readOutput(outDir)).toContain(
      '<link rel="canonical" href="https://example.com/"',
    );
    expect(readOutput(outDir, 'about/index.html')).toContain(
      '<link rel="canonical" href="https://example.com/about"',
    );
  });

  it('writes the geo meta tag only when geo is set', () => {
    expect(readOutput(outDir)).not.toContain('geo.region');

    const withGeo = buildSite({
      template: 't1',
      scheme: 'blue',
      outDir: 'output/test-seo-geo',
      env: { GEO: 'ID' },
    });
    expect(readOutput(withGeo.outDir)).toContain('name="geo.region" content="ID"');
  });
});

describe('SEO artefacts with hostile slugs', () => {
  let outDir;
  const pages = [
    { slug: '/', title: 'Home' },
    { slug: '/a&b', title: 'Q&A' },
    { slug: '/tag<b>end', title: 'Tag' },
    { slug: '/café', title: 'Cafe' },
  ];

  beforeAll(() => {
    const file = writeTempSiteJson({
      domain: 'example.com',
      locale: 'en-US',
      brand: { name: 'Hostile' },
      pages: pages.map(({ slug, title }) => ({ slug, meta: { title }, blocks: [] })),
    });
    try {
      outDir = buildSite({
        template: 't1',
        scheme: 'blue',
        outDir: 'output/test-seo-hostile',
        env: { SITE_JSON: file },
      }).outDir;
    } finally {
      rmSync(file, { force: true });
    }
  });

  it('escapes sitemap loc values so no unescaped & or raw <> remain', () => {
    const xml = readOutput(outDir, 'sitemap.xml');
    const locs = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((match) => match[1]);
    expect(locs).toHaveLength(pages.length);
    for (const loc of locs) {
      expect(loc).not.toMatch(/[<>]/);
      expect(loc).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/);
    }
  });

  it('keeps every canonical href identical to its sitemap loc once decoded', () => {
    const xml = readOutput(outDir, 'sitemap.xml');
    const locs = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((match) =>
      decodeXmlEntities(match[1]),
    );

    pages.forEach((page, index) => {
      const htmlFile = page.slug === '/' ? 'index.html' : `${page.slug.slice(1)}/index.html`;
      const html = readOutput(outDir, htmlFile);
      const match = html.match(/<link rel="canonical" href="([^"]*)"/);
      expect(match).not.toBeNull();
      expect(decodeXmlEntities(match[1])).toBe(locs[index]);
    });
  });
});

describe('SEO artefacts with an unset SITE_URL', () => {
  let outDir;
  const domain = 'mysite.org';

  beforeAll(() => {
    const file = writeTempSiteJson({
      domain,
      locale: 'en-US',
      brand: { name: 'Fallback' },
      pages: [
        { slug: '/', meta: { title: 'Home' }, blocks: [] },
        { slug: '/about', meta: { title: 'About' }, blocks: [] },
      ],
    });
    try {
      outDir = buildSite({
        template: 't1',
        scheme: 'blue',
        outDir: 'output/test-seo-domain-fallback',
        env: { SITE_JSON: file, SITE_URL: '' },
      }).outDir;
    } finally {
      rmSync(file, { force: true });
    }
  });

  it('points the sitemap and robots.txt at the content domain', () => {
    const xml = readOutput(outDir, 'sitemap.xml');
    expect(xml).toContain(`https://${domain}/`);
    expect(xml).toContain(`https://${domain}/about`);
    expect(xml).not.toContain('example.com');

    const txt = readOutput(outDir, 'robots.txt');
    expect(txt).toContain(`Sitemap: https://${domain}/sitemap.xml`);
    expect(txt).not.toContain('example.com');
  });

  it('sets canonical links to the content domain', () => {
    expect(readOutput(outDir)).toContain(`<link rel="canonical" href="https://${domain}/"`);
    expect(readOutput(outDir, 'about/index.html')).toContain(
      `<link rel="canonical" href="https://${domain}/about"`,
    );
  });
});

describe('SEO artefacts with a scheme-only domain and no SITE_URL', () => {
  let outDir;

  beforeAll(() => {
    const file = writeTempSiteJson({
      domain: 'https://',
      locale: 'en-US',
      brand: { name: 'SchemeOnly' },
      pages: [{ slug: '/', meta: { title: 'Home' }, blocks: [] }],
    });
    try {
      outDir = buildSite({
        template: 't1',
        scheme: 'blue',
        outDir: 'output/test-seo-scheme-only-domain',
        env: { SITE_JSON: file, SITE_URL: '' },
      }).outDir;
    } finally {
      rmSync(file, { force: true });
    }
  });

  it('still builds the home page instead of crashing', () => {
    expect(existsSync(join(outDir, 'index.html'))).toBe(true);
  });

  it('still produces a sitemap', () => {
    const xml = readOutput(outDir, 'sitemap.xml');
    expect(xml).toContain('<urlset');
    expect(xml).toContain('<loc>');
  });
});
