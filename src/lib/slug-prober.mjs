import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { RESERVED_ROOT_OUTPUT_NAMES } from './reserved-output-names.mjs';

const MARKER_FILE = 'index.html';

// --- Proof, not prediction ---------------------------------------------------------------
//
// Four review rounds fixed this the same way each time: enumerate one more hostile shape and
// teach normalize.mjs to recognise it — a reserved-name list, a case-fold before comparing, a
// byte-length cap alongside the character cap. Each fix generalized the dimension the previous
// round had attacked and left the next one as a list. The pattern breaks only by refusing to
// predict at all: instead of asserting a slug is safe, actually perform the exact filesystem
// operation the real build will perform — mkdir the page's directory, then create the
// `index.html` marker inside it — against a scratch tree seeded to look like the output root
// will at the moment the build starts. Whatever the OS says is the verdict; nothing here
// encodes an opinion about *why* a path is unusable.
//
// This one mechanism is what a reserved engine file, a public-asset collision, an ASCII case
// fold, a Unicode normalization fold and an unassigned code point all reduce to: "the filesystem
// refused this path." None of the five needs its own rule — see the five collisions this module
// was written against, each reproduced directly against a real macOS/APFS filesystem before this
// was written (see the review's own findings, and tests/slug-prober.test.mjs):
//   1. mkdir(<unassigned code point or noncharacter>) -> ENOENT.
//   2. mkdir/writeFile against a name a mirrored publicDir already put at the output root (e.g.
//      the repo's own ./public/.gitkeep) -> EEXIST/ENOTDIR.
//   3. the same, one level deeper (publicDir's own subdirectories, e.g. images/logo.svg).
//   4. two pages whose slugs are byte-identical but arrived in a different order -> the second
//      claim always loses, with no separate "is this a duplicate" string comparison to drift out
//      of sync with a separate "is this reserved" string comparison.
//   5. two pages whose slugs are byte-*different* but fold to the same directory on a real
//      filesystem (APFS folds case, NFC/NFD, and German ß; it does NOT fold Turkish İ/ı or
//      fullwidth forms, which is exactly why a string-level fold in JS cannot stand in for this)
//      -> the second claim fails the exact same way finding 4 does, for the exact same reason.

// Prepares a scratch directory that starts out looking like the output root will at the moment
// a real build begins, then returns a `tryClaim(segments)` prober against it. `outDir` anchors
// the scratch directory as a sibling of the real build's own output directory, on the same
// volume, so whatever case-folding or normalization the real filesystem performs is exactly what
// this prober performs too — asking a *different* filesystem (e.g. a network-mounted tmpdir with
// different semantics) would reintroduce the same drift this module exists to close. `publicDir`,
// when given, is mirrored in full: everything a real build's publicDir copies verbatim into the
// output root is copied here too, so a page slug colliding with a public asset is caught the
// same way a page slug colliding with another page is.
//
// Never throws. A scratch directory is infrastructure, not content — a read-only temp volume or
// a full disk is not a reason to fail a content build, so any failure to prepare it (or to seed
// it) is reported by returning `null`, letting the caller fall back to the old predictive
// behaviour instead.
export function createOutputProber({ outDir, publicDir } = {}) {
  let root;
  try {
    const base = outDir ? dirname(resolve(outDir)) : tmpdir();
    mkdirSync(base, { recursive: true });
    root = mkdtempSync(join(base, '.slug-probe-'));
  } catch {
    return null;
  }

  try {
    seedReservedRootFiles(root);
    if (publicDir && existsSync(publicDir)) {
      cpSync(publicDir, root, { recursive: true });
    }
  } catch {
    rmSync(root, { recursive: true, force: true });
    return null;
  }

  // segments: the slug's path segments with no leading/trailing slash, e.g. [] for the site
  // root, ['about'] for "/about", ['a', 'b'] for "/a/b". Attempts the exact two filesystem calls
  // a real build performs for that page — create the directory, then create its `index.html` —
  // and reports whether both succeeded. `{ recursive: true }` on mkdir means an already-existing
  // *directory* is not itself a failure (another page's segment, or a publicDir folder, may
  // legitimately share a path prefix); the marker file's exclusive `wx` flag is what actually
  // proves nothing already claimed this exact leaf, whether that something was another page, a
  // reserved engine file, or a mirrored public asset.
  function tryClaim(segments) {
    const targetDir = segments.length > 0 ? join(root, ...segments) : root;
    try {
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(join(targetDir, MARKER_FILE), '', { flag: 'wx' });
      return true;
    } catch {
      return false;
    }
  }

  function cleanup() {
    rmSync(root, { recursive: true, force: true });
  }

  return { tryClaim, cleanup, root };
}

function seedReservedRootFiles(root) {
  for (const name of RESERVED_ROOT_OUTPUT_NAMES) {
    // The home page's own slug ("/") is the one page allowed to legitimately produce this exact
    // file — normalize.mjs runs it through tryClaim([]) the same as any other candidate, so
    // seeding index.html here would make the real home page look like a collision with itself.
    // sitemap.xml and robots.txt have no such carve-out: nothing renders a page for them, they
    // are always there, and both are treated as occupied from the very start.
    if (name.toLowerCase() === MARKER_FILE) continue;
    writeFileSync(join(root, name), '');
  }
}
