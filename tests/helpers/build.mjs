import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ASTRO_BIN = join('node_modules', '.bin', 'astro');

export function buildSite({
  example = 'default',
  template = 't1',
  scheme = 'blue',
  outDir,
  env = {},
} = {}) {
  const target = outDir || join('output', `test-${example}-${template}-${scheme}`);
  rmSync(target, { recursive: true, force: true });

  const examplePublic = join('data', 'examples', example, 'public');
  const log = execFileSync(ASTRO_BIN, ['build'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SITE_JSON: join('data', 'examples', example, 'site.json'),
      PUBLIC_DIR: existsSync(examplePublic) ? examplePublic : '',
      TEMPLATE: template,
      SCHEME: scheme,
      OUT_DIR: target,
      SITE_URL: 'https://example.com',
      ...env,
    },
  });

  return { outDir: target, log };
}

export function readOutput(outDir, file = 'index.html') {
  return readFileSync(join(outDir, file), 'utf8');
}
