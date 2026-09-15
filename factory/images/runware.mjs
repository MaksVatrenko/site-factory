import { randomUUID } from 'node:crypto';

// One task per request, over Runware's REST API: POST a JSON array holding one task, with the
// key in the Authorization header. The result comes back inside the response as base64 or as a
// reference (imageUUID) — no second download, and no racing the 7 days a returned URL stays valid.
export const RETRY_DELAYS_MS = Object.freeze([1000, 2000, 4000]);
const DEFAULT_TIMEOUT_MS = 120_000;
const OUTPUT_QUALITY = 85;

// `kind` is what the caller acts on: 'auth' and 'balance' mean every further request would fail the
// same way, 'rejected' is this one picture's problem, 'unavailable' means Runware never answered
// properly even after retrying. Messages never contain the key.
export class RunwareError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'RunwareError';
    this.kind = kind;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 429 and 5xx are Runware being busy or down, not the request being wrong — those are worth
// another try. A 4xx will fail the same way every time.
function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

// Runware reports errors as { errors: [{ code, message }] } — sometimes next to a 200, since one
// response carries per-task results — so the body is read whatever the status was.
function firstErrorMessage(body) {
  const error = Array.isArray(body?.errors) ? body.errors[0] : undefined;
  return typeof error?.message === 'string' ? error.message : '';
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

// Runware's own errors[].message is text it composed from our request, and one field of that
// request is the key — echoed back, it would land straight in the log via a RunwareError's
// message otherwise. The spec's rule is absolute (no log line ever carries the key), so any
// occurrence is scrubbed before the message is used, whatever put it there.
function scrubKey(message, apiKey) {
  if (!apiKey) return message;
  return message.split(apiKey).join('***');
}

// One task, one request: sends it, retries what is worth retrying, and returns the answer that
// carries this task's taskUUID. `hasResult` says whether that answer holds what the caller needs —
// a picture's bytes, or just its imageUUID — so every task shares the same retry, error and
// key-scrubbing rules instead of repeating them.
async function runTask(
  task,
  { config, fetchFn = fetch, sleep = defaultSleep, timeoutMs = DEFAULT_TIMEOUT_MS },
  hasResult,
) {
  const body = JSON.stringify([task]);

  let lastProblem = '';
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

    let response;
    try {
      response = await fetchFn(config.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // Never interpolate error.message here: undici's own message for a header value with a
      // line break or NUL byte quotes the whole invalid header value back, which is the entire
      // "Bearer <key>" this request tried to send. error?.name (e.g. "TypeError") stays key-free.
      lastProblem =
        error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? `нет ответа за ${Math.round(timeoutMs / 1000)} с`
          : `сеть недоступна (${error?.cause?.code ?? error?.name ?? 'неизвестная ошибка'})`;
      continue;
    }

    const payload = await readJson(response);
    if (response.status === 401 || response.status === 403) {
      throw new RunwareError('auth', 'Runware не принял ключ');
    }
    if (response.status === 402) {
      throw new RunwareError('balance', 'на счёте Runware недостаточно денег');
    }
    if (isRetryableStatus(response.status)) {
      lastProblem = `Runware ответил ${response.status}`;
      continue;
    }
    if (!response.ok) {
      const detail = scrubKey(firstErrorMessage(payload), config.apiKey) || 'без описания';
      throw new RunwareError('rejected', `Runware отклонил запрос (${response.status}: ${detail})`);
    }

    const result = Array.isArray(payload?.data)
      ? payload.data.find((item) => item?.taskUUID === task.taskUUID)
      : undefined;
    if (!result || !hasResult(result)) {
      const detail = scrubKey(firstErrorMessage(payload), config.apiKey);
      throw new RunwareError('rejected', `Runware не вернул картинку${detail ? ` (${detail})` : ''}`);
    }
    return result;
  }

  throw new RunwareError('unavailable', `Runware недоступен: ${lastProblem}`);
}

const hasImageData = (result) =>
  typeof result.imageBase64Data === 'string' && result.imageBase64Data !== '';
const costOf = (result) => (typeof result.cost === 'number' ? result.cost : undefined);

export async function generateImage(request, options) {
  const task = {
    taskType: 'imageInference',
    taskUUID: randomUUID(),
    model: options.config.model,
    positivePrompt: request.prompt,
    width: request.width,
    height: request.height,
    steps: options.config.steps,
    CFGScale: options.config.guidance,
    numberResults: 1,
    outputType: 'base64Data',
    outputFormat: 'WEBP',
    outputQuality: OUTPUT_QUALITY,
    includeCost: true,
  };
  if (request.negativePrompt) task.negativePrompt = request.negativePrompt;
  const result = await runTask(task, options, hasImageData);
  return {
    bytes: Buffer.from(result.imageBase64Data, 'base64'),
    cost: costOf(result),
    seed: typeof result.seed === 'number' ? result.seed : undefined,
  };
}

// The wordmark comes from a model chosen for rendering text (Ideogram by default). Only the fields
// such models all accept are sent — no steps or CFGScale, which they manage themselves — and the
// picture is not downloaded at all: removeBackground takes it straight from Runware by imageUUID.
// Ideogram 4.0's schema sets additionalProperties: false and has no negativePrompt field, so it is
// never added to this task — even if a caller's request happens to carry one (see
// loadLogoPromptFile in logo-prompts.mjs, which now refuses to even load a logo.json that has one).
export async function generateLogoArtwork(request, options) {
  const task = {
    taskType: 'imageInference',
    taskUUID: randomUUID(),
    model: options.config.logoModel,
    positivePrompt: request.prompt,
    width: request.width,
    height: request.height,
    numberResults: 1,
    outputFormat: 'PNG',
    includeCost: true,
  };
  const result = await runTask(
    task,
    options,
    (answer) => typeof answer.imageUUID === 'string' && answer.imageUUID !== '',
  );
  return { imageUUID: result.imageUUID, cost: costOf(result) };
}

// Cuts the wordmark out of its plain background. The answer is matched by taskUUID like every
// other: Runware's docs show it named "imageBackgroundRemoval", not the "removeBackground" asked for.
export async function removeBackground(imageUUID, options) {
  const task = {
    taskType: 'removeBackground',
    taskUUID: randomUUID(),
    model: options.config.bgModel,
    inputs: { image: imageUUID },
    outputType: 'base64Data',
    outputFormat: 'PNG',
    includeCost: true,
  };
  const result = await runTask(task, options, hasImageData);
  return { bytes: Buffer.from(result.imageBase64Data, 'base64'), cost: costOf(result) };
}
