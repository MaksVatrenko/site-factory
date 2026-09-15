import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    expect(file.width).toBe(2048);
    expect(file.height).toBe(2048);
    expect(file.prompts.length).toBeGreaterThanOrEqual(6);
    expect(file.prompts.every((prompt) => prompt.includes('{brand}'))).toBe(true);
    expect(file.gradients.length).toBeGreaterThanOrEqual(6);
  });

  // Contract test: pins the shipped file itself (read directly, bypassing the loader) to the one
  // width/height pair Ideogram 4.0 actually accepts within the project's 128-2048 size rule, and to
  // having no negativePrompt key at all — Ideogram 4.0 rejects that field outright (finding C1).
  // This must keep failing on its own even if loadLogoPromptFile's own checks are ever loosened.
  it('pins the shipped logo.json to Ideogram 4.0\'s one allowed size, with no negativePrompt key', () => {
    const raw = JSON.parse(readFileSync(join('factory', 'prompts', 'logo.json'), 'utf8'));
    expect(raw.width).toBe(2048);
    expect(raw.height).toBe(2048);
    expect(Object.hasOwn(raw, 'negativePrompt')).toBe(false);
  });

  it('returns the gradients next to what the picture prompt file already checks', () => {
    expect(loadLogoPromptFile(writeFile(VALID))).toEqual({
      width: 1536,
      height: 768,
      prompts: ['a wordmark that reads "{brand}"'],
      gradients: [['#3b1a8c', '#7b3fe4']],
    });
  });

  it('refuses a prompt with no place for the brand', () => {
    const file = writeFile({ ...VALID, prompts: ['a golden casino logo'] });
    expect(() => loadLogoPromptFile(file)).toThrow(/\{brand\}/);
  });

  // C1: Ideogram 4.0's schema sets additionalProperties: false and has no negativePrompt at all —
  // sending it makes the model reject the whole request. Its intent has to live in the prompts
  // themselves instead, so a logo.json still carrying the field is refused before it ever reaches
  // Runware, the same way any other structurally-wrong file is.
  it('refuses a logo.json with negativePrompt: Ideogram 4.0 does not accept that field', () => {
    const file = writeFile({ ...VALID, negativePrompt: 'watermark, busy background' });
    expect(() => loadLogoPromptFile(file)).toThrow(/negativePrompt/);
    expect(() => loadLogoPromptFile(file)).toThrow(file);
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
