import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
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
    expect(readOutput(outDir)).not.toMatch(/<script[^>]*\ssrc=/i);
  });

  it('survives a broken content file', () => {
    const broken = buildSite({ example: 'broken', outDir: join('output', 'test-broken') });
    expect(existsSync(join(broken.outDir, 'sloppy', 'index.html'))).toBe(true);
    expect(broken.log).toContain('carousel');
  });
});
