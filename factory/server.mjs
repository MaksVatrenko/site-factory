import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
// archiver 8 ships as native ESM with no default export — only the format classes below.
import { ZipArchive } from 'archiver';
import express from 'express';
import { listTemplates } from '../src/lib/templates.mjs';
import { listSchemes } from '../src/lib/schemes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const EXAMPLES_DIR = join(ROOT, 'data', 'examples');
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

function listExamples() {
  if (!existsSync(EXAMPLES_DIR)) return [];
  return readdirSync(EXAMPLES_DIR)
    .filter((name) => existsSync(join(EXAMPLES_DIR, name, 'site.json')))
    .sort();
}

function isBuildRunning(domain) {
  return [...builds.values()].some((build) => build.domain === domain && build.status === 'running');
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

  app.get('/api/examples', (_req, res) => {
    res.json({ examples: listExamples() });
  });

  app.post('/api/generate', (req, res) => {
    const body = req.body ?? {};
    const example = safeName(body.example, 'default');
    const exampleDir = join(EXAMPLES_DIR, example);
    if (!existsSync(join(exampleDir, 'site.json'))) {
      res.status(400).json({ error: `Папка с примерами «${example}» не найдена` });
      return;
    }

    const domain = safeName(body.domain, example);
    if (isBuildRunning(domain)) {
      res.status(409).json({ error: `Сборка для домена «${domain}» уже выполняется` });
      return;
    }

    const outDir = join(OUTPUT_DIR, domain);
    const examplePublic = join(exampleDir, 'public');

    const build = startBuild({
      domain,
      outDir,
      env: {
        SITE_JSON: join(exampleDir, 'site.json'),
        PUBLIC_DIR: existsSync(examplePublic) ? examplePublic : '',
        TEMPLATE: safeName(body.template, ''),
        SCHEME: safeName(body.scheme, ''),
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

    const dir = join(OUTPUT_DIR, domain);
    if (domain === '' || !existsSync(join(dir, 'index.html'))) {
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
