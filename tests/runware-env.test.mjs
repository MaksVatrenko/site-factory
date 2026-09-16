import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRunwareConfig, RUNWARE_DEFAULTS } from '../factory/images/env.mjs';

const SENTINEL = 'sentinel-runware-key-env-5d1e';
let dir;

function writeEnv(text) {
  dir = mkdtempSync(join(tmpdir(), 'site-factory-env-'));
  const file = join(dir, '.env');
  writeFileSync(file, text);
  return file;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('readRunwareConfig', () => {
  it('reads every setting from the .env file', () => {
    const file = writeEnv(
      [
        `RUNWARE_API_KEY=${SENTINEL}`,
        'RUNWARE_API_URL=https://runware.test/v1',
        'RUNWARE_MODEL=runware:1@1',
        'RUNWARE_GUIDANCE=3.5',
        'RUNWARE_STEPS=8',
        'RUNWARE_CONCURRENCY=2',
        'RUNWARE_LOGO_MODEL=ideogram:9@9',
        'RUNWARE_BG_MODEL=runware:1@2',
      ].join('\n'),
    );
    expect(readRunwareConfig(file)).toEqual({
      apiKey: SENTINEL,
      apiKeyInvalid: false,
      apiUrl: 'https://runware.test/v1',
      model: 'runware:1@1',
      guidance: 3.5,
      steps: 8,
      concurrency: 2,
      logoModel: 'ideogram:9@9',
      bgModel: 'runware:1@2',
    });
  });

  it('fills in the defaults for everything the file leaves out', () => {
    const file = writeEnv(`RUNWARE_API_KEY=${SENTINEL}\n`);
    expect(readRunwareConfig(file)).toEqual({
      apiKey: SENTINEL,
      apiKeyInvalid: false,
      ...RUNWARE_DEFAULTS,
    });
  });

  it('falls back to the default for a number that is not a positive number', () => {
    const file = writeEnv('RUNWARE_STEPS=abc\nRUNWARE_CONCURRENCY=0\nRUNWARE_GUIDANCE=-1\n');
    const config = readRunwareConfig(file);
    expect(config.steps).toBe(RUNWARE_DEFAULTS.steps);
    expect(config.concurrency).toBe(RUNWARE_DEFAULTS.concurrency);
    expect(config.guidance).toBe(RUNWARE_DEFAULTS.guidance);
  });

  it('returns an empty key and the defaults when there is no .env at all', () => {
    const config = readRunwareConfig(join(tmpdir(), 'site-factory-no-such-dir', '.env'));
    expect(config).toEqual({ apiKey: '', apiKeyInvalid: false, ...RUNWARE_DEFAULTS });
  });

  // I2: a key with a space or line break inside it cannot be sent in a Bearer header safely (it
  // is not entirely visible ASCII), so it must never reach a request — flag it instead of using it.
  it('refuses a key with an inner space, without using it', () => {
    const file = writeEnv('RUNWARE_API_KEY=abc def\n');
    const config = readRunwareConfig(file);
    expect(config.apiKey).toBe('');
    expect(config.apiKeyInvalid).toBe(true);
  });

  it('refuses a key with an inner line break, without using it', () => {
    const file = writeEnv('RUNWARE_API_KEY="abc\\ndef"\n');
    const config = readRunwareConfig(file);
    expect(config.apiKey).toBe('');
    expect(config.apiKeyInvalid).toBe(true);
  });

  it('does not flag a key that is entirely visible ASCII', () => {
    const file = writeEnv(`RUNWARE_API_KEY=${SENTINEL}\n`);
    expect(readRunwareConfig(file).apiKeyInvalid).toBe(false);
  });

  it('does not flag a missing key as invalid', () => {
    const file = writeEnv('');
    const config = readRunwareConfig(file);
    expect(config.apiKey).toBe('');
    expect(config.apiKeyInvalid).toBe(false);
  });

  it('never puts anything into process.env', () => {
    const file = writeEnv(`RUNWARE_API_KEY=${SENTINEL}\nRUNWARE_STEPS=8\n`);
    const keysBefore = Object.keys(process.env).sort();
    readRunwareConfig(file);
    expect(Object.keys(process.env).sort()).toEqual(keysBefore);
    expect(Object.values(process.env)).not.toContain(SENTINEL);
  });
});

describe('.env.example', () => {
  it('lists every setting with an empty key and 4 steps', () => {
    const config = readRunwareConfig('.env.example');
    expect(config.apiKey).toBe('');
    expect(config.steps).toBe(4);
    expect(config.model).toBe('runware:400@6');
    expect(config.logoModel).toBe('ideogram:4@0');
    expect(config.bgModel).toBe('ideogram:remove-background@0');
  });

  it('is committed to git while .env itself stays ignored', () => {
    // `git check-ignore -q` exits 0 for an ignored path and 1 for one git would track.
    expect(spawnSync('git', ['check-ignore', '-q', '.env.example']).status).toBe(1);
    expect(spawnSync('git', ['check-ignore', '-q', '.env']).status).toBe(0);
  });
});
