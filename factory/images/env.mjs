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

export function readRunwareConfig(envFile) {
  const values = readEnvFile(envFile);
  const text = (key) => (typeof values[key] === 'string' ? values[key].trim() : '');
  return {
    apiKey: text('RUNWARE_API_KEY'),
    apiUrl: text('RUNWARE_API_URL') || RUNWARE_DEFAULTS.apiUrl,
    model: text('RUNWARE_MODEL') || RUNWARE_DEFAULTS.model,
    guidance: positiveNumber(text('RUNWARE_GUIDANCE'), RUNWARE_DEFAULTS.guidance),
    steps: positiveInteger(text('RUNWARE_STEPS'), RUNWARE_DEFAULTS.steps),
    concurrency: positiveInteger(text('RUNWARE_CONCURRENCY'), RUNWARE_DEFAULTS.concurrency),
  };
}
