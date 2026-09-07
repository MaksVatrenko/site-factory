// Names Astro's own build occupies at the ROOT of output/<domain>/ — outside of, and as a
// sibling to, every page's own slug directory. A content page whose normalized slug puts one of
// these names in ANY segment collides with one of these root-level entries on disk: `mkdir`
// finds a FILE already sitting where it needs a directory (ENOTDIR), or — on a case-insensitive
// filesystem such as macOS's default APFS — a same-named entry differing only in case does the
// same thing, since the filesystem treats them as the identical path.
//
// This list is deliberately maintained BY HAND here, in exactly one place, rather than derived
// by scanning src/pages/ at build time: the point of tests/reserved-output-names.test.mjs is
// that adding a new root-level endpoint route must NOT start working for free. That test builds
// a real site and checks every FILE it finds at the output root against this exact list, so a
// future root-level endpoint (say, `src/pages/ads.txt.js`) makes the test fail until a human
// adds its output filename below — the test is the actual safeguard; this list is just data it
// checks against. `.prerender` (below) is the one entry that test can never see for itself, since
// it never survives into a finished build's output — see its own note.
//
// Keep this in sync with:
//   - the home page's own output: Astro's "directory" build format always writes a plain
//     `index.html` FILE at the output root for the page whose slug is "/"
//     (src/pages/[...slug].astro drives every page, including that one).
//   - every root-level endpoint file directly under src/pages/ that is not itself a dynamic
//     route: currently src/pages/robots.txt.js and src/pages/sitemap.xml.js.
//   - `.prerender`: Astro's OWN build-staging directory, created at the output root while pages
//     are being generated and unconditionally deleted once generation finishes (see
//     factory/server.mjs's own use of a leftover `.prerender/` as a crash signal — real only
//     because a normal, successful build never leaves it behind). It never appears in
//     tests/reserved-output-names.test.mjs's scan of a finished build's own output, because by
//     the time that scan runs it is already gone — but for the whole build it is just as occupied
//     as sitemap.xml or robots.txt are, so a page slugged into it (or nested under it) is built
//     for real and then deleted out from under itself by Astro's own cleanup, with nothing here
//     to warn about it (final-fix-6, finding F1). `_astro` (inlined-asset output in this project's
//     config, see astro.config.mjs's `inlineStylesheets: 'always'`) and `.git` were both checked
//     against a real build and found to coexist fine with a same-named page directory — neither
//     belongs here.
export const RESERVED_ROOT_OUTPUT_NAMES = Object.freeze([
  'index.html',
  'sitemap.xml',
  'robots.txt',
  '.prerender',
]);

const RESERVED_ROOT_OUTPUT_NAMES_LOWER = new Set(
  RESERVED_ROOT_OUTPUT_NAMES.map((name) => name.toLowerCase()),
);

// Case-insensitive on purpose: a segment that differs from a reserved name only in case still
// collides with it on a case-insensitive filesystem (macOS's default APFS/HFS+), even though the
// two strings are not === equal.
export function isReservedOutputName(name) {
  return RESERVED_ROOT_OUTPUT_NAMES_LOWER.has(name.toLowerCase());
}
