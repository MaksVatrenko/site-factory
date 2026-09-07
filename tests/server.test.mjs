import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createApp, createLineSplitter, startBuild } from '../factory/server.mjs';

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

describe('factory API', () => {
  it('lists templates read from disk', async () => {
    const data = await fetch(`${base}/api/templates`).then((r) => r.json());
    expect(data.templates.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    expect(data.templates[0].name).toBeTruthy();
  });

  it('lists colour schemes read from disk', async () => {
    const data = await fetch(`${base}/api/schemes`).then((r) => r.json());
    expect(data.schemes).toEqual(['blue', 'dark', 'green']);
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
