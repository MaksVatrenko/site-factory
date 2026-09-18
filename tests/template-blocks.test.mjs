import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeBlocks, loadTemplateBlocks } from '../factory/texts/template.mjs';

let roots = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

const MANIFEST = {
  id: 'demo',
  name: 'Demo',
  blocks: ['hero', 'toc', 'section', 'links', 'faq'],
  elements: ['title', 'text', 'list', 'table', 'cards', 'toggle', 'image'],
};

// A throwaway template tree, so these tests never depend on what templates/review happens to hold.
function writeTemplate(blocks, { manifest = MANIFEST } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'site-factory-blocks-'));
  roots.push(root);
  const dir = join(root, 'templates', 'demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  if (blocks !== undefined) {
    writeFileSync(join(dir, 'blocks.json'), typeof blocks === 'string' ? blocks : JSON.stringify(blocks));
  }
  return root;
}

const load = (blocks, options) => loadTemplateBlocks('demo', writeTemplate(blocks, options));

describe('loadTemplateBlocks', () => {
  it('reads every block with its nature, its content ranges and the page-wide numbers', () => {
    const content = load({
      lengths: { h1: 60, text: [200, 400] },
      links: { perBlock: [0, 2], perPage: [0, 8] },
      blocks: {
        hero: { h1: true, image: true, content: { text: [1, 2] } },
        toc: { auto: true },
        section: { heading: true, content: { text: [2, 6] } },
      },
    });

    // `image` says both that the block has a picture and where it sits: a bare true means
    // directly under the heading, which is what most blocks want and what "top" spells out.
    expect(content.blocks.hero).toEqual({
      type: 'hero',
      auto: false,
      h1: true,
      image: 'top',
      heading: false,
      content: { text: [1, 2] },
    });
    expect(content.blocks.section.heading).toBe(true);
    expect(content.links).toEqual({ perBlock: [0, 2], perPage: [0, 8] });
    expect(content.lengths.h1).toBe(60);
  });

  // The nature a block does not claim is the nature it does not have. Without this, "no heading"
  // and "heading left out of the file" would be two different things everywhere downstream.
  it('defaults every nature flag to false, so a block says only what it is', () => {
    const content = load({ blocks: { toc: { auto: true } } });
    expect(content.blocks.toc).toEqual({
      type: 'toc',
      auto: true,
      h1: false,
      image: false,
      heading: false,
      content: {},
    });
  });

  it('normalises an exact count to a range, so callers have one shape', () => {
    const content = load({ blocks: { faq: { content: { toggle: 6 } } } });
    expect(content.blocks.faq.content.toggle).toEqual([6, 6]);
  });

  // resolveLayout tells "the theme cannot draw this block" apart from "it can, but blocks.json does
  // not describe it" — two different mistakes with two different fixes. It reads the first from
  // here rather than opening the manifest a second time.
  it('hands back what the theme can draw at all, beside what blocks.json describes', () => {
    const content = load({ blocks: { hero: { h1: true } } });
    expect(content.known).toEqual(['hero', 'toc', 'section', 'links', 'faq']);
    expect(Object.keys(content.blocks)).toEqual(['hero']);
  });

  it('refuses a template with no blocks.json, naming the file', () => {
    expect(() => load(undefined)).toThrow(/blocks\.json/);
  });

  it('refuses broken JSON, naming the file', () => {
    expect(() => load('{ не json')).toThrow(/blocks\.json/);
  });

  it('refuses a blocks.json that is not an object', () => {
    expect(() => load('[]')).toThrow(/объектом/);
  });

  it('refuses an empty list of blocks', () => {
    expect(() => load({ blocks: {} })).toThrow(/непустой/);
  });

  // The manifest already says which blocks a theme can render. A blocks.json that describes one it
  // cannot is a template-authoring mistake, and the page would come out with a hole in it.
  it('refuses a block the manifest does not declare', () => {
    expect(() => load({ blocks: { split: { content: { text: [1, 1] } } } })).toThrow(/split/);
  });

  it('refuses an element the manifest does not declare', () => {
    expect(() => load({ blocks: { section: { content: { video: [1, 1] } } } })).toThrow(/video/);
  });

  it('refuses a range whose lower bound is above its upper one', () => {
    expect(() => load({ blocks: { section: { content: { text: [6, 2] } } } })).toThrow(/text/);
  });

  // "метка без имени не возникнет": a picture belongs to a block by its nature, and the model is
  // never offered an `image` element to place one itself. A template that asks for one anyway would
  // get a plan naming a picture nothing declared — the defect the live run of 2026-09-18 hit.
  it('refuses image as a content element, since a picture is a nature not an element', () => {
    expect(() => load({ blocks: { section: { content: { image: [0, 1] } } } })).toThrow(/image: true/);
  });

  it('refuses an auto block that also declares content, since the factory fills it', () => {
    expect(() => load({ blocks: { toc: { auto: true, content: { text: [1, 1] } } } })).toThrow(/auto/);
  });

  // assemble.mjs has to pick one, and whichever it picks the other nature is paid for and thrown
  // away: the plan writes lead paragraphs for an h1 block, and a heading block takes an entry from
  // the plan's sections. A theme claiming both gets one of them silently discarded.
  it('refuses a block that is both the page heading and a section heading', () => {
    expect(() => load({ blocks: { hero: { h1: true, heading: true } } })).toThrow(/h1/);
  });

  it('names itself, so a layout refused against it can say which theme refused it', () => {
    expect(load({ blocks: { hero: { h1: true } } }).id).toBe('demo');
  });

  it('refuses a nature flag that is not a boolean', () => {
    expect(() => load({ blocks: { hero: { heading: 'yes' } } })).toThrow(/heading/);
  });

  // A picture's place is one of a short list, and a typo in it would otherwise put the picture
  // silently back at the top — the one place the block was asking for it not to be.
  it('reads where a picture sits, and refuses a place it does not know', () => {
    expect(load({ blocks: { hero: { image: 'after-text' } } }).blocks.hero.image).toBe('after-text');
    expect(load({ blocks: { hero: { image: false } } }).blocks.hero.image).toBe(false);
    expect(() => load({ blocks: { hero: { image: 'sideways' } } })).toThrow(/after-text/);
  });

  // The conservative default, not the permissive one: a theme that says nothing about links gets
  // none, rather than an unstated unlimited budget.
  it('defaults the link budgets to none when the template says nothing', () => {
    const content = load({ blocks: { hero: { h1: true } } });
    expect(content.links).toEqual({ perBlock: [0, 0], perPage: [0, 0] });
  });
});

describe('describeBlocks', () => {
  const CONTENT = {
    blocks: {
      hero: { type: 'hero', auto: false, h1: true, image: true, heading: false, content: { text: [1, 2] } },
      toc: { type: 'toc', auto: true, h1: false, image: false, heading: false, content: {} },
      section: { type: 'section', auto: false, h1: false, image: false, heading: true, content: { title: [0, 1], text: [2, 6] } },
      faq: { type: 'faq', auto: false, h1: false, image: false, heading: true, content: { toggle: [6, 6] } },
    },
    lengths: { h1: 60, text: [200, 400] },
    links: { perBlock: [0, 2], perPage: [0, 8] },
  };

  it('names every block the model writes, with its counts and its lengths', () => {
    const text = describeBlocks(CONTENT);
    expect(text).toMatch(/- hero: between 1 and 2 text/);
    expect(text).toMatch(/- section: between 0 and 1 title, between 2 and 6 text/);
    expect(text).toMatch(/- h1: up to 60 characters/);
    expect(text).toMatch(/- text: 200–400 characters/);
  });

  it('leaves auto blocks out, since the factory fills them', () => {
    expect(describeBlocks(CONTENT)).not.toMatch(/- toc:/);
  });

  // Naming what the factory supplies is not decoration: unsaid, the model writes a heading of its
  // own into the body and the page ends up with two.
  it('says which parts of a block are written for the model, not by it', () => {
    const text = describeBlocks(CONTENT);
    expect(text).toMatch(/- hero:.*its h1 and its picture are written for you/);
    expect(text).toMatch(/- section:.*its heading is written for you/);
  });
});
