import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Settings for the paid services live in the project's .env. They are parsed into a plain object
// and deliberately never copied into process.env: the factory starts every Astro build with
// `{ ...process.env, ...options.env }`, so a key that is not in process.env physically cannot
// reach the build process, and so cannot end up in a built site.
//
// A missing or unreadable .env is not an error here: without a key, a generation step reports that
// it skipped its work, and the site still builds.
export function readEnvFile(envFile) {
  try {
    return parseEnv(readFileSync(envFile, 'utf8'));
  } catch {
    return {};
  }
}
