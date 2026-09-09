import { describe, it, expect } from 'vitest';
import { parseRichText, isSafeHref } from '../templates/_shared/rich-text.mjs';

describe('isSafeHref', () => {
  it('accepts the four shapes a page can legitimately link to', () => {
    expect(isSafeHref('/casino')).toBe(true);
    expect(isSafeHref('#bonus')).toBe(true);
    expect(isSafeHref('https://example.com/x')).toBe(true);
    expect(isSafeHref('mailto:hi@example.com')).toBe(true);
  });

  it('rejects anything that would run instead of navigate', () => {
    // The content is written by a third party and pasted through a spreadsheet, so this is the
    // one place where "render whatever it says" would be genuinely unsafe.
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('JavaScript:alert(1)')).toBe(false);
    expect(isSafeHref('data:text/html,<script>')).toBe(false);
    expect(isSafeHref('vbscript:msgbox')).toBe(false);
  });

  it('rejects a protocol-relative link, which is not this site', () => {
    expect(isSafeHref('//evil.example')).toBe(false);
  });

  it('does not throw on anything at all', () => {
    for (const value of [undefined, null, 42, {}, [], '', '   ']) {
      expect(isSafeHref(value)).toBe(false);
    }
  });
});

describe('parseRichText', () => {
  it('splits a sentence into words and links, in order', () => {
    expect(parseRichText('Open the [full lobby](/casino) and browse.')).toEqual([
      { text: 'Open the ' },
      { text: 'full lobby', href: '/casino' },
      { text: ' and browse.' },
    ]);
  });

  it('reads several links in one string', () => {
    const parts = parseRichText('[BPL](/betting), [India series](/betting) and [slots](/slots)');
    expect(parts.filter((part) => part.href).map((part) => part.href)).toEqual([
      '/betting',
      '/betting',
      '/slots',
    ]);
  });

  it('keeps an unsafe link as plain words rather than dropping the sentence', () => {
    // The words still belong to the sentence; only the link does not survive.
    expect(parseRichText('Tap [here](javascript:alert) now')).toEqual([
      { text: 'Tap ' },
      { text: 'here' },
      { text: ' now' },
    ]);
  });

  it('never hands back an href for markup that named an unsafe one', () => {
    for (const text of [
      'Tap [here](javascript:alert(1)) now',
      'Tap [here](data:text/html,x) now',
      'Tap [here](//evil.example) now',
    ]) {
      expect(parseRichText(text).some((part) => part.href)).toBe(false);
    }
  });

  it('leaves ordinary prose alone', () => {
    expect(parseRichText('A sentence [sic] with brackets (and parens).')).toEqual([
      { text: 'A sentence [sic] with brackets (and parens).' },
    ]);
  });

  it('leaves half-written markup on screen instead of eating the rest of the line', () => {
    for (const text of ['[label](', 'label](/casino)', '[](/casino)', '[a] (/casino)']) {
      expect(parseRichText(text)).toEqual([{ text }]);
    }
  });

  it('does not throw on anything at all', () => {
    for (const value of [undefined, null, 42, {}, []]) {
      expect(parseRichText(value)).toEqual([]);
    }
  });
});
