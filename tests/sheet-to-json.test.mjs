import { describe, it, expect } from 'vitest';
import { sheetToPage, classify, rowsToPage } from '../scripts/sheet-to-json.mjs';

function section(...content) {
  return { blocks: [{ type: 'section', content }] };
}

const title = (tag, text) => ({ type: 'title', [tag]: text });
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
    expect(sheetToPage(csv).blocks[0].type).toBe('faq');
  });
});

describe('sheetToPage: the page format it writes', () => {
  it('writes no slug — the file name is the address now', () => {
    const page = sheetToPage('title,Casino\ndescription,About the casino\nh1,Welcome');
    expect(page).not.toHaveProperty('slug');
    expect(page.title).toBe('Casino');
    expect(page.description).toBe('About the casino');
  });

  it('builds the hero as content, keeping paragraphs and lists in the order they were written', () => {
    const csv = [
      'h1,Welcome',
      ',First paragraph.',
      ',Here is what I noticed:',
      ',Fast payouts',
      ',Live tables',
      ',Closing paragraph.',
    ].join('\n');
    expect(sheetToPage(csv).blocks[0]).toEqual({
      type: 'hero',
      content: [
        { type: 'title', h1: 'Welcome' },
        { type: 'text', text: 'First paragraph.' },
        { type: 'text', text: 'Here is what I noticed:' },
        { type: 'list', items: ['Fast payouts', 'Live tables'] },
        { type: 'text', text: 'Closing paragraph.' },
      ],
    });
  });

  it('writes section headings with the tag as the key', () => {
    const csv = ['h2,Payments', ',Deposits are instant.', 'h3,bKash', ',Fast.'].join('\n');
    const titles = sheetToPage(csv).blocks[0].content.filter((entry) => entry.type === 'title');
    expect(titles).toEqual([
      { type: 'title', h2: 'Payments' },
      { type: 'title', h3: 'bKash' },
    ]);
  });

  it('turns an FAQ into toggles', () => {
    const csv = [
      'h2,FAQ',
      'h3,Is it legit?',
      ',Yes.',
      'h3,How fast?',
      ',Minutes.',
      'h3,Is there an app?',
      ',Android only.',
    ].join('\n');
    expect(sheetToPage(csv).blocks[0]).toEqual({
      type: 'faq',
      content: [
        { type: 'title', h2: 'FAQ' },
        { type: 'toggle', title: 'Is it legit?', text: 'Yes.' },
        { type: 'toggle', title: 'How fast?', text: 'Minutes.' },
        { type: 'toggle', title: 'Is there an app?', text: 'Android only.' },
      ],
    });
  });

  it('turns a table of contents into a title and a list', () => {
    const csv = ['h2,On this page', ',🎰 Casino', ',🏏 Cricket'].join('\n');
    expect(sheetToPage(csv).blocks[0]).toEqual({
      type: 'toc',
      content: [
        { type: 'title', h2: 'On this page' },
        { type: 'list', items: ['Casino', 'Cricket'] },
      ],
    });
  });

  it('turns a heading with nothing under it into the other-pages block', () => {
    expect(sheetToPage('h2,More pages').blocks[0]).toEqual({
      type: 'links',
      content: [{ type: 'title', h2: 'More pages' }],
    });
  });
});

// A seam inside a section: what follows it is an aside about what came above — a caveat, a note on
// the odds. The theme has drawn one since v1 and no example has ever carried one, because the
// spreadsheet had no way to say it. This is that way.
describe('метка line', () => {
  const page = (rows) => rowsToPage(rows);

  it('puts a divider where the sheet asks for one', () => {
    const built = page([
      ['h2', 'Раздел'],
      ['', 'Первый абзац.'],
      ['line'],
      ['', 'Заметка под линией.'],
    ]);
    expect(built.blocks[0].content.map((item) => item.type)).toEqual(['title', 'text', 'line', 'text']);
  });

  it('carries nothing of its own, whatever stands in the cell beside it', () => {
    const built = page([['h2', 'Раздел'], ['', 'Абзац.'], ['line', 'мусор'], ['', 'Заметка.']]);
    expect(built.blocks[0].content[2]).toEqual({ type: 'line' });
  });

  // A divider with nothing above it inside its own section is a rule hanging off the heading, and
  // one with nothing below it is a seam to nowhere. Neither is what the label means.
  it('starts a section if the sheet puts one before any text', () => {
    const built = page([['line'], ['', 'Абзац.']]);
    expect(built.blocks[0].content.map((item) => item.type)).toEqual(['line', 'text']);
  });
});
