import { describe, it, expect } from 'vitest';
import {
  spreadsheetId,
  parseSheetList,
  fileNameFor,
  slugFor,
  assignTargets,
} from '../scripts/import-sheet.mjs';

describe('spreadsheetId', () => {
  it('pulls the id out of a full edit url', () => {
    expect(spreadsheetId('https://docs.google.com/spreadsheets/d/1ssEGpfq_AB-cd/edit?gid=17#gid=17')).toBe(
      '1ssEGpfq_AB-cd',
    );
  });

  it('accepts a bare id unchanged', () => {
    expect(spreadsheetId('1ssEGpfq_AB-cd')).toBe('1ssEGpfq_AB-cd');
  });

  it('does not throw on nonsense', () => {
    expect(() => spreadsheetId(undefined)).not.toThrow();
    expect(() => spreadsheetId(42)).not.toThrow();
  });
});

describe('parseSheetList', () => {
  it('reads name and gid pairs out of the htmlview markup', () => {
    const html = 'x{name: "Home", index: 0, gid: "1678698839", y}z{name: "Casino", gid: "1642940808"}';
    expect(parseSheetList(html)).toEqual([
      { name: 'Home', gid: '1678698839' },
      { name: 'Casino', gid: '1642940808' },
    ]);
  });

  it('keeps one entry per sheet when the markup repeats it', () => {
    const html = '{name: "Home", gid: "1"}{name: "Home", gid: "1"}{name: "Bonus", gid: "2"}';
    expect(parseSheetList(html).map((s) => s.gid)).toEqual(['1', '2']);
  });

  it('returns nothing rather than throwing when the page holds no sheet list', () => {
    expect(parseSheetList('<html>Sign in</html>')).toEqual([]);
    expect(parseSheetList(undefined)).toEqual([]);
  });
});

describe('fileNameFor / slugFor', () => {
  it('turns a sheet name into a filename and a slug', () => {
    expect(fileNameFor('Casino')).toBe('casino');
    expect(slugFor('Casino')).toBe('/casino');
  });

  it('treats the usual front-page names as the site root', () => {
    for (const name of ['Home', 'home', 'Index', 'Main', 'Главная']) {
      expect(slugFor(name)).toBe('/');
    }
  });

  it('handles spaces, punctuation and non-latin names', () => {
    expect(fileNameFor('Live Dealer!')).toBe('live-dealer');
    expect(slugFor('Live Dealer!')).toBe('/live-dealer');
    expect(fileNameFor('Бонусы')).toBe('бонусы');
  });

  it('falls back rather than producing an empty name', () => {
    expect(fileNameFor('!!!')).toBe('page');
    expect(fileNameFor('')).toBe('page');
  });
});

describe('assignTargets', () => {
  it('gives every sheet its own file and slug', () => {
    const { targets } = assignTargets([
      { name: 'Home', gid: '1' },
      { name: 'Casino', gid: '2' },
    ]);
    expect(targets.map((t) => [t.file, t.slug])).toEqual([
      ['home.json', '/'],
      ['casino.json', '/casino'],
    ]);
  });

  it('resolves two sheets that reduce to the same slug, and says so', () => {
    // Two pages sharing a slug is the exact failure this script exists to prevent: the second one
    // silently ends up at /page-1 at build time, which is very hard to trace back to the sheet.
    const { targets, notes } = assignTargets([
      { name: 'Bonus', gid: '1' },
      { name: 'bonus!', gid: '2' },
    ]);
    const slugs = targets.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(2);
    expect(new Set(targets.map((t) => t.file)).size).toBe(2);
    expect(notes.join(' ')).toContain('bonus!');
  });

  it('does not warn when there is nothing to resolve', () => {
    const { notes } = assignTargets([{ name: 'Home', gid: '1' }, { name: 'App', gid: '2' }]);
    expect(notes).toEqual([]);
  });

  it('handles an empty sheet list', () => {
    expect(assignTargets([])).toEqual({ targets: [], notes: [] });
  });
});
