import { readFileSync } from 'node:fs';

// Runware takes any width and height from 128 to 2048 in steps of 16 — anything else is refused
// with a 400 for every single picture, so a file that asks for it is caught once, here.
const MIN_SIDE = 128;
const MAX_SIDE = 2048;
const SIDE_STEP = 16;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidSide(value) {
  return Number.isInteger(value) && value >= MIN_SIDE && value <= MAX_SIDE && value % SIDE_STEP === 0;
}

export function loadPromptFile(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`не удалось прочитать файл промптов ${path}: ${error.message}`);
  }
  if (!isPlainObject(raw)) {
    throw new Error(`файл промптов ${path} должен быть объектом`);
  }
  const { width, height, negativePrompt, prompts } = raw;
  if (!isValidSide(width) || !isValidSide(height)) {
    throw new Error(
      `в файле промптов ${path} ширина и высота должны быть от 128 до 2048 и делиться на 16 — сейчас ${width}×${height}`,
    );
  }
  if (
    !Array.isArray(prompts) ||
    prompts.length === 0 ||
    prompts.some((prompt) => typeof prompt !== 'string' || prompt.trim() === '')
  ) {
    throw new Error(`в файле промптов ${path} нужен непустой список prompts из непустых строк`);
  }
  if (negativePrompt !== undefined && typeof negativePrompt !== 'string') {
    throw new Error(`в файле промптов ${path} negativePrompt должен быть строкой`);
  }
  return {
    width,
    height,
    negativePrompt: (negativePrompt ?? '').trim(),
    prompts: prompts.map((prompt) => prompt.trim()),
  };
}

// Random, but without repeats until the list runs out: two pictures on one site drawn from the
// same prompt would look like the same picture twice.
export function createPromptPicker(prompts, random = Math.random) {
  let unused = [];
  return function pick() {
    if (unused.length === 0) unused = [...prompts];
    const index = Math.min(Math.floor(random() * unused.length), unused.length - 1);
    return unused.splice(index, 1)[0];
  };
}

export function fillBrand(prompt, brand) {
  return prompt.replaceAll('{brand}', brand).replace(/\s{2,}/g, ' ').trim();
}
