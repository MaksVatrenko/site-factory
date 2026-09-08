import { describe, it, expect } from 'vitest';
import { linkAnchors } from '../src/lib/anchors.mjs';

function page(...blocks) {
  return { blocks: blocks.map((b) => ({ ...b, props: { ...b.props } })) };
}

describe('linkAnchors', () => {
  it('pairs contents entries with the sections that follow, by position', () => {
    const result = linkAnchors(
      page(
        { type: 'toc', props: { items: ['Первый пункт', 'Второй пункт'] } },
        { type: 'section', props: { heading: 'Why It Works' } },
        { type: 'section', props: { heading: 'How To Start' } },
      ),
    );
    expect(result.blocks[0].props.items).toEqual([
      { label: 'Первый пункт', anchor: 'why-it-works' },
      { label: 'Второй пункт', anchor: 'how-to-start' },
    ]);
  });

  it('links an entry whose wording differs entirely from the heading', () => {
    // This is the real case: the spreadsheet paraphrases, so matching on text found nothing.
    const result = linkAnchors(
      page(
        { type: 'toc', props: { items: ['Welcome Bonus — No Fluff'] } },
        { type: 'section', props: { heading: '899OK Welcome Bonus — The Real Terms' } },
      ),
    );
    expect(result.blocks[0].props.items[0].anchor).toBe(result.blocks[1].props.anchor);
    expect(result.blocks[0].props.items[0].anchor).not.toBe('');
  });

  it('never starts an anchor with a digit', () => {
    // A digit-leading id is legal HTML but not a valid CSS selector: querySelector throws on it.
    const result = linkAnchors(page({ type: 'section', props: { heading: '899OK Bonus' } }));
    expect(result.blocks[0].props.anchor).toMatch(/^[a-z]/);
  });

  it('keeps anchors unique when two headings slugify the same', () => {
    const result = linkAnchors(
      page(
        { type: 'section', props: { heading: 'Payments' } },
        { type: 'section', props: { heading: 'Payments' } },
      ),
    );
    const [first, second] = result.blocks.map((b) => b.props.anchor);
    expect(first).not.toBe(second);
  });

  it('leaves an entry without a section unlinked rather than pointing it nowhere', () => {
    const result = linkAnchors(
      page(
        { type: 'toc', props: { items: ['Есть раздел', 'Раздела нет'] } },
        { type: 'section', props: { heading: 'Only One' } },
      ),
    );
    expect(result.blocks[0].props.items[1].anchor).toBe('');
  });

  it('does not anchor the contents block itself', () => {
    const result = linkAnchors(page({ type: 'toc', props: { heading: 'Содержание', items: [] } }));
    expect(result.blocks[0].props.anchor).toBeUndefined();
  });

  it('survives malformed input', () => {
    expect(() => linkAnchors({})).not.toThrow();
    expect(() => linkAnchors({ blocks: 'nonsense' })).not.toThrow();
    expect(() => linkAnchors({ blocks: [null, 42, { type: 'toc' }] })).not.toThrow();
    expect(() => linkAnchors({ blocks: [{ type: 'toc', props: { items: 'строка' } }] })).not.toThrow();
  });
});
