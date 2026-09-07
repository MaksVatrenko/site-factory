import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { ZipArchive } from 'archiver';
import {
  createApp,
  createLineSplitter,
  startBuild,
  countEntriesRecursively,
  guardArchiveCompleteness,
} from '../factory/server.mjs';

let server;
let base;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
});

async function readUntilDone(buildId) {
  const response = await fetch(`${base}/api/builds/${buildId}/log`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('event: done')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return text;
}

// --- Minimal, dependency-free ZIP parsing — just enough to prove an archive is complete. ---
// archiver (the only zip-related package in this project) only ever writes zips, so there is
// no library already available to read one back with, and none may be added. These read the
// raw bytes directly instead; the two signatures and the EOCD field offset below are the
// entire ZIP layout this needs.

const EOCD_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const LOCAL_FILE_HEADER_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

// Finds the End Of Central Directory record by scanning backward from the end of the buffer
// for its signature, then reads the total-entry-count field at offset 10 of that record.
// Throws if no EOCD record is found — which is exactly what a truncated or otherwise
// corrupted archive looks like, since every valid zip ends with one.
function readZipEntryCount(buffer) {
  for (let offset = buffer.length - EOCD_SIGNATURE.length; offset >= 0; offset -= 1) {
    if (buffer.subarray(offset, offset + EOCD_SIGNATURE.length).equals(EOCD_SIGNATURE)) {
      return buffer.readUInt16LE(offset + 10);
    }
  }
  throw new Error('End Of Central Directory record not found — not a complete zip archive');
}

// Reads every entry name recorded in a local file header (signature 50 4B 03 04). Each
// header's file-name length sits at a fixed offset, immediately followed by the name itself,
// so this walks the buffer header by header without needing a real zip parser.
function readZipEntryNames(buffer) {
  const names = [];
  let searchFrom = 0;
  for (;;) {
    const headerStart = buffer.indexOf(LOCAL_FILE_HEADER_SIGNATURE, searchFrom);
    if (headerStart === -1) break;
    const nameLength = buffer.readUInt16LE(headerStart + 26);
    const extraLength = buffer.readUInt16LE(headerStart + 28);
    const nameStart = headerStart + 30;
    names.push(buffer.toString('utf8', nameStart, nameStart + nameLength));
    searchFrom = nameStart + nameLength + extraLength;
  }
  return names;
}

// Counts every filesystem entry (files and directories alike) under `dir`, recursively — the
// same notion of "entry" archiver itself uses when it walks a directory (a zip gets its own
// entry per subdirectory too, not just per file), so this is what a complete archive's total
// entry count is expected to match.
function countFsEntriesRecursively(dir) {
  let count = 0;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    count += 1;
    if (item.isDirectory()) count += countFsEntriesRecursively(join(dir, item.name));
  }
  return count;
}

// Both helpers below walk the source directories directly instead of calling listTemplates()/
// listSchemes() to build the expectation — otherwise the assertions below would just be checking
// those functions against themselves. Reading the filesystem independently means the tests still
// catch a template or scheme the API fails to report, or one it invents, while surviving a fourth
// template or scheme being added later.
function templateIdsOnDisk() {
  return readdirSync('templates')
    .filter((name) => existsSync(join('templates', name, 'manifest.json')))
    .sort();
}

function schemeIdsOnDisk() {
  return readdirSync(join('styles', 'schemes'))
    .filter((name) => name.endsWith('.css'))
    .map((name) => name.slice(0, -'.css'.length))
    .sort();
}

describe('factory API', () => {
  it('lists templates read from disk', async () => {
    const data = await fetch(`${base}/api/templates`).then((r) => r.json());
    expect(data.templates.map((t) => t.id)).toEqual(templateIdsOnDisk());
    expect(data.templates[0].name).toBeTruthy();
  });

  it('lists colour schemes read from disk', async () => {
    const data = await fetch(`${base}/api/schemes`).then((r) => r.json());
    expect(data.schemes).toEqual(schemeIdsOnDisk());
  });

  it('lists example folders that actually hold content', async () => {
    const data = await fetch(`${base}/api/examples`).then((r) => r.json());
    expect(data.examples).toContain('default');
    expect(data.examples).toContain('broken');
  });

  it('builds a site and reports success', async () => {
    rmSync(join('output', 'api-test.com'), { recursive: true, force: true });

    const start = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'API Test',
        template: 't2',
        scheme: 'green',
        example: 'default',
        domain: 'api-test.com',
        partnerUrl: 'https://partner.example/go',
      }),
    }).then((r) => r.json());

    expect(start.buildId).toBeTruthy();
    expect(start.domain).toBe('api-test.com');

    const log = await readUntilDone(start.buildId);
    expect(log).toContain('event: done');

    const status = await fetch(`${base}/api/builds/${start.buildId}`).then((r) => r.json());
    expect(status.status).toBe('ok');
    expect(existsSync(join('output', 'api-test.com', 'index.html'))).toBe(true);
  });

  it('serves a built site for preview', async () => {
    const response = await fetch(`${base}/preview/api-test.com/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Find what actually works');
  });

  it('returns a zip of a built site', async () => {
    const response = await fetch(`${base}/api/output/api-test.com/zip`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('zip');
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.toString('ascii', 0, 2)).toBe('PK');

    // Being over 100 bytes and starting with 'PK' is also true of a truncated, corrupt zip
    // (see the test below) — actually inspect the archive: every filesystem entry on disk,
    // nested ones included, must have made it in.
    const expectedEntries = countFsEntriesRecursively(join('output', 'api-test.com'));
    expect(readZipEntryCount(buffer)).toBe(expectedEntries);

    const names = readZipEntryNames(buffer);
    expect(names).toContain('about/index.html');
    expect(names).toContain('images/logo.svg');
  });

  it('rejects a truncated copy of the same archive as corrupt', async () => {
    const response = await fetch(`${base}/api/output/api-test.com/zip`);
    const buffer = Buffer.from(await response.arrayBuffer());

    // The central directory and the End Of Central Directory record both live at the tail of
    // the file; chopping it off leaves the 'PK' header and well over 100 bytes intact, so the
    // old assertions would both still pass on this — exactly the gap this test closes.
    const truncated = buffer.subarray(0, 500);
    expect(truncated.length).toBeGreaterThan(100);
    expect(truncated.toString('ascii', 0, 2)).toBe('PK');

    expect(() => readZipEntryCount(truncated)).toThrow();
  });

  it('answers 404 when there is nothing to zip', async () => {
    const response = await fetch(`${base}/api/output/never-built.com/zip`);
    expect(response.status).toBe(404);
  });

  it('refuses to zip a domain whose build is still running', async () => {
    const domain = 'zip-during-build.com';
    const fakeChild = new EventEmitter();
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();
    // The fake child never emits 'close', so this build stays 'running' for the life of the
    // test — enough to prove the zip route refuses it, with no need for a real racing rebuild.
    startBuild({ domain, outDir: join('output', domain), env: {} }, () => fakeChild);

    const response = await fetch(`${base}/api/output/${domain}/zip`);
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.error).toContain(domain);
  });

  it('falls back to the example name when no domain is given', async () => {
    const start = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ example: 'default', template: 't1', scheme: 'blue' }),
    }).then((r) => r.json());

    expect(start.domain).toBe('default');
    await readUntilDone(start.buildId);
  });

  it('refuses a second build for a domain that already has one running', async () => {
    const domain = 'concurrent-test.com';
    const headers = { 'Content-Type': 'application/json' };
    const payload = JSON.stringify({ example: 'default', domain });

    const first = await fetch(`${base}/api/generate`, { method: 'POST', headers, body: payload }).then(
      (r) => r.json(),
    );
    expect(first.buildId).toBeTruthy();

    const second = await fetch(`${base}/api/generate`, { method: 'POST', headers, body: payload });
    expect(second.status).toBe(409);
    const data = await second.json();
    expect(data.error).toContain(domain);

    await readUntilDone(first.buildId);
  });

  it('refuses an example that does not exist', async () => {
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ example: 'does-not-exist' }),
    });
    expect(response.status).toBe(400);
  });

  it('keeps the output directory inside the project even for a domain that tries to escape it', async () => {
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ example: 'default', domain: '../../../../etc/passwd' }),
    });
    expect(response.status).toBe(200);

    const data = await response.json();
    const projectOutput = resolve('output');
    expect(resolve(data.outDir).startsWith(projectOutput + sep)).toBe(true);

    await readUntilDone(data.buildId);
  });

  it('truncates an absurdly long domain name to a sane length', async () => {
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ example: 'default', domain: 'a'.repeat(300) }),
    });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.domain.length).toBeLessThanOrEqual(100);

    await readUntilDone(data.buildId);
  });

  it('answers 404 for an unknown build', async () => {
    const response = await fetch(`${base}/api/builds/nope`);
    expect(response.status).toBe(404);
  });
});

// Finding M2: example, template and scheme used to be pushed through safeName — the same
// lowercase-and-strip-unsafe-characters helper that is correct for `domain`, because a domain
// names a directory this server creates. But these three values are ids the server's own list
// endpoints already read verbatim from disk (folder names, template ids, scheme filenames), so
// mangling them before checking makes a perfectly real, listed value fail to round-trip: it
// stops matching the real entry and the request silently resolves to something else (or, for
// `example`, is wrongly rejected as not found). The fixture ids below use a space/parentheses —
// characters safeName replaces, not just re-cases — chosen to sort after every real t1/t2/t3
// template and blue/dark/green scheme id, so a fallback-to-first-available would never
// coincidentally land on the right file and mask the bug.
describe('example, template and scheme are validated against the real lists, not rewritten (M2)', () => {
  it('accepts an example folder name safeName would mangle into a 404', async () => {
    const exampleId = 'My Example';
    const exampleDir = join('data', 'examples', exampleId);
    const domain = 'safename-example-test.com';
    mkdirSync(exampleDir, { recursive: true });
    writeFileSync(
      join(exampleDir, 'site.json'),
      JSON.stringify({
        pages: [{ slug: '/', meta: { title: 'Fixture Example Content' }, blocks: [] }],
      }),
    );

    try {
      const response = await fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ example: exampleId, domain }),
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      await readUntilDone(data.buildId);
      expect(readFileSync(join('output', domain, 'index.html'), 'utf8')).toContain(
        'Fixture Example Content',
      );
    } finally {
      rmSync(exampleDir, { recursive: true, force: true });
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });

  it('accepts a colour scheme id safeName would mangle past recognition', async () => {
    const schemeId = 'warm (sunset)';
    const schemeFile = join('styles', 'schemes', `${schemeId}.css`);
    const domain = 'safename-scheme-test.com';
    // Copies an existing scheme's variables verbatim (so the "every scheme defines the same
    // variables" invariant still holds) but keeps a --c-primary no real scheme uses, so the
    // built page can prove which file actually got read.
    writeFileSync(schemeFile, readFileSync(join('styles', 'schemes', 'dark.css'), 'utf8'));

    try {
      const response = await fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ example: 'default', template: 't1', scheme: schemeId, domain }),
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      await readUntilDone(data.buildId);
      expect(readFileSync(join('output', domain, 'index.html'), 'utf8')).toContain('#4d97ff');
    } finally {
      rmSync(schemeFile, { force: true });
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });

  it('accepts a template id safeName would mangle past recognition', async () => {
    const templateId = 'warm (sunset)';
    const templateDir = join('templates', templateId);
    const domain = 'safename-template-test.com';
    mkdirSync(join(templateDir, 'blocks'), { recursive: true });
    writeFileSync(
      join(templateDir, 'manifest.json'),
      JSON.stringify({ id: templateId, name: 'Fixture', blocks: [], defaultScheme: 'dark' }),
    );

    try {
      // No scheme in the request: the engine falls back to the resolved template's own
      // defaultScheme, so the colour in the page proves which template actually got used.
      const response = await fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ example: 'default', template: templateId, domain }),
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      await readUntilDone(data.buildId);
      expect(readFileSync(join('output', domain, 'index.html'), 'utf8')).toContain('#4d97ff');
    } finally {
      rmSync(templateDir, { recursive: true, force: true });
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });

  it('refuses a colour scheme that is not in the real list instead of silently substituting one', async () => {
    const domain = 'safename-scheme-reject-test.com';
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ example: 'default', scheme: 'totally-bogus-scheme', domain }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('totally-bogus-scheme');
    expect(existsSync(join('output', domain))).toBe(false);
  });

  it('refuses a template that is not in the real list instead of silently substituting one', async () => {
    const domain = 'safename-template-reject-test.com';
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ example: 'default', template: 'totally-bogus-template', domain }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('totally-bogus-template');
    expect(existsSync(join('output', domain))).toBe(false);
  });

  it('still treats an absent template and scheme as "use the default"', async () => {
    const domain = 'safename-defaults-test.com';
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ example: 'default', domain }),
    });
    expect(response.status).toBe(200);

    const data = await response.json();
    try {
      await readUntilDone(data.buildId);
      expect(existsSync(join('output', domain, 'index.html'))).toBe(true);
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });
});

// Finding M3: nothing followed BRAND, LOCALE, DOMAIN or PARTNER_URL all the way from the form
// through the server's env plumbing into the actual built HTML — tests/server.test.mjs posted
// brand/partnerUrl but only ever checked that the build succeeded. That gap would let the two
// ends of the factory/server.mjs <-> src/lib/site-context.mjs env-variable contract drift (e.g.
// a rename on one side) without a single one of the 116 existing tests noticing, even though
// every generated site would silently lose the field. This drives a real build through the
// public HTTP API with all four fields set and reads them back out of the generated page.
describe('form values reach the built HTML end to end (M3)', () => {
  it('carries brand, locale, domain and the affiliate link from the form into the built HTML', async () => {
    const domain = 'seam-test.example';
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        example: 'default',
        template: 't1',
        scheme: 'dark',
        domain,
        brand: 'Seam Test Brand',
        geo: 'ID',
        locale: 'fr-FR',
        partnerUrl: 'https://partner.example/seam-test-affiliate',
      }),
    });
    expect(response.status).toBe(200);

    const data = await response.json();
    try {
      await readUntilDone(data.buildId);

      const html = readFileSync(join('output', domain, 'index.html'), 'utf8');
      expect(html).toContain('Seam Test Brand');
      expect(html).toContain('lang="fr"');
      expect(html).toContain(`<link rel="canonical" href="https://${domain}/"`);
      expect(html).toContain('href="https://partner.example/seam-test-affiliate"');
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });
});

// These exercise the chunk-decoding and process-handling logic directly rather than through
// the HTTP API: a real Astro build's stdout/stderr chunking is not controllable from a test
// (chunk boundaries depend on OS pipe buffering), so there is no reliable way to force a
// multi-byte character split, a CRLF line ending, or a spawn failure through POST /api/generate.
describe('build log line splitting', () => {
  it('holds a multi-byte UTF-8 character until the split bytes complete it', () => {
    const lines = [];
    const splitter = createLineSplitter((line) => lines.push(line));

    const text = 'Предупреждение: файл не найден';
    const bytes = Buffer.from(`${text}\n`, 'utf8');
    // Split inside the first (2-byte) Cyrillic character, mirroring how a real Astro build's
    // stderr chunks land mid-character.
    splitter.write(bytes.subarray(0, 1));
    splitter.write(bytes.subarray(1));

    expect(lines).toEqual([text]);
  });

  it('strips a trailing carriage return from CRLF line endings', () => {
    const lines = [];
    const splitter = createLineSplitter((line) => lines.push(line));

    splitter.write(Buffer.from('first line\r\nsecond line\r\n', 'utf8'));

    expect(lines).toEqual(['first line', 'second line']);
  });
});

describe('build process handling', () => {
  it('does not report a second failure line when close fires after error', () => {
    const fakeChild = new EventEmitter();
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();

    const build = startBuild(
      { domain: '__fake_spawn_failure__', outDir: '/tmp/__fake_spawn_failure__', env: {} },
      () => fakeChild,
    );

    fakeChild.emit('error', new Error('spawn astro ENOENT'));
    fakeChild.emit('close', -2, null);

    expect(build.status).toBe('failed');
    expect(build.lines).toEqual(['Не удалось запустить сборку: spawn astro ENOENT']);
  });
});

// These drive the zip route's data-loss detection directly, the same way the section above
// drives startBuild directly: hitting the route over HTTP and hoping a delete lands inside
// archiver's directory scan from outside the process is not reliable. The first three cases
// below exercise the decision logic with a fake archive/response; the last one reproduces a
// genuine vanished-file race deterministically, by controlling exactly when the file is
// deleted relative to two synchronous calls instead of relying on timing luck.
describe('zip archive completeness guard', () => {
  it('destroys the response when fewer entries arrive than were counted on disk', () => {
    const archive = new EventEmitter();
    let destroyed = false;
    const res = { destroy: () => { destroyed = true; } };

    guardArchiveCompleteness(archive, res, 3);
    archive.emit('entry', { name: 'a' });
    archive.emit('entry', { name: 'b' });
    // The third entry never arrives — e.g. its file disappeared before archiver's directory
    // scan reached it, which fires neither 'error' nor 'warning'.
    archive.emit('end');

    expect(destroyed).toBe(true);
  });

  it('leaves the response alone when every expected entry made it into the archive', () => {
    const archive = new EventEmitter();
    let destroyed = false;
    const res = { destroy: () => { destroyed = true; } };

    guardArchiveCompleteness(archive, res, 2);
    archive.emit('entry', { name: 'a' });
    archive.emit('entry', { name: 'b' });
    archive.emit('end');

    expect(destroyed).toBe(false);
  });

  it('destroys the response on a warning even when the entry count matches', () => {
    const archive = new EventEmitter();
    let destroyed = false;
    const res = { destroy: () => { destroyed = true; } };

    guardArchiveCompleteness(archive, res, 1);
    archive.emit('warning', new Error('ENOENT: no such file or directory, lstat'));
    archive.emit('entry', { name: 'a' });
    archive.emit('end');

    expect(destroyed).toBe(true);
  });

  it('counts files and directories recursively, matching what archiver emits an entry for', () => {
    const dir = join('output', '__count-entries-guard-test__');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'about'), { recursive: true });
    mkdirSync(join(dir, 'images'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), 'x');
    writeFileSync(join(dir, 'about', 'index.html'), 'x');
    writeFileSync(join(dir, 'images', 'logo.svg'), 'x');

    // index.html, about/, about/index.html, images/, images/logo.svg = 5. archiver's
    // directory() walk (readdir-glob without `nodir`) emits an 'entry' for subdirectories
    // too, not just for files, so this count must include them to ever match a real archive.
    expect(countEntriesRecursively(dir)).toBe(5);

    rmSync(dir, { recursive: true, force: true });
  });

  it('catches a real file deleted right after the scan starts, with no error or warning from archiver', async () => {
    const dir = join('output', '__guard-real-race-test__');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.txt'), 'a');
    writeFileSync(join(dir, 'b.txt'), 'b');

    const expectedEntryCount = countEntriesRecursively(dir);
    let destroyed = false;
    const res = { destroy: () => { destroyed = true; } };
    const archive = new ZipArchive({ zlib: { level: 9 } });
    let sawError = false;
    let sawWarning = false;
    archive.on('error', () => { sawError = true; });
    archive.on('warning', () => { sawWarning = true; });
    archive.on('data', () => {}); // drain so the stream actually reaches 'end'
    guardArchiveCompleteness(archive, res, expectedEntryCount);

    // archiver's directory scan only starts on a callback scheduled by directory(), not
    // synchronously within the call itself — so deleting a file right after that call, in the
    // same synchronous block, is guaranteed to land before the scan ever lists it. This
    // reproduces the exact race from the finding deterministically, with no real timing luck.
    archive.directory(dir, false);
    unlinkSync(join(dir, 'b.txt'));
    archive.finalize();

    await new Promise((resolve) => archive.on('end', resolve));

    expect(sawError).toBe(false);
    expect(sawWarning).toBe(false);
    expect(destroyed).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});
