import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRunwareConfig } from '../factory/images/env.mjs';
import { generateMissingImages } from '../factory/images/generate.mjs';

// Generates a site's missing pictures without building it — the same step the factory runs before
// every build. The brand for alt text and prompts comes from the site's own site.json.
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

let loggedAnything = false;
const summary = await generateMissingImages({
  siteDir,
  config: readRunwareConfig(envFile),
  promptFile: join(ROOT, 'factory', 'prompts', 'images.json'),
  log: (line) => {
    console.log(line);
    loggedAnything = true;
  },
});

// generateMissingImages logs nothing only when every picture is already in place. When the site
// folder cannot be read, it logs an error line and returns empty results.
if (!loggedAnything) {
  console.log('Картинки: все метки уже есть в images.json');
}
