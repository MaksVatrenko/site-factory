import { describe, it, expect } from 'vitest';
import {
  spreadsheetId,
  parseSheetList,
  fileNameFor,
  isHomeSheet,
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

describe('fileNameFor / isHomeSheet', () => {
  it('turns a sheet name into a file name', () => {
    expect(fileNameFor('Casino')).toBe('casino');
  });

  it('recognises the usual front-page names, and only those', () => {
    for (const name of ['Home', 'home', 'Index', 'Main', 'Главная', ' Домашняя ']) {
      expect(isHomeSheet(name), name).toBe(true);
    }
    expect(isHomeSheet('Casino')).toBe(false);
    expect(isHomeSheet('Homepage')).toBe(false);
  });

  it('handles spaces, punctuation and non-latin names', () => {
    expect(fileNameFor('Live Dealer!')).toBe('live-dealer');
    expect(fileNameFor('Бонусы')).toBe('бонусы');
  });

  it('falls back rather than producing an empty name', () => {
    expect(fileNameFor('!!!')).toBe('page');
    expect(fileNameFor('')).toBe('page');
  });
});

describe('assignTargets', () => {
  it('gives every sheet its own file, and the front page always home.json', () => {
    const { targets } = assignTargets([
      { name: 'Main', gid: '1' },
      { name: 'Casino', gid: '2' },
    ]);
    expect(targets.map((t) => t.file)).toEqual(['home.json', 'casino.json']);
    expect(targets[1]).not.toHaveProperty('slug');
  });

  it('resolves two sheets that reduce to the same file name, and says so', () => {
    // The file name is the page's address, so two sheets on one file name would lose a page.
    const { targets, notes } = assignTargets([
      { name: 'Bonus', gid: '1' },
      { name: 'bonus!', gid: '2' },
    ]);
    expect(targets.map((t) => t.file)).toEqual(['bonus.json', 'bonus-2.json']);
    expect(notes.join(' ')).toContain('bonus!');
  });

  it('keeps only the first front-page sheet at home.json', () => {
    const { targets, notes } = assignTargets([
      { name: 'Home', gid: '1' },
      { name: 'Главная', gid: '2' },
    ]);
    expect(targets.map((t) => t.file)).toEqual(['home.json', 'home-2.json']);
    expect(notes).toHaveLength(1);
  });

  it('never names a page after a service file', () => {
    const { targets, notes } = assignTargets([
      { name: 'Site', gid: '1' },
      { name: 'Images', gid: '2' },
    ]);
    expect(targets.map((t) => t.file)).toEqual(['site-2.json', 'images-2.json']);
    expect(notes.join(' ')).toContain('служебным файлом site.json');
  });

  it('does not warn when there is nothing to resolve', () => {
    const { notes } = assignTargets([
      { name: 'Home', gid: '1' },
      { name: 'App', gid: '2' },
    ]);
    expect(notes).toEqual([]);
  });

  it('handles an empty sheet list', () => {
    expect(assignTargets([])).toEqual({ targets: [], notes: [] });
  });
});
