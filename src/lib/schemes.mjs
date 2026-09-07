import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SCHEMES_DIR = join('styles', 'schemes');

export function listSchemes(root = process.cwd()) {
  const dir = join(root, SCHEMES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.css'))
    .map((name) => name.slice(0, -'.css'.length))
    .sort();
}

export function readScheme(id, root = process.cwd()) {
  const available = listSchemes(root);
  if (available.length === 0) {
    throw new Error(`No colour schemes found in ${SCHEMES_DIR}`);
  }
  const wanted = typeof id === 'string' ? id : '';
  const chosen = available.includes(wanted) ? wanted : available[0];
  return {
    id: chosen,
    css: readFileSync(join(root, SCHEMES_DIR, `${chosen}.css`), 'utf8'),
    fellBack: chosen !== wanted,
  };
}
