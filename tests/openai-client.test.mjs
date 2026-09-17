import { describe, it, expect } from 'vitest';
import { askJson, costOf, OpenAiError, RETRY_DELAYS_MS } from '../factory/texts/openai.mjs';
import { answer, failed, refused, truncated } from './helpers/openai.mjs';

const SENTINEL = 'sentinel-openai-key-client-8b4e';
const CONFIG = {
  apiKey: SENTINEL,
  apiKeyInvalid: false,
  apiUrl: 'https://openai.test/v1/responses',
  model: 'gpt-5.6-luna',
  concurrency: 1,
  priceInput: 0.2,
  priceCachedInput: 0.02,
  priceOutput: 1.2,
};

const SCHEMA = {
  type: 'object',
  properties: { headline: { type: 'string' } },
  required: ['headline'],
  additionalProperties: false,
};

const ask = (options, overrides = {}) =>
  askJson(
    { instructions: 'rules', input: 'page: casino', schemaName: 'page_plan', schema: SCHEMA, ...options },
    { config: CONFIG, sleep: async () => {}, ...overrides },
  );

describe('askJson', () => {
  it('asks with a strict schema, static text first, and returns the parsed answer', async () => {
    let sent;
    const fetchFn = async (url, init) => {
      sent = { url, init, body: JSON.parse(init.body) };
      return answer({ headline: 'Casino' });
    };
    const result = await ask({}, { fetchFn });

    expect(sent.url).toBe(CONFIG.apiUrl);
    expect(sent.init.headers.Authorization).toBe(`Bearer ${SENTINEL}`);
    expect(sent.body.model).toBe('gpt-5.6-luna');
    // The cache only hits when the unchanging part leads: instructions carry the rules and the
    // examples, input carries what differs per call.
    expect(sent.body.instructions).toBe('rules');
    expect(sent.body.input).toEqual([{ role: 'user', content: 'page: casino' }]);
    expect(sent.body.text.format).toEqual({
      type: 'json_schema',
      name: 'page_plan',
      strict: true,
      schema: SCHEMA,
    });
    expect(result.data).toEqual({ headline: 'Casino' });
  });

  it('passes a cache key and an output limit when given them', async () => {
    let body;
    const fetchFn = async (_url, init) => {
      body = JSON.parse(init.body);
      return answer({ headline: 'x' });
    };
    await ask({ cacheKey: 'sf-plan-review', maxOutputTokens: 900 }, { fetchFn });
    expect(body.prompt_cache_key).toBe('sf-plan-review');
    expect(body.max_output_tokens).toBe(900);
  });

  it('counts money from the token counters, charging cached input at its own price', async () => {
    const fetchFn = async () =>
      answer({ headline: 'x' }, {
        input_tokens: 30_000,
        output_tokens: 1_000,
        input_tokens_details: { cached_tokens: 25_000 },
      });
    const result = await ask({}, { fetchFn });
    // 5000 fresh × $0.20 + 25000 cached × $0.02 + 1000 out × $1.20, per million.
    expect(result.cost).toBeCloseTo((5000 * 0.2 + 25_000 * 0.02 + 1000 * 1.2) / 1e6, 12);
    expect(result.usage.cachedTokens).toBe(25_000);
  });

  it('treats a rejected key as final and does not retry it', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return failed(401, { message: 'bad key' });
    };
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({ kind: 'auth' });
    expect(calls).toBe(1);
  });

  // A 429 is usually "too fast" and worth retrying, but the same status also carries "you are out
  // of money" — and that one will answer the same way for the rest of the run.
  it('tells an out-of-money 429 apart from a too-fast one', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return failed(429, { code: 'insufficient_quota', message: 'no funds' });
    };
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({ kind: 'balance' });
    expect(calls).toBe(1);
  });

  it('retries a plain 429 and succeeds on a later attempt', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      if (calls < 3) return failed(429, { message: 'slow down' });
      return answer({ headline: 'at last' });
    };
    const result = await ask({}, { fetchFn });
    expect(calls).toBe(3);
    expect(result.data).toEqual({ headline: 'at last' });
  });

  it('waits at least as long as Retry-After asks', async () => {
    const waited = [];
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: 'slow down' } }), {
          status: 429,
          headers: { 'Retry-After': '7' },
        });
      }
      return answer({ headline: 'ok' });
    };
    await ask({}, { fetchFn, sleep: async (ms) => waited.push(ms) });
    expect(waited[0]).toBeGreaterThanOrEqual(7000);
  });

  it('reports a run that hit the output limit as truncated, not as a broken answer', async () => {
    const fetchFn = async () => truncated();
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({ kind: 'truncated' });
  });

  it('reports a refusal as a refusal', async () => {
    const fetchFn = async () => refused();
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({ kind: 'refused' });
  });

  it('gives up with "unavailable" after the last retry', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return failed(503, { message: 'down' });
    };
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({ kind: 'unavailable' });
    expect(calls).toBe(RETRY_DELAYS_MS.length + 1);
  });

  it('never lets the key into an error message, whoever put it there', async () => {
    const fetchFn = async () => failed(400, { message: `your key ${SENTINEL} is odd` });
    await expect(ask({}, { fetchFn })).rejects.toSatisfy(
      (error) => error instanceof OpenAiError && !error.message.includes(SENTINEL),
    );
  });

  it('survives an answer whose text is not JSON at all', async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'sorry, plain prose' }] }],
        }),
        { status: 200 },
      );
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({ kind: 'rejected' });
  });
});

describe('costOf', () => {
  it('is zero for an answer with no counters', () => {
    expect(costOf(undefined, CONFIG)).toBe(0);
  });
});
