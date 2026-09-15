import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLogoPromptFile } from '../factory/images/logo-prompts.mjs';

let dir;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function writeFile(content) {
  dir = mkdtempSync(join(tmpdir(), 'site-factory-logo-prompts-'));
  const file = join(dir, 'logo.json');
  writeFileSync(file, JSON.stringify(content));
  return file;
}

const VALID = {
  width: 1536,
  height: 768,
  prompts: ['a wordmark that reads "{brand}"'],
  gradients: [['#3b1a8c', '#7b3fe4']],
};

describe('loadLogoPromptFile', () => {
  it('loads the logo prompt file the factory ships with', () => {
    const file = loadLogoPromptFile(join('factory', 'prompts', 'logo.json'));
    expect(file.width).toBe(1536);
    expect(file.height).toBe(768);
    expect(file.prompts.length).toBeGreaterThanOrEqual(6);
    expect(file.prompts.every((prompt) => prompt.includes('{brand}'))).toBe(true);
    expect(file.gradients.length).toBeGreaterThanOrEqual(6);
  });

  it('returns the gradients next to what the picture prompt file already checks', () => {
    expect(loadLogoPromptFile(writeFile(VALID))).toEqual({
      width: 1536,
      height: 768,
      negativePrompt: '',
      prompts: ['a wordmark that reads "{brand}"'],
      gradients: [['#3b1a8c', '#7b3fe4']],
    });
  });

  it('refuses a prompt with no place for the brand', () => {
    const file = writeFile({ ...VALID, prompts: ['a golden casino logo'] });
    expect(() => loadLogoPromptFile(file)).toThrow(/\{brand\}/);
  });

  it.each([[[]], [undefined], [[['#3b1a8c']]], [[['#fff', '#000000']]], [[['red', 'blue']]], [['#3b1a8c']]])(
    'refuses gradients that are not pairs of #rrggbb colours: %j',
    (gradients) => {
      const file = writeFile({ ...VALID, gradients });
      expect(() => loadLogoPromptFile(file)).toThrow(/gradients/);
    },
  );

  it('keeps the size rules of the picture prompt file', () => {
    const file = writeFile({ ...VALID, width: 1000 });
    expect(() => loadLogoPromptFile(file)).toThrow(/делиться на 16/);
  });
});
