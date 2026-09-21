import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
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

// The main test app must never see the owner's real .env or reach Runware: it builds 899ok again
// and again, and a real key there would spend real money.
const NO_ENV_FILE = join(tmpdir(), 'site-factory-no-such-dir', '.env');
const refuseNetwork = async () => {
  throw new Error('tests must not reach the network');
};

beforeAll(async () => {
  server = createApp({ envFile: NO_ENV_FILE, fetchFn: refuseNetwork }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
});

async function readUntilDone(buildId, origin = base) {
  const response = await fetch(`${origin}/api/builds/${buildId}/log`);
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

// What the stream's own `done` event carries — 'ok' or 'failed' — read out of the raw SSE text
// `readUntilDone` already collected, rather than a second round trip through GET /api/builds/:id.
// A build/job that never reaches 'done' (still 'running') has nothing here to match, so this
// returns undefined instead of throwing — a wrong status is a clearer failure than a crash.
function doneStatus(log) {
  const match = log.match(/event: done\ndata: (.+)/);
  return match ? JSON.parse(match[1]) : undefined;
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

// Same "read the filesystem independently" principle as the two helpers above: parses
// factory/geos.json itself rather than calling loadGeos, so the /api/geos assertions below do
// not just check that function against itself.
function geosOnDisk() {
  return JSON.parse(readFileSync(join('factory', 'geos.json'), 'utf8'));
}

// Same principle once more, applied to layouts/: reads the folder itself instead of calling
// loadLayouts, so the /api/layouts assertion below does not check that function against itself,
// and survives a second layout file being added later. The id is the file name and the name is
// prose inside the file (falling back to the id when a file gives none) — the same two-line rule
// loadLayouts states, restated here rather than imported for exactly that reason.
// The source sites the review theme has an example from on every one of its pages — which is what
// the picker may offer, since a run builds the whole site from one name.
function examplesOnDisk(templateId = 'review') {
  const dir = join('templates', templateId, 'examples');
  const lists = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      readdirSync(join(dir, entry.name))
        .filter((file) => file.endsWith('.json'))
        .sort()
        .map((file) => file.slice(0, -'.json'.length)),
    );
  return (lists[0] ?? [])
    .filter((name) => lists.every((list) => list.includes(name)))
    .map((name) => ({ id: name, name }));
}

// Same "read the filesystem independently" principle as the two helpers above, applied to a site
// folder under data/sites: the page count is every *.json file in the folder except the two
// service files, site.json and images.json — spelled out here rather than imported from
// src/lib/site-dir.mjs, so the assertions below check the /api/sites route against content on disk,
// not against the same rule the route itself calls.
function pageCountOnDisk(siteId) {
  return readdirSync(join('data', 'sites', siteId)).filter(
    (name) => name.endsWith('.json') && name !== 'site.json' && name !== 'images.json',
  ).length;
}

function siteBrandOnDisk(siteId) {
  const file = join('data', 'sites', siteId, 'site.json');
  if (!existsSync(file)) return '';
  const name = JSON.parse(readFileSync(file, 'utf8'))?.brand?.name;
  return typeof name === 'string' ? name : '';
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

  // The order matters as much as the content: the owner puts the countries they use most at the
  // top of factory/geos.json on purpose, and that order is meant to survive all the way into the
  // dropdown — so this checks countries as an ordered array (toEqual), not merely which ones
  // showed up.
  it('lists geos read from disk, each country with its locale, and the distinct locales', async () => {
    const data = await fetch(`${base}/api/geos`).then((r) => r.json());
    const raw = geosOnDisk();
    expect(data.countries).toEqual(Object.entries(raw).map(([name, locale]) => ({ name, locale })));
    expect(data.locales).toEqual([...new Set(Object.values(raw))]);
  });

  // What the «Раскладка» dropdown on the Тексты tab is filled from. Two things are asserted at
  // once by comparing whole objects: every layout on disk is offered, and each is offered as the
  // pair a dropdown needs — the id that goes back to the server and the prose name a person reads.
  // A route that answered ids alone would leave the list unreadable, and one that answered whole
  // layout files would ship every block list to the browser to be thrown away there.
  it('lists the source sites a theme has an example from on every page', async () => {
    const data = await fetch(`${base}/api/examples?template=review`).then((r) => r.json());
    expect(data.examples).toEqual(examplesOnDisk());
    expect(data.examples.length).toBeGreaterThan(0);
  });

  it('lists site folders read from disk, each with its page count and brand name', async () => {
    const data = await fetch(`${base}/api/sites`).then((r) => r.json());
    const byId = Object.fromEntries(data.sites.map((site) => [site.id, site]));

    // `broken` used to live under data/sites and be listed here too; it moved to
    // tests/fixtures/sites/broken (finding I3) precisely so it is not a real, listed site.
    for (const siteId of ['899ok']) {
      expect(byId[siteId], `expected ${siteId} in /api/sites`).toBeTruthy();
      expect(byId[siteId].pages).toBe(pageCountOnDisk(siteId));
      expect(byId[siteId].brand).toBe(siteBrandOnDisk(siteId));
    }
  });

  it('does not count images.json as a page', async () => {
    const siteId = 'images-count-fixture';
    const siteDir = join('data', 'sites', siteId);
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(join(siteDir, 'home.json'), JSON.stringify({ title: 'Home', blocks: [] }));
    writeFileSync(
      join(siteDir, 'images.json'),
      JSON.stringify({ main: { src: '/images/main.webp', alt: 'Main' } }),
    );
    try {
      const data = await fetch(`${base}/api/sites`).then((r) => r.json());
      expect(data.sites.find((site) => site.id === siteId)?.pages).toBe(1);
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
    }
  });

  it('builds a real site folder end to end and the page holds that folder\'s own content', async () => {
    const domain = 'sites-e2e-test.com';
    rmSync(join('output', domain), { recursive: true, force: true });

    const start = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: '899ok', template: 'review', scheme: 'dark', domain }),
    }).then((r) => r.json());

    try {
      const log = await readUntilDone(start.buildId);
      expect(log).toContain('event: done');

      // Pulled straight from data/sites/899ok/home.json's own hero heading — proves the built
      // page is genuinely assembled from that folder's content, not merely that a build ran.
      const html = readFileSync(join('output', domain, 'index.html'), 'utf8');
      expect(html).toContain('Everyday Casino');
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });

  it('builds a site and reports success', async () => {
    rmSync(join('output', 'api-test.com'), { recursive: true, force: true });

    const start = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'API Test',
        scheme: 'dark',
        site: '899ok',
        domain: 'api-test.com',
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
    expect(await response.text()).toContain('Everyday Casino');
  });

  it('rewrites a preview page\'s absolute links onto the preview prefix', async () => {
    const page = await fetch(`${base}/preview/api-test.com/`).then((r) => r.text());
    // The nav links a site ships are absolute (/casino) because that is right once it is deployed
    // at a domain root; under the preview prefix they would leave it and hit the factory itself.
    expect(page).not.toMatch(/href="\/(?!preview\/)[a-z]/);
    expect(page).toMatch(/href="\/preview\/api-test\.com\//);
    expect(page).not.toContain('/preview/api-test.com/preview/');
  });

  it('leaves the links on disk absolute, since that is what ships', () => {
    const html = readFileSync(join('output', 'api-test.com', 'index.html'), 'utf8');
    expect(html).not.toContain('/preview/');
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
    expect(names).toContain('casino/index.html');
    expect(names).toContain('robots.txt');
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

  it('falls back to the site name when no domain is given', async () => {
    const start = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: '899ok', scheme: 'dark' }),
    }).then((r) => r.json());

    expect(start.domain).toBe('899ok');
    await readUntilDone(start.buildId);
  });

  // Finding C2: the zip route used to check only "no build currently running" and "index.html
  // exists" — neither of which tells "finished cleanly" apart from "crashed partway through,
  // after already writing some pages (including a home page)". A crash like the one in C1 can
  // leave a fully-present index.html and Astro's own leftover .prerender/ server bundle sitting
  // right next to it, and the old checks would happily zip that up and serve it as if it were a
  // finished site. These drive startBuild directly with a fake child process (the same pattern
  // the "still running" test above uses) so the "failed" state is reached deterministically,
  // with no need for a real crashing build.
  it('refuses to zip a domain whose most recent recorded build failed', async () => {
    const domain = 'zip-after-failed-build.com';
    rmSync(join('output', domain), { recursive: true, force: true });
    const fakeChild = new EventEmitter();
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();
    startBuild({ domain, outDir: join('output', domain), env: {} }, () => fakeChild);
    fakeChild.emit('close', 1); // a non-zero exit marks this build 'failed'

    const response = await fetch(`${base}/api/output/${domain}/zip`);
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.error).toContain(domain);
  });

  it('refuses to zip a domain whose most recent build failed even though an index.html already exists', async () => {
    // Reproduces the exact C1-crash scenario: a home page (and, in a real crash, a stray
    // .prerender/ directory) already made it to disk before the build died partway through —
    // the plain "does index.html exist" check alone would say this is fine to ship.
    const domain = 'zip-after-failed-build-with-partial-output.com';
    const dir = join('output', domain);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<html>partial</html>');

    const fakeChild = new EventEmitter();
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();
    startBuild({ domain, outDir: dir, env: {} }, () => fakeChild);
    fakeChild.emit('close', 1);

    const response = await fetch(`${base}/api/output/${domain}/zip`);
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.error).toContain(domain);

    rmSync(dir, { recursive: true, force: true });
  });

  it('still serves a zip when no build is recorded for the domain at all', async () => {
    // Absence of a build record (server restarted, or the folder predates this process) is not
    // evidence that anything failed — this domain's output is written directly to disk, with no
    // call to startBuild, so the server has no record of it whatsoever.
    const domain = 'zip-no-build-record.com';
    const dir = join('output', domain);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<html>unrecorded but real</html>');

    try {
      const response = await fetch(`${base}/api/output/${domain}/zip`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('zip');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a second build for a domain that already has one running', async () => {
    const domain = 'concurrent-test.com';
    const headers = { 'Content-Type': 'application/json' };
    const payload = JSON.stringify({ site: '899ok', domain });

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

  it('refuses a site that does not exist', async () => {
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: 'does-not-exist' }),
    });
    expect(response.status).toBe(400);
  });

  // `site` is checked against listSiteNames() — literal entries of readdirSync('data/sites') — the
  // same exact-match-against-a-real-list pattern M2 below relies on for template and scheme. A
  // traversal string can never equal one of those literal folder names, so this can never reach
  // `join(SITES_DIR, site)` with anything that escapes it; it is refused as simply unknown.
  it('refuses a site folder name that attempts path traversal', async () => {
    const sitesBefore = readdirSync(join('data', 'sites')).sort();
    const domain = 'traversal-site-test.com';

    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: '../../../../etc', domain }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeTruthy();

    expect(readdirSync(join('data', 'sites')).sort()).toEqual(sitesBefore);
    expect(existsSync(join('output', domain))).toBe(false);
  });

  it('keeps the output directory inside the project even for a domain that tries to escape it', async () => {
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: '899ok', domain: '../../../../etc/passwd' }),
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
      body: JSON.stringify({ site: '899ok', domain: 'a'.repeat(300) }),
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

// Finding M2: site, template and scheme used to be pushed through safeName — the same
// lowercase-and-strip-unsafe-characters helper that is correct for `domain`, because a domain
// names a directory this server creates. But these three values are ids the server's own list
// endpoints already read verbatim from disk (folder names, template ids, scheme filenames), so
// mangling them before checking makes a perfectly real, listed value fail to round-trip: it
// stops matching the real entry and the request silently resolves to something else (or, for
// `site`, is wrongly rejected as not found). The fixture ids below use a space/parentheses —
// characters safeName replaces, not just re-cases — chosen to sort after every real template and
// scheme id, so a fallback-to-first-available would never coincidentally land on the right file
// and mask the bug.
// A colour no scheme on disk uses, so a built page containing it can only have got it from the
// fixture file written below — that is what makes these tests prove which file was actually read
// rather than merely that a build succeeded.
const FIXTURE_PRIMARY = '#4d97ff';

// Copies a real scheme's variables (so the "every scheme defines the same variables" invariant
// still holds) with only --c-primary swapped for the marker colour above.
function fixtureSchemeCss() {
  return readFileSync(join('styles', 'schemes', 'dark.css'), 'utf8').replace(
    /--c-primary:\s*[^;]+;/,
    `--c-primary: ${FIXTURE_PRIMARY};`,
  );
}

// A dedicated app per test, pointed at a throwaway geosFile instead of the real
// factory/geos.json — the same isolation pattern the picture- and logo-generation describe
// blocks below use for their own tmp .env. GET /api/geos must survive a geos.json that cannot be
// read at all, exactly as badly as it must survive one that parses but fails validation: a broken
// file on this tab must not stop someone building a site on the Генерация tab.
describe('GET /api/geos survives a broken geos.json', () => {
  let dir;
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function geosResponseFor(geosFile) {
    const app = createApp({ envFile: NO_ENV_FILE, fetchFn: refuseNetwork, geosFile });
    const brokenServer = app.listen(0);
    await new Promise((resolve) => brokenServer.once('listening', resolve));
    const origin = `http://127.0.0.1:${brokenServer.address().port}`;
    try {
      const response = await fetch(`${origin}/api/geos`);
      return { status: response.status, body: await response.json() };
    } finally {
      brokenServer.close();
    }
  }

  it('answers with empty lists, not an error, when the file is not valid JSON', async () => {
    dir = mkdtempSync(join(tmpdir(), 'site-factory-broken-geos-'));
    const geosFile = join(dir, 'geos.json');
    writeFileSync(geosFile, '{ not json');

    const { status, body } = await geosResponseFor(geosFile);
    expect(status).toBe(200);
    expect(body).toEqual({ countries: [], locales: [] });
  });

  it('answers with empty lists, not an error, when the file does not exist at all', async () => {
    const geosFile = join(tmpdir(), 'site-factory-geos-does-not-exist', 'geos.json');

    const { status, body } = await geosResponseFor(geosFile);
    expect(status).toBe(200);
    expect(body).toEqual({ countries: [], locales: [] });
  });
});

// A layouts folder that cannot be read is the same kind of accident as the broken geos.json above,
// and earns the same answer for the same reason: loadLayouts throws for a missing folder, an empty
// one and an unreadable file alike, and thrown out of a route handler that becomes a 500 — so one
// hand-edited layout file would take down the whole Тексты tab, and the Генерация tab beside it,
// for somebody who was not going to touch that dropdown at all. Refusing to *start a run* without
// a usable layout is right and happens elsewhere; refusing to draw the page is not.
// Pointed at a throwaway folder, the same isolation the geosFile tests above use: the real
// layouts/ is expected to be in working order, and a test may not break it to find out.
describe('GET /api/examples survives a theme with no examples', () => {
  it('answers with an empty list, not an error', async () => {
    const response = await fetch(`${base}/api/examples?template=no-such-theme`);
    expect(response.status).toBe(200);
    expect((await response.json()).examples).toEqual([]);
  });
});

describe('site, template and scheme are validated against the real lists, not rewritten (M2)', () => {
  it('accepts a site folder name safeName would mangle into a 404', async () => {
    const siteId = 'My Site';
    const siteDir = join('data', 'sites', siteId);
    const domain = 'safename-site-test.com';
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(
      join(siteDir, 'home.json'),
      JSON.stringify({ title: 'Fixture Site Content', blocks: [] }),
    );

    try {
      const response = await fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: siteId, domain }),
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      await readUntilDone(data.buildId);
      expect(readFileSync(join('output', domain, 'index.html'), 'utf8')).toContain(
        'Fixture Site Content',
      );
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });

  it('accepts a colour scheme id safeName would mangle past recognition', async () => {
    const schemeId = 'warm (sunset)';
    const schemeFile = join('styles', 'schemes', `${schemeId}.css`);
    const domain = 'safename-scheme-test.com';
    writeFileSync(schemeFile, fixtureSchemeCss());

    try {
      const response = await fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: '899ok', scheme: schemeId, domain }),
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      await readUntilDone(data.buildId);
      expect(readFileSync(join('output', domain, 'index.html'), 'utf8')).toContain(FIXTURE_PRIMARY);
    } finally {
      rmSync(schemeFile, { force: true });
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });

  it('accepts a template id safeName would mangle past recognition', async () => {
    const templateId = 'warm (sunset)';
    const templateDir = join('templates', templateId);
    // The fixture template points at a fixture scheme rather than the real one: with a single
    // scheme shipped, a template whose defaultScheme is that scheme proves nothing — the same
    // colour would land in the page from the fall-back-to-first-available path this is meant to
    // catch. A scheme only this template names cannot arrive by accident.
    const schemeId = 'warm (sunset)';
    const schemeFile = join('styles', 'schemes', `${schemeId}.css`);
    const domain = 'safename-template-test.com';
    writeFileSync(schemeFile, fixtureSchemeCss());
    mkdirSync(join(templateDir, 'blocks'), { recursive: true });
    writeFileSync(
      join(templateDir, 'manifest.json'),
      JSON.stringify({ id: templateId, name: 'Fixture', blocks: [], defaultScheme: schemeId }),
    );

    try {
      // No scheme in the request: the engine falls back to the resolved template's own
      // defaultScheme, so the colour in the page proves which template actually got used.
      const response = await fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: '899ok', template: templateId, domain }),
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      await readUntilDone(data.buildId);
      expect(readFileSync(join('output', domain, 'index.html'), 'utf8')).toContain(FIXTURE_PRIMARY);
    } finally {
      rmSync(schemeFile, { force: true });
      rmSync(templateDir, { recursive: true, force: true });
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });

  it('refuses a colour scheme that is not in the real list instead of silently substituting one', async () => {
    const domain = 'safename-scheme-reject-test.com';
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: '899ok', scheme: 'totally-bogus-scheme', domain }),
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
      body: JSON.stringify({ site: '899ok', template: 'totally-bogus-template', domain }),
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
      body: JSON.stringify({ site: '899ok', domain }),
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

  // Follow-up finding: `trimmedString` maps ANY non-string value (a number, an object, `null`,
  // an array) to '' — the exact same result as a field that was never sent at all — so
  // `{"template": 42}` used to sail past the `template !== ''` guard and silently build with the
  // first available template instead of being refused the way an unknown *string* id already is.
  // That is asymmetric: a caller who sends garbage of the right type gets a clear 400, but a
  // caller who sends garbage of the wrong type gets an unannounced substitution.
  it('refuses a present but non-string template instead of silently using the default', async () => {
    const domain = 'non-string-template-test.com';
    rmSync(join('output', domain), { recursive: true, force: true });
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: '899ok', template: 42, domain }),
    });
    expect(response.status).toBe(400);
    expect(existsSync(join('output', domain))).toBe(false);
  });

  it('refuses a present but non-string scheme instead of silently using the default', async () => {
    const domain = 'non-string-scheme-test.com';
    rmSync(join('output', domain), { recursive: true, force: true });
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: '899ok', scheme: 42, domain }),
    });
    expect(response.status).toBe(400);
    expect(existsSync(join('output', domain))).toBe(false);
  });
});

// Finding M3: nothing followed BRAND, LOCALE, DOMAIN or PARTNER_URL all the way from the form
// through the server's env plumbing into the actual built HTML — tests/server.test.mjs posted
// brand/geo/locale/domain but only ever checked that the build succeeded. That gap would let the
// two ends of the factory/server.mjs <-> src/lib/site-context.mjs env-variable contract drift
// (e.g. a rename on one side) without a single test in this suite noticing, even though every
// generated site would silently lose the field. This drives a real build through the public HTTP
// API with all four fields set and reads them back out of the generated page. PARTNER_URL follows
// the identical override pattern one line away in normalize.mjs (see pickOverride's four other
// callers there) but has no observable effect once rendered: PARTNER_URL/site.partnerUrl was only
// ever rendered by the now-deleted t1/t2/t3 templates' own hero/cards/footer CTA, and the review
// template declares no such element at all — so there is nothing left in the built HTML for this
// test to read it back out of.
describe('form values reach the built HTML end to end (M3)', () => {
  it('carries brand, geo, locale and domain from the form into the built HTML', async () => {
    const domain = 'seam-test.example';
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site: '899ok',
        scheme: 'dark',
        domain,
        brand: 'Seam Test Brand',
        geo: 'ID',
        locale: 'fr-FR',
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
      // The one field this test posted but never checked: a rename of GEO on either side of the
      // server<->engine env-variable boundary would leave every other assertion here green while
      // silently dropping meta[name=geo.region] from every built site.
      expect(html).toContain('name="geo.region" content="ID"');
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });
});

// final-fix-5, follow-up 1: a build can succeed with no page at "/" at all — the shipped
// `broken` site's only page resolves to "/sloppy" — so Astro never writes a root index.html.
// The zip route used to gate entirely on that one file existing, and the preview route is plain
// express.static with `index: 'index.html'`, so both used to 404 even though the build finished
// cleanly and reported success. Decision: make both links work for such a site instead of
// only reporting the mismatch, since the build output is completely real and there is no reason
// to withhold it — the zip route's job is "was anything actually built", not "is there a page at
// this one specific path", and the preview route can simply serve whatever page really exists.
describe('final-fix-5: a successful build with no page at "/" still has a working zip and preview', () => {
  // The broken fixture lives under tests/fixtures/sites, not data/sites (finding I3), and
  // /api/generate only ever builds a folder under data/sites — so these tests copy it into a
  // fixture folder there first, the same way other describes in this file stage their own fixture
  // sites. This app never sees a real .env and refuses any network call (see NO_ENV_FILE and
  // refuseNetwork above), so no generation can actually happen for it.
  const siteId = 'final-fix-5-broken-fixture';
  const siteDir = join('data', 'sites', siteId);

  beforeAll(() => {
    rmSync(siteDir, { recursive: true, force: true });
    cpSync(join('tests', 'fixtures', 'sites', 'broken'), siteDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(siteDir, { recursive: true, force: true });
  });

  it('zips a site whose only page is not at the root', async () => {
    const domain = 'no-root-page-zip-test.com';
    rmSync(join('output', domain), { recursive: true, force: true });

    const start = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: siteId, domain }),
    }).then((r) => r.json());

    try {
      const log = await readUntilDone(start.buildId);
      expect(log).toContain('event: done');
      const status = await fetch(`${base}/api/builds/${start.buildId}`).then((r) => r.json());
      expect(status.status).toBe('ok');
      expect(existsSync(join('output', domain, 'index.html'))).toBe(false);
      expect(existsSync(join('output', domain, 'sloppy', 'index.html'))).toBe(true);

      const response = await fetch(`${base}/api/output/${domain}/zip`);
      expect(response.status).toBe(200);
      const buffer = Buffer.from(await response.arrayBuffer());
      const names = readZipEntryNames(buffer);
      expect(names).toContain('sloppy/index.html');
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });

  it('serves a working preview for a site whose only page is not at the root', async () => {
    const domain = 'no-root-page-preview-test.com';
    rmSync(join('output', domain), { recursive: true, force: true });

    const start = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: siteId, domain }),
    }).then((r) => r.json());

    try {
      await readUntilDone(start.buildId);

      // fetch() follows the redirect automatically, the same way a browser follows the link the
      // UI hands out (see factory/public/app.js) — this must land on the real page, not a 404.
      const response = await fetch(`${base}/preview/${domain}/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Text still renders after every broken entry above it');
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });

  it('still serves the root page directly when a build does have one', async () => {
    // Regression guard: a normal build with a real "/" page must not be redirected anywhere.
    const response = await fetch(`${base}/preview/api-test.com/`);
    expect(response.status).toBe(200);
    expect(response.redirected).toBe(false);
    expect(await response.text()).toContain('Everyday Casino');
  });
});

// final-fix-5, follow-up 2: the failed-build guard above (C2) only ever consults the in-memory
// `builds` Map, which is empty again after every server restart — so a build that crashed in a
// previous process is indistinguishable from one that finished cleanly, and its (possibly
// partial) output becomes downloadable again. Astro's own `.prerender/` staging directory is a
// durable, on-disk fact instead: a crashed build leaves it behind, and any build that actually
// finishes — successfully, and regardless of whether it has a page at "/" — always removes it
// (verified directly against this repo's real `astro build` before writing this check). This
// adds that check alongside the in-memory one rather than replacing it, since the in-memory
// check is still what the fake-child-process tests above rely on to reach the 'failed' state
// deterministically, with no real Astro process involved to leave a real `.prerender/` behind.
describe('final-fix-5: a leftover .prerender/ directory is a durable crash signal (C2 follow-up)', () => {
  it('refuses to zip a domain with a leftover .prerender/ even with no build recorded at all', async () => {
    const domain = 'prerender-leftover-no-record.com';
    const dir = join('output', domain);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, '.prerender'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<html>partial, from a crash a previous process saw</html>');

    try {
      const response = await fetch(`${base}/api/output/${domain}/zip`);
      expect(response.status).toBe(409);
      const data = await response.json();
      expect(data.error).toContain(domain);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still serves a zip once nothing is left behind but a real, finished build', async () => {
    // Sanity check for the test above: the SAME shape of domain, with `.prerender/` actually
    // cleaned up (as any build that truly finished would leave it), must serve normally.
    const domain = 'prerender-cleaned-up.com';
    const dir = join('output', domain);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<html>finished</html>');

    try {
      const response = await fetch(`${base}/api/output/${domain}/zip`);
      expect(response.status).toBe(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('pictures are generated before the build', () => {
  const siteId = 'image-generation-fixture';
  const siteDir = join('data', 'sites', siteId);
  const SENTINEL = 'sentinel-runware-key-server-4e8b';
  let envDir;
  let pictureServer;
  let pictureBase;
  let requests;
  let respond;

  const picture = (task) =>
    new Response(
      JSON.stringify({
        data: [{ taskUUID: task.taskUUID, imageBase64Data: Buffer.from('fake webp').toString('base64'), cost: 0.001 }],
      }),
      { status: 200 },
    );

  function listFilesRecursively(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? listFilesRecursively(join(dir, entry.name)) : [join(dir, entry.name)],
    );
  }

  async function generate(domain, extra = {}) {
    rmSync(join('output', domain), { recursive: true, force: true });
    const start = await fetch(`${pictureBase}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: siteId, domain, ...extra }),
    }).then((r) => r.json());
    const log = await readUntilDone(start.buildId, pictureBase);
    const status = await fetch(`${pictureBase}/api/builds/${start.buildId}`).then((r) => r.json());
    return { log, status };
  }

  beforeAll(async () => {
    envDir = mkdtempSync(join(tmpdir(), 'site-factory-server-env-'));
    writeFileSync(join(envDir, '.env'), `RUNWARE_API_KEY=${SENTINEL}\n`);
    const fetchFn = async (_url, init) => {
      requests.push(init);
      return respond(JSON.parse(init.body)[0]);
    };
    pictureServer = createApp({ envFile: join(envDir, '.env'), fetchFn }).listen(0);
    await new Promise((resolve) => pictureServer.once('listening', resolve));
    pictureBase = `http://127.0.0.1:${pictureServer.address().port}`;
  });

  // Every test starts from a site whose one picture is missing: no images.json, no public/.
  beforeEach(() => {
    rmSync(siteDir, { recursive: true, force: true });
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(
      join(siteDir, 'home.json'),
      JSON.stringify({
        title: 'Pictures',
        blocks: [{ type: 'hero', content: [{ type: 'title', h1: 'Pictures' }, { image: 'hero-shot' }] }],
      }),
    );
    requests = [];
    respond = picture;
  });

  afterAll(() => {
    pictureServer?.close();
    rmSync(siteDir, { recursive: true, force: true });
    rmSync(envDir, { recursive: true, force: true });
  });

  it('generates missing pictures before the build, and the page shows them', async () => {
    const domain = 'image-generation-test.com';
    try {
      const { log, status } = await generate(domain);
      expect(status.status).toBe('ok');
      expect(requests).toHaveLength(1);
      const ready = log.indexOf('Картинка hero-shot готова');
      expect(ready).toBeGreaterThan(-1);
      expect(ready).toBeLessThan(log.indexOf('[build]'));
      // The site had no public/ folder when the request came in; the build must still see the
      // picture generation just put there.
      expect(readFileSync(join('output', domain, 'index.html'), 'utf8')).toContain(
        'src="/images/hero-shot.webp"',
      );
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });

  it('skips generation entirely when asked to', async () => {
    const domain = 'image-generation-skip-test.com';
    try {
      const { log, status } = await generate(domain, { skipImages: true });
      expect(status.status).toBe('ok');
      expect(requests).toHaveLength(0);
      expect(log).not.toContain('Картинк');
      expect(existsSync(join(siteDir, 'images.json'))).toBe(false);
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });

  it('still builds the site when Runware refuses', async () => {
    const domain = 'image-generation-refused-test.com';
    respond = () =>
      new Response(JSON.stringify({ errors: [{ message: 'no money' }] }), { status: 402 });
    try {
      const { log, status } = await generate(domain);
      expect(log).toContain('на счёте Runware недостаточно денег');
      expect(status.status).toBe('ok');
      expect(existsSync(join('output', domain, 'index.html'))).toBe(true);
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });

  it('keeps the key out of the build process and out of every file of the built site', async () => {
    const domain = 'image-generation-leak-test.com';
    try {
      const { log } = await generate(domain);
      // The key really was used — so its absence below means something.
      expect(requests[0].headers.Authorization).toBe(`Bearer ${SENTINEL}`);
      // The build process gets `{ ...process.env, ...options.env }`: with the key in neither, it
      // never has it.
      expect(Object.values(process.env).some((value) => value?.includes(SENTINEL))).toBe(false);
      expect(log).not.toContain(SENTINEL);
      for (const file of listFilesRecursively(join('output', domain))) {
        expect(readFileSync(file).includes(SENTINEL), `${file} holds the key`).toBe(false);
      }
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });
});

describe('the logo is made before the pictures', () => {
  const siteId = 'logo-generation-fixture';
  const siteDir = join('data', 'sites', siteId);
  const SENTINEL = 'sentinel-runware-key-server-logo-9c1d';
  let envDir;
  let logoServer;
  let logoBase;
  let cutout;

  beforeAll(async () => {
    const { default: sharp } = await import('sharp');
    const mark = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="100%" height="100%" rx="24" fill="#ffb800"/></svg>');
    cutout = await sharp({ create: { width: 1536, height: 768, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: mark, gravity: 'centre' }])
      .png()
      .toBuffer();
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(join(siteDir, 'site.json'), JSON.stringify({ brand: { name: 'Logo Brand' }, nav: [{ label: 'Home', href: '/' }] }));
    writeFileSync(
      join(siteDir, 'home.json'),
      JSON.stringify({ title: 'Logo', blocks: [{ type: 'hero', content: [{ type: 'title', h1: 'Logo' }, { image: 'hero-shot' }] }] }),
    );
    envDir = mkdtempSync(join(tmpdir(), 'site-factory-server-logo-env-'));
    writeFileSync(join(envDir, '.env'), `RUNWARE_API_KEY=${SENTINEL}\n`);
    const fetchFn = async (_url, init) => {
      const [task] = JSON.parse(init.body);
      if (task.taskType === 'removeBackground') {
        return new Response(JSON.stringify({ data: [{ taskUUID: task.taskUUID, imageBase64Data: cutout.toString('base64'), cost: 0.001 }] }), { status: 200 });
      }
      if (task.model === 'ideogram:4@0') {
        return new Response(JSON.stringify({ data: [{ taskUUID: task.taskUUID, imageUUID: 'art-1', cost: 0.09 }] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ data: [{ taskUUID: task.taskUUID, imageBase64Data: Buffer.from('fake webp').toString('base64'), cost: 0.001 }] }),
        { status: 200 },
      );
    };
    logoServer = createApp({ envFile: join(envDir, '.env'), fetchFn }).listen(0);
    await new Promise((resolve) => logoServer.once('listening', resolve));
    logoBase = `http://127.0.0.1:${logoServer.address().port}`;
  });

  afterAll(() => {
    logoServer?.close();
    rmSync(siteDir, { recursive: true, force: true });
    rmSync(envDir, { recursive: true, force: true });
  });

  it('logs the logo first, then the pictures, then the build — and the page carries all of it', async () => {
    const domain = 'logo-generation-test.com';
    rmSync(join('output', domain), { recursive: true, force: true });
    try {
      const start = await fetch(`${logoBase}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: siteId, domain }),
      }).then((r) => r.json());
      const log = await readUntilDone(start.buildId, logoBase);
      const status = await fetch(`${logoBase}/api/builds/${start.buildId}`).then((r) => r.json());
      expect(status.status).toBe('ok');

      const logoReady = log.indexOf('Логотип готов');
      const pictureReady = log.indexOf('Картинка hero-shot готова');
      expect(logoReady).toBeGreaterThan(-1);
      expect(logoReady).toBeLessThan(pictureReady);
      expect(pictureReady).toBeLessThan(log.indexOf('[build]'));
      expect(log).not.toContain(SENTINEL);

      const html = readFileSync(join('output', domain, 'index.html'), 'utf8');
      expect(html).toMatch(/<img[^>]*src="\/images\/logo\.webp"/);
      expect(html).toContain(`<meta property="og:image" content="https://${domain}/images/logo-square.png"`);
      expect(html).toContain('application/ld+json');
      expect(existsSync(join('output', domain, 'images', 'logo-square.png'))).toBe(true);
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });

  // The form's "regenerate the logo" checkbox, followed from the request body through generateLogo
  // into the built page. It runs after the test above deliberately: that one leaves this site with
  // a logo already recorded, which is the only state where the checkbox changes anything.
  it('draws a new logo when the form asks to regenerate, though the site already has one', async () => {
    const domain = 'logo-regenerate-test.com';
    rmSync(join('output', domain), { recursive: true, force: true });
    const logoSrc = () => JSON.parse(readFileSync(join(siteDir, 'images.json'), 'utf8')).logo.src;
    // Left behind by the test above — without the checkbox, this build would leave it alone.
    expect(logoSrc()).toBe('/images/logo.webp');

    try {
      const start = await fetch(`${logoBase}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: siteId, domain, regenerateLogo: true }),
      }).then((r) => r.json());
      const log = await readUntilDone(start.buildId, logoBase);
      expect(log).toContain('Логотип: делаю заново');

      expect(logoSrc()).toBe('/images/logo-2.webp');
      const html = readFileSync(join('output', domain, 'index.html'), 'utf8');
      expect(html).toMatch(/<img[^>]*src="\/images\/logo-2\.webp"/);
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });
});

describe('startBuild runs a prepare step first', () => {
  it('logs what prepare says before starting Astro, and reads env only then', async () => {
    const fakeChild = new EventEmitter();
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();
    const order = [];
    let spawnedEnv;
    const build = startBuild(
      {
        domain: '__prepare_step__',
        outDir: '/tmp/__prepare_step__',
        prepare: async (log) => {
          order.push('prepare');
          log('prepared');
        },
        env: () => {
          order.push('env');
          return { MARK: 'late' };
        },
      },
      (_bin, _args, options) => {
        order.push('spawn');
        spawnedEnv = options.env;
        return fakeChild;
      },
    );

    expect(build.status).toBe('running');
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(['prepare', 'env', 'spawn']);
    expect(spawnedEnv.MARK).toBe('late');
    fakeChild.emit('close', 0);
    expect(build.lines).toEqual(['prepared', 'Готово']);
    expect(build.status).toBe('ok');
  });

  it('still starts Astro when prepare fails, with the reason in the log', async () => {
    const fakeChild = new EventEmitter();
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();
    const build = startBuild(
      {
        domain: '__prepare_failure__',
        outDir: '/tmp/__prepare_failure__',
        env: {},
        prepare: async () => {
          throw new Error('boom');
        },
      },
      () => fakeChild,
    );
    await new Promise((resolve) => setImmediate(resolve));
    fakeChild.emit('close', 0);
    expect(build.lines).toEqual(['Подготовка сборки не удалась: boom', 'Готово']);
  });

  // I1: `spawn` throws synchronously for some inputs (e.g. an env value containing a NUL byte —
  // BRAND/GEO/LOCALE/PARTNER_URL all come straight from the request body). Without a `prepare`
  // step this used to throw out of `startBuild` itself, leaving the build stuck at 'running'
  // forever; with one, it became an unhandled rejection that would kill the whole process.
  it('turns a synchronous spawn failure into a failed build, without a prepare step', () => {
    const build = startBuild(
      { domain: '__spawn_throws__', outDir: '/tmp/__spawn_throws__', env: {} },
      () => {
        throw new Error('spawn boom');
      },
    );
    expect(build.status).toBe('failed');
    expect(build.lines).toEqual(['Не удалось запустить сборку: spawn boom']);
  });

  it('turns a synchronous spawn failure into a failed build, after a prepare step', async () => {
    const build = startBuild(
      {
        domain: '__spawn_throws_prepare__',
        outDir: '/tmp/__spawn_throws_prepare__',
        env: {},
        prepare: async (log) => {
          log('prepared');
        },
      },
      () => {
        throw new Error('spawn boom');
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(build.status).toBe('failed');
    expect(build.lines).toEqual(['prepared', 'Не удалось запустить сборку: spawn boom']);
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

describe('the texts tab writes a whole site folder', () => {
  const siteId = 'texts-generation-fixture';
  const siteDir = join('data', 'sites', siteId);
  const SENTINEL = 'sentinel-openai-key-server-texts-2f8c';
  let envDir;
  let textsServer;
  let textsBase;

  const reply = (data) =>
    new Response(
      JSON.stringify({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
        usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } },
      }),
      { status: 200 },
    );

  beforeAll(async () => {
    rmSync(siteDir, { recursive: true, force: true });
    envDir = mkdtempSync(join(tmpdir(), 'site-factory-texts-env-'));
    writeFileSync(join(envDir, '.env'), `OPENAI_API_KEY=${SENTINEL}\n`);
    const fetchFn = async (_url, init) => {
      // A real, if tiny, delay — the same trick the concurrency test in image-generate.test.mjs
      // uses. Without it every simulated call resolves through microtasks alone, with no timer or
      // socket I/O in between, so the whole job (all of a page's sections, in one page, done
      // sequentially) finishes before this same process's own HTTP client ever sees the response
      // to the request that started it. That made the "still running" test below flake into a
      // guaranteed failure: the second request always arrived after the job had already finished.
      await new Promise((resolve) => setTimeout(resolve, 20));
      const body = JSON.parse(init.body);
      const { name, schema } = body.text.format;
      if (name === 'site_frame') {
        const size = schema.properties.navLabels.minItems;
        return reply({
          tagline: 'Tagline.',
          navLabels: Array.from({ length: size }, (_, i) => `Page ${i + 1}`),
          footer: { ageWarning: '18+', ageText: 'Adults only.', quickLinksTitle: 'LINKS', paymentsTitle: 'PAY', copyright: '© 2026.' },
          blockLabels: { toc: 'Contents', links: 'Other pages', faq: 'Questions' },
        });
      }
      if (name === 'page_plan') {
        // One array per kind of content block the layout holds, read off the schema the way a real
        // model would rather than assumed — a page can hold more than one kind now.
        const byType = schema.properties.blocks.properties;
        const faq = schema.properties.faq.minItems;
        return reply({
          title: 'T', description: 'D', h1: 'H', heroText: ['Hero.'],
          images: Array.from({ length: schema.properties.images.minItems }, (_, i) => `picture-${i + 1}`),
          blocks: Object.fromEntries(
            Object.entries(byType).map(([type, list]) => [
              type,
              Array.from({ length: list.minItems }, (_, i) => ({
                heading: `Section ${i + 1}`, brief: 'b', elements: ['title', 'text'], links: [],
              })),
            ]),
          ),
          faq: Array.from({ length: faq }, (_, i) => `Question ${i + 1}?`),
        });
      }
      if (name === 'faq_answers') {
        const count = schema.properties.answers.minItems;
        return reply({ answers: Array.from({ length: count }, () => 'An answer.') });
      }
      return reply({ items: [{ kind: 'text', text: 'Body text.' }] });
    };
    textsServer = createApp({ envFile: join(envDir, '.env'), fetchFn }).listen(0);
    await new Promise((resolve) => textsServer.once('listening', resolve));
    textsBase = `http://127.0.0.1:${textsServer.address().port}`;
  });

  afterAll(() => {
    textsServer?.close();
    rmSync(siteDir, { recursive: true, force: true });
    rmSync(envDir, { recursive: true, force: true });
  });

  const start = (payload) =>
    fetch(`${textsBase}/api/texts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  it('writes the pages and site.json, and the new folder is listed as a site', async () => {
    const response = await start({
      template: 'review', out: siteId, brand: 'Acme', geo: 'Bangladesh', pages: 'home\ncasino',
    });
    expect(response.status).toBe(200);
    const { jobId } = await response.json();
    const log = await readUntilDone(jobId, textsBase);
    expect(log).toContain('event: done');
    expect(log).not.toContain(SENTINEL);
    // Finding 1: a run that actually wrote pages must still be reported as a success — this is
    // the honest counterpart to the "no key" failure test below.
    expect(doneStatus(log)).toBe('ok');

    expect(existsSync(join(siteDir, 'home.json'))).toBe(true);
    expect(existsSync(join(siteDir, 'casino.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(siteDir, 'site.json'), 'utf8')).nav).toHaveLength(1);

    // The point of the whole tab: the folder is now a site the Генерация tab can build.
    const sites = await fetch(`${textsBase}/api/sites`).then((r) => r.json());
    expect(sites.sites.some((site) => site.id === siteId)).toBe(true);
  });

  // Finding 1: generateSite never throws — a run with no key just logs "ключ не задан" and
  // returns having written nothing (see generate-site.test.mjs's "says so and does nothing at all
  // without a key"). Before this fix, startJob only ever saw that clean, non-throwing return and
  // reported 'ok' regardless — the Тексты tab's `is-bad` branch in app.js was unreachable. This
  // posts to the main `base` app, whose envFile (NO_ENV_FILE) never has a key, unlike textsBase
  // above — proving the job is marked 'failed' even though generateSite itself never threw.
  it('reports failure, not success, when the run wrote no page at all', async () => {
    const out = 'texts-no-key-fixture';
    rmSync(join('data', 'sites', out), { recursive: true, force: true });
    try {
      const response = await fetch(`${base}/api/texts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: 'review', out, brand: 'Acme', pages: 'home' }),
      });
      expect(response.status).toBe(200);
      const { jobId } = await response.json();
      const log = await readUntilDone(jobId);
      expect(doneStatus(log)).toBe('failed');
      expect(existsSync(join('data', 'sites', out, 'home.json'))).toBe(false);
    } finally {
      rmSync(join('data', 'sites', out), { recursive: true, force: true });
    }
  });

  it('refuses a page list with no home page, before spending anything', async () => {
    const response = await start({ template: 'review', out: 'texts-no-home', brand: 'Acme', pages: 'casino' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('home');
    expect(existsSync(join('data', 'sites', 'texts-no-home'))).toBe(false);
  });

  // Finding 4: /api/generate already refuses a present but non-string template/scheme instead of
  // letting trimmedString coerce it to '' and read as "absent" (see the non-string-template test
  // near the top of this file) — /api/texts skipped that guard entirely. geo has no "must be
  // non-empty" check of its own the way brand and out do, so a non-string value used to sail
  // straight through as plain "geo not given" — a 200 with the job started — instead of being
  // refused the way a bad *string* geo already would be treated as unknown-but-valid. The other
  // three guarded fields (template, brand, locale) follow the identical isPresentNonString check.
  it('refuses a present but non-string geo instead of silently treating it as absent', async () => {
    const out = 'texts-non-string-geo';
    // Same belt-and-braces cleanup as the fixture above: this only ever leaves a folder behind if
    // the guard regresses and the run actually starts — exactly the case where you would least want
    // a stray folder left in the real data/sites/.
    rmSync(join('data', 'sites', out), { recursive: true, force: true });
    try {
      const response = await start({ template: 'review', out, brand: 'Acme', geo: 42, pages: 'home' });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('geo');
      expect(existsSync(join('data', 'sites', out))).toBe(false);
    } finally {
      rmSync(join('data', 'sites', out), { recursive: true, force: true });
    }
  });

  // Review finding on Task 12: this test's name claimed to cover loadTemplateBlocks's own
  // guard (a template with no blocks.json), but 'nope' is never in the template list at all, so
  // the request is rejected by the earlier unknown-template-id check instead and never reaches
  // that branch. Renamed to say what it actually exercises; the test below takes over the branch
  // this name used to promise.
  it('refuses an unknown template id', async () => {
    const response = await start({ template: 'nope', out: 'texts-bad-template', brand: 'Acme', pages: 'home' });
    expect(response.status).toBe(400);
  });

  // The loadTemplateBlocks branch itself: a template that IS in the real list (its manifest.json
  // exists, so it passes the guard above) but has no blocks.json beside it. Same fixture recipe
  // as "accepts a template id safeName would mangle past recognition" earlier in this file, minus
  // blocks.json. The id sorts after 'review' (the only real template on disk) and is not a real
  // id, so nothing could ever pick it up as the "first available" fallback template by accident.
  it('refuses a template that cannot describe itself', async () => {
    const templateId = 'texts-missing-blocks-fixture';
    const templateDir = join('templates', templateId);
    const out = 'texts-missing-blocks-fixture-out';
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(join(templateDir, 'manifest.json'), JSON.stringify({ id: templateId, name: 'Fixture' }));

    try {
      const response = await start({ template: templateId, out, brand: 'Acme', pages: 'home' });
      expect(response.status).toBe(400);
      const data = await response.json();
      // Names both the template and its missing file, so this reads differently in the logs than
      // the unknown-id guard's "не найден" message above -- the owner can tell the two failures apart.
      expect(data.error).toContain(templateId);
      expect(data.error).toContain('pictures.json');
      expect(existsSync(join('data', 'sites', out))).toBe(false);
    } finally {
      rmSync(templateDir, { recursive: true, force: true });
    }
  });

  // `example` is the one field of this form whose value names a file on disk, and an unknown one
  // is refused here rather than left to the run. The run is where it would otherwise surface —
  // pickExamples throws for a name it cannot find — but by then this request has already been
  // answered 200, so a typo would come back as a job that starts and instantly dies, with the
  // reason buried in the log, instead of as a refused form with the word to fix in it.
  it('refuses an example that is not in the real list, before any folder is made', async () => {
    const out = 'texts-bad-example';
    rmSync(join('data', 'sites', out), { recursive: true, force: true });
    try {
      const response = await start({
        template: 'review', out, brand: 'Acme', example: 'no-such-example', pages: 'home',
      });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('no-such-example');
      // The "before" half of the claim above: nothing started, so nothing was made. A folder here
      // would mean the check moved behind startJob and the refusal is now merely cosmetic.
      expect(existsSync(join('data', 'sites', out))).toBe(false);
    } finally {
      rmSync(join('data', 'sites', out), { recursive: true, force: true });
    }
  });

  // An empty example is not a missing one: «Случайно» — an example drawn per page — is a real
  // choice in the dropdown, and the value it sends is ''. Checking every value against the list of
  // real names, without excepting '', would refuse the option the form offers first.
  it('accepts an empty example as «Случайно»', async () => {
    const out = 'texts-random-example';
    rmSync(join('data', 'sites', out), { recursive: true, force: true });
    try {
      const response = await start({ template: 'review', out, brand: 'Acme', example: '', pages: 'home' });
      expect(response.status).toBe(200);
      const { jobId } = await response.json();
      // Drained, not abandoned: this app generates for real against its own fetchFn, and a job
      // still running when afterAll closes the server would go on writing into data/sites.
      await readUntilDone(jobId, textsBase);
    } finally {
      rmSync(join('data', 'sites', out), { recursive: true, force: true });
    }
  });

  // The same asymmetry the non-string geo test above describes, in the field where it bites
  // hardest: trimmedString(42) is '', and '' is not "nothing given" here — it is the valid
  // «Случайно». So without this guard an example sent as a number would not be refused and would
  // not be honoured either; it would quietly become "any example at all", and the site would come
  // out built from a different page than the one asked for, with nothing anywhere having said so.
  it('refuses a present but non-string example instead of silently treating it as «Случайно»', async () => {
    const out = 'texts-non-string-example';
    rmSync(join('data', 'sites', out), { recursive: true, force: true });
    try {
      const response = await start({ template: 'review', out, brand: 'Acme', example: 42, pages: 'home' });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('example');
      expect(existsSync(join('data', 'sites', out))).toBe(false);
    } finally {
      rmSync(join('data', 'sites', out), { recursive: true, force: true });
    }
  });

  it('refuses a second run into the same folder while the first is going', async () => {
    const payload = { template: 'review', out: 'texts-busy', brand: 'Acme', pages: 'home' };
    const first = await start(payload).then((r) => r.json());
    const second = await start(payload);
    expect(second.status).toBe(409);
    await readUntilDone(first.jobId, textsBase);
    rmSync(join('data', 'sites', 'texts-busy'), { recursive: true, force: true });
  });
});
