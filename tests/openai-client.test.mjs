import { describe, it, expect, vi } from 'vitest';
import { askJson, costOf, OpenAiError, RETRY_DELAYS_MS, RETRY_JITTER_MS } from '../factory/texts/openai.mjs';
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

  // The specific billing code is not always one we know, but the broad type is: a 429 that names
  // the category must be terminal even when its code is a string this client has never seen.
  // The code below is deliberately NOT in QUOTA_CODES — a code from that set would pass this test
  // through the code branch alone, and the test would still pass with the type check deleted,
  // which is the very regression it exists to catch.
  it('treats an unknown billing code as out of money when the type says so', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return failed(429, { type: 'insufficient_quota', code: 'some_future_billing_code', message: 'no funds' });
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

  // Spec §12: "нарастающей паузой и разбросом" — a spread on top of the fixed schedule, so several
  // pages retrying at once do not all wake up on the same tick. Math.random is stubbed to a fixed,
  // non-zero value so the resulting delay can be pinned down exactly: a jitter-free `sleep(floor)`
  // produces exactly the floor and fails this. A "stays within the band" check does not, since a
  // jitter-free sleep sits at the bottom of that same band and passes it by accident — which is
  // exactly what let `await sleep(floor)` slip past this test once already.
  it('adds a small random spread on top of the fixed retry delays', async () => {
    const waited = [];
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      if (calls <= RETRY_DELAYS_MS.length) return failed(500, { message: 'down' });
      return answer({ headline: 'ok' });
    };
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      await ask({}, { fetchFn, sleep: async (ms) => waited.push(ms) });
    } finally {
      randomSpy.mockRestore();
    }
    expect(waited).toEqual(RETRY_DELAYS_MS.map((floor) => floor + 0.5 * RETRY_JITTER_MS));
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

  // The model ran, and OpenAI billed for it, before the answer hit the output cap — so the error
  // must carry that cost rather than let it disappear the moment askJson throws.
  it('prices a truncated answer from the same usage counters a success would read', async () => {
    const fetchFn = async () =>
      truncated('max_output_tokens', { input_tokens: 2_000, output_tokens: 500, input_tokens_details: { cached_tokens: 0 } });
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({
      kind: 'truncated',
      cost: (2_000 * 0.2 + 500 * 1.2) / 1e6,
    });
  });

  it('reports a refusal as a refusal', async () => {
    const fetchFn = async () => refused();
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({ kind: 'refused' });
  });

  it('prices a refusal from the same usage counters a success would read', async () => {
    const fetchFn = async () =>
      refused('no', { input_tokens: 2_000, output_tokens: 50, input_tokens_details: { cached_tokens: 0 } });
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({
      kind: 'refused',
      cost: (2_000 * 0.2 + 50 * 1.2) / 1e6,
    });
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

  // undici throws, for an invalid header value, an error whose own message quotes the whole header
  // back — the entire "Bearer <key>" this request sent. The catch around fetchFn must never let
  // that message through unscrubbed.
  it('never lets the key into an error message when fetchFn itself throws it back', async () => {
    const fetchFn = async () => {
      throw new Error(`Invalid header value: "Bearer ${SENTINEL}"`);
    };
    await expect(ask({}, { fetchFn })).rejects.toSatisfy(
      (error) =>
        error instanceof OpenAiError && error.kind === 'unavailable' && !error.message.includes(SENTINEL),
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

  // Finding 2: this response completed and OpenAI billed for it — the model simply produced no
  // output_text part — so, like truncated and refused above, it must carry what was actually spent
  // rather than let a caller that swallows or retries it report the attempt as free.
  it('prices an answer with no output text from the same usage counters a success would read', async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [],
          usage: { input_tokens: 2_000, output_tokens: 500, input_tokens_details: { cached_tokens: 0 } },
        }),
        { status: 200 },
      );
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({
      kind: 'rejected',
      cost: (2_000 * 0.2 + 500 * 1.2) / 1e6,
    });
  });

  // Same principle, the other rejected-but-billed branch: the answer completed with real output_text,
  // it just was not parseable JSON — strict mode makes this all but impossible, but it still means
  // the model ran and OpenAI charged for it.
  it('prices an answer whose text will not parse from the same usage counters a success would read', async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'sorry, plain prose' }] }],
          usage: { input_tokens: 5_000, output_tokens: 100, input_tokens_details: { cached_tokens: 0 } },
        }),
        { status: 200 },
      );
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({
      kind: 'rejected',
      cost: (5_000 * 0.2 + 100 * 1.2) / 1e6,
    });
  });
});

describe('costOf', () => {
  it('is zero for an answer with no counters', () => {
    expect(costOf(undefined, CONFIG)).toBe(0);
  });
});
