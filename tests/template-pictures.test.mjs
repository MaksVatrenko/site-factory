import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTemplatePictures } from '../factory/texts/template.mjs';

let roots = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

const MANIFEST = {
  id: 'demo',
  name: 'Demo',
  blocks: ['hero', 'toc', 'section', 'links', 'faq'],
  elements: ['title', 'text', 'list', 'table', 'cards', 'toggle', 'image', 'line'],
};

// A throwaway template tree, so these tests never depend on what templates/template1 happens to hold.
function writePictures(pictures, { manifest = MANIFEST } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'site-factory-pictures-'));
  roots.push(root);
  const dir = join(root, 'templates', 'demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  if (pictures !== undefined) {
    writeFileSync(join(dir, 'pictures.json'), typeof pictures === 'string' ? pictures : JSON.stringify(pictures));
  }
  return root;
}

const pictures = (raw, options) => loadTemplatePictures('demo', writePictures(raw, options));


describe('loadTemplatePictures', () => {
  it('reads where each picture goes and what the theme can draw', () => {
    const content = pictures({ pictures: { hero: 'after-text', section: true }, links: { perBlock: [0, 2], perPage: [0, 8] } });

    expect(content.id).toBe('demo');
    expect(content.pictures).toEqual({ hero: 'after-text', section: 'top' });
    expect(content.links).toEqual({ perBlock: [0, 2], perPage: [0, 8] });
    expect(content.known).toEqual(MANIFEST.blocks);
    expect(content.elements).toEqual(MANIFEST.elements);
  });

  it('refuses a theme with no pictures.json, naming the file', () => {
    expect(() => pictures(undefined)).toThrow(/pictures.json/);
  });

  it('refuses a pictures.json that is not readable JSON, naming the theme', () => {
    expect(() => pictures('{ не json')).toThrow(/demo/);
  });

  it('refuses a picture in a block the theme cannot draw, naming block and theme', () => {
    expect(() => pictures({ pictures: { gallery: true } })).toThrow(/gallery/);
  });

  it('refuses a place a picture cannot sit in, naming the ones it can', () => {
    expect(() => pictures({ pictures: { hero: 'сбоку' } })).toThrow(/after-text/);
  });

  it('reads a block with no picture as having none', () => {
    expect(pictures({ pictures: { hero: false } }).pictures).toEqual({ hero: false });
  });

  it('gives a theme that says nothing about links none at all, rather than unlimited', () => {
    expect(pictures({ pictures: {} }).links).toEqual({ perBlock: [0, 0], perPage: [0, 0] });
  });

  it('takes an exact number for a link budget as a range', () => {
    expect(pictures({ pictures: {}, links: { perBlock: 2 } }).links.perBlock).toEqual([2, 2]);
  });
});

// Two more things the example cannot say, for the same reason it cannot say where a picture goes:
// the texts arrive plain. How much emphasis a block may carry, and whether a closing paragraph is
// set off by a divider, are decisions about how a page reads — the theme's, like the picture.
describe('loadTemplatePictures: выделение и сноска', () => {
  it('reads the emphasis budget and whether a closing note gets a divider', () => {
    const content = pictures({ pictures: {}, emphasis: { perBlock: [0, 3] }, noteLine: true });
    expect(content.emphasis).toEqual({ perBlock: [0, 3] });
    expect(content.noteLine).toBe(true);
  });

  // Same conservative default as the link budget: a theme that says nothing gets none, rather than
  // an unstated licence to emphasise every other word.
  it('gives a theme that says nothing about emphasis none at all', () => {
    expect(pictures({ pictures: {} }).emphasis).toEqual({ perBlock: [0, 0] });
  });

  // And a theme that never declared a `line` element cannot draw one, so inserting it would put a
  // block on the page that renders as nothing at all.
  it('draws no divider unless the theme asks for one', () => {
    expect(pictures({ pictures: {} }).noteLine).toBe(false);
  });

  it('refuses a divider from a theme whose manifest has no line element', () => {
    const manifest = { ...MANIFEST, elements: MANIFEST.elements.filter((name) => name !== 'line') };
    expect(() => pictures({ pictures: {}, noteLine: true }, { manifest })).toThrow(/line/);
  });

  it('takes an exact number for the emphasis budget as a range', () => {
    expect(pictures({ pictures: {}, emphasis: { perBlock: 3 } }).emphasis.perBlock).toEqual([3, 3]);
  });
});
