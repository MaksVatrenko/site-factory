import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listTemplates,
  readManifest,
  loadTemplate,
  missingBlockFiles,
  missingElementFiles,
} from '../src/lib/templates.mjs';

// Each fixture root created below is a real mkdtemp'd directory under the OS temp folder, which
// nothing else ever cleans up — left alone, one accumulates per test run forever. Tracking the
// roots this file itself creates (and only those) lets afterAll remove exactly what it made.
const createdRoots = [];

function makeTemplateRoot(folderId, manifestText) {
  const root = mkdtempSync(join(tmpdir(), 'site-factory-templates-'));
  createdRoots.push(root);
  const dir = join(root, 'templates', folderId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), manifestText);
  return root;
}

describe('template registry', () => {
  afterAll(() => {
    for (const root of createdRoots) rmSync(root, { recursive: true, force: true });
  });

  it('finds at least one template', () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      blocks: expect.any(Array),
    });
  });

  it('keeps templates sorted by id', () => {
    const ids = listTemplates().map((template) => template.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('reads a manifest by id', () => {
    const manifest = readManifest('review');
    expect(manifest.id).toBe('review');
    expect(manifest.blocks).toContain('hero');
    expect(manifest.elements).toContain('title');
    expect(manifest.defaultScheme).toBeTruthy();
  });

  it('throws for an unknown manifest', () => {
    expect(() => readManifest('nope')).toThrow(/nope/);
  });

  it('falls back to the first template for an unknown id', () => {
    expect(loadTemplate('nope').id).toBe(listTemplates()[0].id);
    expect(loadTemplate('').id).toBe(listTemplates()[0].id);
  });

  it('reports no missing files for shipped templates', () => {
    for (const template of listTemplates()) {
      expect(missingBlockFiles(template)).toEqual([]);
      expect(missingElementFiles(template)).toEqual([]);
    }
  });

  it('reports a block file that does not exist', () => {
    const broken = { id: 'review', blocks: ['hero', 'imaginary'] };
    expect(missingBlockFiles(broken)).toEqual(['imaginary']);
  });

  // Mirrors the block-file checks above, one level down: an element type a manifest declares
  // support for must have a matching templates/<id>/elements/<type>.astro file, exactly like a
  // block type must -- see src/components/ElementRenderer.astro.
  it('reports an element file that does not exist', () => {
    const broken = { id: 'review', elements: ['title', 'imaginary'] };
    expect(missingElementFiles(broken)).toEqual(['imaginary']);
  });

  it('treats a manifest with no elements field as declaring none', () => {
    expect(missingElementFiles({ id: 'review' })).toEqual([]);
  });

  it('throws when a manifest id does not match its folder', () => {
    const root = makeTemplateRoot('sample', JSON.stringify({ id: 'zzz', blocks: ['hero'] }));
    expect(() => readManifest('sample', root)).toThrow(/sample/);
    expect(() => readManifest('sample', root)).toThrow(/zzz/);
  });

  it('keeps using the folder name when a manifest has no id field', () => {
    const root = makeTemplateRoot('fixture', JSON.stringify({ blocks: ['hero'] }));
    expect(readManifest('fixture', root).id).toBe('fixture');
  });

  it('throws when blocks is present but not an array', () => {
    const root = makeTemplateRoot('fixture', JSON.stringify({ id: 'fixture', blocks: 'hero' }));
    expect(() => readManifest('fixture', root)).toThrow(/blocks/);
  });

  it('defaults to an empty block list when blocks is absent', () => {
    const root = makeTemplateRoot('fixture', JSON.stringify({ id: 'fixture' }));
    expect(readManifest('fixture', root).blocks).toEqual([]);
  });

  // Mirrors the two `blocks`-field tests above exactly, for the `elements` field a "section"
  // block's own content entries are checked against (see src/components/ElementRenderer.astro).
  it('throws when elements is present but not an array', () => {
    const root = makeTemplateRoot('fixture', JSON.stringify({ id: 'fixture', elements: 'title' }));
    expect(() => readManifest('fixture', root)).toThrow(/elements/);
  });

  it('defaults to an empty element list when elements is absent', () => {
    const root = makeTemplateRoot('fixture', JSON.stringify({ id: 'fixture' }));
    expect(readManifest('fixture', root).elements).toEqual([]);
  });

  it('names the file when the manifest is not valid JSON', () => {
    const root = makeTemplateRoot('fixture', '{ this is not json');
    expect(() => readManifest('fixture', root)).toThrow(/manifest\.json/);
  });
});
