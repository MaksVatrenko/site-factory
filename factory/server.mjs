import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
// archiver 8 ships as native ESM with no default export — only the format classes below.
import { ZipArchive } from 'archiver';
import express from 'express';
import { listTemplates } from '../src/lib/templates.mjs';
import { listSchemes } from '../src/lib/schemes.mjs';
import { isPageFileName } from '../src/lib/site-dir.mjs';
import { loadGeos } from './geos.mjs';
import { readRunwareConfig } from './images/env.mjs';
import { generateMissingImages } from './images/generate.mjs';
import { generateLogo } from './images/logo.mjs';
import { readOpenAiConfig } from './texts/env.mjs';
import { generateSite } from './texts/generate-site.mjs';
import { loadTemplatePictures } from './texts/template.mjs';
import { loadExamples } from './texts/example.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SITES_DIR = join(ROOT, 'data', 'sites');
const OUTPUT_DIR = join(ROOT, 'output');
const ASTRO_BIN = join(ROOT, 'node_modules', '.bin', 'astro');
const PUBLIC_UI_DIR = join(HERE, 'public');
const PORT = Number(process.env.PORT || 3002);
const ENV_FILE = join(ROOT, '.env');
const IMAGE_PROMPTS_FILE = join(HERE, 'prompts', 'images.json');
const LOGO_PROMPTS_FILE = join(HERE, 'prompts', 'logo.json');
const TEXTS_PROMPTS_FILE = join(HERE, 'prompts', 'texts.json');
const GEOS_FILE = join(HERE, 'geos.json');
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

// A page file is whatever src/lib/site-dir.mjs says it is — any *.json file in the folder itself
// that is not a service file (site.json, images.json). Imported rather than restated: the rule
// used to be copied here, and a copy is exactly what drifts when a service file is added.
function pageFileNames(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isPageFileName(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

// A site folder "actually holds content" when it has at least one page file — a site.json alone
// (or an empty folder) is not buildable, see loadSiteDirInput's own "no pages" check.
function siteHasPages(dir) {
  return pageFileNames(dir).length > 0;
}

// The brand name is the one thing about a site worth showing before anyone builds it — everything
// else in site.json only matters once you're already looking at the output. Missing or unreadable
// is not a listing-time error (that failure belongs to an actual build, see loadSiteDirInput):
// here it just means this folder has no brand name to show yet.
function siteBrandName(dir) {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8'));
    const name = raw?.brand?.name;
    return typeof name === 'string' ? name : '';
  } catch {
    return '';
  }
}

// The allow-list `/api/generate` checks `site` against. Every entry is a literal name
// readdirSync(SITES_DIR) actually returned, so this doubles as the escape guard for path
// traversal: a value like "../../etc" can never equal one of these names, and nothing outside
// this list is ever joined onto SITES_DIR (see finding M2 below for why an exact-match list,
// rather than a sanitizer, is what makes that true).
function listSiteNames() {
  if (!existsSync(SITES_DIR)) return [];
  return readdirSync(SITES_DIR)
    .filter((name) => siteHasPages(join(SITES_DIR, name)))
    .sort();
}

// The full listing the form actually shows: each site folder alongside how many pages it holds
// and its brand name (when site.json declares one), so a dropdown entry means something before
// anyone builds it.
function listSites() {
  return listSiteNames().map((name) => {
    const dir = join(SITES_DIR, name);
    return { id: name, pages: pageFileNames(dir).length, brand: siteBrandName(dir) };
  });
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
//
// `options.prepare`, when given, runs first — generating missing pictures — inside this same
// build record: its lines land in the same log and the domain counts as busy throughout. Whether
// it succeeds or not, Astro runs after it. `options.env` may be a function, called only once
// prepare is done, so the build sees what prepare left on disk (a public/ folder that did not
// exist when the request came in). Without prepare, Astro starts synchronously, exactly as before.
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

  const runAstro = () => {
    // `options.env()` and `spawnFn` both run synchronously here, and either can throw — e.g.
    // `spawn` itself throws for an env value containing a NUL byte, and BRAND/GEO/LOCALE/
    // PARTNER_URL all come straight from the request body. With a `prepare` step, this call sits
    // inside a `.then()` with nothing after it to catch a synchronous throw, so it would become
    // an unhandled rejection and kill the whole process; without `prepare`, it would throw out of
    // `startBuild` itself and leave the build stuck at 'running' forever. Both are treated exactly
    // like the child's own `error` event below: one log line, and the build is marked 'failed'.
    let env;
    let child;
    try {
      env = typeof options.env === 'function' ? options.env() : options.env;
      child = spawnFn(ASTRO_BIN, ['build'], {
        cwd: ROOT,
        env: { ...process.env, ...env },
      });
    } catch (error) {
      pushLine(build, `Не удалось запустить сборку: ${error.message}`);
      finishBuild(build, 'failed');
      return;
    }

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
  };

  if (typeof options.prepare === 'function') {
    Promise.resolve()
      .then(() => options.prepare((line) => pushLine(build, line)))
      .catch((error) => pushLine(build, `Подготовка сборки не удалась: ${error.message}`))
      .then(runAstro);
  } else {
    runAstro();
  }

  return build;
}

// A job that is not a build: same record, same log stream, no Astro. Generating texts writes a site
// folder instead of building one, but the form should watch it exactly the same way — so it shares
// `builds` and therefore GET /api/builds/:id/log without that route knowing anything new.
export function startJob({ domain }, work) {
  const job = { id: randomUUID(), status: 'running', domain, outDir: '', lines: [], listeners: new Set() };
  builds.set(job.id, job);
  Promise.resolve()
    .then(() => work((line) => pushLine(job, line)))
    .then(() => finishBuild(job, 'ok'))
    .catch((error) => {
      pushLine(job, `Не удалось: ${error.message}`);
      finishBuild(job, 'failed');
    });
  return job;
}

// Content is not required to place a page at "/" — a site whose only page is not at "/", like
// the broken test fixture (tests/fixtures/sites/broken, whose only page is "/sloppy") — so a
// build can finish cleanly and report success while writing no root index.html at all.
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

// envFile, fetchFn, promptFile, logoPromptFile and geosFile exist for tests: they let a test app
// read a temporary .env, answer Runware/OpenAI requests itself and load a throwaway geos file, so
// no test ever sees the owner's real key, spends money, or depends on the real factory/geos.json.
export function createApp({
  envFile = ENV_FILE,
  fetchFn = fetch,
  promptFile = IMAGE_PROMPTS_FILE,
  logoPromptFile = LOGO_PROMPTS_FILE,
  geosFile = GEOS_FILE,
} = {}) {
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

  // Fills the geo/language dropdowns on both the Генерация and Тексты tabs. A geos.json that
  // cannot be read or fails validation must not stop someone building a site on the other tab —
  // the same reasoning as listTemplates/listSchemes answering [] instead of throwing when their
  // own directory is missing — so this reports an empty pair of lists instead of a 500.
  app.get('/api/geos', (_req, res) => {
    try {
      const { languageByGeo, countries, locales } = loadGeos(geosFile);
      res.json({
        countries: countries.map((name) => ({ name, locale: languageByGeo[name] })),
        locales,
      });
    } catch {
      res.json({ countries: [], locales: [] });
    }
  });

  // Fills the «Пример» list on the Тексты tab: the source sites this theme has examples from, by
  // the file name they share across every page folder. Same reasoning as /api/geos above — a theme
  // whose examples cannot be read must not stop somebody building a site on the other tab, so this
  // reports an empty list instead of a 500. The generation itself still refuses to start, loudly,
  // in generateSite, and that is the right place for it: only a run actually needs an example.
  app.get('/api/examples', (req, res) => {
    const template = trimmedString(req.query.template) || listTemplates(ROOT)[0]?.id || '';
    try {
      const byPage = loadExamples(template, ROOT);
      // Only the names every page has. One page short and the site could not be built from it, so
      // offering it would be offering a choice that fails.
      const lists = Object.values(byPage).map((list) => list.map((one) => one.name));
      const everywhere = (lists[0] ?? []).filter((name) => lists.every((list) => list.includes(name)));
      res.json({ examples: everywhere.map((name) => ({ id: name, name })) });
    } catch {
      res.json({ examples: [] });
    }
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
    if (!listSiteNames().includes(site)) {
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
    const brand = String(body.brand ?? '');
    // Strictly `true`, exactly like skipImages below: this checkbox spends money, so anything else
    // that happens to arrive in that field ("on" from a plain form post, 1, "false") means "no".
    const regenerateLogo = body.regenerateLogo === true;

    // Before the build: the logo first (a site without one gets it, and `force` draws a new one
    // over a site that already has it), then any missing pictures — unless the form asked for a
    // plain rebuild, which skips both steps and so outranks the regenerate checkbox. The .env is
    // read here, per request and once for both steps, so a key added while the factory is running
    // is picked up without a restart.
    const prepare =
      body.skipImages === true
        ? undefined
        : async (log) => {
            const config = readRunwareConfig(envFile);
            await generateLogo({
              siteDir,
              brand,
              config,
              promptFile: logoPromptFile,
              fetchFn,
              force: regenerateLogo,
              log,
            });
            await generateMissingImages({ siteDir, brand, config, promptFile, fetchFn, log });
          };

    const build = startBuild({
      domain,
      outDir,
      prepare,
      // A function, so PUBLIC_DIR is decided once generation is done: a site that had no public/
      // folder before this build may have one now.
      env: () => ({
        SITE_DIR: siteDir,
        PUBLIC_DIR: existsSync(sitePublic) ? sitePublic : '',
        TEMPLATE: templateInput,
        SCHEME: scheme,
        OUT_DIR: outDir,
        SITE_URL: `https://${domain}`,
        DOMAIN: domain,
        BRAND: brand,
        GEO: String(body.geo ?? ''),
        LOCALE: String(body.locale ?? ''),
        PARTNER_URL: String(body.partnerUrl ?? ''),
      }),
    });

    res.json({ buildId: build.id, domain, outDir });
  });

  app.post('/api/texts', (req, res) => {
    const body = req.body ?? {};

    // Empty/absent template stays valid — it means "use the default" — but a *present* value of
    // the wrong type is neither of those things, exactly like /api/generate's own guard above.
    if (isPresentNonString(body.template)) {
      res.status(400).json({ error: 'Поле «template» должно быть строкой' });
      return;
    }
    const templateInput = trimmedString(body.template);
    const template = templateInput || listTemplates(ROOT)[0]?.id || '';
    if (!listTemplates(ROOT).some((candidate) => candidate.id === template)) {
      res.status(400).json({ error: `Шаблон «${template}» не найден` });
      return;
    }
    // A theme with no pictures.json or no examples cannot be generated for at all, and saying so
    // now costs nothing — finding out after the first paid request would not.
    try {
      loadTemplatePictures(template, ROOT);
      loadExamples(template, ROOT);
    } catch (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    // Empty/absent example stays valid — it means «Случайно», an example drawn per page. A present
    // value has to name one that exists, and that is checked here rather than inside the run: a
    // typo must come back as a refused request, not as a job that starts and immediately gives up.
    if (isPresentNonString(body.example)) {
      res.status(400).json({ error: 'Поле «example» должно быть строкой' });
      return;
    }
    const example = trimmedString(body.example);
    if (example !== '') {
      const byPage = loadExamples(template, ROOT);
      // Every page must have it, not just one: the run builds the whole site from this name.
      const missing = Object.entries(byPage)
        .filter(([, list]) => !list.some((one) => one.name === example))
        .map(([address]) => address);
      if (missing.length > 0) {
        res.status(400).json({ error: `Примера «${example}» нет у страниц: ${missing.join(', ')}` });
        return;
      }
    }

    const site = safeName(body.out, '');
    if (site === '') {
      res.status(400).json({ error: 'Нужно имя папки для нового сайта' });
      return;
    }

    if (isPresentNonString(body.brand)) {
      res.status(400).json({ error: 'Поле «brand» должно быть строкой' });
      return;
    }
    const brand = trimmedString(body.brand);
    if (brand === '') {
      res.status(400).json({ error: 'Нужно название бренда' });
      return;
    }

    if (isPresentNonString(body.geo)) {
      res.status(400).json({ error: 'Поле «geo» должно быть строкой' });
      return;
    }
    const geo = trimmedString(body.geo);

    if (isPresentNonString(body.locale)) {
      res.status(400).json({ error: 'Поле «locale» должно быть строкой' });
      return;
    }
    const locale = trimmedString(body.locale);

    const raw = Array.isArray(body.pages) ? body.pages : String(body.pages ?? '').split(/[\s,]+/);
    const pages = [...new Set(raw.map((name) => safeName(name, '')).filter(Boolean))];
    if (!pages.includes('home')) {
      res.status(400).json({ error: 'В списке страниц нужна home — иначе у сайта не будет главной' });
      return;
    }

    if (isBuildRunning(site)) {
      res.status(409).json({ error: `Для папки «${site}» уже что-то выполняется` });
      return;
    }

    const job = startJob({ domain: site }, async (log) => {
      const summary = await generateSite({
        siteDir: join(SITES_DIR, site),
        templateId: template,
        brand,
        geo,
        locale,
        pages,
        config: readOpenAiConfig(envFile),
        root: ROOT,
        promptFile: TEXTS_PROMPTS_FILE,
        geosFile,
        example,
        fetchFn,
        log,
      });
      // generateSite never throws — a bad key, an empty balance, or a broken template all just
      // become a log line so a half-written folder stays inspectable (see generate-site.mjs). But
      // startJob only marks the job 'failed' when the work function throws, and the form's `done`
      // event has nothing else to go on — so without this, every one of those runs would still
      // report success. A page file actually on disk (freshly written, or already there from an
      // earlier run this one resumed) is what "success" means here; site.json alone is the frame,
      // not a page, so it does not count.
      const pageFiles = new Set([...summary.written, ...summary.skipped]);
      pageFiles.delete('site.json');
      if (pageFiles.size === 0) {
        throw new Error('ни одна страница не была написана — смотри лог');
      }
    });

    res.json({ jobId: job.id, site });
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

  // A build with no page at "/" (a site whose only page is not at "/", like the broken test
  // fixture, whose only page is "/sloppy") has nothing for express.static below to find at the
  // domain's own root, and it has no way to know which nested page should stand in for it. This
  // runs first and hands it the answer directly:
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

  // A built site links to its own pages absolutely — /casino, /bonus — which is correct once it
  // is deployed at a domain root, and wrong here, where preview serves it under /preview/<domain>/.
  // Followed as-is those links leave the prefix and land on the factory itself. So rewrite them on
  // the way out: the files on disk keep the absolute links they must ship with, and only this
  // response gets the prefix. A URL starting with // is a protocol-relative link to another host
  // and is left alone.
  app.use('/preview', (req, res, next) => {
    const segments = req.path.split('/').filter((part) => part !== '');
    const domain = safeName(segments[0] ?? '', '');
    if (domain === '') {
      next();
      return;
    }

    const rest = segments.slice(1).join('/');
    const wantsDirectory = rest === '' || req.path.endsWith('/');
    const file = wantsDirectory
      ? join(OUTPUT_DIR, domain, rest, 'index.html')
      : join(OUTPUT_DIR, domain, rest);

    if (!file.endsWith('.html') || !existsSync(file)) {
      next();
      return;
    }

    const html = readFileSync(file, 'utf8').replace(
      /\b(href|src)="\/(?!\/)/g,
      `$1="/preview/${domain}/`,
    );
    res.type('html').send(html);
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
