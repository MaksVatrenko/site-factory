import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPENAI_DEFAULTS, readOpenAiConfig } from '../factory/texts/env.mjs';

const SENTINEL = 'sentinel-openai-key-env-3d71';

let dirs = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function envFile(body) {
  const dir = mkdtempSync(join(tmpdir(), 'site-factory-openai-env-'));
  dirs.push(dir);
  const file = join(dir, '.env');
  writeFileSync(file, body);
  return file;
}

describe('readOpenAiConfig', () => {
  it('falls back to the defaults when only the key is set', () => {
    const config = readOpenAiConfig(envFile(`OPENAI_API_KEY=${SENTINEL}\n`));
    expect(config.apiKey).toBe(SENTINEL);
    expect(config.apiKeyInvalid).toBe(false);
    expect(config.apiUrl).toBe(OPENAI_DEFAULTS.apiUrl);
    expect(config.model).toBe(OPENAI_DEFAULTS.model);
    // Literal numbers, not OPENAI_DEFAULTS.priceX: these are prices, and comparing the parsed
    // result against the very constant it was read from can never catch a wrong default — only a
    // wrong default silently mispricing every run's money log can.
    expect(config.priceInput).toBe(0.2);
    expect(config.priceCachedInput).toBe(0.02);
    expect(config.priceOutput).toBe(1.2);
  });

  it('takes every setting from the file when it is there', () => {
    const config = readOpenAiConfig(
      envFile(
        `OPENAI_API_KEY=${SENTINEL}\nOPENAI_API_URL=https://proxy.test/v1/responses\n` +
          'OPENAI_MODEL=gpt-5.6-terra\n' +
          'OPENAI_PRICE_INPUT=2\nOPENAI_PRICE_CACHED_INPUT=0.2\nOPENAI_PRICE_OUTPUT=12\n',
      ),
    );
    expect(config.apiUrl).toBe('https://proxy.test/v1/responses');
    expect(config.model).toBe('gpt-5.6-terra');
    expect(config.priceInput).toBe(2);
    expect(config.priceCachedInput).toBe(0.2);
    expect(config.priceOutput).toBe(12);
  });

  // A free model is a real case, and 0 must not be mistaken for "not set" the way a positive-only
  // check would: prices are the one setting where zero is meaningful.
  it('keeps a price of zero instead of replacing it with the default', () => {
    const config = readOpenAiConfig(envFile(`OPENAI_API_KEY=${SENTINEL}\nOPENAI_PRICE_OUTPUT=0\n`));
    expect(config.priceOutput).toBe(0);
  });

  it('reports no key at all when the file does not exist', () => {
    const config = readOpenAiConfig(join(tmpdir(), 'site-factory-no-such-dir', '.env'));
    expect(config.apiKey).toBe('');
    expect(config.apiKeyInvalid).toBe(false);
    expect(config.model).toBe(OPENAI_DEFAULTS.model);
  });

  // A Bearer header value cannot carry a space or a line break; trying anyway is what once let a
  // raw fetch error quote the whole "Bearer <key>" back into a log line.
  it('refuses a key with a space in it, and says the key is wrong rather than missing', () => {
    const config = readOpenAiConfig(envFile('OPENAI_API_KEY=key with a space\n'));
    expect(config.apiKey).toBe('');
    expect(config.apiKeyInvalid).toBe(true);
  });
});
