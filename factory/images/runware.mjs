import { randomUUID } from 'node:crypto';

// One picture per request, over Runware's REST API: POST a JSON array holding one imageInference
// task, with the key in the Authorization header. The picture comes back inside the response as
// base64 — no second download, and no racing the 7 days a returned URL stays valid.
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

export async function generateImage(
  request,
  { config, fetchFn = fetch, sleep = defaultSleep, timeoutMs = DEFAULT_TIMEOUT_MS },
) {
  const taskUUID = randomUUID();
  const task = {
    taskType: 'imageInference',
    taskUUID,
    model: config.model,
    positivePrompt: request.prompt,
    width: request.width,
    height: request.height,
    steps: config.steps,
    CFGScale: config.guidance,
    numberResults: 1,
    outputType: 'base64Data',
    outputFormat: 'WEBP',
    outputQuality: OUTPUT_QUALITY,
    includeCost: true,
  };
  if (request.negativePrompt) task.negativePrompt = request.negativePrompt;
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
      lastProblem =
        error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? `нет ответа за ${Math.round(timeoutMs / 1000)} с`
          : `сеть недоступна (${error?.message ?? error})`;
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
      throw new RunwareError(
        'rejected',
        `Runware отклонил запрос (${response.status}: ${firstErrorMessage(payload) || 'без описания'})`,
      );
    }

    const result = Array.isArray(payload?.data)
      ? payload.data.find((item) => item?.taskUUID === taskUUID)
      : undefined;
    if (typeof result?.imageBase64Data !== 'string' || result.imageBase64Data === '') {
      const detail = firstErrorMessage(payload);
      throw new RunwareError('rejected', `Runware не вернул картинку${detail ? ` (${detail})` : ''}`);
    }
    return {
      bytes: Buffer.from(result.imageBase64Data, 'base64'),
      cost: typeof result.cost === 'number' ? result.cost : undefined,
      seed: typeof result.seed === 'number' ? result.seed : undefined,
    };
  }

  throw new RunwareError('unavailable', `Runware недоступен: ${lastProblem}`);
}
