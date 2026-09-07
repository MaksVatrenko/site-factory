import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOutputProber } from '../src/lib/slug-prober.mjs';

// These drive createOutputProber directly, against a real (scratch) filesystem, so each proof
// mechanism (mkdir + an exclusive marker-file write) is pinned in isolation and fast, before the
// much larger real-`astro build` property test in tests/render.test.mjs exercises the same
// mechanism end to end through normalizeSite.

const scratchDirs = [];
function tempOutDir() {
  const dir = mkdtempSync(join(tmpdir(), 'site-factory-prober-outdir-'));
  scratchDirs.push(dir);
  return join(dir, 'output', 'somesite.com');
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    rmSync(scratchDirs.pop(), { recursive: true, force: true });
  }
});

describe('createOutputProber', () => {
  it('claims a fresh slug the first time and refuses the exact same slug the second time', () => {
    const prober = createOutputProber({ outDir: tempOutDir() });
    expect(prober).not.toBeNull();
    expect(prober.tryClaim(['about'])).toBe(true);
    expect(prober.tryClaim(['about'])).toBe(false);
    prober.cleanup();
  });

  it('claims the site root (empty segments) even though index.html is a reserved name', () => {
    // The home page's slug "/" must always be claimable — it IS the page that legitimately
    // produces the output root's index.html, not a collision with it.
    const prober = createOutputProber({ outDir: tempOutDir() });
    expect(prober.tryClaim([])).toBe(true);
    prober.cleanup();
  });

  it('refuses a slug matching a reserved engine root file other than index.html', () => {
    const prober = createOutputProber({ outDir: tempOutDir() });
    expect(prober.tryClaim(['sitemap.xml'])).toBe(false);
    expect(prober.tryClaim(['robots.txt'])).toBe(false);
    // An ordinary name is unaffected.
    expect(prober.tryClaim(['sitemap-page'])).toBe(true);
    prober.cleanup();
  });

  it('mirrors the publicDir tree and refuses a slug colliding with a nested public asset', () => {
    const publicDir = mkdtempSync(join(tmpdir(), 'site-factory-prober-public-'));
    scratchDirs.push(publicDir);
    mkdirSync(join(publicDir, 'images'), { recursive: true });
    writeFileSync(join(publicDir, 'images', 'logo.svg'), '<svg/>');
    writeFileSync(join(publicDir, '.gitkeep'), '');

    const prober = createOutputProber({ outDir: tempOutDir(), publicDir });
    expect(prober.tryClaim(['images', 'logo.svg'])).toBe(false);
    expect(prober.tryClaim(['.gitkeep'])).toBe(false);
    // A sibling path under the same mirrored directory is unaffected — this is not a
    // root-name problem, only the exact colliding path is refused.
    expect(prober.tryClaim(['images', 'other-page'])).toBe(true);
    prober.cleanup();
  });

  it('refuses a code point real mkdir rejects (ENOENT on APFS)', () => {
    const prober = createOutputProber({ outDir: tempOutDir() });
    // U+0378 is an unassigned Unicode code point; APFS's mkdir refuses it outright.
    expect(prober.tryClaim([`bad${String.fromCodePoint(0x0378)}name`])).toBe(false);
    prober.cleanup();
  });

  it('folds an NFC/NFD pair onto the same claim, the way APFS folds them', () => {
    const prober = createOutputProber({ outDir: tempOutDir() });
    const nfc = 'café'.normalize('NFC');
    const nfd = 'café'.normalize('NFD');
    expect(nfc).not.toBe(nfd); // different byte sequences going in
    expect(prober.tryClaim([nfc])).toBe(true);
    expect(prober.tryClaim([nfd])).toBe(false);
    prober.cleanup();
  });

  it('does not fold Turkish İ/ı or fullwidth forms, matching real APFS behaviour', () => {
    const prober = createOutputProber({ outDir: tempOutDir() });
    expect(prober.tryClaim(['i'])).toBe(true);
    expect(prober.tryClaim(['İ'])).toBe(true);
    expect(prober.tryClaim(['A'])).toBe(true);
    expect(prober.tryClaim(['Ａ'])).toBe(true);
    prober.cleanup();
  });

  it('cleanup removes the scratch directory entirely', () => {
    const prober = createOutputProber({ outDir: tempOutDir() });
    expect(existsSync(prober.root)).toBe(true);
    prober.cleanup();
    expect(existsSync(prober.root)).toBe(false);
  });

  it('returns null instead of throwing when the scratch directory cannot be prepared', () => {
    // Force failure deterministically: make the parent of the intended scratch location a
    // plain FILE, so mkdir-ing through it can only ever fail with ENOTDIR — no reliance on
    // chmod/permissions, which behave inconsistently across CI environments and platforms.
    const container = mkdtempSync(join(tmpdir(), 'site-factory-prober-blocked-'));
    scratchDirs.push(container);
    const blocker = join(container, 'blocker-file');
    writeFileSync(blocker, '');

    const prober = createOutputProber({ outDir: join(blocker, 'nested', 'output', 'site.com') });
    expect(prober).toBeNull();
  });
});
