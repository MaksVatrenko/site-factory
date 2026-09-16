import { describe, it, expect } from 'vitest';
import { generateImage, generateLogoArtwork, removeBackground, RETRY_DELAYS_MS, RunwareError } from '../factory/images/runware.mjs';

const SENTINEL = 'sentinel-runware-key-client-9b2c';
const CONFIG = {
  apiKey: SENTINEL,
  apiUrl: 'https://runware.test/v1',
  model: 'runware:400@6',
  guidance: 2,
  steps: 4,
  logoModel: 'ideogram:4@0',
  bgModel: 'ideogram:remove-background@0',
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

  // I2: undici's own error message for a header value containing LF/NUL quotes the whole invalid
  // header value back — here, the entire "Bearer <key>" the request tried to send. That message
  // must never be interpolated as-is into the failure this throws.
  it('never lets a fetch failure message leak the key, even when the message itself holds it', async () => {
    const headerError = new TypeError(
      `Headers.append: "Bearer ${SENTINEL}\nx" is an invalid header value.`,
    );
    const { fetchFn } = scriptedFetch([headerError]);
    const error = await failureOf(
      generateImage(REQUEST, { config: CONFIG, fetchFn, sleep: async () => {} }),
    );
    expect(error.kind).toBe('unavailable');
    expect(error.message).not.toContain(SENTINEL);
  });

  // Round 2 fix 3: Runware's own errors[].message is echoed back into a 'rejected' failure's
  // message (a 4xx) and into the "no picture" message (a 200 with no imageBase64Data). The
  // spec's rule is absolute — the key appears in no log line — so even a message Runware itself
  // sends back that happens to contain the key must be scrubbed before it is used.
  it('scrubs the key out of a 4xx error message that echoes it back', async () => {
    const { fetchFn } = scriptedFetch([
      () => jsonResponse(400, { errors: [{ code: 'x', message: `bad token ${SENTINEL} used` }] }),
    ]);
    const error = await failureOf(generateImage(REQUEST, { config: CONFIG, fetchFn }));
    expect(error.kind).toBe('rejected');
    expect(error.message).toContain('***');
    expect(error.message).not.toContain(SENTINEL);
  });

  it('scrubs the key out of a "no picture" error message that echoes it back', async () => {
    const { fetchFn } = scriptedFetch([
      () => jsonResponse(200, { errors: [{ code: 'x', message: `rejected ${SENTINEL}` }] }),
    ]);
    const error = await failureOf(generateImage(REQUEST, { config: CONFIG, fetchFn }));
    expect(error.kind).toBe('rejected');
    expect(error.message).toContain('***');
    expect(error.message).not.toContain(SENTINEL);
  });
});

describe('generateLogoArtwork', () => {
  const LOGO_REQUEST = { prompt: 'a wordmark that reads "899OK"', negativePrompt: 'extra letters', width: 1536, height: 768 };

  it('asks the logo model for the wordmark without the quality knobs other models manage themselves, and never with Ideogram\'s rejected negativePrompt', async () => {
    const { fetchFn, calls } = scriptedFetch([
      (task) => jsonResponse(200, { data: [{ taskUUID: task.taskUUID, imageUUID: 'art-1', cost: 0.09 }] }),
    ]);
    const result = await generateLogoArtwork(LOGO_REQUEST, { config: CONFIG, fetchFn });

    expect(result).toEqual({ imageUUID: 'art-1', cost: 0.09 });
    const [task] = JSON.parse(calls[0].init.body);
    expect(task).toMatchObject({
      taskType: 'imageInference',
      model: 'ideogram:4@0',
      positivePrompt: 'a wordmark that reads "899OK"',
      width: 1536,
      height: 768,
      numberResults: 1,
      outputFormat: 'PNG',
      includeCost: true,
    });
    expect(task).not.toHaveProperty('steps');
    expect(task).not.toHaveProperty('CFGScale');
    expect(task).not.toHaveProperty('outputType');
    // Ideogram 4.0's schema sets additionalProperties: false and has no negativePrompt at all, so
    // it must never be forwarded — even though LOGO_REQUEST above still carries one, proving this
    // is actively stripped rather than merely never having been asked for (finding C1).
    expect(task).not.toHaveProperty('negativePrompt');
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${SENTINEL}`);
  });

  it('refuses an answer without the picture\'s imageUUID', async () => {
    const { fetchFn } = scriptedFetch([(task) => jsonResponse(200, { data: [{ taskUUID: task.taskUUID }] })]);
    const error = await failureOf(generateLogoArtwork(LOGO_REQUEST, { config: CONFIG, fetchFn }));
    expect(error.kind).toBe('rejected');
  });
});

describe('removeBackground', () => {
  it('hands the wordmark over by its imageUUID and returns the transparent PNG', async () => {
    const png = Buffer.from('fake png with alpha');
    const { fetchFn, calls } = scriptedFetch([
      // Runware's docs show the answer to a removeBackground task named differently from the
      // request, so it is matched by taskUUID alone.
      (task) =>
        jsonResponse(200, {
          data: [{ taskType: 'imageBackgroundRemoval', taskUUID: task.taskUUID, imageBase64Data: png.toString('base64'), cost: 0.001 }],
        }),
    ]);
    const result = await removeBackground('art-1', { config: CONFIG, fetchFn });

    expect(result.bytes.equals(png)).toBe(true);
    expect(result.cost).toBe(0.001);
    const [task] = JSON.parse(calls[0].init.body);
    expect(task).toMatchObject({
      taskType: 'removeBackground',
      model: 'ideogram:remove-background@0',
      inputs: { image: 'art-1' },
      outputType: 'base64Data',
      outputFormat: 'PNG',
      includeCost: true,
    });
  });

  it('reports a refused payment the same way as for pictures', async () => {
    const { fetchFn } = scriptedFetch([() => jsonResponse(402, { errors: [{ message: 'no money' }] })]);
    const error = await failureOf(removeBackground('art-1', { config: CONFIG, fetchFn }));
    expect(error.kind).toBe('balance');
  });
});
