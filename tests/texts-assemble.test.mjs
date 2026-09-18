import { describe, it, expect } from 'vitest';
import { assemblePage } from '../factory/texts/assemble.mjs';

const LABELS = { toc: 'Contents', links: 'Other pages', faq: 'Questions' };
const PAGES = ['home', 'casino', 'bonus'];
// The page being assembled throughout this fixture — matches PLAN's own subject below, so a link
// to /bonus (a different page) is never mistaken for a self-link by the tests that do not care.
const PAGE = 'casino';

const PLAN = {
  title: 'Casino guide',
  description: 'A description of the page.',
  h1: 'Casino guide',
  heroText: ['Opening words.'],
  heroImage: null,
  sections: [
    { heading: 'Payments', brief: '', elements: ['title', 'text'], image: null, links: ['/bonus'] },
    { heading: 'Games', brief: '', elements: ['title', 'text'], image: 'games-shot', links: [] },
  ],
  faq: ['Is it safe?'],
};
const SECTIONS = [
  { heading: 'Payments', items: [{ kind: 'text', text: 'Pay with [the bonus](/bonus) first.' }] },
  { heading: 'Games', items: [{ kind: 'text', text: 'Many games.' }, { kind: 'image', name: 'games-shot' }] },
];
const FAQ = [{ question: 'Is it safe?', answer: 'Yes.' }];

const LENGTHS = {
  title: 60,
  description: [120, 160],
  h1: 60,
  text: [200, 400],
  listItems: [3, 8],
  tableRows: [3, 10],
  cards: [2, 4],
};
// A layout already resolved against the theme — what generate-site.mjs hands the assembler. Every
// entry carries its own nature, and nothing here says "hero" to the assembler except the block's
// own type, which it only ever passes through.
const nature = (type, own) => ({
  type, auto: false, h1: false, image: false, heading: false, content: {}, ...own,
});
const HERO = nature('hero', { h1: true, image: true, content: { text: [1, 2] } });
const TOC = nature('toc', { auto: true });
const SECTION = nature('section', { heading: true, content: { title: [0, 1], text: [2, 6] } });
const LINKS = nature('links', { auto: true });
const FAQ_BLOCK = nature('faq', { heading: true, content: { toggle: [5, 8] } });
const BLOCKS = [HERO, TOC, SECTION, SECTION, LINKS, FAQ_BLOCK];

const build = (overrides = {}) =>
  assemblePage({
    plan: PLAN, blocks: BLOCKS, sections: SECTIONS, faq: FAQ, pages: PAGES, page: PAGE,
    labels: LABELS, lengths: LENGTHS,
    ...overrides,
  });

const blockOf = (page, type) => page.blocks.find((block) => block.type === type);

describe('assemblePage', () => {
  it('builds the page in our own content format, in layout order', () => {
    const { page } = build();
    expect(page.title).toBe('Casino guide');
    expect(page.description).toBe('A description of the page.');
    expect(page.blocks.map((block) => block.type)).toEqual(['hero', 'toc', 'section', 'section', 'links', 'faq']);
    expect(blockOf(page, 'hero').content[0]).toEqual({ type: 'title', h1: 'Casino guide' });
  });

  // The one coupling the model used to break on every page: the table of contents is built from the
  // headings themselves, so it cannot disagree with them. Every block that has a heading is in it,
  // the FAQ included — the contents is a map of the page, not a list of its sections.
  it('lists every headed block in the contents, in order, the FAQ included', () => {
    const { page } = build();
    const list = blockOf(page, 'toc').content.find((item) => item.type === 'list');
    expect(list.items).toEqual(['Payments', 'Games', 'Questions']);
  });

  // The whole point of the work: order and composition come from the file, not from a sequence
  // written into this module.
  it('puts the blocks out in the order the layout gave, not a fixed one', () => {
    const { page } = build({ blocks: [HERO, FAQ_BLOCK, TOC, SECTION, LINKS] });
    expect(page.blocks.map((block) => block.type)).toEqual(['hero', 'faq', 'toc', 'section', 'links']);
  });

  it('builds as many blocks of a kind as the layout asked for', () => {
    const { page } = build({
      blocks: [HERO, TOC, SECTION],
      sections: [SECTIONS[0]],
    });
    expect(page.blocks.filter((block) => block.type === 'section')).toHaveLength(1);
  });

  // A section that never came out is dropped upstream; its contents entry must go with it, or the
  // list points at a heading with nothing under it.
  it('drops a block that has nothing to show, and its contents entry with it', () => {
    const { page } = build({ sections: [SECTIONS[0]] });
    expect(page.blocks.filter((block) => block.type === 'section')).toHaveLength(1);
    const list = blockOf(page, 'toc').content.find((item) => item.type === 'list');
    expect(list.items).toEqual(['Payments', 'Questions']);
  });

  // The layout, not the block type, decides where the h1 goes. This module must not know the word
  // "hero": a theme is free to call its first screen anything and to put the h1 somewhere else.
  it('writes the h1 into whichever block claims it', () => {
    const { page } = build({ blocks: [nature('opener', { h1: true }), TOC, SECTION] });
    expect(page.blocks[0].type).toBe('opener');
    expect(page.blocks[0].content[0]).toEqual({ type: 'title', h1: 'Casino guide' });
  });

  // A picture is placed by the factory now, straight under the heading of the block whose nature
  // carries one. The model chose neither the place nor the count.
  it('puts the picture under the heading of the block whose nature carries it', () => {
    const { page } = build({ plan: { ...PLAN, heroImage: 'casino-lobby' } });
    const hero = blockOf(page, 'hero');
    expect(hero.content[0]).toEqual({ type: 'title', h1: 'Casino guide' });
    expect(hero.content[1]).toEqual({ image: 'casino-lobby' });
  });

  it('gives no picture to a block whose nature has none', () => {
    const { page } = build({
      blocks: [nature('opener', { h1: true }), SECTION],
      plan: { ...PLAN, heroImage: 'casino-lobby' },
    });
    expect(JSON.stringify(page.blocks[0])).not.toMatch(/casino-lobby/);
  });

  it('says so instead of emitting an empty block it has nothing to fill', () => {
    const { page, warnings } = build({ blocks: [HERO, nature('mystery')] });
    expect(page.blocks.map((block) => block.type)).toEqual(['hero']);
    expect(warnings.join(' ')).toMatch(/mystery/);
  });

  it('writes each section heading itself, ahead of what the model returned', () => {
    const { page } = build();
    const first = page.blocks.filter((block) => block.type === 'section')[0];
    expect(first.content[0]).toEqual({ type: 'title', h2: 'Payments' });
    expect(first.content[1].type).toBe('text');
  });

  it('names the service blocks in the language of the site', () => {
    const { page } = build();
    expect(blockOf(page, 'toc').content[0]).toEqual({ type: 'title', h2: 'Contents' });
    expect(blockOf(page, 'links').content[0]).toEqual({ type: 'title', h2: 'Other pages' });
    expect(blockOf(page, 'faq').content[0]).toEqual({ type: 'title', h2: 'Questions' });
  });

  it('turns the FAQ into toggles, question and answer together', () => {
    const { page } = build();
    expect(blockOf(page, 'faq').content[1]).toEqual({ type: 'toggle', title: 'Is it safe?', text: 'Yes.' });
  });

  it('keeps a link to a page this site really has', () => {
    const { page } = build();
    const text = page.blocks.filter((block) => block.type === 'section')[0].content[1];
    expect(text.text).toContain('[the bonus](/bonus)');
  });

  // Prose is never checked against the schema the way the plan's own link list is, so a link the
  // model writes mid-sentence needs the same repair trimPlan gives the plan's links (see links.mjs)
  // — a bare page name or an obvious near-miss address reaches the page in its canonical form,
  // rather than being unwrapped to plain words like a link to a page that truly does not exist.
  it('repairs a link spelled as a bare page name or a near-miss address, inside the prose', () => {
    const sections = [
      { heading: 'Payments', items: [{ kind: 'text', text: 'Go to [home](home) or [home](/home) or [bonus](/bonus/) now.' }] },
      SECTIONS[1],
    ];
    const { page, warnings } = build({ sections });
    const text = page.blocks.filter((block) => block.type === 'section')[0].content[1];
    expect(text.text).toBe('Go to [home](/) or [home](/) or [bonus](/bonus) now.');
    // Other, unrelated length warnings from this fixture's short text are fine (see the list-minimum
    // test above) — only a "ведёт в никуда" link warning, which must not happen here, would matter.
    expect(warnings.join(' ')).not.toContain('никуда');
  });

  it('unwraps a link to a page that does not exist, keeping the words', () => {
    const sections = [
      { heading: 'Payments', items: [{ kind: 'text', text: 'See [the app](/app) for more.' }] },
      SECTIONS[1],
    ];
    const { page, warnings } = build({ sections });
    const text = page.blocks.filter((block) => block.type === 'section')[0].content[1];
    expect(text.text).toBe('See the app for more.');
    expect(warnings.join(' ')).toContain('/app');
  });

  // The live-run bug this task exists to fix: a page linking to itself mid-sentence, reported
  // separately from "ведёт в никуда" (this page resolves fine — it is simply not a different page).
  it('unwraps a link to the page itself, keeping the words, with its own warning', () => {
    const sections = [
      { heading: 'Payments', items: [{ kind: 'text', text: 'See [this page](/casino) or [bonus](/bonus) for more.' }] },
      SECTIONS[1],
    ];
    const { page, warnings } = build({ sections });
    const text = page.blocks.filter((block) => block.type === 'section')[0].content[1];
    expect(text.text).toBe('See this page or [bonus](/bonus) for more.');
    expect(warnings.join(' ')).toContain('саму страницу');
    expect(warnings.join(' ')).not.toContain('никуда');
  });

  // An anchor reaches a heading further down this same page — the one in-page link worth having —
  // and must keep working even though, in a sense, its target is "this page" too.
  it('keeps an anchor to a heading on the same page', () => {
    const sections = [
      { heading: 'Payments', items: [{ kind: 'text', text: 'Jump to [the FAQ](#faq) below.' }] },
      SECTIONS[1],
    ];
    const { page, warnings } = build({ sections });
    const text = page.blocks.filter((block) => block.type === 'section')[0].content[1];
    expect(text.text).toBe('Jump to [the FAQ](#faq) below.');
    expect(warnings.join(' ')).not.toContain('саму страницу');
  });

  it('drops a picture the plan never asked for', () => {
    const sections = [
      { heading: 'Payments', items: [{ kind: 'image', name: 'never-planned' }] },
      SECTIONS[1],
    ];
    const { page, warnings } = build({ sections });
    const first = page.blocks.filter((block) => block.type === 'section')[0];
    expect(JSON.stringify(first)).not.toContain('never-planned');
    expect(warnings.join(' ')).toContain('never-planned');
  });

  it('keeps the picture the plan did ask for', () => {
    const { page } = build();
    const second = page.blocks.filter((block) => block.type === 'section')[1];
    expect(second.content).toContainEqual({ image: 'games-shot' });
  });

  it('turns every element kind into its own shape', () => {
    const sections = [
      {
        heading: 'Everything',
        items: [
          { kind: 'title', level: 'h3', text: 'Sub' },
          { kind: 'list', items: ['one', 'two'] },
          { kind: 'table', columns: ['A'], rows: [['1'], ['2']] },
          { kind: 'cards', cards: [{ title: 'C', text: 'T', image: null }] },
          { kind: 'toggle', title: 'Q', text: 'A' },
        ],
      },
      SECTIONS[1],
    ];
    const content = build({ sections }).page.blocks.filter((block) => block.type === 'section')[0].content;
    expect(content[1]).toEqual({ type: 'title', h3: 'Sub' });
    expect(content[2]).toEqual({ type: 'list', items: ['one', 'two'] });
    expect(content[3]).toEqual({ type: 'table', columns: ['A'], rows: [['1'], ['2']] });
    expect(content[4]).toEqual({ type: 'cards', items: [{ title: 'C', text: 'T' }] });
    expect(content[5]).toEqual({ type: 'toggle', title: 'Q', text: 'A' });
  });

  it('puts the hero picture in when the plan asked for one', () => {
    const { page } = build({ plan: { ...PLAN, heroImage: 'hero-shot' } });
    expect(blockOf(page, 'hero').content).toContainEqual({ image: 'hero-shot' });
  });

  // Lengths are reported, never enforced: cutting a paragraph mid-sentence is worse than a long
  // paragraph, and the engine does not care either way.
  it('mentions a paragraph well outside the template length, without touching it', () => {
    const sections = [
      { heading: 'Payments', items: [{ kind: 'text', text: 'Short.' }] },
      SECTIONS[1],
    ];
    const { page, warnings } = build({ sections });
    const written = page.blocks.filter((block) => block.type === 'section')[0].content[1];
    expect(written.text).toBe('Short.');
    expect(warnings.join(' ')).toContain('text');
  });

  // Unlike a character length, an item count can be cut cleanly — spec §9: "лишнее отбрасывается,
  // строка в лог" — so these three, unlike the text/h1 lengths above, actually get trimmed.
  it('trims a list past the template maximum, and logs what was cut', () => {
    const items = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    const sections = [{ heading: 'Payments', items: [{ kind: 'list', items }] }, SECTIONS[1]];
    const { page, warnings } = build({ sections });
    const list = page.blocks.filter((block) => block.type === 'section')[0].content[1];
    expect(list.items).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(warnings.join(' ')).toContain('пунктов списка: 10 вместо 8');
  });

  it('trims a table past the template row maximum, and logs what was cut', () => {
    const rows = Array.from({ length: 12 }, (_, index) => [`r${index + 1}`]);
    const sections = [{ heading: 'Payments', items: [{ kind: 'table', columns: ['A'], rows }] }, SECTIONS[1]];
    const { page, warnings } = build({ sections });
    const table = page.blocks.filter((block) => block.type === 'section')[0].content[1];
    expect(table.rows).toEqual(rows.slice(0, 10));
    expect(warnings.join(' ')).toContain('строк таблицы: 12 вместо 10');
  });

  it('trims a card set past the template maximum, and logs what was cut', () => {
    const cards = Array.from({ length: 6 }, (_, index) => ({ title: `C${index + 1}`, text: 'T', image: null }));
    const sections = [{ heading: 'Payments', items: [{ kind: 'cards', cards }] }, SECTIONS[1]];
    const { page, warnings } = build({ sections });
    const cardsBlock = page.blocks.filter((block) => block.type === 'section')[0].content[1];
    expect(cardsBlock.items).toHaveLength(4);
    expect(cardsBlock.items.map((card) => card.title)).toEqual(['C1', 'C2', 'C3', 'C4']);
    expect(warnings.join(' ')).toContain('карточек: 6 вместо 4');
  });

  // Trimming only ever removes — it must never invent items to reach the minimum, the same rule
  // trimPlan already follows for elements and pictures.
  it('leaves a list under the template minimum alone, without inventing items', () => {
    const sections = [{ heading: 'Payments', items: [{ kind: 'list', items: ['one'] }] }, SECTIONS[1]];
    const { page, warnings } = build({ sections });
    const list = page.blocks.filter((block) => block.type === 'section')[0].content[1];
    expect(list.items).toEqual(['one']);
    // Other, unrelated length warnings from this fixture's text are fine — only a count trim of
    // this list, which must not happen, would mention "пунктов списка".
    expect(warnings.join(' ')).not.toContain('пунктов списка');
  });

  it('mentions an h1 longer than the template allows, without shortening it', () => {
    const h1 = 'A headline far longer than the sixty characters this template asks a heading to keep';
    const { page, warnings } = build({ plan: { ...PLAN, h1 } });
    expect(blockOf(page, 'hero').content[0]).toEqual({ type: 'title', h1 });
    expect(warnings.join(' ')).toContain('h1');
  });

  it('leaves exactly one h1 on the page', () => {
    const { page } = build();
    const h1s = JSON.stringify(page).match(/"h1"/g) ?? [];
    expect(h1s).toHaveLength(1);
  });
});
