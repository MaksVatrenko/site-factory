import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { normalizeSite } from './normalize.mjs';
import { loadTemplate, missingBlockFiles } from './templates.mjs';
import { readScheme } from './schemes.mjs';
import { createOutputProber } from './slug-prober.mjs';

let cache = null;

export function resetContextCache() {
  cache = null;
}

// Seeds a real prober the same way a real build will actually look: `outDir` anchors the scratch
// directory as a sibling of this build's own output (see createOutputProber), and `publicDir`
// mirrors whatever publicDir astro.config.mjs is about to use for THIS build — the same env var,
// with the same "fall back to the repo's own ./public" rule, so the mirror can never drift from
// what actually gets copied (finding 2: the shipped `broken` example has no public/ folder of its
// own, so the build falls back to the repo's ./public, whose .gitkeep lands at the output root —
// only mirroring the SAME fallback the real build applies catches that).
//
// Never throws, and never lets a failure here fail the build: a prober is a backstop, not a
// content requirement (see createOutputProber's own contract) — if it cannot be built at all,
// normalizeSite is simply called with no prober, exactly as it is in every unit test, and falls
// back to the old predictive behaviour.
function buildProber(root) {
  try {
    // `resolve`, not `join`: OUT_DIR is relative in the test helpers but ALWAYS absolute in
    // factory/server.mjs's own real builds (it is built from that file's own absolute ROOT
    // constant). `join` concatenates its arguments regardless, so joining `root` with an
    // already-absolute OUT_DIR would nest the whole repo path inside itself a second time;
    // `resolve` correctly discards `root` when the second argument is already absolute, exactly
    // like resolving a relative path against a base URL.
    const outDir = resolve(root, process.env.OUT_DIR || './output/preview');
    const envPublicDir = process.env.PUBLIC_DIR;
    const publicDir =
      envPublicDir && existsSync(envPublicDir) ? envPublicDir : join(root, 'public');
    return createOutputProber({ outDir, publicDir });
  } catch {
    return null;
  }
}

export function loadContext(root = process.cwd()) {
  if (cache) return cache;

  const file = process.env.SITE_JSON;
  if (!file) {
    throw new Error('SITE_JSON is not set: point it at a content file');
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read content from ${file}: ${error.message}`);
  }

  const template = loadTemplate(process.env.TEMPLATE || '', root);
  const missing = missingBlockFiles(template, root);
  if (missing.length > 0) {
    throw new Error(
      `Template "${template.id}" declares blocks with no file: ${missing.join(', ')}`,
    );
  }

  const prober = buildProber(root);
  if (prober) {
    // A build is one OS process from start to finish, so 'exit' is the one lifecycle hook
    // guaranteed to fire whether the build succeeds or crashes — and rmSync is synchronous, so
    // it completes even from inside an 'exit' handler.
    process.once('exit', prober.cleanup);

    // 'exit' alone misses SIGINT/SIGTERM (final-fix-6, F3): Node does not emit 'exit' for a
    // process a signal kills outright, so Ctrl-C (or a supervisor's SIGTERM) mid-build used to
    // leave the scratch tree — a full publicDir mirror — behind under output/ forever. Adding a
    // listener for a signal replaces Node's own default "terminate the process" action for it, so
    // each handler here cleans up and then re-sends the SAME signal to this same process with no
    // listener of its own left to catch it (the `once` below already removed itself before this
    // body runs) — the default action fires immediately after and the process still dies exactly
    // as it would have with no handler at all, just with the scratch directory already gone.
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => {
        prober.cleanup();
        process.kill(process.pid, signal);
      });
    }
  } else {
    // Final-fix-6, F5: with no prober, slug resolution silently drops back to the old predictive
    // path — the one with no rule for a publicDir collision, a case fold, or an unassigned code
    // point — and nothing else about a build's own log looks any different when that happens. A
    // real crash (or a bug like final-fix-6's own F2) two steps away then looks unrelated to this,
    // because there is nothing here to point at the moment the safety net actually went away.
    console.warn('[factory] Проверка слагов через файловую систему недоступна — слаги разрешаются без неё');
  }

  const { site, warnings } = normalizeSite(raw, {
    supportedBlocks: template.blocks,
    overrides: {
      brand: process.env.BRAND || '',
      locale: process.env.LOCALE || '',
      geo: process.env.GEO || '',
      domain: process.env.DOMAIN || '',
      partnerUrl: process.env.PARTNER_URL || '',
    },
    prober: prober ? prober.tryClaim : undefined,
  });

  const scheme = readScheme(process.env.SCHEME || site.style || template.defaultScheme, root);

  for (const warning of warnings) console.warn(`[factory] ${warning}`);
  if (scheme.fellBack) {
    console.warn(`[factory] Схема не найдена, взята «${scheme.id}»`);
  }

  cache = { site, template, scheme };
  return cache;
}
