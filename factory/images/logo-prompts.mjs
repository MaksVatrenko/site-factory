import { readFileSync } from 'node:fs';
import { loadPromptFile } from './prompts.mjs';

// The logo prompt file is the picture prompt file plus one list — the gradients the square logo is
// drawn on — and one extra rule: every prompt must say where the brand goes, since a logo prompt
// with no {brand} would draw a logo for nobody. Everything the picture file already checks (size,
// prompts, negativePrompt) is checked by loadPromptFile itself, with its own messages.
const COLOUR = /^#[0-9a-fA-F]{6}$/;

function isColourPair(value) {
  return Array.isArray(value) && value.length === 2 && value.every((colour) => typeof colour === 'string' && COLOUR.test(colour));
}

export function loadLogoPromptFile(path) {
  const base = loadPromptFile(path);
  if (!base.prompts.every((prompt) => prompt.includes('{brand}'))) {
    throw new Error(`в файле промптов логотипа ${path} каждый промпт должен содержать {brand}`);
  }
  // loadPromptFile has already parsed this file successfully, so reading it again cannot fail on
  // its format — it only picks up the one field loadPromptFile does not return.
  const { gradients } = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(gradients) || gradients.length === 0 || !gradients.every(isColourPair)) {
    throw new Error(`в файле промптов логотипа ${path} нужен непустой список gradients из пар цветов вида #rrggbb`);
  }
  return { ...base, gradients: gradients.map(([from, to]) => [from, to]) };
}
