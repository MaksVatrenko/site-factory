import { describe, it, expect } from 'vitest';
import { fillFaq, fillSection } from '../factory/texts/fill.mjs';
import { answer, failed, refused, truncated } from './helpers/openai.mjs';

const CONFIG = {
  apiKey: 'sentinel-openai-key-fill-7c30',
  apiUrl: 'https://openai.test/v1/responses',
  model: 'gpt-5.6-luna',
  priceInput: 0.2,
  priceCachedInput: 0.02,
  priceOutput: 1.2,
};
// A block's elements carry their own size now, one entry per place (see example.mjs's frameOf).
const holds = (...kinds) => kinds.map((kind) => ({ kind }));
const SECTION = { heading: 'Payments', brief: 'how to pay', elements: holds('title', 'text'), image: null, links: ['/bonus'] };

const ITEMS = { items: [{ kind: 'text', text: 'Body.' }, { kind: 'text', text: 'More.' }] };
const run = (overrides, fetchFn) =>
  fillSection(
    { section: SECTION, siblings: ['Bonuses', 'Games'], brand: 'Acme', locale: 'en-US', instructions: 'RULES', ...overrides },
    { config: CONFIG, fetchFn, sleep: async () => {} },
  );

describe('fillSection', () => {
  it('asks only for this section, and tells the model what the neighbours cover', async () => {
    let body;
    const result = await run({}, async (_url, init) => {
      body = JSON.parse(init.body);
      return answer(ITEMS);
    });

    expect(body.instructions).toBe('RULES');
    const input = String(body.input[0].content);
    expect(input).toContain('Payments');
    expect(input).toContain('how to pay');
    // Without the neighbours, every section drifts into saying the same thing.
    expect(input).toContain('Bonuses');
    expect(input).toContain('Games');
    // Every element the plan chose reaches the model. A block's heading used to be subtracted
    // here, because content.json's "title" meant the heading and the subheading at once; blocks.json
    // separates them, so a "title" in the plan is now the optional h3 and must not be eaten.
    expect(Object.keys(body.text.format.schema.$defs)).toEqual(['title', 'text']);
    expect(result.items).toHaveLength(2);
  });

  // A subheading the plan asked for has to survive all the way to the request. This is the h3 that
  // never once appeared on a generated page: the plan chose it, and fill.mjs ate it as if it were
  // the block's own heading, so the model was never asked to write one.
  it('asks for the subheading the plan chose, instead of mistaking it for the heading', async () => {
    let body;
    const section = { ...SECTION, elements: holds('title', 'text') };
    await run({ section }, async (_url, init) => {
      body = JSON.parse(init.body);
      return answer(ITEMS);
    });
    // One line per element, in place, each with its own size — not a comma list of kinds.
    const brief = String(body.input[0].content);
    expect(brief).toContain('1. title');
    expect(brief).toContain('2. text');
  });

  // A picture belongs to a block by its nature and is placed by the factory, so there is no image
  // element for the model to write and no name for it to get wrong. Saying anything about one would
  // only invite it to write something that is then thrown away — which is how a picture nobody
  // declared used to end up in the middle of a page.
  it('never mentions a picture to the model at all', async () => {
    let body;
    await run({}, async (_url, init) => {
      body = JSON.parse(init.body);
      return answer(ITEMS);
    });
    const input = String(body.input[0].content);
    expect(input.toLowerCase()).not.toContain('picture');
  });

  it('asks again when the model refuses, and keeps the one that worked', async () => {
    let calls = 0;
    const result = await run({}, async () => {
      calls += 1;
      return calls === 1 ? refused() : answer(ITEMS);
    });
    expect(calls).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  // A truncated answer hit the model's own output cap. No production caller ever passes
  // maxOutputTokens, so the second request is byte-identical to the first and would hit the exact
  // same cap — retrying could only ever repeat the bill, never fix the answer.
  it('does not retry a truncated answer, since an unchanged request cannot clear an unchanged cap', async () => {
    let calls = 0;
    await expect(
      run({}, async () => {
        calls += 1;
        return truncated();
      }),
    ).rejects.toMatchObject({ kind: 'truncated' });
    expect(calls).toBe(1);
  });

  it('gives up after the allowed number of attempts and says why', async () => {
    let calls = 0;
    await expect(
      run({ attempts: 3 }, async () => {
        calls += 1;
        return refused();
      }),
    ).rejects.toMatchObject({ kind: 'refused' });
    expect(calls).toBe(3);
  });

  // Finding 2: each retried refusal is a separate billed request — OpenAI ran the model and charged
  // for it on every attempt, not only on the one that finally gave up. Keeping only the last
  // attempt's cost on the thrown error would hide what the earlier, also-billed attempts spent.
  it('accumulates the cost of every refused attempt into the final error, not just the last', async () => {
    let calls = 0;
    const perAttempt = (1000 * 0.2 + 100 * 1.2) / 1e6; // refused()'s default usage, at CONFIG's prices
    const error = await run({ attempts: 3 }, async () => {
      calls += 1;
      return refused();
    }).catch((caught) => caught);
    expect(calls).toBe(3);
    expect(error.kind).toBe('refused');
    expect(error.cost).toBeCloseTo(perAttempt * 3, 12);
  });

  it('does not retry a refusal that is really a rejected request', async () => {
    let calls = 0;
    await expect(
      run({}, async () => {
        calls += 1;
        return failed(400, { message: 'bad schema' });
      }),
    ).rejects.toMatchObject({ kind: 'rejected' });
    expect(calls).toBe(1);
  });
});

describe('fillFaq', () => {
  it('answers every question in one request, in order', async () => {
    let body;
    const result = await fillFaq(
      { questions: ['Is it safe?', 'How fast?'], brand: 'Acme', locale: 'en-US', instructions: 'RULES' },
      {
        config: CONFIG,
        sleep: async () => {},
        fetchFn: async (_url, init) => {
          body = JSON.parse(init.body);
          return answer({ answers: ['Yes.', 'Fast.'] });
        },
      },
    );
    expect(body.text.format.schema.properties.answers.minItems).toBe(2);
    expect(result.answers).toEqual(['Yes.', 'Fast.']);
  });

  // fillFaq shares askWithRetries with fillSection, but nothing exercised the retry policy from
  // this side of it — a typo that dropped 'refused' from the retry set would have broken the FAQ
  // silently while every fillSection test above kept passing.
  it('asks again when the model refuses, and keeps the answer from the attempt that worked', async () => {
    let calls = 0;
    const result = await fillFaq(
      { questions: ['Is it safe?'], brand: 'Acme', locale: 'en-US', instructions: 'RULES' },
      {
        config: CONFIG,
        sleep: async () => {},
        fetchFn: async () => {
          calls += 1;
          return calls === 1 ? refused() : answer({ answers: ['Yes.'] });
        },
      },
    );
    expect(calls).toBe(2);
    expect(result.answers).toEqual(['Yes.']);
  });
});
