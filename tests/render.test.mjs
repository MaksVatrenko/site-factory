import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, readOutput } from './helpers/build.mjs';

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
