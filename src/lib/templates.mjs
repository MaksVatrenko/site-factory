import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TEMPLATES_DIR = 'templates';

function manifestPath(id, root) {
  return join(root, TEMPLATES_DIR, id, 'manifest.json');
}

export function readManifest(id, root = process.cwd()) {
  const file = manifestPath(id, root);
  if (!existsSync(file)) {
    throw new Error(`Template "${id}" not found: no manifest at ${file}`);
  }
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : id,
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : id,
    description: typeof raw.description === 'string' ? raw.description : '',
    blocks: Array.isArray(raw.blocks) ? raw.blocks.filter((b) => typeof b === 'string') : [],
    defaultScheme: typeof raw.defaultScheme === 'string' ? raw.defaultScheme : '',
  };
}

export function listTemplates(root = process.cwd()) {
  const dir = join(root, TEMPLATES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => existsSync(manifestPath(name, root)))
    .map((name) => readManifest(name, root))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function loadTemplate(id, root = process.cwd()) {
  const available = listTemplates(root);
  if (available.length === 0) {
    throw new Error(`No templates found in ${TEMPLATES_DIR}`);
  }
  return available.find((template) => template.id === id) ?? available[0];
}

export function missingBlockFiles(manifest, root = process.cwd()) {
  const dir = join(root, TEMPLATES_DIR, manifest.id, 'blocks');
  return manifest.blocks.filter((type) => !existsSync(join(dir, `${type}.astro`)));
}
