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
const SECTION = { heading: 'Payments', brief: 'how to pay', elements: ['title', 'text'], image: null, links: ['/bonus'] };

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
    // The section heading is the factory's to write, so the plan's first "title" is taken off the
    // list and only "text" is left to ask for.
    expect(Object.keys(body.text.format.schema.$defs)).toEqual(['text']);
    expect(result.items).toHaveLength(2);
  });

  // Finding 1: the plan is the only place a section's picture name is decided, but fill.mjs never
  // passed it on — the model was asked for an "image" element with no idea what to call it, so the
  // name it guessed could never match what assemble.mjs later checks against.
  it("tells the model the exact name of the picture the plan chose for this section", async () => {
    let body;
    const section = { ...SECTION, elements: ['title', 'text', 'image'], image: 'roulette-table-close-up' };
    await run({ section }, async (_url, init) => {
      body = JSON.parse(init.body);
      return answer({ items: [{ kind: 'text', text: 'Body.' }, { kind: 'image', name: 'roulette-table-close-up' }] });
    });
    const input = String(body.input[0].content);
    expect(input).toContain('roulette-table-close-up');
  });

  // The other half of the same fix: inventing a picture the plan never asked for is exactly as
  // wrong as mangling the name of one it did — so a section with no picture must not be told about
  // one at all.
  it('says nothing about a picture when the plan gave this section none', async () => {
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
