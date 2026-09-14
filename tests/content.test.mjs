import { describe, it, expect } from 'vitest';
import { normalizePageContent } from '../src/lib/content.mjs';

// Stands in for the resolver from src/lib/images.mjs: knows two pictures, one without alt text.
function fakeResolver() {
  const known = {
    main: { src: '/images/main.webp', alt: 'Main' },
    bare: { src: '/images/bare.webp', alt: '' },
  };
  return (name) =>
    known[name]
      ? { image: known[name], problem: null, missingAlt: known[name].alt === '' }
      : { image: null, problem: `картинки «${name}» нет в images.json`, missingAlt: false };
}

const block = (type, content) => ({ type, props: { content } });
const run = (blocks) =>
  normalizePageContent(blocks, { slug: '/page', resolveImage: fakeResolver() });

describe('normalizePageContent: titles', () => {
  it('turns the tag key into tag and text, keeping the order of content', () => {
    const { blocks, warnings } = run([
      block('section', [
        { type: 'title', h1: 'Page title' },
        { type: 'text', text: 'Body.' },
        { type: 'title', h3: 'Sub' },
      ]),
    ]);
    expect(blocks[0]).toEqual({
      type: 'section',
      props: {
        content: [
          { type: 'title', tag: 'h1', text: 'Page title' },
          { type: 'text', text: 'Body.' },
          { type: 'title', tag: 'h3', text: 'Sub' },
        ],
      },
    });
    expect(warnings).toEqual([]);
  });

  it('takes the first heading key when there are several, and says which ones', () => {
    const { blocks, warnings } = run([
      block('section', [
        { type: 'title', h1: 'Page' },
        { type: 'title', h3: 'Wins', h2: 'Ignored' },
      ]),
    ]);
    expect(blocks[0].props.content[1]).toEqual({ type: 'title', tag: 'h3', text: 'Wins' });
    expect(warnings).toEqual(['/page: у заголовка несколько ключей (h3, h2) — взят h3']);
  });

  it('drops a title with no heading key — including one still written the old way', () => {
    const { blocks, warnings } = run([
      block('section', [
        { type: 'title', h1: 'Page' },
        { type: 'title', tag: 'h2', text: 'Old style' },
        { type: 'title', h7: 'Not a tag' },
      ]),
    ]);
    expect(blocks[0].props.content).toEqual([{ type: 'title', tag: 'h1', text: 'Page' }]);
    expect(warnings).toEqual([
      '/page: у заголовка нет ключа h1–h6 — пропущен',
      '/page: у заголовка нет ключа h1–h6 — пропущен',
    ]);
  });

  it('drops a heading with nothing in it', () => {
    const { blocks, warnings } = run([
      block('section', [
        { type: 'title', h1: 'Page' },
        { type: 'title', h2: '   ' },
        { type: 'title', h2: 42 },
      ]),
    ]);
    expect(blocks[0].props.content).toHaveLength(1);
    expect(warnings).toEqual([
      '/page: заголовок h2 пустой — пропущен',
      '/page: заголовок h2 пустой — пропущен',
    ]);
  });
});

describe('normalizePageContent: one h1 per page', () => {
  it('keeps the first h1 and turns every later one into h2, across blocks', () => {
    const { blocks, warnings } = run([
      block('hero', [{ type: 'title', h1: 'First' }]),
      block('section', [
        { type: 'title', h1: 'Second' },
        { type: 'title', h1: 'Third' },
      ]),
    ]);
    expect(blocks[0].props.content[0].tag).toBe('h1');
    expect(blocks[1].props.content.map((entry) => entry.tag)).toEqual(['h2', 'h2']);
    expect(warnings).toEqual([
      '/page: второй h1 на странице стал h2: «Second»',
      '/page: второй h1 на странице стал h2: «Third»',
    ]);
  });

  it('warns when a page with content has no h1 at all', () => {
    expect(run([block('section', [{ type: 'title', h2: 'Only h2' }])]).warnings).toEqual([
      '/page: на странице нет h1',
    ]);
  });

  it('does not warn about h1 on a page with no content at all', () => {
    expect(run([block('section', [])]).warnings).toEqual([]);
    expect(run([]).warnings).toEqual([]);
  });
});

describe('normalizePageContent: pictures', () => {
  it('resolves a standalone picture written either way', () => {
    const { blocks, warnings } = run([
      block('section', [
        { type: 'title', h1: 'Page' },
        { image: 'main' },
        { type: 'image', image: 'main' },
      ]),
    ]);
    expect(blocks[0].props.content.slice(1)).toEqual([
      { type: 'image', image: { src: '/images/main.webp', alt: 'Main' } },
      { type: 'image', image: { src: '/images/main.webp', alt: 'Main' } },
    ]);
    expect(warnings).toEqual([]);
  });

  it('drops a standalone picture that does not resolve, giving the reason', () => {
    const { blocks, warnings } = run([
      block('section', [{ type: 'title', h1: 'Page' }, { image: 'nowhere' }]),
    ]);
    expect(blocks[0].props.content).toHaveLength(1);
    expect(warnings).toEqual(['/page: картинки «nowhere» нет в images.json — не выводится']);
  });

  it('resolves the image field of a card, and drops only the field when it does not resolve', () => {
    const { blocks, warnings } = run([
      block('section', [
        { type: 'title', h1: 'Page' },
        {
          type: 'cards',
          items: [
            { title: 'With picture', text: 'A', image: 'main' },
            { title: 'Broken picture', text: 'B', image: 'nowhere' },
          ],
        },
      ]),
    ]);
    expect(blocks[0].props.content[1].items).toEqual([
      { title: 'With picture', text: 'A', image: { src: '/images/main.webp', alt: 'Main' } },
      { title: 'Broken picture', text: 'B' },
    ]);
    expect(warnings).toEqual(['/page: картинки «nowhere» нет в images.json — не выводится']);
  });

  it('keeps a picture that has no alt text, and says so', () => {
    const { blocks, warnings } = run([
      block('section', [{ type: 'title', h1: 'Page' }, { image: 'bare' }]),
    ]);
    expect(blocks[0].props.content[1].image.src).toBe('/images/bare.webp');
    expect(warnings).toEqual(['/page: у картинки «bare» нет alt — выводится без описания']);
  });

  it('refuses an image value that is not a name', () => {
    const { blocks, warnings } = run([
      block('section', [
        { type: 'title', h1: 'Page' },
        { image: { src: '/inline.webp' } },
        { type: 'cards', items: [{ title: 'Card', image: 42 }] },
      ]),
    ]);
    expect(blocks[0].props.content).toEqual([
      { type: 'title', tag: 'h1', text: 'Page' },
      { type: 'cards', items: [{ title: 'Card' }] },
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings.every((warning) => warning.includes('поле image'))).toBe(true);
  });
});

describe('normalizePageContent: block shape', () => {
  it('names block fields other than content — what a block written the old way leaves behind', () => {
    const { blocks, warnings } = run([
      { type: 'hero', props: { heading: 'Old', paragraphs: ['Old'] } },
    ]);
    expect(blocks[0]).toEqual({ type: 'hero', props: { content: [] } });
    expect(warnings).toEqual([
      '/page: у блока «hero» поля heading, paragraphs не используются — содержимое блока пишется в content',
    ]);
  });

  it('treats a missing content as empty quietly, and a content that is not a list as empty loudly', () => {
    const quiet = run([{ type: 'links', props: {} }]);
    expect(quiet.blocks[0].props.content).toEqual([]);
    expect(quiet.warnings).toEqual([]);

    const loud = run([block('faq', 'not a list')]);
    expect(loud.blocks[0].props.content).toEqual([]);
    expect(loud.warnings).toEqual(['/page: у блока «faq» content не список — блок пуст']);
  });

  it('passes every other element through for the template to judge', () => {
    const entries = [
      { type: 'title', h1: 'Page' },
      { type: 'text', text: 'Body' },
      { type: 'toggle', title: 'Q?', text: 'A.' },
      { type: 'quote', text: 'Unknown to this file' },
      { note: 'no type at all' },
    ];
    expect(run([block('section', entries)]).blocks[0].props.content.slice(1)).toEqual(
      entries.slice(1),
    );
  });

  it('drops content entries that are not objects', () => {
    const { blocks } = run([
      block('section', [{ type: 'title', h1: 'Page' }, 'a string', null, 42, ['array']]),
    ]);
    expect(blocks[0].props.content).toEqual([{ type: 'title', tag: 'h1', text: 'Page' }]);
  });

  it('never throws on nonsense', () => {
    for (const input of [
      undefined,
      null,
      'blocks',
      [null, 42, 'x', { type: 'section' }],
      [{ type: 'section', props: 'x' }],
    ]) {
      expect(() => normalizePageContent(input)).not.toThrow();
    }
  });

  it('works with no slug and no resolver', () => {
    const { warnings } = normalizePageContent([
      block('section', [{ type: 'title', h1: 'Page' }, { image: 'main' }]),
    ]);
    expect(warnings).toEqual(['картинки «main» нет в images.json — не выводится']);
  });
});
