import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('project skeleton', () => {
  it('runs on a Node version Astro 7 supports', () => {
    const [major, minor] = process.versions.node.split('.').map(Number);
    expect(major).toBeGreaterThanOrEqual(22);
    if (major === 22) expect(minor).toBeGreaterThanOrEqual(12);
    expect(major % 2).toBe(0);
  });

  it('declares the expected scripts', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(Object.keys(pkg.scripts)).toEqual(
      expect.arrayContaining(['dev', 'test', 'build:site', 'check:matrix']),
    );
    expect(pkg.type).toBe('module');
  });
});
