import { readFileSync } from 'node:fs';
import { loadPromptFile } from './prompts.mjs';

// The logo prompt file is the picture prompt file plus rules of its own: every prompt must say
// where the brand goes ({brand}, since a logo prompt without it would draw a logo for nobody), it
// needs a non-empty gradients list (the colour pairs the square logo is drawn on), and it must
// carry no negativePrompt at all — Ideogram 4.0's request schema has no such field and rejects the
// whole request if one is sent, so this is stricter than the type check loadPromptFile itself does
// for the picture prompt file. Everything else (size, prompts) is checked by loadPromptFile itself,
// with its own messages.
const COLOUR = /^#[0-9a-fA-F]{6}$/;

function isColourPair(value) {
  return Array.isArray(value) && value.length === 2 && value.every((colour) => typeof colour === 'string' && COLOUR.test(colour));
}

export function loadLogoPromptFile(path) {
  const base = loadPromptFile(path);
  // loadPromptFile has already parsed this file successfully, so reading it again cannot fail on
  // its format — it only picks up fields loadPromptFile's own return shape does not carry
  // (gradients), and checks for the one field Ideogram 4.0 rejects outright.
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  // Ideogram 4.0's published request schema sets additionalProperties: false and has no
  // negativePrompt field at all — sending one makes Ideogram reject the whole request, not just
  // ignore the field. Its intent has to live in the prompts themselves instead (see logo.json), so
  // a file that still carries it is refused here, before it ever costs a paid request.
  if (Object.hasOwn(raw, 'negativePrompt')) {
    throw new Error(
      `в файле промптов логотипа ${path} не должно быть поля negativePrompt: Ideogram 4.0 его не принимает, его смысл нужно включить в сами промпты`,
    );
  }
  if (!base.prompts.every((prompt) => prompt.includes('{brand}'))) {
    throw new Error(`в файле промптов логотипа ${path} каждый промпт должен содержать {brand}`);
  }
  const { gradients } = raw;
  if (!Array.isArray(gradients) || gradients.length === 0 || !gradients.every(isColourPair)) {
    throw new Error(`в файле промптов логотипа ${path} нужен непустой список gradients из пар цветов вида #rrggbb`);
  }
  // negativePrompt is left out of the returned shape entirely (not merely defaulted to '' the
  // way loadPromptFile leaves it for the picture prompt file) — nothing downstream can read it
  // back out and forward it to Ideogram.
  return {
    width: base.width,
    height: base.height,
    prompts: base.prompts,
    gradients: gradients.map(([from, to]) => [from, to]),
  };
}
