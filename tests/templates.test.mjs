import { describe, it, expect } from 'vitest';
import {
  listTemplates,
  readManifest,
  loadTemplate,
  missingBlockFiles,
} from '../src/lib/templates.mjs';

describe('template registry', () => {
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
    const manifest = readManifest('t1');
    expect(manifest.id).toBe('t1');
    expect(manifest.blocks).toContain('hero');
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
    }
  });

  it('reports a block file that does not exist', () => {
    const broken = { id: 't1', blocks: ['hero', 'imaginary'] };
    expect(missingBlockFiles(broken)).toEqual(['imaginary']);
  });
});
