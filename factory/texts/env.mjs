import { readEnvFile } from '../env-file.mjs';

export const OPENAI_DEFAULTS = Object.freeze({
  // The Responses API: OpenAI recommends it over Chat Completions for new work, and it is the one
  // whose `text.format` carries the strict JSON schema this stage depends on.
  apiUrl: 'https://api.openai.com/v1/responses',
  model: 'gpt-5.6-luna',
  // Prices are settings, not facts. Unlike Runware, which answers with `cost`, OpenAI answers only
  // with token counts, so the only way to report what a run cost is to multiply them out here.
  // Dollars per million tokens, matching the default model above: change the model and these have
  // to change with it, or the log quietly lies.
  priceInput: 0.2,
  priceCachedInput: 0.02,
  priceOutput: 1.2,
});

// Same reasoning as factory/images/env.mjs: a Bearer header value cannot safely carry a space, a
// line break or any other non-printable character, and trying anyway is exactly what let a raw
// fetch error leak a key once. Caught here, once, so every caller gets a clean "no usable key".
const VISIBLE_ASCII = /^[\x21-\x7E]+$/;

// Zero is a legitimate price (a free model), so this accepts it — only a genuinely empty setting
// falls back to the default.
function price(raw, fallback) {
  if (raw === '') return fallback;
  const number = Number(raw);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function readOpenAiConfig(envFile) {
  const values = readEnvFile(envFile);
  const text = (key) => (typeof values[key] === 'string' ? values[key].trim() : '');
  const rawKey = text('OPENAI_API_KEY');
  const apiKeyInvalid = rawKey !== '' && !VISIBLE_ASCII.test(rawKey);
  return {
    apiKey: apiKeyInvalid ? '' : rawKey,
    apiKeyInvalid,
    apiUrl: text('OPENAI_API_URL') || OPENAI_DEFAULTS.apiUrl,
    model: text('OPENAI_MODEL') || OPENAI_DEFAULTS.model,
    priceInput: price(text('OPENAI_PRICE_INPUT'), OPENAI_DEFAULTS.priceInput),
    priceCachedInput: price(text('OPENAI_PRICE_CACHED_INPUT'), OPENAI_DEFAULTS.priceCachedInput),
    priceOutput: price(text('OPENAI_PRICE_OUTPUT'), OPENAI_DEFAULTS.priceOutput),
  };
}
