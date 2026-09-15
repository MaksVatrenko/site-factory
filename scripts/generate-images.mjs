import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRunwareConfig } from '../factory/images/env.mjs';
import { generateLogo } from '../factory/images/logo.mjs';
import { generateMissingImages } from '../factory/images/generate.mjs';

// Generates a site's logo (when it has none) and its missing pictures without building it — the
// same two steps the factory runs before every build. The brand for alt text and prompts comes
// from the site's own site.json.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = process.argv[2];

if (!site) {
  console.error('Укажите папку сайта: npm run generate:images -- 899ok');
  process.exit(1);
}

// A plain folder name only: anything with a path separator or a leading dot could step outside
// data/sites.
const siteDir = join(ROOT, 'data', 'sites', site);
if (/[/\\]/.test(site) || site.startsWith('.') || !existsSync(siteDir)) {
  console.error(`Папка сайта «${site}» не найдена в data/sites`);
  process.exit(1);
}

// Tests point RUNWARE_ENV_FILE at a nonexistent file so they never read the owner's real key.
const envFile = process.env.RUNWARE_ENV_FILE ? process.env.RUNWARE_ENV_FILE : join(ROOT, '.env');

// Read once and shared by both steps below, same as the server's own prepare step: a key added to
// .env while this runs would not matter anyway, since a CLI run reads it exactly once regardless.
const config = readRunwareConfig(envFile);

let loggedAnything = false;
const log = (line) => {
  console.log(line);
  loggedAnything = true;
};

await generateLogo({ siteDir, config, promptFile: join(ROOT, 'factory', 'prompts', 'logo.json'), log });
await generateMissingImages({
  siteDir,
  config,
  promptFile: join(ROOT, 'factory', 'prompts', 'images.json'),
  log,
});

// Both steps log nothing only when there is nothing left for them to do — a site with its own
// brand.logo and a full images.json. When the site folder cannot be read, each logs its own error
// line instead.
if (!loggedAnything) {
  console.log('Картинки и логотип: всё уже на месте');
}
