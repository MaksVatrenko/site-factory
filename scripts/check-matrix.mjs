import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { listTemplates } from '../src/lib/templates.mjs';
import { listSchemes } from '../src/lib/schemes.mjs';

const ASTRO_BIN = join('node_modules', '.bin', 'astro');
const EXAMPLE = process.argv[2] || 'default';
const EXAMPLE_DIR = join('data', 'examples', EXAMPLE);

if (!existsSync(join(EXAMPLE_DIR, 'site.json'))) {
  console.error(`Нет примера «${EXAMPLE}» в data/examples/`);
  process.exit(1);
}

const templates = listTemplates();
const schemes = listSchemes();
const failures = [];

console.log(`Проверка ${templates.length} × ${schemes.length} на примере «${EXAMPLE}»\n`);

for (const template of templates) {
  for (const scheme of schemes) {
    const outDir = join('output', 'matrix', `${template.id}-${scheme}`);
    rmSync(outDir, { recursive: true, force: true });
    const label = `${template.id} × ${scheme}`;

    try {
      const examplePublic = join(EXAMPLE_DIR, 'public');
      execFileSync(ASTRO_BIN, ['build'], {
        stdio: 'pipe',
        env: {
          ...process.env,
          SITE_JSON: join(EXAMPLE_DIR, 'site.json'),
          PUBLIC_DIR: existsSync(examplePublic) ? examplePublic : '',
          TEMPLATE: template.id,
          SCHEME: scheme,
          OUT_DIR: outDir,
          SITE_URL: 'https://example.com',
        },
      });

      const html = readFileSync(join(outDir, 'index.html'), 'utf8');
      const problems = [];
      if (!html.includes('--c-primary')) problems.push('нет переменных схемы');
      if (/<script[^>]*\ssrc=/i.test(html)) problems.push('в выходе есть JS');
      if (/<link[^>]*\brel=["']?stylesheet["']?/i.test(html)) problems.push('есть внешний стиль');
      if (!html.includes('Find what actually works') && EXAMPLE === 'default') {
        problems.push('нет контента hero');
      }

      if (problems.length > 0) {
        failures.push(`${label}: ${problems.join(', ')}`);
        console.log(`  ✗ ${label} — ${problems.join(', ')}`);
      } else {
        console.log(`  ✓ ${label}`);
      }
    } catch (error) {
      failures.push(`${label}: сборка упала`);
      console.log(`  ✗ ${label} — сборка упала`);
      console.log(String(error.stderr ?? error.message).trim());
    }
  }
}

console.log('');
if (failures.length > 0) {
  console.error(`Провалов: ${failures.length}`);
  process.exit(1);
}
console.log('Все комбинации собрались.');
