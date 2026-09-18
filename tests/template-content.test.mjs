import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  describeTemplate,
  loadTemplateContent,
  loadTemplateExamples,
} from '../factory/texts/template.mjs';

let roots = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

// A throwaway template tree, so these tests never depend on what templates/review happens to hold.
function writeTemplate({ manifest, content, examples = {} }) {
  const root = mkdtempSync(join(tmpdir(), 'site-factory-template-'));
  roots.push(root);
  const dir = join(root, 'templates', 'demo');
  mkdirSync(join(dir, 'blocks'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  if (content !== undefined) {
    writeFileSync(join(dir, 'content.json'), typeof content === 'string' ? content : JSON.stringify(content));
  }
  if (Object.keys(examples).length > 0) mkdirSync(join(dir, 'examples'), { recursive: true });
  for (const [name, page] of Object.entries(examples)) {
    writeFileSync(join(dir, 'examples', name), JSON.stringify(page));
  }
  return root;
}

const MANIFEST = {
  id: 'demo',
  name: 'Demo',
  blocks: ['hero', 'toc', 'section', 'links', 'faq'],
  elements: ['title', 'text', 'list', 'table', 'cards', 'toggle', 'image'],
};
const CONTENT = {
  blocks: [
    { type: 'hero', content: { title: 1, text: [1, 2], image: [0, 1] } },
    { type: 'toc', auto: true },
    { type: 'section', count: [8, 10], content: { title: 1, text: [2, 6], list: [0, 1] } },
    { type: 'links', auto: true },
    { type: 'faq', content: { title: 1, toggle: [5, 8] } },
  ],
  images: [0, 3],
  lengths: { title: 60, description: [120, 160], h1: 60, text: [200, 400], listItems: [3, 8] },
  home: { sectionsBonus: 2 },
};

// `CONTENT` above is the raw on-disk shape, which is what `writeTemplate` needs. `describeTemplate`
// never sees that shape: its only caller hands it `loadTemplateContent`'s output, where every count
// is already a `[min, max]` pair and every block carries one. So it gets its own fixture, in the
// shape it is actually contracted to accept — feeding it the raw one would be testing a shape no
// real caller produces, and would push the "number or pair" rule into a second place in the code.
const LOADED = {
  blocks: [
    { type: 'hero', auto: false, count: [1, 1], content: { title: [1, 1], text: [1, 2], image: [0, 1] } },
    { type: 'toc', auto: true, count: [1, 1], content: {} },
    { type: 'section', auto: false, count: [8, 10], content: { title: [1, 1], text: [2, 6], list: [0, 1] } },
    { type: 'links', auto: true, count: [1, 1], content: {} },
    { type: 'faq', auto: false, count: [1, 1], content: { title: [1, 1], toggle: [5, 8] } },
  ],
  images: [0, 3],
  lengths: { title: 60, description: [120, 160], h1: 60, text: [200, 400], listItems: [3, 8] },
  home: { sectionsBonus: 2 },
};

describe('loadTemplateContent', () => {
  it('reads the blocks, the image budget and the lengths', () => {
    const root = writeTemplate({ manifest: MANIFEST, content: CONTENT });
    const content = loadTemplateContent('demo', root);
    expect(content.blocks.map((block) => block.type)).toEqual(['hero', 'toc', 'section', 'links', 'faq']);
    expect(content.blocks[2].count).toEqual([8, 10]);
    expect(content.blocks[1].auto).toBe(true);
    expect(content.images).toEqual([0, 3]);
    expect(content.lengths.text).toEqual([200, 400]);
    expect(content.home.sectionsBonus).toBe(2);
  });

  // Loaded the same way as images (readRange, defaulting to 0): a template that says nothing about
  // link budgets gets no links at all, rather than the least conservative choice possible.
  it('reads the link budgets, defaulting to none when the template says nothing', () => {
    const withLinks = { ...CONTENT, links: { section: [0, 2], page: [0, 8] } };
    const root = writeTemplate({ manifest: MANIFEST, content: withLinks });
    expect(loadTemplateContent('demo', root).links).toEqual({ section: [0, 2], page: [0, 8] });

    const bareRoot = writeTemplate({ manifest: MANIFEST, content: CONTENT });
    expect(loadTemplateContent('demo', bareRoot).links).toEqual({ section: [0, 0], page: [0, 0] });
  });

  it('refuses a template with no content.json, naming it', () => {
    const root = writeTemplate({ manifest: MANIFEST });
    expect(() => loadTemplateContent('demo', root)).toThrow(/demo/);
  });

  // The manifest already says which blocks a template can render. A content.json that asks for one
  // it cannot render would generate text that silently renders as a plain section.
  it('refuses a block the manifest does not declare', () => {
    const content = { ...CONTENT, blocks: [...CONTENT.blocks, { type: 'promo', content: { text: 1 } }] };
    const root = writeTemplate({ manifest: MANIFEST, content });
    expect(() => loadTemplateContent('demo', root)).toThrow(/promo/);
  });

  it('refuses an element the manifest does not declare', () => {
    const blocks = [{ type: 'section', count: [1, 2], content: { video: 1 } }];
    const root = writeTemplate({ manifest: MANIFEST, content: { ...CONTENT, blocks } });
    expect(() => loadTemplateContent('demo', root)).toThrow(/video/);
  });

  it('refuses a range whose lower bound is above its upper one', () => {
    const blocks = [{ type: 'section', count: [10, 8], content: { text: 1 } }];
    const root = writeTemplate({ manifest: MANIFEST, content: { ...CONTENT, blocks } });
    expect(() => loadTemplateContent('demo', root)).toThrow(/section/);
  });

  it('refuses broken JSON, naming the file', () => {
    const root = writeTemplate({ manifest: MANIFEST, content: '{ not json' });
    expect(() => loadTemplateContent('demo', root)).toThrow(/content\.json/);
  });
});

describe('loadTemplateExamples', () => {
  it('reads every example page, sorted by file name', () => {
    const root = writeTemplate({
      manifest: MANIFEST,
      content: CONTENT,
      examples: {
        'b.json': { title: 'B', blocks: [] },
        'a.json': { title: 'A', blocks: [] },
      },
    });
    expect(loadTemplateExamples('demo', root).map((page) => page.title)).toEqual(['A', 'B']);
  });

  it('refuses a template with no examples at all', () => {
    const root = writeTemplate({ manifest: MANIFEST, content: CONTENT });
    expect(() => loadTemplateExamples('demo', root)).toThrow(/demo/);
  });
});

describe('describeTemplate', () => {
  it('turns the rules into prompt text that names every block and its counts', () => {
    const text = describeTemplate(LOADED);
    expect(text).toContain('hero');
    expect(text).toContain('8');
    expect(text).toContain('10');
    // A block the factory fills itself must never be described as something to write.
    expect(text).not.toContain('toc');
    expect(text).not.toContain('links');
  });
});
