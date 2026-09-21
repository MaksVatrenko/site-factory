import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOpenAiConfig } from '../factory/texts/env.mjs';
import { generateSite } from '../factory/texts/generate-site.mjs';
import { loadExamples } from '../factory/texts/example.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The same escape hatch generate-images.mjs has, so tests never read the owner's real .env.
const ENV_FILE = process.env.OPENAI_ENV_FILE || join(ROOT, '.env');

// The only flags this script reads — the sole ones checked below for a shape the parser cannot
// make sense of. An unrecognised flag is left alone, exactly as before: it lands in `values`
// under whatever name was typed, but nothing ever reads it back out.
const KNOWN_FLAGS = ['template', 'out', 'brand', 'geo', 'locale', 'pages', 'example'];

// Accepts `--flag value` and `--flag=value` alike — people type either, and the README shows the
// `=` form for a comma list like --pages. The old, position-only parser only understood the space
// form: given `--pages=home,casino`, it stored the whole thing under the key `pages=home,casino`
// and used the *next* argument (often another flag) as if it were the value, so `pages` silently
// fell back to its one-page default with no warning at all. A known flag whose value still cannot
// be read this way — nothing follows it, or the next token is itself a flag — throws instead of
// repeating that mistake with a different shape.
function flags(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      // Split on the FIRST '=' only, so a value that itself contains one (a URL, say) survives whole.
      values[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[index + 1];
    if (KNOWN_FLAGS.includes(body) && (next === undefined || next.startsWith('--'))) {
      throw new Error(`Не удалось прочитать значение флага --${body}`);
    }
    values[body] = next ?? '';
  }
  return values;
}

let parsed;
try {
  parsed = flags(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { template = 'template1', out = '', brand = '', geo = '', locale = '', pages = '', example = '' } = parsed;

if (out === '' || brand === '') {
  console.error(
    'Использование: npm run generate:texts -- --template template1 --out <папка> --brand <бренд> --geo <гео> [--locale en-US] [--pages home,casino] [--example 899ok]',
  );
  process.exit(1);
}

// A plain folder name only: anything with a path separator or a leading dot could step outside
// data/sites — same containment generate-images.mjs applies to its own --site, and for the same
// reason. Unlike that script's --site, --out need not already exist (a fresh site starts here),
// so this checks only the shape, not existsSync.
if (/[/\\]/.test(out) || out.startsWith('.')) {
  console.error(`Имя папки «${out}» недопустимо: без «/», «\\» и без точки в начале`);
  process.exit(1);
}

// An empty --example means «Случайно» — an example drawn per page — so only a named one is
// checked. This sits with the argument checks above, and not with the run below, on purpose: a typo
// in an example name is a mistake in what was typed, like «--out ../../etc», and mistakes in
// arguments leave through stderr with code 1. Everything that goes wrong *during* a run stays a
// line in stdout and exit 0, because generateSite never throws and half a written folder is still
// worth looking at — which is exactly why a typo must not be left to it: the run would start, write
// nothing and report success. The available names come along because what somebody who mistyped
// «899ok-db» needs next is the correct spelling, and it is one line away.
if (example !== '') {
  let byPage;
  try {
    byPage = loadExamples(template, ROOT);
  } catch (error) {
    // A theme whose examples are missing or unreadable is still a reason this run cannot honour
    // what was asked for, so it leaves the same way — with the reason, not a stack.
    console.error(error.message);
    process.exit(1);
  }
  const has = (list) => list.some((one) => one.name === example);
  // Every page must have it, not just one: the run builds the whole site from this name.
  const missing = Object.entries(byPage).filter(([, list]) => !has(list)).map(([address]) => address);
  if (missing.length > 0) {
    const everywhere = (Object.values(byPage)[0] ?? [])
      .map((one) => one.name)
      .filter((name) => Object.values(byPage).every((list) => list.some((one) => one.name === name)));
    console.error(
      `Примера «${example}» нет у страниц: ${missing.join(', ')}. Есть у всех: ${everywhere.join(', ')}`,
    );
    process.exit(1);
  }
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
  geosFile: join(ROOT, 'factory', 'geos.json'),
  example,
  log: (line) => console.log(line),
});
