// One request, one JSON answer, over OpenAI's Responses API. The schema goes in `text.format` with
// strict: true, which constrains decoding itself — a completed answer cannot be malformed JSON or
// carry a field the schema does not name. Only two things can still go wrong with the content, and
// both are reported by the API rather than guessed at: the model refusing, and the answer running
// into the output limit. Everything else here is transport.
export const RETRY_DELAYS_MS = Object.freeze([1000, 2000, 4000]);
const DEFAULT_TIMEOUT_MS = 120_000;

// `kind` is what the caller acts on. 'auth' and 'balance' mean every further request fails the same
// way, so the run stops. 'refused' and 'truncated' are this one request's problem and are worth
// asking again. 'rejected' is a request the API would refuse identically forever. 'unavailable'
// means OpenAI never answered properly even after retrying. Messages never contain the key.
export class OpenAiError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'OpenAiError';
    this.kind = kind;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A 429 means two different things: "too fast", which is worth another try, and "out of money",
// which will answer the same way for the rest of the run. Only the error code tells them apart.
const QUOTA_CODES = new Set(['insufficient_quota', 'billing_hard_limit_reached']);

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

// OpenAI's own error text is composed from our request, and one field of that request is the key.
// Echoed back, it would land straight in a log line, so any occurrence is scrubbed before use —
// whatever put it there.
function scrubKey(message, apiKey) {
  if (!apiKey) return message;
  return String(message).split(apiKey).join('***');
}

function errorOf(payload) {
  const error = payload?.error;
  return {
    code: typeof error?.code === 'string' ? error.code : '',
    message: typeof error?.message === 'string' ? error.message : '',
  };
}

// The answer we asked for is the text of an `output_text` part inside a `message` item. Walked
// rather than read from a convenience field, because this client talks to the API directly.
function outputText(payload) {
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return '';
}

// A refusal replaces the schema-shaped answer. It is documented as an output item; it is also
// accepted here as a content part, because either shape means the same thing and guessing wrong
// would turn a clear refusal into a confusing "no answer".
function refusalText(payload) {
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type === 'refusal' && typeof item.refusal === 'string') return item.refusal;
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === 'refusal' && typeof part.refusal === 'string') return part.refusal;
    }
  }
  return '';
}

// Retry-After is a floor, not a replacement: when OpenAI names a wait, honouring anything shorter
// just earns another 429.
function retryAfterMs(response) {
  const header = response.headers?.get?.('retry-after');
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

// The answer carries token counters, not money — there is no `cost` field to read, unlike Runware.
// Cached input is billed at its own much lower rate, and `input_tokens` already includes it, so the
// fresh part is what is left after taking the cached part out.
export function costOf(usage, config) {
  const input = Number(usage?.input_tokens) || 0;
  const cached = Number(usage?.input_tokens_details?.cached_tokens) || 0;
  const output = Number(usage?.output_tokens) || 0;
  const fresh = Math.max(input - cached, 0);
  return (
    (fresh * config.priceInput + cached * config.priceCachedInput + output * config.priceOutput) /
    1_000_000
  );
}

export async function askJson(
  { instructions, input, schemaName, schema, cacheKey, maxOutputTokens },
  { config, fetchFn = fetch, sleep = defaultSleep, timeoutMs = DEFAULT_TIMEOUT_MS },
) {
  const request = {
    model: config.model,
    // Static first, dynamic last. This is not style: the prompt cache only hits on an unchanged
    // prefix, and the rules plus the examples are far and away the biggest part of every request.
    instructions,
    input: [{ role: 'user', content: input }],
    text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } },
  };
  if (cacheKey) request.prompt_cache_key = cacheKey;
  if (maxOutputTokens) request.max_output_tokens = maxOutputTokens;
  const body = JSON.stringify(request);

  let lastProblem = '';
  let lastRetryAfter = 0;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(Math.max(RETRY_DELAYS_MS[attempt - 1], lastRetryAfter));

    let response;
    try {
      response = await fetchFn(config.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // Never interpolate error.message here: undici's message for an invalid header value quotes
      // the whole header back, which is the entire "Bearer <key>" this request tried to send.
      lastProblem =
        error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? `нет ответа за ${Math.round(timeoutMs / 1000)} с`
          : `сеть недоступна (${error?.cause?.code ?? error?.name ?? 'неизвестная ошибка'})`;
      lastRetryAfter = 0;
      continue;
    }

    const payload = await readJson(response);
    const { code, message } = errorOf(payload);

    if (response.status === 401 || response.status === 403) {
      throw new OpenAiError('auth', 'OpenAI не принял ключ');
    }
    if (QUOTA_CODES.has(code)) {
      throw new OpenAiError('balance', 'на счёте OpenAI недостаточно денег');
    }
    if (response.status === 429 || response.status >= 500) {
      lastProblem = `OpenAI ответил ${response.status}`;
      lastRetryAfter = retryAfterMs(response);
      continue;
    }
    if (!response.ok) {
      const detail = scrubKey(message, config.apiKey) || 'без описания';
      throw new OpenAiError('rejected', `OpenAI отклонил запрос (${response.status}: ${detail})`);
    }

    if (payload?.status === 'incomplete') {
      const reason = payload?.incomplete_details?.reason ?? 'без причины';
      throw new OpenAiError('truncated', `OpenAI оборвал ответ (${reason})`);
    }
    const refusal = refusalText(payload);
    if (refusal) {
      throw new OpenAiError('refused', `OpenAI отказался отвечать (${scrubKey(refusal, config.apiKey)})`);
    }

    const text = outputText(payload);
    if (text === '') throw new OpenAiError('rejected', 'OpenAI вернул ответ без текста');
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Strict mode makes this all but impossible, so it means something unexpected happened
      // rather than the model being sloppy. The text itself is not logged: it is the model's own
      // words about our request and has no place in a build log.
      throw new OpenAiError('rejected', 'OpenAI вернул не JSON');
    }

    const usage = payload?.usage;
    return {
      data,
      cost: costOf(usage, config),
      usage: {
        inputTokens: Number(usage?.input_tokens) || 0,
        cachedTokens: Number(usage?.input_tokens_details?.cached_tokens) || 0,
        outputTokens: Number(usage?.output_tokens) || 0,
      },
    };
  }

  throw new OpenAiError('unavailable', `OpenAI недоступен: ${lastProblem}`);
}
