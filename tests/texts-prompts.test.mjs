import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { languageFor, loadTextsPromptFile } from '../factory/texts/texts-prompts.mjs';

let dirs = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function promptFile(body) {
  const dir = mkdtempSync(join(tmpdir(), 'site-factory-texts-prompts-'));
  dirs.push(dir);
  const file = join(dir, 'texts.json');
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
}

const GOOD = {
  rules: ['Write clear, useful content.', 'Do not copy text from the examples.'],
  languageByGeo: { Bangladesh: 'en-US', Mexico: 'es-MX' },
};

describe('loadTextsPromptFile', () => {
  it('reads the rules and the language table', () => {
    const loaded = loadTextsPromptFile(promptFile(GOOD));
    expect(loaded.rules).toHaveLength(2);
    expect(loaded.languageByGeo.Mexico).toBe('es-MX');
  });

  it('refuses a file with no rules', () => {
    expect(() => loadTextsPromptFile(promptFile({ ...GOOD, rules: [] }))).toThrow(/rules/);
  });

  it('refuses a rule that is not a non-empty string', () => {
    expect(() => loadTextsPromptFile(promptFile({ ...GOOD, rules: ['ok', '  '] }))).toThrow(/rules/);
  });

  it('refuses a language table that is not a map of strings', () => {
    expect(() => loadTextsPromptFile(promptFile({ ...GOOD, languageByGeo: { Mexico: 5 } }))).toThrow(
      /languageByGeo/,
    );
  });

  it('refuses a file that is not JSON, naming it', () => {
    const file = promptFile('{ not json');
    expect(() => loadTextsPromptFile(file)).toThrow(new RegExp(file.replace(/[/\\]/g, '.')));
  });
});

describe('languageFor', () => {
  it('finds the language of a known geo', () => {
    expect(languageFor('Mexico', GOOD.languageByGeo)).toEqual({ locale: 'es-MX', known: true });
  });

  it('ignores case and surrounding spaces', () => {
    expect(languageFor('  mexico ', GOOD.languageByGeo)).toEqual({ locale: 'es-MX', known: true });
  });

  // An unknown geo must not stop a run: English is a defensible default, and the caller says so in
  // the log so nobody is surprised by an English site for a country that wanted another language.
  it('falls back to English and says the geo was unknown', () => {
    expect(languageFor('Atlantis', GOOD.languageByGeo)).toEqual({ locale: 'en-US', known: false });
  });

  it('treats an empty geo as unknown too', () => {
    expect(languageFor('', GOOD.languageByGeo)).toEqual({ locale: 'en-US', known: false });
  });
});
