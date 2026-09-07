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

  // Final-fix-6, F1: Astro stages `<outDir>/.prerender/` during every build and unconditionally
  // deletes it once every page is generated — a name the build occupies for the whole build, the
  // same way sitemap.xml and robots.txt are occupied from the start, even though `.prerender`
  // itself never survives into a finished build's output. Before this fix, nothing seeded that
  // name into the scratch tree, so a page slugged `/.prerender` was wrongly granted, built for
  // real, and then deleted out from under itself by Astro's own cleanup with no warning at all.
  it('refuses a slug matching Astro\'s own transient .prerender build directory, nested or not (final-fix-6, F1)', () => {
    const prober = createOutputProber({ outDir: tempOutDir() });
    expect(prober.tryClaim(['.prerender'])).toBe(false);
    expect(prober.tryClaim(['.prerender', 'deep'])).toBe(false);
    // The filesystem folds case the same way it does for the other reserved names (macOS/APFS).
    expect(prober.tryClaim(['.PRERENDER'])).toBe(false);
    // An ordinary name is unaffected.
    expect(prober.tryClaim(['prerender-notes'])).toBe(true);
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

  // Final-fix-6, F2: a content package can legitimately ship a public/ directory named exactly
  // like one of the engine's own reserved root files — Astro itself copies it in without
  // complaint (it just skips generating its own endpoint for that route instead). Before this
  // fix, createOutputProber seeded its reserved-name marker FILES before mirroring publicDir in,
  // so mirroring a same-named publicDir DIRECTORY second collided with the marker this module had
  // just written (cpSync -> ENOTDIR), and that exception took the ENTIRE prober down — not just
  // refused this one name — because the whole seed-then-mirror sequence shared one try/catch.
  it('does not disable the whole prober when a publicDir asset shares a reserved root name (final-fix-6, F2)', () => {
    const publicDir = mkdtempSync(join(tmpdir(), 'site-factory-prober-public-collision-'));
    scratchDirs.push(publicDir);
    mkdirSync(join(publicDir, 'sitemap.xml'), { recursive: true });
    writeFileSync(join(publicDir, 'sitemap.xml', 'note.txt'), 'not a real sitemap');

    const prober = createOutputProber({ outDir: tempOutDir(), publicDir });
    expect(prober).not.toBeNull();
    // The OTHER reserved names must still have been seeded — proof the one seed that lost to a
    // publicDir asset did not abort seeding of the rest, nor the prober as a whole.
    expect(prober.tryClaim(['robots.txt'])).toBe(false);
    expect(prober.tryClaim(['.prerender'])).toBe(false);
    // An ordinary page slug still works — the prober as a whole is still live.
    expect(prober.tryClaim(['about'])).toBe(true);
    // The publicDir asset itself made it into the scratch tree, exactly as a real build's own
    // publicDir copy would place it.
    expect(existsSync(join(prober.root, 'sitemap.xml', 'note.txt'))).toBe(true);
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
