import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadContext, resetContextCache } from '../src/lib/site-context.mjs';

// Final-fix-6, F4: buildProber (private to site-context.mjs) computes
// `resolve(root, process.env.OUT_DIR || './output/preview')`. It used to read
// `join(root, process.env.OUT_DIR)` instead — `path.join` has no special case for an
// already-absolute later argument the way `path.resolve` does, so joining the repo's own root
// with an ABSOLUTE OUT_DIR nested a copy of that entire absolute path inside the repo root itself
// (see final-fix-5's own report for the real incident this reproduces:
// "<repo>/Users/x/site-factory/output/<domain>", a real stray directory tree created by every
// real server build). Every OUT_DIR any other test in this suite passes is RELATIVE (see
// tests/helpers/build.mjs and scripts/check-matrix.mjs), so that bug left all pre-existing tests
// green while silently recreating this stray tree on every real `factory/server.mjs` build, where
// OUT_DIR is always absolute (built from that file's own absolute ROOT constant). This is the one
// place in the suite that calls loadContext with an absolute OUT_DIR, so a future regression back
// to `join` fails here instead of shipping unnoticed again.
describe('final-fix-6, F4: buildProber resolves an absolute OUT_DIR instead of nesting it under root', () => {
  const ENV_KEYS = [
    'SITE_DIR',
    'OUT_DIR',
    'TEMPLATE',
    'SCHEME',
    'PUBLIC_DIR',
    'BRAND',
    'LOCALE',
    'GEO',
    'DOMAIN',
    'PARTNER_URL',
  ];

  it('places the scratch tree next to the real output directory, with nothing stray created under root', () => {
    const repoRoot = process.cwd();
    const rootEntriesBefore = new Set(readdirSync(repoRoot));

    const contentDir = mkdtempSync(join(tmpdir(), 'site-factory-f4-content-'));
    const outParent = mkdtempSync(join(tmpdir(), 'site-factory-f4-outparent-'));
    // Deliberately ABSOLUTE — the one shape no other test in this suite exercises.
    const absoluteOutDir = join(outParent, 'output', 'somesite.com');

    writeFileSync(
      join(contentDir, 'site.json'),
      JSON.stringify({ domain: 'example.com', locale: 'en-US', brand: { name: 'F4' } }),
    );
    writeFileSync(
      join(contentDir, 'home.json'),
      JSON.stringify({ slug: '/', title: 'F4 Home', blocks: [] }),
    );

    const savedEnv = {};
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    Object.assign(process.env, {
      SITE_DIR: contentDir,
      OUT_DIR: absoluteOutDir,
      TEMPLATE: 'review',
      SCHEME: 'blue',
      PUBLIC_DIR: '',
      BRAND: '',
      LOCALE: '',
      GEO: '',
      DOMAIN: '',
      PARTNER_URL: '',
    });
    resetContextCache();

    try {
      const { site } = loadContext(repoRoot);
      // Sanity check that loadContext actually ran end to end (a thrown error before this point
      // would make every check below vacuous).
      expect(site.pages.length).toBeGreaterThan(0);

      // The scratch tree must be a SIBLING of the real, absolute output directory — inside its
      // parent, on the same volume — exactly as createOutputProber's own contract requires (see
      // src/lib/slug-prober.mjs). A buggy `join` would put it under the repo root instead, nested
      // many levels deep beneath a copy of outParent's own absolute path — nowhere near here.
      const scratchDirs = readdirSync(dirname(absoluteOutDir)).filter((name) =>
        name.startsWith('.slug-probe-'),
      );
      expect(scratchDirs.length).toBe(1);

      // Nothing new appeared directly under the real repo root: the exact regression
      // `join(root, absoluteOutDir)` used to cause was a brand new top-level directory here
      // (the absolute OUT_DIR's own first path segment, e.g. "Users" or "var").
      const rootEntriesAfter = readdirSync(repoRoot);
      const newRootEntries = rootEntriesAfter.filter((name) => !rootEntriesBefore.has(name));
      expect(newRootEntries).toEqual([]);
    } finally {
      for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
      resetContextCache();
      rmSync(contentDir, { recursive: true, force: true });
      rmSync(outParent, { recursive: true, force: true });
    }
  });
});

// SITE_DIR is the only content input loadContext accepts (the old single-file content path was
// removed once the whole factory moved to folder-shaped sites — see docs/content-format.md). This
// pins the one operator-side failure that sits on top of loadSiteDirInput's own two content-side
// failures: nothing was pointed at a folder at all.
describe('loadContext requires SITE_DIR', () => {
  it('throws a plain, Russian, [factory]-toned error naming the missing variable', () => {
    const saved = process.env.SITE_DIR;
    delete process.env.SITE_DIR;
    resetContextCache();
    try {
      expect(() => loadContext()).toThrow(/^\[factory\] SITE_DIR не задан/);
    } finally {
      if (saved === undefined) delete process.env.SITE_DIR;
      else process.env.SITE_DIR = saved;
      resetContextCache();
    }
  });
});
