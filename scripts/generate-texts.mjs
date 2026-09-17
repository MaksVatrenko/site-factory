import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOpenAiConfig } from '../factory/texts/env.mjs';
import { generateSite } from '../factory/texts/generate-site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The same escape hatch generate-images.mjs has, so tests never read the owner's real .env.
const ENV_FILE = process.env.OPENAI_ENV_FILE || join(ROOT, '.env');

function flags(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    values[argv[index].slice(2)] = argv[index + 1] ?? '';
  }
  return values;
}

const { template = 'review', out = '', brand = '', geo = '', locale = '', pages = '' } = flags(
  process.argv.slice(2),
);

if (out === '' || brand === '') {
  console.error(
    'Использование: npm run generate:texts -- --template review --out <папка> --brand <бренд> --geo <гео> [--locale en-US] [--pages home,casino]',
  );
  process.exit(1);
}

const list = pages
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

await generateSite({
  siteDir: join(ROOT, 'data', 'sites', out),
  templateId: template,
  brand,
  geo,
  locale,
  pages: list.length > 0 ? list : ['home'],
  config: readOpenAiConfig(ENV_FILE),
  root: ROOT,
  promptFile: join(ROOT, 'factory', 'prompts', 'texts.json'),
  log: (line) => console.log(line),
});
