import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLayouts, pickLayouts, planShape, resolveLayout, contentByType } from '../factory/texts/layouts.mjs';
import { assemblePage } from '../factory/texts/assemble.mjs';

let dirs = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

// A throwaway layouts folder, so these tests never depend on what layouts/ happens to hold.
function folder(files) {
  const dir = mkdtempSync(join(tmpdir(), 'site-factory-layouts-'));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

// A theme in the shape loadTemplateBlocks hands back. `known` is wider than `blocks` on purpose:
// `gallery` is a block this theme can draw but blocks.json says nothing about, and `carousel` is one
// it cannot draw at all — two different mistakes a layout can make, with two different fixes.
// A fresh object per call, so a test that mutates what it got cannot poison the next one.
function theme() {
  return {
    content: {
      lengths: { h1: 60, text: [200, 400] },
      links: { perBlock: [0, 2], perPage: [0, 8] },
      blocks: {
        hero: { type: 'hero', auto: false, h1: true, image: true, heading: false, content: { text: [1, 2] } },
        toc: { type: 'toc', auto: true, h1: false, image: false, heading: false, content: {} },
        section: {
          type: 'section',
          auto: false,
          h1: false,
          image: false,
          heading: true,
          content: { title: [0, 1], text: [2, 6] },
        },
        split: { type: 'split', auto: false, h1: false, image: true, heading: true, content: { text: [1, 3] } },
        links: { type: 'links', auto: true, h1: false, image: false, heading: false, content: {} },
        faq: { type: 'faq', auto: false, h1: false, image: false, heading: true, content: { toggle: [5, 8] } },
      },
      known: ['hero', 'toc', 'section', 'split', 'links', 'faq', 'gallery'],
      id: 'demo',
    },
    autoBlocks: ['toc', 'links'],
  };
}

const layout = (blocks) => ({ id: 'probe', name: 'Probe', blocks });

describe('loadLayouts', () => {
  it('reads every layout in the folder, sorted by file name, id from the file name', () => {
    const dir = folder({
      'short.json': { name: 'Короткая', blocks: ['hero'] },
      'long-review.json': { name: 'Длинный обзор', blocks: ['hero', { type: 'section', count: 9 }] },
      'notes.txt': 'не раскладка',
    });

    const layouts = loadLayouts(dir);

    expect(layouts.map((one) => one.id)).toEqual(['long-review', 'short']);
    expect(layouts[0].name).toBe('Длинный обзор');
    // The block list is handed on as written: reading a file and making sense of it against a theme
    // are two jobs, and only the second one needs a theme to do it.
    expect(layouts[0].blocks).toEqual(['hero', { type: 'section', count: 9 }]);
  });

  it('falls back to the file name when a layout has no name of its own', () => {
    expect(loadLayouts(folder({ 'plain.json': { blocks: ['hero'] } }))[0].name).toBe('plain');
  });

  // Naming the folder matters more than it looks: the usual cause is a run pointed at the wrong
  // root, and a message without the path sends the reader looking at the layouts they can see.
  it('refuses a folder with no layouts at all, naming it', () => {
    const dir = folder({ 'readme.md': 'ничего' });
    expect(() => loadLayouts(dir)).toThrow(dir);
    expect(() => loadLayouts(dir)).toThrow(/раскладк/);
  });

  it('refuses a missing folder, naming it', () => {
    const missing = join(folder({}), 'nowhere');
    expect(() => loadLayouts(missing)).toThrow(missing);
  });

  it('refuses broken JSON, naming the file', () => {
    expect(() => loadLayouts(folder({ 'broken.json': '{ не json' }))).toThrow(/broken\.json/);
  });

  it('refuses a layout whose blocks are not a non-empty list', () => {
    expect(() => loadLayouts(folder({ 'empty.json': { blocks: [] } }))).toThrow(/empty/);
    expect(() => loadLayouts(folder({ 'none.json': { name: 'Х' } }))).toThrow(/none/);
    expect(() => loadLayouts(folder({ 'flat.json': '"hero"' }))).toThrow(/flat/);
  });

  // Caught while reading rather than while resolving, because a block with no type has no name to
  // put in any later message: the file is the last place it can still be pointed at.
  it('refuses a block that is neither a name nor an object with a type', () => {
    expect(() => loadLayouts(folder({ 'odd.json': { blocks: [7] } }))).toThrow(/odd/);
    expect(() => loadLayouts(folder({ 'odd.json': { blocks: [{ count: 2 }] } }))).toThrow(/type/);
    expect(() => loadLayouts(folder({ 'odd.json': { blocks: [{ type: '' }] } }))).toThrow(/type/);
  });
});

describe('resolveLayout', () => {
  it('keeps the blocks in the order the layout wrote them', () => {
    const resolved = resolveLayout(layout(['toc', 'faq', 'hero', 'section', 'links']), theme());
    expect(resolved.blocks.map((block) => block.type)).toEqual([
      'toc',
      'faq',
      'hero',
      'section',
      'links',
    ]);
    expect(resolved.id).toBe('probe');
    expect(resolved.name).toBe('Probe');
  });

  it('expands count into that many blocks in a row', () => {
    const resolved = resolveLayout(layout(['hero', { type: 'section', count: 3 }, 'faq']), theme());
    expect(resolved.blocks.map((block) => block.type)).toEqual([
      'hero',
      'section',
      'section',
      'section',
      'faq',
    ]);
  });

  it('gives every block its nature from the theme, untouched', () => {
    const resolved = resolveLayout(layout(['hero', 'toc']), theme());
    expect(resolved.blocks[0]).toEqual({
      type: 'hero',
      auto: false,
      h1: true,
      image: true,
      heading: false,
      content: { text: [1, 2] },
    });
    expect(resolved.blocks[1]).toEqual({
      type: 'toc',
      auto: true,
      h1: false,
      image: false,
      heading: false,
      content: {},
    });
  });

  it('replaces a range with the exact number the layout asked for', () => {
    const resolved = resolveLayout(layout(['hero', { type: 'faq', content: { toggle: 6 } }]), theme());
    expect(resolved.blocks[1].content.toggle).toEqual([6, 6]);
    // What the layout did not name stays the theme's range, for the model to choose inside.
    expect(resolved.blocks[0].content.text).toEqual([1, 2]);
  });

  // The theme is read once per run and serves every page, each with a layout of its own. A resolved
  // block that pointed back into the theme would let one page's numbers rewrite the next page's, and
  // a count expanded into shared objects would make nine sections one section shown nine times.
  it('hands out a fresh object per block, so one page cannot rewrite the theme or the next page', () => {
    const shared = theme();
    const first = resolveLayout(layout(['hero', { type: 'section', count: 2 }]), shared);

    first.blocks[0].content.text = [9, 9];
    first.blocks[1].content.text = [7, 7];
    first.blocks[1].image = true;

    expect(shared.content.blocks.hero.content.text).toEqual([1, 2]);
    expect(first.blocks[2].content.text).toEqual([2, 6]);
    expect(first.blocks[2].image).toBe(false);
    expect(resolveLayout(layout(['hero']), shared).blocks[0].content.text).toEqual([1, 2]);
  });

  it('refuses a block the theme cannot draw at all, naming block and theme', () => {
    expect(() => resolveLayout(layout(['hero', 'carousel']), theme())).toThrow(/carousel/);
    expect(() => resolveLayout(layout(['hero', 'carousel']), theme())).toThrow(/probe/);
  });

  // Different mistake, different fix: the theme has the component, nobody said what goes inside it.
  it('refuses a block the theme draws but blocks.json does not describe, naming the block', () => {
    expect(() => resolveLayout(layout(['hero', 'gallery']), theme())).toThrow(/gallery/);
    expect(() => resolveLayout(layout(['hero', 'gallery']), theme())).toThrow(/blocks\.json/);
  });

  it('refuses an override of an element the block does not have, naming the field', () => {
    expect(() => resolveLayout(layout(['hero', { type: 'faq', content: { cards: 2 } }]), theme()))
      .toThrow(/cards/);
  });

  // This is the border between a layout and a block: the layout owns the composition of the page,
  // the block owns how it is built. A layout that could turn `image: false` on would collapse a
  // half-picture block into an empty half, and nothing downstream could tell it was meant to have one.
  it('refuses an override of the block nature, naming the field', () => {
    expect(() => resolveLayout(layout([{ type: 'hero', image: false }]), theme())).toThrow(/image/);
    expect(() => resolveLayout(layout([{ type: 'hero', heading: true }]), theme())).toThrow(/heading/);
  });

  // A range in blocks.json is the ceiling of what the theme can carry, and a layout picks out of it.
  // Left unchecked, a number above the ceiling reaches the schema as an exact count, the model
  // obediently writes that many, and the page comes out off-template with nothing having complained.
  it('refuses a number outside the range the theme allows, naming the range', () => {
    expect(() => resolveLayout(layout(['hero', { type: 'faq', content: { toggle: 20 } }]), theme()))
      .toThrow(/5.*8/);
    expect(() => resolveLayout(layout(['hero', { type: 'faq', content: { toggle: 20 } }]), theme()))
      .toThrow(/20/);
    // The floor is a ceiling from below: a theme whose FAQ needs five questions cannot draw two.
    expect(() => resolveLayout(layout(['hero', { type: 'faq', content: { toggle: 2 } }]), theme()))
      .toThrow(/toggle/);
    expect(() => resolveLayout(layout(['hero', { type: 'faq', content: { toggle: 1.5 } }]), theme()))
      .toThrow(/целым/);
    expect(() => resolveLayout(layout(['hero', { type: 'faq', content: { toggle: [5, 8] } }]), theme()))
      .toThrow(/целым/);
    expect(() => resolveLayout(layout(['hero', { type: 'faq', content: 6 }]), theme()))
      .toThrow(/объектом/);
  });

  it('refuses a count that is not a positive whole number', () => {
    expect(() => resolveLayout(layout(['hero', { type: 'section', count: 0 }]), theme())).toThrow(/count/);
    expect(() => resolveLayout(layout(['hero', { type: 'section', count: 2.5 }]), theme())).toThrow(/count/);
    expect(() => resolveLayout(layout(['hero', { type: 'section', count: '3' }]), theme())).toThrow(/count/);
  });

  // A page has exactly one h1. Two blocks claiming it, or none at all, is a broken page that must be
  // named now, for free, rather than assembled and looked at later.
  it('refuses a layout with no h1 block, and one with two', () => {
    expect(() => resolveLayout(layout(['section']), theme())).toThrow(/h1/);
    expect(() => resolveLayout(layout(['hero', 'hero']), theme())).toThrow(/h1/);
    // Counted after count is expanded, or two heroes written as one line would slip past.
    expect(() => resolveLayout(layout([{ type: 'hero', count: 2 }]), theme())).toThrow(/h1/);
  });

  // An auto block is filled by the factory, so a layout naming one nobody wrote a builder for would
  // render empty. Free to catch here; invisible until the page is looked at otherwise.
  it('refuses an auto block the factory has no builder for', () => {
    const { content } = theme();
    expect(() => resolveLayout(layout(['hero', 'toc']), { content, autoBlocks: ['links'] }))
      .toThrow(/toc/);
    expect(() => resolveLayout(layout(['hero', 'toc']), { content, autoBlocks: ['links'] }))
      .toThrow(/auto/);
  });
});

describe('planShape', () => {
  it('counts the sections, the pictures and the ranges the model still chooses inside', () => {
    const { blocks } = resolveLayout(
      layout(['hero', 'toc', { type: 'section', count: 9 }, 'links', 'faq']),
      theme(),
    );
    expect(planShape(blocks)).toEqual({
      byType: { section: 9 },
      order: Array.from({ length: 9 }, () => 'section'),
      faq: [5, 8],
      heroText: [1, 2],
      images: 1,
      imageLabels: ['hero'],
    });
  });

  // Counted by kind and listed in page order, which are two different facts. The counts say how
  // many of each to ask the model for; the order says which stands where, and the per-page link
  // budget is spent top to bottom — a fact the per-kind arrays cannot carry on their own.
  it('counts each kind separately and remembers the order they stand in', () => {
    const { blocks } = resolveLayout(
      layout(['hero', 'toc', 'section', 'split', 'section', 'faq']),
      theme(),
    );
    const shape = planShape(blocks);
    expect(shape.byType).toEqual({ section: 2, split: 1 });
    expect(shape.order).toEqual(['section', 'split', 'section']);
  });

  // A layout without a FAQ asks for no questions rather than for an unspecified number of them: the
  // schema is built from these numbers, and `undefined` there is a request the model cannot refuse.
  it('asks for nothing where the layout has no such block', () => {
    const { blocks } = resolveLayout(layout(['hero', { type: 'section', count: 2 }]), theme());
    expect(planShape(blocks).faq).toEqual([0, 0]);
    expect(planShape(blocks).images).toBe(1);
    expect(planShape(blocks).byType).toEqual({ section: 2 });
  });

  // The label goes into the brief, so the model knows what the picture is of. A bare type is enough
  // while there is one such block; past that it has to say which one, or two pictures of a page get
  // one and the same brief.
  it('labels every picture by its block and its place among blocks of that type', () => {
    const { blocks } = resolveLayout(
      layout(['hero', { type: 'split', count: 2 }, 'faq']),
      theme(),
    );
    const shape = planShape(blocks);
    expect(shape.images).toBe(3);
    expect(shape.imageLabels).toEqual(['hero', 'split 1', 'split 2']);
  });
});

describe('contentByType', () => {
  // The defect this exists for: resolveLayout worked out the layout's exact numbers, wrote them
  // into every block, and generate-site.mjs then handed the plan the theme's ranges instead. A
  // layout pinning "no tables here" built a page with tables in it, byte for byte the same page as
  // a layout that had said nothing at all, and nothing anywhere reported a thing.
  it('reports what the layout allows, not what the theme allows', () => {
    const { blocks } = resolveLayout(
      layout(['hero', { type: 'section', count: 2, content: { text: 2, title: 0 } }]),
      theme(),
    );
    expect(contentByType(blocks)).toEqual({ section: { text: [2, 2], title: [0, 0] } });
  });

  // One entry per kind, because each kind is a different question to ask the model. Collapsing them
  // to one would offer a half-and-half block the section's tables and card sets, which it cannot
  // hold — and the answer would be trimmed back out on arrival, paid for and thrown away.
  it('keeps the two kinds of content block apart', () => {
    const { blocks } = resolveLayout(layout(['hero', 'section', 'split']), theme());
    const byType = contentByType(blocks);
    expect(Object.keys(byType).sort()).toEqual(['section', 'split']);
    expect(byType.split).toEqual({ text: [1, 3] });
    expect(byType.section).not.toEqual(byType.split);
  });

  it('reports nothing for a layout with no content block at all', () => {
    const { blocks } = resolveLayout(layout(['hero', 'toc']), theme());
    expect(contentByType(blocks)).toEqual({});
  });
});

describe('resolveLayout refuses what cannot be built', () => {
  // One request answers the FAQ of a whole page, so a second faq block has nowhere to get different
  // questions from: both would be filled from the same answer, word for word, and the contents
  // would carry the same entry twice.
  it('refuses a second faq block', () => {
    expect(() => resolveLayout(layout(['hero', 'faq', 'faq']), theme())).toThrow(/faq/);
  });

  it('names the theme, not only the layout, when the theme cannot draw a block', () => {
    expect(() => resolveLayout(layout(['hero', 'nosuch']), theme())).toThrow(/demo/);
  });
});

const THREE = [
  { id: 'long-review', name: 'Длинный обзор', blocks: ['hero'] },
  { id: 'short', name: 'Короткая', blocks: ['hero'] },
  { id: 'wide', name: 'Широкая', blocks: ['hero'] },
];

const ids = (picked) =>
  Object.fromEntries(Object.entries(picked).map(([page, one]) => [page, one.id]));

describe('pickLayouts', () => {
  it('gives every page a layout from the list', () => {
    const picked = pickLayouts({ layouts: THREE, pages: ['home', 'casino', 'slots'], seed: '520bdapp' });
    expect(Object.keys(picked).sort()).toEqual(['casino', 'home', 'slots']);
    for (const one of Object.values(picked)) expect(THREE).toContain(one);
  });

  // A run that stopped halfway picks up with the same layouts instead of reshuffling the pages that
  // already exist on disk.
  it('gives the same answer for the same seed', () => {
    const pages = ['home', 'casino', 'slots'];
    expect(ids(pickLayouts({ layouts: THREE, pages, seed: '520bdapp' })))
      .toEqual(ids(pickLayouts({ layouts: THREE, pages, seed: '520bdapp' })));
  });

  // Two sites of one network must not come out identical. Any one pair of seeds could collide by
  // chance without the seeding being broken, so this asks of a handful: if every one of them lands
  // on the same assignment, the seed is not reaching the choice at all.
  it('gives different answers for different seeds', () => {
    const pages = ['home', 'casino', 'slots', 'bonus', 'app'];
    const answers = new Set(
      ['520bdapp', '777cosmo', '899ok', 'luckyjet', 'winline'].map((seed) =>
        JSON.stringify(ids(pickLayouts({ layouts: THREE, pages, seed })))),
    );
    expect(answers.size).toBeGreaterThan(1);
  });

  it('does not move the other pages when one is added', () => {
    const before = pickLayouts({ layouts: THREE, pages: ['home', 'casino'], seed: '520bdapp' });
    const after = pickLayouts({ layouts: THREE, pages: ['home', 'casino', 'slots'], seed: '520bdapp' });
    expect(after.home).toBe(before.home);
    expect(after.casino).toBe(before.casino);
    // A page's own name is half of its seed, so a site of five pages is not five copies of one
    // choice. Without this the check above passes on a run that seeds by site alone.
    const many = pickLayouts({
      layouts: THREE,
      pages: ['home', 'casino', 'slots', 'bonus', 'app'],
      seed: '520bdapp',
    });
    expect(new Set(Object.values(many)).size).toBeGreaterThan(1);
  });

  it('does not care in which order the pages are given', () => {
    expect(ids(pickLayouts({ layouts: THREE, pages: ['slots', 'home', 'casino'], seed: '899ok' })))
      .toEqual(ids(pickLayouts({ layouts: THREE, pages: ['home', 'casino', 'slots'], seed: '899ok' })));
  });

  it('gives every page the same layout when one was chosen by hand', () => {
    const picked = pickLayouts({
      layouts: THREE,
      pages: ['home', 'casino', 'slots'],
      seed: '520bdapp',
      chosen: 'short',
    });
    expect(Object.values(picked)).toEqual([THREE[1], THREE[1], THREE[1]]);
  });

  it('refuses a chosen layout that does not exist, naming it', () => {
    expect(() => pickLayouts({ layouts: THREE, pages: ['home'], seed: 's', chosen: 'nope' }))
      .toThrow(/nope/);
  });
});

// planShape says how many section entries the plan must hold; assemblePage hands one out per block
// that takes one. Two modules, one rule — so they are checked against each other rather than each
// against a number written twice. A layout whose content block is not called "section" is the case
// that would have drifted: planned for zero times, then dropped without a word.
describe('planShape agrees with assemblePage about what takes a section', () => {
  const nature = (type, own) => ({
    type, auto: false, h1: false, image: false, heading: false, content: {}, ...own,
  });
  const LAYOUT = [
    nature('hero', { h1: true, image: true, content: { text: [1, 1] } }),
    nature('toc', { auto: true }),
    nature('section', { heading: true, content: { text: [1, 1] } }),
    nature('split', { heading: true, image: true, content: { text: [1, 1] } }),
    nature('links', { auto: true }),
    nature('faq', { heading: true, content: { toggle: [1, 1] } }),
  ];

  it('plans exactly as many blocks as the assembler asks for, of every kind', () => {
    const { byType } = planShape(LAYOUT);
    // The assembler looks a block up by its place in the layout, so the filled blocks are keyed by
    // it. Built here from planShape's own counts: if the two ever disagreed about how many blocks
    // of a kind a page holds, a block would go unplanned and be dropped without a word.
    const taken = new Map();
    const filled = new Map();
    LAYOUT.forEach((block, at) => {
      if (block.auto || block.type === 'faq' || !block.heading) return;
      const nth = (taken.get(block.type) ?? 0) + 1;
      taken.set(block.type, nth);
      if (nth > byType[block.type]) return;
      filled.set(at, { heading: `${block.type} ${nth}`, items: [{ kind: 'text', text: 'Body.' }] });
    });
    const { page } = assemblePage({
      plan: { title: 'T', description: 'D', h1: 'H', heroText: ['Lead.'], images: [] },
      blocks: LAYOUT,
      sections: filled,
      faq: [{ question: 'Q?', answer: 'A.' }],
      pages: ['home'],
      page: 'home',
      labels: { toc: 'Contents', links: 'Other pages', faq: 'Questions' },
    });
    // Every block of the layout survives: none was left without content to put in it.
    expect(page.blocks.map((block) => block.type)).toEqual(LAYOUT.map((block) => block.type));
  });
});
