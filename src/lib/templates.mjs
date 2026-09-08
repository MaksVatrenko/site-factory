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
  const text = readFileSync(file, 'utf8');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`Template manifest ${file} is not valid JSON: ${err.message}`);
  }
  if (typeof raw.id === 'string' && raw.id !== '' && raw.id !== id) {
    throw new Error(`Template manifest ${file} declares id "${raw.id}" but lives in folder "${id}"`);
  }
  if (raw.blocks !== undefined && !Array.isArray(raw.blocks)) {
    throw new Error(`Template manifest ${file} has a "blocks" field that is not an array`);
  }
  if (raw.elements !== undefined && !Array.isArray(raw.elements)) {
    throw new Error(`Template manifest ${file} has an "elements" field that is not an array`);
  }
  return {
    id,
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : id,
    description: typeof raw.description === 'string' ? raw.description : '',
    blocks: Array.isArray(raw.blocks) ? raw.blocks.filter((b) => typeof b === 'string') : [],
    // Element types a "section" block's own content entries may use (see
    // src/components/ElementRenderer.astro) -- the same declare-to-support mechanism as `blocks`,
    // one level down.
    elements: Array.isArray(raw.elements) ? raw.elements.filter((e) => typeof e === 'string') : [],
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

// Mirrors missingBlockFiles exactly, one level down: a template declaring support for an element
// type with no matching file at templates/<id>/elements/<type>.astro is a template-authoring
// mistake, not a content problem, so it is caught the same way -- named and thrown at load time
// instead of silently rendering nothing for every section that uses it.
export function missingElementFiles(manifest, root = process.cwd()) {
  const dir = join(root, TEMPLATES_DIR, manifest.id, 'elements');
  return (manifest.elements || []).filter((type) => !existsSync(join(dir, `${type}.astro`)));
}
