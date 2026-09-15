import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Runware settings come from the project's .env file. They are parsed into a plain object and
// deliberately never copied into process.env: the factory starts every Astro build with
// `{ ...process.env, ...options.env }`, so a key that is not in process.env physically cannot reach
// the build process, and so cannot end up in a built site.
export const RUNWARE_DEFAULTS = Object.freeze({
  apiUrl: 'https://api.runware.ai/v1',
  model: 'runware:400@6',
  guidance: 2,
  steps: 4,
  concurrency: 1,
  // The wordmark needs a model that renders text reliably; background removal is a separate,
  // much cheaper model. Both can be swapped in .env without touching code.
  logoModel: 'ideogram:4@0',
  bgModel: 'runware:109@1',
});

// A missing or unreadable .env is not an error here: without a key, generation reports that it
// skipped the pictures, and the site still builds.
function readEnvFile(envFile) {
  try {
    return parseEnv(readFileSync(envFile, 'utf8'));
  } catch {
    return {};
  }
}

function positiveNumber(raw, fallback) {
  if (raw === '') return fallback;
  const number = Number(raw);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveInteger(raw, fallback) {
  const number = positiveNumber(raw, fallback);
  return Number.isInteger(number) ? number : fallback;
}

// A Bearer header value cannot safely carry a space, a line break or any other non-printable
// character — trying to anyway is exactly what let the raw fetch error leak the key elsewhere
// (see runware.mjs). Catching that here, once, means every caller gets a clean "no usable key"
// instead of each having to guard the same thing.
const VISIBLE_ASCII = /^[\x21-\x7E]+$/;

export function readRunwareConfig(envFile) {
  const values = readEnvFile(envFile);
  const text = (key) => (typeof values[key] === 'string' ? values[key].trim() : '');
  const rawKey = text('RUNWARE_API_KEY');
  const apiKeyInvalid = rawKey !== '' && !VISIBLE_ASCII.test(rawKey);
  return {
    apiKey: apiKeyInvalid ? '' : rawKey,
    apiKeyInvalid,
    apiUrl: text('RUNWARE_API_URL') || RUNWARE_DEFAULTS.apiUrl,
    model: text('RUNWARE_MODEL') || RUNWARE_DEFAULTS.model,
    guidance: positiveNumber(text('RUNWARE_GUIDANCE'), RUNWARE_DEFAULTS.guidance),
    steps: positiveInteger(text('RUNWARE_STEPS'), RUNWARE_DEFAULTS.steps),
    concurrency: positiveInteger(text('RUNWARE_CONCURRENCY'), RUNWARE_DEFAULTS.concurrency),
    logoModel: text('RUNWARE_LOGO_MODEL') || RUNWARE_DEFAULTS.logoModel,
    bgModel: text('RUNWARE_BG_MODEL') || RUNWARE_DEFAULTS.bgModel,
  };
}
