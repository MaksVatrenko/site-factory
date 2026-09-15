import { describe, it, expect } from 'vitest';
import { generateImage, RETRY_DELAYS_MS, RunwareError } from '../factory/images/runware.mjs';

const SENTINEL = 'sentinel-runware-key-client-9b2c';
const CONFIG = {
  apiKey: SENTINEL,
  apiUrl: 'https://runware.test/v1',
  model: 'runware:400@6',
  guidance: 2,
  steps: 4,
};
const REQUEST = { prompt: 'a roulette wheel', negativePrompt: 'text', width: 1024, height: 576 };
const IMAGE_BYTES = Buffer.from('fake webp bytes');

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Answers the way Runware does: one result per task, matched to it by the task's own taskUUID.
function imageFor(task, extra = {}) {
  return {
    taskType: 'imageInference',
    taskUUID: task.taskUUID,
    imageUUID: 'image-uuid',
    imageBase64Data: IMAGE_BYTES.toString('base64'),
    seed: 7,
    cost: 0.0017,
    ...extra,
  };
}

// Plays the given answers in order: a function gets the sent task, an Error is thrown instead.
function scriptedFetch(answers) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    const [task] = JSON.parse(init.body);
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer(task);
  };
  return { fetchFn, calls };
}

const ok = (task) => jsonResponse(200, { data: [imageFor(task)] });

function recordingSleep() {
  const waits = [];
  return { waits, sleep: async (ms) => { waits.push(ms); } };
}

async function failureOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected generateImage to fail');
}

describe('generateImage', () => {
  it('sends one imageInference task with the key in the Authorization header', async () => {
    const { fetchFn, calls } = scriptedFetch([ok]);
    await generateImage(REQUEST, { config: CONFIG, fetchFn });

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe('https://runware.test/v1');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${SENTINEL}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(init.body);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      taskType: 'imageInference',
      model: 'runware:400@6',
      positivePrompt: 'a roulette wheel',
      negativePrompt: 'text',
      width: 1024,
      height: 576,
      steps: 4,
      CFGScale: 2,
      numberResults: 1,
      outputType: 'base64Data',
      outputFormat: 'WEBP',
      outputQuality: 85,
      includeCost: true,
    });
    expect(body[0].taskUUID).toMatch(/^[0-9a-f-]{36}$/);
    // The key travels only in the header, never in the body.
    expect(init.body).not.toContain(SENTINEL);
  });

  it('leaves negativePrompt out when there is none', async () => {
    const { fetchFn, calls } = scriptedFetch([ok]);
    await generateImage({ ...REQUEST, negativePrompt: '' }, { config: CONFIG, fetchFn });
    expect(JSON.parse(calls[0].init.body)[0]).not.toHaveProperty('negativePrompt');
  });

  it('returns the decoded picture, its cost and seed', async () => {
    const { fetchFn } = scriptedFetch([ok]);
    const result = await generateImage(REQUEST, { config: CONFIG, fetchFn });
    expect(result.bytes.equals(IMAGE_BYTES)).toBe(true);
    expect(result.cost).toBe(0.0017);
    expect(result.seed).toBe(7);
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [402, 'balance'],
  ])('turns HTTP %s into a "%s" failure, without retrying', async (status, kind) => {
    const { sleep, waits } = recordingSleep();
    const { fetchFn, calls } = scriptedFetch([
      () => jsonResponse(status, { errors: [{ code: 'x', message: 'no' }] }),
    ]);
    const error = await failureOf(generateImage(REQUEST, { config: CONFIG, fetchFn, sleep }));
    expect(error).toBeInstanceOf(RunwareError);
    expect(error.kind).toBe(kind);
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('turns any other 4xx into a "rejected" failure carrying Runware\'s own message', async () => {
    const { fetchFn } = scriptedFetch([
      () => jsonResponse(400, { errors: [{ code: 'invalidWidth', message: 'Invalid width' }] }),
    ]);
    const error = await failureOf(generateImage(REQUEST, { config: CONFIG, fetchFn }));
    expect(error.kind).toBe('rejected');
    expect(error.message).toContain('400');
    expect(error.message).toContain('Invalid width');
  });

  it('reads an error reported inside a 200 response', async () => {
    const { fetchFn } = scriptedFetch([
      () => jsonResponse(200, { errors: [{ code: 'contentModeration', message: 'Blocked by moderation' }] }),
    ]);
    const error = await failureOf(generateImage(REQUEST, { config: CONFIG, fetchFn }));
    expect(error.kind).toBe('rejected');
    expect(error.message).toContain('Blocked by moderation');
  });

  it('refuses a response that holds no picture for this task', async () => {
    const { fetchFn } = scriptedFetch([
      (task) => jsonResponse(200, { data: [imageFor({ taskUUID: 'someone-else' })] }),
    ]);
    const error = await failureOf(generateImage(REQUEST, { config: CONFIG, fetchFn }));
    expect(error.kind).toBe('rejected');
  });

  it('retries a 503 and succeeds once Runware answers', async () => {
    const { sleep, waits } = recordingSleep();
    const { fetchFn, calls } = scriptedFetch([() => jsonResponse(503, {}), ok]);
    const result = await generateImage(REQUEST, { config: CONFIG, fetchFn, sleep });
    expect(result.bytes.equals(IMAGE_BYTES)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([1000]);
  });

  it('gives up as "unavailable" after three retries', async () => {
    const { sleep, waits } = recordingSleep();
    const { fetchFn, calls } = scriptedFetch([() => jsonResponse(503, {})]);
    const error = await failureOf(generateImage(REQUEST, { config: CONFIG, fetchFn, sleep }));
    expect(error.kind).toBe('unavailable');
    expect(calls).toHaveLength(RETRY_DELAYS_MS.length + 1);
    expect(waits).toEqual([1000, 2000, 4000]);
  });

  it('retries when no answer arrives in time', async () => {
    const { sleep } = recordingSleep();
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const { fetchFn, calls } = scriptedFetch([timeout]);
    const error = await failureOf(generateImage(REQUEST, { config: CONFIG, fetchFn, sleep }));
    expect(error.kind).toBe('unavailable');
    expect(error.message).toContain('нет ответа');
    expect(calls).toHaveLength(4);
  });

  it('retries a network failure', async () => {
    const { sleep } = recordingSleep();
    const { fetchFn } = scriptedFetch([new TypeError('fetch failed'), ok]);
    const result = await generateImage(REQUEST, { config: CONFIG, fetchFn, sleep });
    expect(result.cost).toBe(0.0017);
  });

  it('never puts the key into an error message', async () => {
    const failures = [
      () => jsonResponse(401, {}),
      () => jsonResponse(402, {}),
      () => jsonResponse(400, { errors: [{ message: 'bad' }] }),
      () => jsonResponse(503, {}),
    ];
    for (const failure of failures) {
      const { fetchFn } = scriptedFetch([failure]);
      const error = await failureOf(
        generateImage(REQUEST, { config: CONFIG, fetchFn, sleep: async () => {} }),
      );
      expect(error.message).not.toContain(SENTINEL);
    }
  });
});
