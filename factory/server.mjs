import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
// archiver 8 ships as native ESM with no default export — only the format classes below.
import { ZipArchive } from 'archiver';
import express from 'express';
import { listTemplates } from '../src/lib/templates.mjs';
import { listSchemes } from '../src/lib/schemes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SITES_DIR = join(ROOT, 'data', 'sites');
const OUTPUT_DIR = join(ROOT, 'output');
const ASTRO_BIN = join(ROOT, 'node_modules', '.bin', 'astro');
const PUBLIC_UI_DIR = join(HERE, 'public');
const PORT = Number(process.env.PORT || 3002);

const builds = new Map();

const MAX_NAME_LENGTH = 100;

function safeName(value, fallback = '') {
  const cleaned = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || fallback;
}

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// `trimmedString` maps every non-string value to '' — the same result as a field that was never
// sent — which is correct for a field where absence and "use the default" are the same thing,
// but it also means a *present* value of the wrong type (a number, an array, `null`) silently
// passes as "absent" instead of being refused. This tells those two cases apart: `undefined`
// (the key was never sent) is fine, anything else that is not a string is not.
function isPresentNonString(value) {
  return value !== undefined && typeof value !== 'string';
}

// A site folder "actually holds content" when it has at least one page file — a site.json alone
// (or an empty folder) is not buildable, see loadSiteDirInput's own "no pages" check in
// src/lib/site-dir.mjs. Reading that requirement here directly, rather than requiring a site.json
// specifically, matches what a real build actually needs: a site.json is optional.
function siteHasPages(dir) {
  try {
    return readdirSync(dir).some((name) => name.endsWith('.json') && name !== 'site.json');
  } catch {
    return false;
  }
}

function listSites() {
  if (!existsSync(SITES_DIR)) return [];
  return readdirSync(SITES_DIR)
    .filter((name) => siteHasPages(join(SITES_DIR, name)))
    .sort();
}

function isBuildRunning(domain) {
  return [...builds.values()].some((build) => build.domain === domain && build.status === 'running');
}

// The most recently STARTED build recorded for a domain. `builds` is a Map keyed by a random
// build id, but Map iteration visits entries in insertion order, so the last matching entry seen
// while walking it is the most recent one. Returns undefined when this process has no record of
// ever building this domain at all (a fresh server process, or an output folder that predates
// it) — the caller must treat that as "unknown", not as evidence of failure.
function latestBuildForDomain(domain) {
  let latest;
  for (const build of builds.values()) {
    if (build.domain === domain) latest = build;
  }
  return latest;
}

function pushLine(build, line) {
  build.lines.push(line);
  for (const listener of build.listeners) listener.send(line);
}

function finishBuild(build, status) {
  build.status = status;
  for (const listener of build.listeners) listener.finish(status);
  build.listeners.clear();
}

// Strip a trailing '\r' so CRLF output doesn't leave a stray carriage return glued to the line.
const stripTrailingCR = (line) => line.replace(/\r$/, '');

export function createLineSplitter(onLine) {
  // A dedicated decoder holds onto a trailing partial multi-byte UTF-8 sequence until the next
  // chunk completes it, instead of decoding each chunk in isolation and corrupting split
  // characters into replacement characters.
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  const write = (chunk) => {
    buffer += decoder.write(chunk);
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) onLine(stripTrailingCR(part));
  };
  const flush = () => {
    buffer += decoder.end();
    if (buffer !== '') onLine(stripTrailingCR(buffer));
    buffer = '';
  };
  return { write, flush };
}

// Exported for tests only (it lets tests start a build with a fake spawnFn instead of a real
// Astro process). It is not a public entry point: the 409 "already running" guard lives in the
// /api/generate route handler below, not here, so calling this directly skips that check.
export function startBuild(options, spawnFn = spawn) {
  const build = {
    id: randomUUID(),
    status: 'running',
    domain: options.domain,
    outDir: options.outDir,
    lines: [],
    listeners: new Set(),
  };
  builds.set(build.id, build);

  const child = spawnFn(ASTRO_BIN, ['build'], {
    cwd: ROOT,
    env: { ...process.env, ...options.env },
  });

  // stdout and stderr are independent byte streams, so each needs its own splitter/decoder —
  // sharing one would let a partial multi-byte character from one stream get "completed" with
  // bytes from the other.
  const stdoutSplitter = createLineSplitter((line) => pushLine(build, line));
  const stderrSplitter = createLineSplitter((line) => pushLine(build, line));

  child.stdout.on('data', stdoutSplitter.write);
  child.stderr.on('data', stderrSplitter.write);

  child.on('error', (error) => {
    pushLine(build, `Не удалось запустить сборку: ${error.message}`);
    finishBuild(build, 'failed');
  });

  child.on('close', (code) => {
    // A failed spawn fires both 'error' and 'close'; the 'error' handler above already
    // finished and reported the build, so skip the redundant, confusing second report.
    if (build.status !== 'running') return;

    stdoutSplitter.flush();
    stderrSplitter.flush();
    pushLine(build, code === 0 ? 'Готово' : `Сборка завершилась с кодом ${code}`);
    finishBuild(build, code === 0 ? 'ok' : 'failed');
  });

  return build;
}

// Content is not required to place a page at "/" — the shipped `broken` site's only page is
// "/sloppy" — so a build can finish cleanly and report success while writing no root index.html
// at all.
//
// Rather than assume the root exists, this asks the actual output tree which page does: a
// breadth-first, alphabetical-at-each-level walk for the first index.html found, mirroring the
// same "ask the filesystem instead of predicting from content" approach the slug fix above this
// file uses. Returns null when `dir` does not exist, or holds no page at all.
export function findEntryPageDir(dir) {
  if (!existsSync(dir)) return null;
  if (existsSync(join(dir, 'index.html'))) return '.';

  const queue = [dir];
  while (queue.length > 0) {
    const current = queue.shift();
    const subdirs = readdirSync(current, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
    for (const name of subdirs) {
      const full = join(current, name);
      if (existsSync(join(full, 'index.html'))) return relative(dir, full);
      queue.push(full);
    }
  }
  return null;
}

// Counts every filesystem entry (files and directories alike) under `dir`, recursively.
// archiver's `.directory()` walks the same tree with a glob that includes subdirectories, and
// fires an `entry` event for each match — not just for files — so this is the count a complete
// archive is expected to match.
export function countEntriesRecursively(dir) {
  let count = 0;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    count += 1;
    if (item.isDirectory()) {
      count += countEntriesRecursively(join(dir, item.name));
    }
  }
  return count;
}

// Watches an in-flight archive for signs that it came out short. A file that disappears
// between the route's existence check and archiver's own directory scan reaching it leaves no
// 'error' and no 'warning' — just one fewer 'entry' than expected — so comparing the expected
// and actual entry counts once the archive ends is the only way to catch that case. A
// 'warning' (e.g. a file that vanished a little later, after the scan had already listed it,
// but before it could be read) is treated as the same kind of failure.
//
// The 'end' listener is prepended so it runs before the listener `.pipe()` installs — that
// listener calls `res.end()`, which would otherwise let a short-but-structurally-valid zip
// complete with a clean 200 before this ever gets a chance to abort it.
export function guardArchiveCompleteness(archive, res, expectedEntryCount) {
  let actualEntryCount = 0;
  let hadWarning = false;

  archive.on('entry', () => {
    actualEntryCount += 1;
  });
  archive.on('warning', () => {
    hadWarning = true;
  });
  archive.prependListener('end', () => {
    if (hadWarning || actualEntryCount !== expectedEntryCount) {
      res.destroy();
    }
  });
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/templates', (_req, res) => {
    res.json({ templates: listTemplates(ROOT) });
  });

  app.get('/api/schemes', (_req, res) => {
    res.json({ schemes: listSchemes(ROOT) });
  });

  app.get('/api/sites', (_req, res) => {
    res.json({ sites: listSites() });
  });

  app.post('/api/generate', (req, res) => {
    const body = req.body ?? {};

    // site, template and scheme are ids the server's own list endpoints already read verbatim
    // from disk (folder names, template ids, scheme filenames). They must be checked against
    // those exact lists, not rewritten with safeName — safeName is for `domain`, which is
    // correct there because that value names a directory this server creates. Mangling a real id
    // before checking it makes a legitimately listed value fail to round-trip: it stops matching
    // the entry it came from (see finding M2).
    const siteInput = trimmedString(body.site);
    const site = siteInput === '' ? '899ok' : siteInput;
    if (!listSites().includes(site)) {
      res.status(400).json({ error: `Папка с сайтом «${site}» не найдена` });
      return;
    }
    const siteDir = join(SITES_DIR, site);

    const domain = safeName(body.domain, site);
    if (isBuildRunning(domain)) {
      res.status(409).json({ error: `Сборка для домена «${domain}» уже выполняется` });
      return;
    }

    // Empty/absent template or scheme stay valid — they mean "use the default". A *present*
    // value of the wrong type is neither of those things, so it is refused the same way an
    // unknown string id already is, instead of being coerced into '' and treated as absent.
    if (isPresentNonString(body.template)) {
      res.status(400).json({ error: 'Поле «template» должно быть строкой' });
      return;
    }
    const templateInput = trimmedString(body.template);
    if (
      templateInput !== '' &&
      !listTemplates(ROOT).some((candidate) => candidate.id === templateInput)
    ) {
      res.status(400).json({ error: `Шаблон «${templateInput}» не найден` });
      return;
    }
    // An empty template is passed straight through: the engine's own loadTemplate('') already
    // falls back to listTemplates()[0] (see src/lib/templates.mjs), and with one template on
    // disk that fallback is unambiguous — there is no second, general-purpose template left to
    // prefer over it.

    if (isPresentNonString(body.scheme)) {
      res.status(400).json({ error: 'Поле «scheme» должно быть строкой' });
      return;
    }
    const scheme = trimmedString(body.scheme);
    if (scheme !== '' && !listSchemes(ROOT).includes(scheme)) {
      res.status(400).json({ error: `Цветовая схема «${scheme}» не найдена` });
      return;
    }

    const outDir = join(OUTPUT_DIR, domain);
    const sitePublic = join(siteDir, 'public');

    const build = startBuild({
      domain,
      outDir,
      env: {
        SITE_DIR: siteDir,
        PUBLIC_DIR: existsSync(sitePublic) ? sitePublic : '',
        TEMPLATE: templateInput,
        SCHEME: scheme,
        OUT_DIR: outDir,
        SITE_URL: `https://${domain}`,
        DOMAIN: domain,
        BRAND: String(body.brand ?? ''),
        GEO: String(body.geo ?? ''),
        LOCALE: String(body.locale ?? ''),
        PARTNER_URL: String(body.partnerUrl ?? ''),
      },
    });

    res.json({ buildId: build.id, domain, outDir });
  });

  app.get('/api/builds/:id', (req, res) => {
    const build = builds.get(req.params.id);
    if (!build) {
      res.status(404).json({ error: 'Сборка не найдена' });
      return;
    }
    const { id, status, domain, outDir, lines } = build;
    res.json({ id, status, domain, outDir, lines });
  });

  app.get('/api/builds/:id/log', (req, res) => {
    const build = builds.get(req.params.id);
    if (!build) {
      res.status(404).end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (line) => res.write(`data: ${JSON.stringify(line)}\n\n`);
    const finish = (status) => {
      res.write(`event: done\ndata: ${JSON.stringify(status)}\n\n`);
      res.end();
    };

    for (const line of build.lines) send(line);

    if (build.status !== 'running') {
      finish(build.status);
      return;
    }

    const listener = { send, finish };
    build.listeners.add(listener);
    req.on('close', () => build.listeners.delete(listener));
  });

  app.get('/api/output/:domain/zip', (req, res) => {
    const domain = safeName(req.params.domain, '');
    // A build in progress can still be writing into this exact directory — refuse rather than
    // risk archiving it mid-write, the same way a second build for the domain is refused.
    if (isBuildRunning(domain)) {
      res.status(409).json({ error: `Сборка для домена «${domain}» уже выполняется` });
      return;
    }

    // A build that finished but failed can still leave real files behind — a previous
    // successful build's own output, or even a crash's own partial output, including an
    // already-written index.html if the crash happened after the home page but before the rest
    // (see finding C1). The plain existence check below cannot tell "finished" from "died
    // partway through", so this only refuses when the most recent attempt is actually known to
    // have failed; no record at all (server restarted, or the folder predates this process) is
    // not evidence of anything, and falls through to that check exactly as before.
    const latestBuild = latestBuildForDomain(domain);
    if (latestBuild && latestBuild.status === 'failed') {
      res.status(409).json({
        error: `Последняя сборка для домена «${domain}» завершилась с ошибкой — архив недоступен`,
      });
      return;
    }

    const dir = join(OUTPUT_DIR, domain);
    // The in-memory check above only knows about builds THIS process started — after a server
    // restart, `builds` is empty again, so a crash from a previous process looks exactly like no
    // record at all. Astro's own `.prerender/` staging directory is a durable, on-disk fact
    // instead: a crashed build leaves it behind, and any build that actually finishes — even one
    // with no page at "/" — always removes it (see findEntryPageDir above for the "no root page"
    // half of that same idea). This check does not replace the in-memory one above: the tests
    // that reach a 'failed' build deterministically do so with a fake child process that never
    // touches the filesystem, so no real `.prerender/` exists for them to be caught by this.
    if (existsSync(join(dir, '.prerender'))) {
      res.status(409).json({
        error: `Последняя сборка для домена «${domain}» завершилась с ошибкой — архив недоступен`,
      });
      return;
    }

    // Not gated on index.html specifically: content is not required to place a page at "/" (see
    // findEntryPageDir above), so a real, finished build can legitimately have none. "Does
    // anything exist here at all" is the actual question this route needs answered.
    if (domain === '' || !existsSync(dir) || countEntriesRecursively(dir) === 0) {
      res.status(404).json({ error: 'Собранного сайта с таким именем нет' });
      return;
    }

    // Snapshot the tree now, before archiver gets its own look at it — this is what "expected"
    // means for guardArchiveCompleteness below.
    const expectedEntryCount = countEntriesRecursively(dir);

    res.attachment(`${domain}.zip`);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', () => res.destroy());
    guardArchiveCompleteness(archive, res, expectedEntryCount);
    archive.pipe(res);
    archive.directory(dir, false);
    archive.finalize();
  });

  // A build with no page at "/" (the shipped `broken` site: its only page is "/sloppy") has
  // nothing for express.static below to find at the domain's own root, and it has no way to know
  // which nested page should stand in for it. This runs first and hands it the answer directly:
  // when the root index.html is missing but the domain really was built, redirect to whichever
  // page findEntryPageDir finds. A domain that was never built at all, or genuinely has a root
  // page, falls straight through to the static handler exactly as before.
  app.get('/preview/:domain/', (req, res, next) => {
    const dir = join(OUTPUT_DIR, req.params.domain);
    if (existsSync(join(dir, 'index.html'))) {
      next();
      return;
    }
    const entry = findEntryPageDir(dir);
    if (entry === null) {
      next();
      return;
    }
    res.redirect(302, `/preview/${req.params.domain}/${entry}/`);
  });

  app.use('/preview', express.static(OUTPUT_DIR, { index: 'index.html' }));
  app.use(express.static(PUBLIC_UI_DIR, { index: 'index.html' }));

  return app;
}

function openBrowser(url) {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(command, [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Opening the browser is a convenience, not a precondition for the server to work.
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = `http://localhost:${PORT}`;
  createApp().listen(PORT, () => {
    console.log(`Фабрика сайтов: ${url}`);
    openBrowser(url);
  });
}
