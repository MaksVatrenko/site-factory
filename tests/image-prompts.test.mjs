import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPromptPicker, fillBrand, loadPromptFile } from '../factory/images/prompts.mjs';

let dir;

function writePromptFile(content) {
  dir = mkdtempSync(join(tmpdir(), 'site-factory-prompts-'));
  const file = join(dir, 'images.json');
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const VALID = { width: 1024, height: 576, prompts: ['a', 'b'] };

describe('loadPromptFile', () => {
  it('loads the prompt file the factory ships with', () => {
    const file = loadPromptFile(join('factory', 'prompts', 'images.json'));
    expect(file.width).toBe(1024);
    expect(file.height).toBe(576);
    expect(file.prompts.length).toBeGreaterThanOrEqual(6);
    expect(file.negativePrompt).not.toBe('');
  });

  it('trims the prompts and treats a missing negativePrompt as empty', () => {
    const file = loadPromptFile(writePromptFile({ ...VALID, prompts: ['  roulette  '] }));
    expect(file).toEqual({ width: 1024, height: 576, negativePrompt: '', prompts: ['roulette'] });
  });

  it.each([
    [1000, 576],
    [1024, 100],
    [64, 64],
    [4096, 576],
    ['1024', 576],
  ])('refuses a %s×%s picture Runware would not accept', (width, height) => {
    const file = writePromptFile({ ...VALID, width, height });
    expect(() => loadPromptFile(file)).toThrow(/делиться на 16/);
  });

  it.each([[[]], [['ok', '']], [['ok', 42]], [undefined]])(
    'refuses a prompt list that is empty or holds something other than text: %j',
    (prompts) => {
      const file = writePromptFile({ ...VALID, prompts });
      expect(() => loadPromptFile(file)).toThrow(/непустой список prompts/);
    },
  );

  it('refuses a file that is not JSON, naming the file', () => {
    const file = writePromptFile('{ not json');
    expect(() => loadPromptFile(file)).toThrow(/не удалось прочитать файл промптов/);
    expect(() => loadPromptFile(file)).toThrow(file);
  });
});

describe('createPromptPicker', () => {
  it('uses every prompt once before repeating any of them', () => {
    const pick = createPromptPicker(['a', 'b', 'c'], () => 0.5);
    const firstRound = [pick(), pick(), pick()];
    expect([...firstRound].sort()).toEqual(['a', 'b', 'c']);
    expect(['a', 'b', 'c']).toContain(pick());
  });

  it('copes with a random source that returns its maximum', () => {
    const pick = createPromptPicker(['a', 'b'], () => 0.9999999);
    expect([pick(), pick()].sort()).toEqual(['a', 'b']);
  });
});

describe('fillBrand', () => {
  it('puts the brand wherever {brand} appears', () => {
    expect(fillBrand('{brand} logo, {brand} colours', '899OK')).toBe('899OK logo, 899OK colours');
  });

  it('leaves no double space behind when there is no brand', () => {
    expect(fillBrand('the {brand} casino hall', '')).toBe('the casino hall');
  });
});
