import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { listTemplates } from '../src/lib/templates.mjs';
import { listSchemes, readScheme } from '../src/lib/schemes.mjs';

const ASTRO_BIN = join('node_modules', '.bin', 'astro');
const SITE = process.argv[2] || '899ok';
const SITE_DIR = join('data', 'sites', SITE);

// Extracts the literal value a scheme file assigns to --c-primary, so the build check below can
// confirm that exact value made it into the HTML — not just the variable *name*, which also shows
// up in styles/base.css (inlined into every build regardless of template) as `var(--c-primary)`
// regardless of whether any scheme ever defined it.
function primaryValueOf(css) {
  const match = css.match(/--c-primary\s*:\s*([^;]+);/);
  return match ? match[1].trim() : null;
}

if (!existsSync(SITE_DIR)) {
  console.error(`Нет сайта «${SITE}» в data/sites/`);
  process.exit(1);
}

const templates = listTemplates();
const schemes = listSchemes();
const failures = [];

console.log(`Проверка ${templates.length} × ${schemes.length} на сайте «${SITE}»\n`);

for (const template of templates) {
  for (const scheme of schemes) {
    const outDir = join('output', 'matrix', `${template.id}-${scheme}`);
    rmSync(outDir, { recursive: true, force: true });
    const label = `${template.id} × ${scheme}`;

    try {
      const sitePublic = join(SITE_DIR, 'public');
      execFileSync(ASTRO_BIN, ['build'], {
        stdio: 'pipe',
        env: {
          ...process.env,
          SITE_DIR,
          PUBLIC_DIR: existsSync(sitePublic) ? sitePublic : '',
          TEMPLATE: template.id,
          SCHEME: scheme,
          OUT_DIR: outDir,
          SITE_URL: 'https://example.com',
        },
      });

      const html = readFileSync(join(outDir, 'index.html'), 'utf8');
      const problems = [];
      const primaryValue = primaryValueOf(readScheme(scheme).css);
      if (!primaryValue || !html.includes(primaryValue)) problems.push('нет переменных схемы');
      if (/<script[^>]*\ssrc=/i.test(html)) problems.push('в выходе есть JS');
      if (/<link[^>]*\brel=["']?stylesheet["']?/i.test(html)) problems.push('есть внешний стиль');
      // Compare against the text, not the markup: a template is free to split a heading across
      // elements (the review template accents its last words), and a substring search over raw
      // HTML would report missing content that is in fact rendered.
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      if (!text.includes('899OK') && SITE === '899ok') {
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
