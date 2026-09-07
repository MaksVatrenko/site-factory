import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../factory/server.mjs';

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

  it('refuses an example that does not exist', async () => {
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ example: '../../etc' }),
    });
    expect(response.status).toBe(400);
  });

  it('answers 404 for an unknown build', async () => {
    const response = await fetch(`${base}/api/builds/nope`);
    expect(response.status).toBe(404);
  });
});
