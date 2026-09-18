import { describe, it, expect } from 'vitest';
import { linkAnchors } from '../src/lib/anchors.mjs';

function page(...blocks) {
  return { blocks: blocks.map((b) => ({ ...b, props: { ...b.props } })) };
}

// A section's heading is now the first `title` element in its `content` array (see
// src/lib/anchors.mjs) rather than a dedicated `heading` field -- this builds that shape so each
// test below can still just say what heading it means.
function section(text, extra = []) {
  return { type: 'section', props: { content: [{ type: 'title', tag: 'h2', text }, ...extra] } };
}

// A table of contents is the first `list` in a toc block's content now; the pairs linkAnchors
// makes land beside it as `tocLinks`.
function toc(items, heading) {
  const title = heading ? [{ type: 'title', tag: 'h2', text: heading }] : [];
  return { type: 'toc', props: { content: [...title, { type: 'list', items }] } };
}

// The blocks this file had no helper for: a service block and the FAQ, both of which carry a
// heading of their own without ever being a section.
function headed(type, text) {
  return { type, props: { content: [{ type: 'title', tag: 'h2', text }] } };
}

describe('linkAnchors', () => {
  it('pairs contents entries with the sections that follow, by position', () => {
    const result = linkAnchors(
      page(
        toc(['Первый пункт', 'Второй пункт']),
        section('Why It Works'),
        section('How To Start'),
      ),
    );
    expect(result.blocks[0].props.tocLinks).toEqual([
      { label: 'Первый пункт', anchor: 'why-it-works' },
      { label: 'Второй пункт', anchor: 'how-to-start' },
    ]);
  });

  it('links an entry whose wording differs entirely from the heading', () => {
    // This is the real case: the spreadsheet paraphrases, so matching on text found nothing.
    const result = linkAnchors(
      page(
        toc(['Welcome Bonus — No Fluff']),
        section('899OK Welcome Bonus — The Real Terms'),
      ),
    );
    expect(result.blocks[0].props.tocLinks[0].anchor).toBe(result.blocks[1].props.anchor);
    expect(result.blocks[0].props.tocLinks[0].anchor).not.toBe('');
  });

  it('never starts an anchor with a digit', () => {
    // A digit-leading id is legal HTML but not a valid CSS selector: querySelector throws on it.
    const result = linkAnchors(page(section('899OK Bonus')));
    expect(result.blocks[0].props.anchor).toMatch(/^[a-z]/);
  });

  it('keeps anchors unique when two headings slugify the same', () => {
    const result = linkAnchors(page(section('Payments'), section('Payments')));
    const [first, second] = result.blocks.map((b) => b.props.anchor);
    expect(first).not.toBe(second);
  });

  it('leaves an entry without a section unlinked rather than pointing it nowhere', () => {
    const result = linkAnchors(
      page(
        toc(['Есть раздел', 'Раздела нет']),
        section('Only One'),
      ),
    );
    expect(result.blocks[0].props.tocLinks[1].anchor).toBe('');
  });

  it('does not anchor the contents block itself', () => {
    const result = linkAnchors(page(toc([], 'Содержание')));
    expect(result.blocks[0].props.anchor).toBeUndefined();
  });

  it('takes the heading from the first title element, wherever it sits in content', () => {
    // Content order is the content author's call now, not a fixed shape: a section can open with
    // body text, or lead with an h3, before its own h2 ever appears. The anchor must still come
    // from the first TITLE element specifically, not from content[0] or the first h2.
    const result = linkAnchors(
      page({
        type: 'section',
        props: {
          content: [
            { type: 'text', text: 'Intro paragraph before any heading.' },
            { type: 'title', tag: 'h2', text: 'Real Heading' },
            { type: 'title', tag: 'h3', text: 'A later subheading' },
          ],
        },
      }),
    );
    expect(result.blocks[0].props.anchor).toBe('real-heading');
  });

  it('anchors every kind of block by the first title in its content', () => {
    const titled = (type, text) => ({
      type,
      props: { content: [{ type: 'title', tag: 'h2', text }] },
    });
    const result = linkAnchors(
      page(titled('hero', 'Welcome'), titled('faq', 'Questions'), titled('links', 'More Pages')),
    );
    expect(result.blocks.map((block) => block.props.anchor)).toEqual([
      'welcome',
      'questions',
      'more-pages',
    ]);
  });

  it('takes the first list of a toc as its entries, wherever it sits', () => {
    const result = linkAnchors(
      page(
        {
          type: 'toc',
          props: {
            content: [
              { type: 'text', text: 'Intro' },
              { type: 'list', items: ['Only'] },
              { type: 'list', items: ['Ignored'] },
            ],
          },
        },
        section('Target'),
      ),
    );
    expect(result.blocks[0].props.tocLinks).toEqual([{ label: 'Only', anchor: 'target' }]);
  });

  it('pairs a contents entry with the block it names, past a service block in between', () => {
    // The page the factory builds once layouts exist: the contents names the FAQ as well as the
    // sections, and the "other pages" grid — which carries a heading of its own — sits between them.
    // Pairing purely by position hands the FAQ entry that grid's anchor.
    const result = linkAnchors(
      page(
        toc(['Раздел А', 'Раздел Б', 'Частые вопросы'], 'Содержание'),
        section('Раздел А'),
        section('Раздел Б'),
        headed('links', 'Другие страницы'),
        headed('faq', 'Частые вопросы'),
      ),
    );
    expect(result.blocks[0].props.tocLinks.map((entry) => entry.anchor)).toEqual([
      'раздел-а',
      'раздел-б',
      'частые-вопросы',
    ]);
  });

  it('still falls back to position when no entry names its block', () => {
    // The guarantee for hand-written pages (data/sites/899ok): entries there paraphrase their
    // headings, match nothing, and must still land on the sections in order.
    const result = linkAnchors(
      page(
        toc(['Про бонус', 'Про вывод']),
        section('899OK Welcome Bonus — The Real Terms'),
        section('Withdrawals, Step by Step'),
      ),
    );
    expect(result.blocks[0].props.tocLinks.map((entry) => entry.anchor)).toEqual([
      's-899ok-welcome-bonus-the-real-terms',
      'withdrawals-step-by-step',
    ]);
  });

  it('never pairs an entry with a block an earlier entry already took', () => {
    // A match never runs backwards, so two sections sharing a heading stay in their own order.
    const result = linkAnchors(page(toc(['Бонусы', 'Бонусы']), section('Бонусы'), section('Бонусы')));
    const anchors = result.blocks[0].props.tocLinks.map((entry) => entry.anchor);
    expect(new Set(anchors).size).toBe(2);
  });

  it('survives malformed input', () => {
    expect(() => linkAnchors({})).not.toThrow();
    expect(() => linkAnchors({ blocks: 'nonsense' })).not.toThrow();
    expect(() => linkAnchors({ blocks: [null, 42, { type: 'toc' }] })).not.toThrow();
    expect(() =>
      linkAnchors({ blocks: [{ type: 'toc', props: { content: [{ type: 'list', items: 'строка' }] } }] }),
    ).not.toThrow();
    expect(() => linkAnchors({ blocks: [{ type: 'toc', props: { content: 'x' } }] })).not.toThrow();
    // A section whose `content` is not even an array, or whose entries are not usable title
    // records -- both must be swallowed the same way any other malformed content shape is.
    expect(() =>
      linkAnchors({ blocks: [{ type: 'section', props: { content: 'not an array' } }] }),
    ).not.toThrow();
    expect(() =>
      linkAnchors({
        blocks: [{ type: 'section', props: { content: [null, 'string', { type: 'title' }] } }],
      }),
    ).not.toThrow();
  });
});
