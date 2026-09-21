import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadExamples, pickExamples, frameOf, planShape } from '../factory/texts/example.mjs';
import { assemblePage } from '../factory/texts/assemble.mjs';

let dirs = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

// A throwaway templates root holding one theme's examples, so these tests never depend on what
// templates/ happens to hold — the same reason the layout tests build their own layouts folder.
// `pages` is { адрес: { имя файла: содержимое } }.
function folder(pages, id = 'demo') {
  const root = mkdtempSync(join(tmpdir(), 'site-factory-examples-'));
  dirs.push(root);
  for (const [address, files] of Object.entries(pages)) {
    const dir = join(root, 'templates', id, 'examples', address);
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
    }
  }
  return root;
}

// A theme in the shape loadTemplatePictures hands back. `known` is wider than what the examples use
// on purpose: the theme may draw blocks no example happens to contain.
function theme() {
  return {
    content: {
      id: 'demo',
      pictures: { hero: 'after-text', split: true },
      links: { perBlock: [0, 2], perPage: [0, 8] },
      known: ['hero', 'toc', 'section', 'split', 'links', 'faq'],
      elements: ['title', 'text', 'list', 'table', 'cards', 'toggle', 'image', 'buttons', 'steps'],
    },
    autoBlocks: ['toc', 'links'],
  };
}

const title = (tag, text = 'Заголовок') => ({ type: 'title', [tag]: text });
const text = (length) => ({ type: 'text', text: 'я'.repeat(length) });
const list = (...lengths) => ({ type: 'list', items: lengths.map((n) => 'я'.repeat(n)) });
// A question and its answer live in title and text, like every other element of the format.
const toggle = (question, answer) => ({ type: 'toggle', title: question, text: answer });

// The shape rowsToPage hands back: a page is a title, a description and a list of blocks, and every
// block's content is a list of elements whose first is the block's own heading.
const example = (blocks, over = {}) => ({
  name: '1',
  id: 'home/1',
  page: { title: 'Т'.repeat(48), description: 'О'.repeat(145), blocks, ...over },
});

const page = (blocks, over) => example(blocks, over).page;

// The commonest real shape, measured across the supplied examples: hero, contents, sections, faq.
const ordinary = () => [
  { type: 'hero', content: [title('h1', 'Г'.repeat(40)), text(124)] },
  { type: 'toc', content: [title('h2'), list(20, 20)] },
  { type: 'section', content: [title('h2'), text(124), list(41, 41, 41)] },
  { type: 'faq', content: [title('h2'), toggle('Как?', 'Так.')] },
];

describe('loadExamples', () => {
  it('reads every example of every page, sorted by file name', () => {
    const root = folder({
      home: { '1.json': page(ordinary()), '2.json': page(ordinary()), '10.json': page(ordinary()) },
      casino: { '1.json': page(ordinary()) },
    });
    const examples = loadExamples('demo', root);

    expect(Object.keys(examples).sort()).toEqual(['casino', 'home']);
    expect(examples.home.map((one) => one.name)).toEqual(['1', '10', '2']);
    expect(examples.home[0].page.blocks).toHaveLength(4);
  });

  it('names an example by page and file, since that is what goes into the built page', () => {
    const root = folder({ home: { '2.json': page(ordinary()) } });
    expect(loadExamples('demo', root).home[0].id).toBe('home/2');
  });

  it('takes the page address from the folder name', () => {
    const root = folder({ 'how-to-play': { '1.json': page(ordinary()) } });
    expect(Object.keys(loadExamples('demo', root))).toEqual(['how-to-play']);
  });

  it('refuses a theme with no examples folder, naming the theme', () => {
    const root = folder({ home: { '1.json': page(ordinary()) } }, 'other');
    expect(() => loadExamples('demo', root)).toThrow(/demo/);
  });

  it('refuses a page folder with nothing in it, naming the page', () => {
    const root = folder({ home: { '1.json': page(ordinary()) }, casino: {} });
    expect(() => loadExamples('demo', root)).toThrow(/casino/);
  });

  it('refuses an example that is not readable JSON, naming the file', () => {
    const root = folder({ home: { '1.json': '{ не json' } });
    expect(() => loadExamples('demo', root)).toThrow(/home\/1/);
  });

  it('refuses an example that is not a page, naming the file', () => {
    const root = folder({ home: { '1.json': { blocks: 'да' } } });
    expect(() => loadExamples('demo', root)).toThrow(/home\/1/);
  });

  it('ignores anything in the folder that is not a json file', () => {
    const root = folder({ home: { '1.json': page(ordinary()), 'README.md': 'заметка' } });
    expect(loadExamples('demo', root).home).toHaveLength(1);
  });
});

describe('pickExamples', () => {
  const four = () => ({
    home: [1, 2, 3, 4].map((n) => ({ ...example(ordinary()), name: String(n), id: `home/${n}` })),
    casino: [1, 2, 3, 4].map((n) => ({ ...example(ordinary()), name: String(n), id: `casino/${n}` })),
  });

  it('gives every page one of its own examples', () => {
    const picked = pickExamples({ examples: four(), pages: ['home', 'casino'], seed: 'сайт' });
    expect(picked.home.id).toMatch(/^home\//);
    expect(picked.casino.id).toMatch(/^casino\//);
  });

  it('gives the same answer for the same seed', () => {
    const once = pickExamples({ examples: four(), pages: ['home', 'casino'], seed: 'сайт' });
    const twice = pickExamples({ examples: four(), pages: ['home', 'casino'], seed: 'сайт' });
    expect(twice.home.id).toBe(once.home.id);
    expect(twice.casino.id).toBe(once.casino.id);
  });

  it('gives different answers for different seeds', () => {
    const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(
      (seed) => pickExamples({ examples: four(), pages: ['home'], seed }).home.id,
    );
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  // Without the page in the seed every page of a site picks the same example, and a site built
  // from four sources reads as one source copied eight times.
  it('lets the page name into the choice, so two pages are not always the same example', () => {
    const differ = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].some((seed) => {
      const picked = pickExamples({ examples: four(), pages: ['home', 'casino'], seed });
      return picked.home.name !== picked.casino.name;
    });
    expect(differ).toBe(true);
  });

  it('does not move the other pages when one is added', () => {
    const before = pickExamples({ examples: four(), pages: ['home'], seed: 'сайт' });
    const after = pickExamples({ examples: four(), pages: ['home', 'casino'], seed: 'сайт' });
    expect(after.home.id).toBe(before.home.id);
  });

  it('does not care in which order the pages are given', () => {
    const one = pickExamples({ examples: four(), pages: ['home', 'casino'], seed: 'сайт' });
    const other = pickExamples({ examples: four(), pages: ['casino', 'home'], seed: 'сайт' });
    expect(other.home.id).toBe(one.home.id);
  });

  it('gives every page the example the owner named, when they named one', () => {
    const picked = pickExamples({ examples: four(), pages: ['home', 'casino'], seed: 'с', chosen: '3' });
    expect(picked.home.id).toBe('home/3');
    expect(picked.casino.id).toBe('casino/3');
  });

  it('refuses a named example a page has not got, naming both', () => {
    const examples = four();
    examples.casino = examples.casino.slice(0, 2);
    expect(() => pickExamples({ examples, pages: ['home', 'casino'], seed: 'с', chosen: '3' })).toThrow(
      /casino.*«3»|«3».*casino/,
    );
  });

  it('refuses a page with no examples at all, naming it', () => {
    expect(() => pickExamples({ examples: four(), pages: ['home', 'bonus'], seed: 'с' })).toThrow(/bonus/);
  });
});

describe('frameOf', () => {
  it('keeps the blocks in the order the example wrote them', () => {
    const frame = frameOf(example(ordinary()), theme());
    expect(frame.blocks.map((block) => block.type)).toEqual(['hero', 'toc', 'section', 'faq']);
  });

  it('reads the h1 block, the headed blocks and the auto blocks apart', () => {
    const frame = frameOf(example(ordinary()), theme());
    expect(frame.blocks.map((block) => [block.h1, block.heading, block.auto])).toEqual([
      [true, false, false],
      [false, false, true],
      [false, true, false],
      [false, true, false],
    ]);
  });

  it('leaves the block heading out of its elements, because the factory writes it', () => {
    const frame = frameOf(example(ordinary()), theme());
    expect(frame.blocks[2].elements).toEqual(['text', 'list']);
  });

  it('leaves an auto block with no elements, however full the example wrote it', () => {
    const frame = frameOf(example(ordinary()), theme());
    expect(frame.blocks[1].elements).toEqual([]);
    expect(frame.blocks[1].counts).toEqual({});
  });

  it('drops a second heading inside a block, keeping what came after it', () => {
    const frame = frameOf(
      example([
        { type: 'hero', content: [title('h1'), text(124)] },
        { type: 'section', content: [title('h2'), text(124), title('h3'), list(41)] },
      ]),
      theme(),
    );
    expect(frame.blocks[1].elements).toEqual(['text', 'list']);
  });

  // Pictures are placed by the theme, so one standing in an example would be a second picture in
  // the same block. None of the supplied examples has one, which is exactly why this is written
  // down: the day one does, the page must not quietly grow an extra.
  it('drops a picture the example happens to carry, since the theme places pictures', () => {
    const frame = frameOf(
      example([
        { type: 'hero', content: [title('h1'), text(124)] },
        { type: 'section', content: [title('h2'), { type: 'image', name: 'bpl' }, text(124)] },
      ]),
      theme(),
    );
    expect(frame.blocks[1].elements).toEqual(['text']);
  });

  it('counts what is inside an element: list items, table rows, cards, questions', () => {
    const frame = frameOf(
      example([
        { type: 'hero', content: [title('h1'), text(124)] },
        {
          type: 'section',
          content: [
            title('h2'),
            list(41, 41, 41, 41, 41),
            { type: 'table', columns: ['а', 'б'], rows: [['1', '2'], ['3', '4'], ['5', '6']] },
            { type: 'cards', items: [{ title: 'а' }, { title: 'б' }] },
          ],
        },
      ]),
      theme(),
    );
    expect(frame.blocks[1].counts).toEqual({ list: 5, table: 3, cards: 2 });
  });

  // Questions are elements of their own, so how many there are is already in the sequence — a
  // count beside it would be the same number written twice, free to disagree with itself.
  it('leaves a repeated element to the sequence rather than counting it', () => {
    const frame = frameOf(
      example([
        { type: 'hero', content: [title('h1'), text(124)] },
        {
          type: 'faq',
          content: [title('h2'), ...Array.from({ length: 7 }, () => toggle('а', 'б'))],
        },
      ]),
      theme(),
    );
    expect(frame.blocks[1].elements).toEqual(Array.from({ length: 7 }, () => 'toggle'));
    expect(frame.blocks[1].counts).toEqual({});
  });

  it('takes the widest of two same-kind elements, since the count is also the ceiling for trimming', () => {
    const frame = frameOf(
      example([
        { type: 'hero', content: [title('h1'), text(124)] },
        { type: 'section', content: [title('h2'), list(41, 41, 41, 41), list(41, 41)] },
      ]),
      theme(),
    );
    expect(frame.blocks[1].counts.list).toBe(4);
  });

  it('takes the picture from the theme, since the example never has one', () => {
    const frame = frameOf(
      example([
        { type: 'hero', content: [title('h1'), text(124)] },
        { type: 'split', content: [title('h2'), text(124)] },
        { type: 'section', content: [title('h2'), text(124)] },
      ]),
      theme(),
    );
    expect(frame.blocks.map((block) => block.image)).toEqual(['after-text', true, false]);
  });

  // The whole reason the median is taken rather than the mean. Paragraph lengths in the supplied
  // examples run from 3 to 415 characters, and a mean lets either end set the target for every
  // paragraph on the page: here one long outlier alone would ask for 194 instead of 130.
  it('measures lengths by kind, as a median', () => {
    const frame = frameOf(
      example([
        { type: 'hero', content: [title('h1'), text(110)] },
        { type: 'section', content: [title('h2'), text(120), text(130), text(415)] },
      ]),
      theme(),
    );
    expect(frame.lengths.text).toBe(130);
  });

  it('measures a question and its answer, which a toggle keeps in title and text', () => {
    const frame = frameOf(
      example([
        { type: 'hero', content: [title('h1'), text(124)] },
        { type: 'faq', content: [title('h2'), toggle('я'.repeat(30), 'я'.repeat(220))] },
      ]),
      theme(),
    );
    expect(frame.lengths.question).toBe(30);
    expect(frame.lengths.answer).toBe(220);
  });

  it('measures the page title, description and headings too', () => {
    const frame = frameOf(example(ordinary()), theme());
    expect(frame.lengths.title).toBe(48);
    expect(frame.lengths.description).toBe(145);
    expect(frame.lengths.h1).toBe(40);
    expect(frame.lengths.listItem).toBe(41);
  });

  it('measures an auto block for nothing: the factory writes its text, not the model', () => {
    const frame = frameOf(
      example([
        { type: 'hero', content: [title('h1'), text(200)] },
        { type: 'toc', content: [title('h2'), list(3, 3, 3)] },
        { type: 'section', content: [title('h2'), list(41, 41)] },
      ]),
      theme(),
    );
    expect(frame.lengths.listItem).toBe(41);
  });

  it('refuses an example whose block the theme cannot draw, naming block and theme', () => {
    const one = example([{ type: 'hero', content: [title('h1'), text(124)] }, { type: 'gallery', content: [] }]);
    expect(() => frameOf(one, theme())).toThrow(/gallery.*demo|demo.*gallery/);
  });

  it('refuses an example whose element the theme cannot draw, naming the element', () => {
    const one = example([
      { type: 'hero', content: [title('h1'), text(124)] },
      { type: 'section', content: [title('h2'), { type: 'video', src: 'а' }] },
    ]);
    expect(() => frameOf(one, theme())).toThrow(/video/);
  });

  it('refuses an example with no h1 at all', () => {
    const one = example([{ type: 'section', content: [title('h2'), text(124)] }]);
    expect(() => frameOf(one, theme())).toThrow(/h1/);
  });

  it('refuses an example with two h1, naming the example', () => {
    const one = example([
      { type: 'hero', content: [title('h1'), text(124)] },
      { type: 'hero', content: [title('h1'), text(124)] },
    ]);
    expect(() => frameOf(one, theme())).toThrow(/home\/1/);
  });

  it('refuses an example with a second faq, since the page has one set of questions', () => {
    const one = example([
      { type: 'hero', content: [title('h1'), text(124)] },
      { type: 'faq', content: [title('h2'), { type: 'toggle', question: 'а', answer: 'б' }] },
      { type: 'faq', content: [title('h2'), toggle('в', 'г')] },
    ]);
    expect(() => frameOf(one, theme())).toThrow(/faq/);
  });
});

// planShape says how many block entries the plan must hold; assemblePage hands one out per block
// that takes one. Two modules, one rule — so they are checked against each other rather than each
// against a number written twice. A page whose content block is not called "section" is the case
// that would have drifted: planned for zero times, then dropped without a word.
describe('planShape agrees with assemblePage about what takes a section', () => {
  const nature = (type, own) => ({
    type, auto: false, h1: false, image: false, heading: false, elements: [], counts: {}, ...own,
  });
  const FRAME = [
    nature('hero', { h1: true, image: true, elements: ['text'] }),
    nature('toc', { auto: true }),
    nature('section', { heading: true, elements: ['text'] }),
    nature('split', { heading: true, image: true, elements: ['text'] }),
    nature('links', { auto: true }),
    nature('faq', { heading: true, elements: ['toggle'] }),
  ];

  it('plans exactly as many blocks as the assembler asks for, of every kind', () => {
    const { byType } = planShape(FRAME);
    // The assembler looks a block up by its place on the page, so the filled blocks are keyed by
    // it. Built here from planShape's own counts: if the two ever disagreed about how many blocks
    // of a kind a page holds, a block would go unplanned and be dropped without a word.
    const taken = new Map();
    const filled = new Map();
    FRAME.forEach((block, at) => {
      if (block.auto || block.type === 'faq' || !(block.heading || block.h1)) return;
      const nth = (taken.get(block.type) ?? 0) + 1;
      taken.set(block.type, nth);
      // A kind planShape left out entirely reads as zero, not as "no ceiling": that is the very
      // drift this test exists to catch, and `nth > undefined` is false, which would let it pass.
      if (nth > (byType[block.type] ?? 0)) return;
      filled.set(at, { heading: `${block.type} ${nth}`, items: [{ kind: 'text', text: 'Body.' }] });
    });
    const { page } = assemblePage({
      plan: { title: 'T', description: 'D', h1: 'H', images: [] },
      blocks: FRAME,
      sections: filled,
      faq: [{ question: 'Q?', answer: 'A.' }],
      pages: ['home'],
      page: 'home',
      labels: { toc: 'Contents', links: 'Other pages', faq: 'Questions' },
    });
    // Every block of the page survives: none was left without content to put in it.
    expect(page.blocks.map((block) => block.type)).toEqual(FRAME.map((block) => block.type));
  });

  // The other half of the same rule: how many questions the FAQ is planned for is how many toggles
  // the example's own FAQ held, and the schema is pinned to that number.
  it('plans exactly as many questions as the example had', () => {
    expect(planShape(FRAME).faq).toBe(1);
    expect(planShape([...FRAME.slice(0, 5), nature('faq', { heading: true, elements: ['toggle', 'toggle', 'toggle'] })]).faq).toBe(3);
  });
});
