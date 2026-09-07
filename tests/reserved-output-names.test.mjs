import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildSite } from './helpers/build.mjs';
import { RESERVED_ROOT_OUTPUT_NAMES } from '../src/lib/reserved-output-names.mjs';

// Finding C1: the reserved-segment rule in normalize.mjs used to name exactly one file
// ("index.html") while the engine's build unconditionally writes THREE files at the root of
// output/<domain>/ (index.html, sitemap.xml, robots.txt) — nothing tied the rule to what the
// engine actually emits, so the two were free to drift, and did.
//
// This test is the actual fix, not the two extra names RESERVED_ROOT_OUTPUT_NAMES now carries:
// it builds a real site and looks at what Astro genuinely put at the root of the output
// directory, then demands every one of those names already be accounted for in the shared
// reserved-names module. Add a fourth root-level endpoint later (say, `src/pages/ads.txt.js`)
// without updating RESERVED_ROOT_OUTPUT_NAMES and this test fails — that failure is the
// trip-wire that makes the omission impossible to miss, which is the whole point.
describe('the reserved root-output-name set matches what a real build actually writes (C1)', () => {
  it('accounts for every file sitting at the root of a built site, not inside a page directory', () => {
    const { outDir } = buildSite({
      template: 't1',
      scheme: 'blue',
      outDir: join('output', 'test-reserved-root-names'),
    });

    const rootFiles = readdirSync(outDir).filter((name) => statSync(join(outDir, name)).isFile());

    // Sanity check that this build actually produced the root-level files the rest of this test
    // assumes — otherwise the loop below would vacuously pass over an empty list.
    expect(rootFiles.length).toBeGreaterThan(0);
    expect(rootFiles).toContain('index.html');
    expect(rootFiles).toContain('sitemap.xml');
    expect(rootFiles).toContain('robots.txt');

    const reserved = new Set(RESERVED_ROOT_OUTPUT_NAMES.map((name) => name.toLowerCase()));
    for (const file of rootFiles) {
      expect(
        reserved.has(file.toLowerCase()),
        `"${file}" is written at the output root by a real build but is missing from ` +
          'RESERVED_ROOT_OUTPUT_NAMES in src/lib/reserved-output-names.mjs',
      ).toBe(true);
    }
  });
});
