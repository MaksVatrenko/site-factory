import { describe, it, expect, beforeAll } from 'vitest';
import { buildSite, readOutput } from './helpers/build.mjs';

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
