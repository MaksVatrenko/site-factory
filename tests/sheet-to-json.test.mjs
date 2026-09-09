import { describe, it, expect } from 'vitest';
import { sheetToPage, classify } from '../scripts/sheet-to-json.mjs';

function section(...content) {
  return { blocks: [{ type: 'section', content }] };
}

const title = (tag, text) => ({ type: 'title', tag, text });
const text = (value) => ({ type: 'text', text: value });

describe('classify: the trailing run of h3 subsections becomes a card set', () => {
  it('folds two text-only h3 subsections at the end of a section into one cards element', () => {
    const page = classify(
      section(
        title('h2', 'Cricket Betting'),
        text('Intro paragraph.'),
        title('h3', 'BPL Markets'),
        text('Thirty-five markets a match.'),
        title('h3', 'Live Casino Floor'),
        text('Teen Patti and Andar Bahar.'),
      ),
    );

    expect(page.blocks[0].content).toEqual([
      title('h2', 'Cricket Betting'),
      text('Intro paragraph.'),
      {
        type: 'cards',
        items: [
          { title: 'BPL Markets', text: 'Thirty-five markets a match.' },
          { title: 'Live Casino Floor', text: 'Teen Patti and Andar Bahar.' },
        ],
      },
    ]);
  });

  it('leaves a single h3 as a heading — one card is not a set', () => {
    const content = [title('h2', 'Payments'), title('h3', 'bKash'), text('Instant.')];
    expect(classify(section(...content)).blocks[0].content).toEqual(content);
  });

  it('keeps an h3 that carries a list or a table out of the run', () => {
    const page = classify(
      section(
        title('h2', 'Is It Safe'),
        title('h3', "What it can't do"),
        { type: 'list', items: ['Guarantee wins'] },
        title('h3', 'Licensing'),
        text('Curacao licence.'),
        title('h3', 'Offshore status'),
        text('Limited recourse.'),
      ),
    );

    const [heading, subHeading, list, cards] = page.blocks[0].content;
    expect([heading, subHeading, list]).toEqual([
      title('h2', 'Is It Safe'),
      title('h3', "What it can't do"),
      { type: 'list', items: ['Guarantee wins'] },
    ]);
    expect(cards.type).toBe('cards');
    expect(cards.items.map((item) => item.title)).toEqual(['Licensing', 'Offshore status']);
  });

  it('keeps several paragraphs of one card as separate paragraphs', () => {
    const page = classify(
      section(
        title('h2', 'Payments'),
        title('h3', 'bKash'),
        text('Instant deposits.'),
        text('Cashouts in twenty minutes.'),
        title('h3', 'Nagad'),
        text('Ten to thirty minutes.'),
      ),
    );
    expect(page.blocks[0].content[1].items[0].text).toEqual([
      'Instant deposits.',
      'Cashouts in twenty minutes.',
    ]);
  });

  it('changes nothing the second time it is run over the same page', () => {
    const once = classify(
      section(
        title('h2', 'Cricket'),
        title('h3', 'A'),
        text('a.'),
        title('h3', 'B'),
        text('b.'),
      ),
    );
    expect(classify(structuredClone(once))).toEqual(once);
  });

  it('does not touch a section that a block type already claimed', () => {
    // Three questions with answers is an FAQ, and an FAQ has no content array left to group.
    const csv = [
      'h2,899OK FAQ',
      'h3,Is it legit?',
      ',Yes.',
      'h3,How fast are withdrawals?',
      ',Minutes.',
      'h3,Is there an app?',
      ',Android only.',
    ].join('\n');
    expect(sheetToPage(csv, '/').blocks[0].type).toBe('faq');
  });
});
