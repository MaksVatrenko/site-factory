# Генерация картинок через Runware: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** перед сборкой сайта фабрика сама генерирует через Runware картинки для меток
`{ "image": "имя" }`, которых нет в `images.json` сайта, сохраняет файлы и дописывает
`images.json`.

**Architecture:**
- Всё новое лежит в `factory/images/`, четыре модуля:
  - `env.mjs` — чтение `.env`;
  - `prompts.mjs` — файл промптов и выбор промпта;
  - `runware.mjs` — клиент Runware;
  - `generate.mjs` — весь запуск генерации.
- Сервер фабрики запускает генерацию шагом `prepare` внутри той же записи сборки, до Astro.
- Движок сайта (`src/lib`, шаблоны) не меняется.
- Ключ читается из `.env` в объект и никогда не кладётся в `process.env`.

**Tech Stack:** Node ≥ 22.12 (ESM, встроенные `fetch`, `util.parseEnv`,
`crypto.randomUUID`), Express 5, Vitest 5, Runware REST API.

**Спецификация:** `docs/specs/2026-09-15-image-generation-design.md`. Если план и спецификация
расходятся, спросить владельца.

## Global Constraints

**Зависимости и среда**
- Новых зависимостей в `package.json` не добавлять. Нужное есть во встроенных модулях Node.
- Код комментируется по-английски, и комментарий объясняет «почему», как везде в проекте.
  Сообщения в логе, ошибки и тексты интерфейса — по-русски.

**Ключ Runware**
- Ключ читается только из файла `.env`, через `util.parseEnv`, в объект. Он **никогда** не
  записывается в `process.env`, не печатается в лог и не попадает в текст ошибок.
- Никто, кроме владельца, не пишет настоящий ключ ни в какой файл.

**Тесты**
- Тесты не ходят в сеть и не читают настоящий `.env`. `fetch` и путь к `.env` передаются
  параметрами. Тестовый ключ — строка вида `sentinel-runware-key-…`.

**Git и коммиты**
- Никогда не коммитить `data/sites/899ok/home.json`, `data/sites/899ok/images.json` и
  `data/sites/899ok/public/`. Это локальные файлы владельца.
- Перед каждым коммитом проверять `git diff --cached --name-only`. В индексе должны быть
  только файлы задачи.
- Коммиты на русском, в конце строка `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

**Параметры Runware**
- Значения по умолчанию: `RUNWARE_API_URL=https://api.runware.ai/v1`,
  `RUNWARE_MODEL=runware:400@6`, `RUNWARE_GUIDANCE=2`, `RUNWARE_STEPS=4`,
  `RUNWARE_CONCURRENCY=1`.
- Размер картинки задаёт файл промптов. Ширина и высота — целые от 128 до 2048, кратные 16.
  Стартовый размер 1024×576.
- Запрос: `outputType: "base64Data"`, `outputFormat: "WEBP"`, `outputQuality: 85`,
  `includeCost: true`, `numberResults: 1`.
- Ожидание ответа — 120 с. Повторы при 429, 5xx, сетевой ошибке и истёкшем ожидании: до 3,
  с паузами 1000, 2000 и 4000 мс.

**Тестовые команды**
- Один файл: `npx vitest run tests/<файл>`.
- Весь набор: `npm test`. Перед планом в нём 343 теста, все зелёные.

---

## Файлы

| Файл | Что делает |
|---|---|
| `.env.example` (новый) | Образец настроек Runware без ключа |
| `.gitignore` | Исключение `!.env.example` |
| `factory/images/env.mjs` (новый) | `readRunwareConfig(envFile)` |
| `factory/prompts/images.json` (новый) | Размер, `negativePrompt`, стартовые промпты |
| `factory/images/prompts.mjs` (новый) | `loadPromptFile`, `createPromptPicker`, `fillBrand` |
| `factory/images/runware.mjs` (новый) | `generateImage`, `RunwareError`, `RETRY_DELAYS_MS` |
| `factory/images/generate.mjs` (новый) | `generateMissingImages`, `collectImageNames`, `fileBaseFor`, `altFor` |
| `factory/server.mjs` | `startBuild`: шаг `prepare` и `env`-функция. `createApp`: параметры `envFile`, `fetchFn`, `promptFile`. `/api/generate`: `skipImages` |
| `factory/public/index.html`, `app.js`, `styles.css` | Галочка «Без генерации картинок» |
| `scripts/generate-images.mjs` (новый) | `npm run generate:images -- <сайт>` |
| `package.json` | Скрипт `generate:images` |
| `README.md` | Раздел «Картинки», правка «Что дальше» |
| Тесты | `tests/runware-env.test.mjs`, `tests/image-prompts.test.mjs`, `tests/runware-client.test.mjs`, `tests/image-generate.test.mjs`, `tests/generate-images-cli.test.mjs` (новые); `tests/server.test.mjs`, `tests/smoke.test.mjs` (правка) |

---

### Task 1: Настройки Runware и `.env`

**Files:**
- Create: `.env.example`
- Modify: `.gitignore`
- Create: `factory/images/env.mjs`
- Test: `tests/runware-env.test.mjs`

**Interfaces:**
- Consumes: ничего.
- Produces: `readRunwareConfig(envFile: string)` возвращает
  `{ apiKey: string, apiUrl: string, model: string, guidance: number, steps: number, concurrency: number }`.
  Функция никогда не бросает исключение. Если файла нет, `apiKey` пустой, остальное по
  умолчанию. Также экспортируется `RUNWARE_DEFAULTS`.

- [ ] **Step 1: Написать падающий тест**

`tests/runware-env.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRunwareConfig, RUNWARE_DEFAULTS } from '../factory/images/env.mjs';

const SENTINEL = 'sentinel-runware-key-env-5d1e';
let dir;

function writeEnv(text) {
  dir = mkdtempSync(join(tmpdir(), 'site-factory-env-'));
  const file = join(dir, '.env');
  writeFileSync(file, text);
  return file;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('readRunwareConfig', () => {
  it('reads every setting from the .env file', () => {
    const file = writeEnv(
      [
        `RUNWARE_API_KEY=${SENTINEL}`,
        'RUNWARE_API_URL=https://runware.test/v1',
        'RUNWARE_MODEL=runware:1@1',
        'RUNWARE_GUIDANCE=3.5',
        'RUNWARE_STEPS=8',
        'RUNWARE_CONCURRENCY=2',
      ].join('\n'),
    );
    expect(readRunwareConfig(file)).toEqual({
      apiKey: SENTINEL,
      apiUrl: 'https://runware.test/v1',
      model: 'runware:1@1',
      guidance: 3.5,
      steps: 8,
      concurrency: 2,
    });
  });

  it('fills in the defaults for everything the file leaves out', () => {
    const file = writeEnv(`RUNWARE_API_KEY=${SENTINEL}\n`);
    expect(readRunwareConfig(file)).toEqual({ apiKey: SENTINEL, ...RUNWARE_DEFAULTS });
  });

  it('falls back to the default for a number that is not a positive number', () => {
    const file = writeEnv('RUNWARE_STEPS=abc\nRUNWARE_CONCURRENCY=0\nRUNWARE_GUIDANCE=-1\n');
    const config = readRunwareConfig(file);
    expect(config.steps).toBe(RUNWARE_DEFAULTS.steps);
    expect(config.concurrency).toBe(RUNWARE_DEFAULTS.concurrency);
    expect(config.guidance).toBe(RUNWARE_DEFAULTS.guidance);
  });

  it('returns an empty key and the defaults when there is no .env at all', () => {
    const config = readRunwareConfig(join(tmpdir(), 'site-factory-no-such-dir', '.env'));
    expect(config).toEqual({ apiKey: '', ...RUNWARE_DEFAULTS });
  });

  it('never puts anything into process.env', () => {
    const file = writeEnv(`RUNWARE_API_KEY=${SENTINEL}\nRUNWARE_STEPS=8\n`);
    const keysBefore = Object.keys(process.env).sort();
    readRunwareConfig(file);
    expect(Object.keys(process.env).sort()).toEqual(keysBefore);
    expect(Object.values(process.env)).not.toContain(SENTINEL);
  });
});

describe('.env.example', () => {
  it('lists every setting with an empty key and 4 steps', () => {
    const config = readRunwareConfig('.env.example');
    expect(config.apiKey).toBe('');
    expect(config.steps).toBe(4);
    expect(config.model).toBe('runware:400@6');
  });

  it('is committed to git while .env itself stays ignored', () => {
    // `git check-ignore -q` exits 0 for an ignored path and 1 for one git would track.
    expect(spawnSync('git', ['check-ignore', '-q', '.env.example']).status).toBe(1);
    expect(spawnSync('git', ['check-ignore', '-q', '.env']).status).toBe(0);
  });
});
```

- [ ] **Step 2: Запустить и увидеть падение**

Run: `npx vitest run tests/runware-env.test.mjs`
Expected: FAIL — `Failed to load url ../factory/images/env.mjs` (модуля ещё нет).

- [ ] **Step 3: Написать `.env.example`, исключение в `.gitignore` и модуль**

`.env.example`:

```ini
# Настройки генерации картинок через Runware (https://runware.ai).
# Скопируйте этот файл в .env и впишите ключ. Файл .env не попадает ни в git, ни в собранный сайт.
RUNWARE_API_KEY=
RUNWARE_API_URL=https://api.runware.ai/v1
RUNWARE_MODEL=runware:400@6
RUNWARE_GUIDANCE=2
# Модель рассчитана на 4 шага. Если качества не хватает, число можно поднять, но каждый шаг дороже.
RUNWARE_STEPS=4
RUNWARE_CONCURRENCY=1
```

`.gitignore`: сразу после строки `.env.*` добавить строку

```
!.env.example
```

`factory/images/env.mjs`:

```js
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Runware settings come from the project's .env file. They are parsed into a plain object and
// deliberately never copied into process.env: the factory starts every Astro build with
// `{ ...process.env, ...options.env }`, so a key that is not in process.env physically cannot reach
// the build process, and so cannot end up in a built site.
export const RUNWARE_DEFAULTS = Object.freeze({
  apiUrl: 'https://api.runware.ai/v1',
  model: 'runware:400@6',
  guidance: 2,
  steps: 4,
  concurrency: 1,
});

// A missing or unreadable .env is not an error here: without a key, generation reports that it
// skipped the pictures, and the site still builds.
function readEnvFile(envFile) {
  try {
    return parseEnv(readFileSync(envFile, 'utf8'));
  } catch {
    return {};
  }
}

function positiveNumber(raw, fallback) {
  if (raw === '') return fallback;
  const number = Number(raw);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveInteger(raw, fallback) {
  const number = positiveNumber(raw, fallback);
  return Number.isInteger(number) ? number : fallback;
}

export function readRunwareConfig(envFile) {
  const values = readEnvFile(envFile);
  const text = (key) => (typeof values[key] === 'string' ? values[key].trim() : '');
  return {
    apiKey: text('RUNWARE_API_KEY'),
    apiUrl: text('RUNWARE_API_URL') || RUNWARE_DEFAULTS.apiUrl,
    model: text('RUNWARE_MODEL') || RUNWARE_DEFAULTS.model,
    guidance: positiveNumber(text('RUNWARE_GUIDANCE'), RUNWARE_DEFAULTS.guidance),
    steps: positiveInteger(text('RUNWARE_STEPS'), RUNWARE_DEFAULTS.steps),
    concurrency: positiveInteger(text('RUNWARE_CONCURRENCY'), RUNWARE_DEFAULTS.concurrency),
  };
}
```

- [ ] **Step 4: Запустить и увидеть, что проходит**

Run: `npx vitest run tests/runware-env.test.mjs`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Коммит**

```bash
git add .env.example .gitignore factory/images/env.mjs tests/runware-env.test.mjs
git diff --cached --name-only
git commit -m "Настройки Runware из .env без попадания в process.env" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Файл промптов

**Files:**
- Create: `factory/prompts/images.json`
- Create: `factory/images/prompts.mjs`
- Test: `tests/image-prompts.test.mjs`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `loadPromptFile(path: string)` возвращает
    `{ width: number, height: number, negativePrompt: string, prompts: string[] }`. Если файл
    не читается или неверен, бросает `Error` с русским текстом, где указан путь.
  - `createPromptPicker(prompts: string[], random = Math.random)` возвращает `pick(): string`.
    Промпт не повторяется, пока список не исчерпан.
  - `fillBrand(prompt: string, brand: string): string`.

- [ ] **Step 1: Написать падающий тест**

`tests/image-prompts.test.mjs`:

```js
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
```

- [ ] **Step 2: Запустить и увидеть падение**

Run: `npx vitest run tests/image-prompts.test.mjs`
Expected: FAIL — `Failed to load url ../factory/images/prompts.mjs`.

- [ ] **Step 3: Написать файл промптов и модуль**

`factory/prompts/images.json`:

```json
{
  "width": 1024,
  "height": 576,
  "negativePrompt": "text, letters, words, numbers, watermark, logo, signature, blurry, distorted hands",
  "prompts": [
    "a luxurious modern casino hall with glowing roulette and card tables, warm golden lighting, cinematic wide shot, photorealistic",
    "close-up of a roulette wheel spinning with the ball in motion, dramatic lighting, shallow depth of field, photorealistic",
    "a cricket stadium at night under bright floodlights, packed stands, batsman ready at the crease, cinematic wide shot",
    "a smartphone lying on a dark table showing a colourful slot game, neon reflections, product photography",
    "stacks of casino chips and playing cards on green felt, soft spotlight, photorealistic macro shot",
    "a live dealer at a blackjack table in an elegant casino studio, warm cinematic lighting, photorealistic",
    "golden coins and gift boxes bursting with light on a dark purple background, festive bonus concept, 3d render",
    "a cricket ball and bat on fresh green grass at golden hour, stadium lights blurred in the background, photorealistic"
  ]
}
```

`factory/images/prompts.mjs`:

```js
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
```

- [ ] **Step 4: Запустить и увидеть, что проходит**

Run: `npx vitest run tests/image-prompts.test.mjs`
Expected: PASS, 16 тестов.

- [ ] **Step 5: Коммит**

```bash
git add factory/prompts/images.json factory/images/prompts.mjs tests/image-prompts.test.mjs
git diff --cached --name-only
git commit -m "Файл промптов для картинок и случайный выбор без повторов" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Клиент Runware

**Files:**
- Create: `factory/images/runware.mjs`
- Test: `tests/runware-client.test.mjs`

**Interfaces:**
- Consumes: объект настроек формы `readRunwareConfig` из Task 1:
  `{ apiKey, apiUrl, model, guidance, steps }`.
- Produces:
  - `generateImage(request, options)` возвращает `Promise<{ bytes: Buffer, cost: number | undefined, seed: number | undefined }>`.
    - `request` — `{ prompt: string, negativePrompt: string, width: number, height: number }`.
    - `options` — `{ config, fetchFn = fetch, sleep, timeoutMs = 120000 }`.
  - `class RunwareError extends Error` с полем `kind`: `'auth'`, `'balance'`, `'rejected'`
    или `'unavailable'`.
  - `RETRY_DELAYS_MS = [1000, 2000, 4000]`.

- [ ] **Step 1: Написать падающий тест**

`tests/runware-client.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { generateImage, RETRY_DELAYS_MS, RunwareError } from '../factory/images/runware.mjs';

const SENTINEL = 'sentinel-runware-key-client-9b2c';
const CONFIG = {
  apiKey: SENTINEL,
  apiUrl: 'https://runware.test/v1',
  model: 'runware:400@6',
  guidance: 2,
  steps: 4,
};
const REQUEST = { prompt: 'a roulette wheel', negativePrompt: 'text', width: 1024, height: 576 };
const IMAGE_BYTES = Buffer.from('fake webp bytes');

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Answers the way Runware does: one result per task, matched to it by the task's own taskUUID.
function imageFor(task, extra = {}) {
  return {
    taskType: 'imageInference',
    taskUUID: task.taskUUID,
    imageUUID: 'image-uuid',
    imageBase64Data: IMAGE_BYTES.toString('base64'),
    seed: 7,
    cost: 0.0017,
    ...extra,
  };
}

// Plays the given answers in order: a function gets the sent task, an Error is thrown instead.
function scriptedFetch(answers) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    const [task] = JSON.parse(init.body);
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer(task);
  };
  return { fetchFn, calls };
}

const ok = (task) => jsonResponse(200, { data: [imageFor(task)] });

function recordingSleep() {
  const waits = [];
  return { waits, sleep: async (ms) => { waits.push(ms); } };
}

async function failureOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected generateImage to fail');
}

describe('generateImage', () => {
  it('sends one imageInference task with the key in the Authorization header', async () => {
    const { fetchFn, calls } = scriptedFetch([ok]);
    await generateImage(REQUEST, { config: CONFIG, fetchFn });

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe('https://runware.test/v1');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${SENTINEL}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(init.body);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      taskType: 'imageInference',
      model: 'runware:400@6',
      positivePrompt: 'a roulette wheel',
      negativePrompt: 'text',
      width: 1024,
      height: 576,
      steps: 4,
      CFGScale: 2,
      numberResults: 1,
      outputType: 'base64Data',
      outputFormat: 'WEBP',
      outputQuality: 85,
      includeCost: true,
    });
    expect(body[0].taskUUID).toMatch(/^[0-9a-f-]{36}$/);
    // The key travels only in the header, never in the body.
    expect(init.body).not.toContain(SENTINEL);
  });

  it('leaves negativePrompt out when there is none', async () => {
    const { fetchFn, calls } = scriptedFetch([ok]);
    await generateImage({ ...REQUEST, negativePrompt: '' }, { config: CONFIG, fetchFn });
    expect(JSON.parse(calls[0].init.body)[0]).not.toHaveProperty('negativePrompt');
  });

  it('returns the decoded picture, its cost and seed', async () => {
    const { fetchFn } = scriptedFetch([ok]);
    const result = await generateImage(REQUEST, { config: CONFIG, fetchFn });
    expect(result.bytes.equals(IMAGE_BYTES)).toBe(true);
    expect(result.cost).toBe(0.0017);
    expect(result.seed).toBe(7);
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [402, 'balance'],
  ])('turns HTTP %s into a "%s" failure, without retrying', async (status, kind) => {
    const { sleep, waits } = recordingSleep();
    const { fetchFn, calls } = scriptedFetch([
      () => jsonResponse(status, { errors: [{ code: 'x', message: 'no' }] }),
    ]);
    const error = await failureOf(generateImage(REQUEST, { config: CONFIG, fetchFn, sleep }));
    expect(error).toBeInstanceOf(RunwareError);
    expect(error.kind).toBe(kind);
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('turns any other 4xx into a "rejected" failure carrying Runware\'s own message', async () => {
    const { fetchFn } = scriptedFetch([
      () => jsonResponse(400, { errors: [{ code: 'invalidWidth', message: 'Invalid width' }] }),
    ]);
    const error = await failureOf(generateImage(REQUEST, { config: CONFIG, fetchFn }));
    expect(error.kind).toBe('rejected');
    expect(error.message).toContain('400');
    expect(error.message).toContain('Invalid width');
  });

  it('reads an error reported inside a 200 response', async () => {
    const { fetchFn } = scriptedFetch([
      () => jsonResponse(200, { errors: [{ code: 'contentModeration', message: 'Blocked by moderation' }] }),
    ]);
    const error = await failureOf(generateImage(REQUEST, { config: CONFIG, fetchFn }));
    expect(error.kind).toBe('rejected');
    expect(error.message).toContain('Blocked by moderation');
  });

  it('refuses a response that holds no picture for this task', async () => {
    const { fetchFn } = scriptedFetch([
      (task) => jsonResponse(200, { data: [imageFor({ taskUUID: 'someone-else' })] }),
    ]);
    const error = await failureOf(generateImage(REQUEST, { config: CONFIG, fetchFn }));
    expect(error.kind).toBe('rejected');
  });

  it('retries a 503 and succeeds once Runware answers', async () => {
    const { sleep, waits } = recordingSleep();
    const { fetchFn, calls } = scriptedFetch([() => jsonResponse(503, {}), ok]);
    const result = await generateImage(REQUEST, { config: CONFIG, fetchFn, sleep });
    expect(result.bytes.equals(IMAGE_BYTES)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([1000]);
  });

  it('gives up as "unavailable" after three retries', async () => {
    const { sleep, waits } = recordingSleep();
    const { fetchFn, calls } = scriptedFetch([() => jsonResponse(503, {})]);
    const error = await failureOf(generateImage(REQUEST, { config: CONFIG, fetchFn, sleep }));
    expect(error.kind).toBe('unavailable');
    expect(calls).toHaveLength(RETRY_DELAYS_MS.length + 1);
    expect(waits).toEqual([1000, 2000, 4000]);
  });

  it('retries when no answer arrives in time', async () => {
    const { sleep } = recordingSleep();
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const { fetchFn, calls } = scriptedFetch([timeout]);
    const error = await failureOf(generateImage(REQUEST, { config: CONFIG, fetchFn, sleep }));
    expect(error.kind).toBe('unavailable');
    expect(error.message).toContain('нет ответа');
    expect(calls).toHaveLength(4);
  });

  it('retries a network failure', async () => {
    const { sleep } = recordingSleep();
    const { fetchFn } = scriptedFetch([new TypeError('fetch failed'), ok]);
    const result = await generateImage(REQUEST, { config: CONFIG, fetchFn, sleep });
    expect(result.cost).toBe(0.0017);
  });

  it('never puts the key into an error message', async () => {
    const failures = [
      () => jsonResponse(401, {}),
      () => jsonResponse(402, {}),
      () => jsonResponse(400, { errors: [{ message: 'bad' }] }),
      () => jsonResponse(503, {}),
    ];
    for (const failure of failures) {
      const { fetchFn } = scriptedFetch([failure]);
      const error = await failureOf(
        generateImage(REQUEST, { config: CONFIG, fetchFn, sleep: async () => {} }),
      );
      expect(error.message).not.toContain(SENTINEL);
    }
  });
});
```

- [ ] **Step 2: Запустить и увидеть падение**

Run: `npx vitest run tests/runware-client.test.mjs`
Expected: FAIL — `Failed to load url ../factory/images/runware.mjs`.

- [ ] **Step 3: Написать клиент**

`factory/images/runware.mjs`:

```js
import { randomUUID } from 'node:crypto';

// One picture per request, over Runware's REST API: POST a JSON array holding one imageInference
// task, with the key in the Authorization header. The picture comes back inside the response as
// base64 — no second download, and no racing the 7 days a returned URL stays valid.
export const RETRY_DELAYS_MS = Object.freeze([1000, 2000, 4000]);
const DEFAULT_TIMEOUT_MS = 120_000;
const OUTPUT_QUALITY = 85;

// `kind` is what the caller acts on: 'auth' and 'balance' mean every further request would fail the
// same way, 'rejected' is this one picture's problem, 'unavailable' means Runware never answered
// properly even after retrying. Messages never contain the key.
export class RunwareError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'RunwareError';
    this.kind = kind;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 429 and 5xx are Runware being busy or down, not the request being wrong — those are worth
// another try. A 4xx will fail the same way every time.
function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

// Runware reports errors as { errors: [{ code, message }] } — sometimes next to a 200, since one
// response carries per-task results — so the body is read whatever the status was.
function firstErrorMessage(body) {
  const error = Array.isArray(body?.errors) ? body.errors[0] : undefined;
  return typeof error?.message === 'string' ? error.message : '';
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function generateImage(
  request,
  { config, fetchFn = fetch, sleep = defaultSleep, timeoutMs = DEFAULT_TIMEOUT_MS },
) {
  const taskUUID = randomUUID();
  const task = {
    taskType: 'imageInference',
    taskUUID,
    model: config.model,
    positivePrompt: request.prompt,
    width: request.width,
    height: request.height,
    steps: config.steps,
    CFGScale: config.guidance,
    numberResults: 1,
    outputType: 'base64Data',
    outputFormat: 'WEBP',
    outputQuality: OUTPUT_QUALITY,
    includeCost: true,
  };
  if (request.negativePrompt) task.negativePrompt = request.negativePrompt;
  const body = JSON.stringify([task]);

  let lastProblem = '';
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

    let response;
    try {
      response = await fetchFn(config.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastProblem =
        error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? `нет ответа за ${Math.round(timeoutMs / 1000)} с`
          : `сеть недоступна (${error?.message ?? error})`;
      continue;
    }

    const payload = await readJson(response);
    if (response.status === 401 || response.status === 403) {
      throw new RunwareError('auth', 'Runware не принял ключ');
    }
    if (response.status === 402) {
      throw new RunwareError('balance', 'на счёте Runware недостаточно денег');
    }
    if (isRetryableStatus(response.status)) {
      lastProblem = `Runware ответил ${response.status}`;
      continue;
    }
    if (!response.ok) {
      throw new RunwareError(
        'rejected',
        `Runware отклонил запрос (${response.status}: ${firstErrorMessage(payload) || 'без описания'})`,
      );
    }

    const result = Array.isArray(payload?.data)
      ? payload.data.find((item) => item?.taskUUID === taskUUID)
      : undefined;
    if (typeof result?.imageBase64Data !== 'string' || result.imageBase64Data === '') {
      const detail = firstErrorMessage(payload);
      throw new RunwareError('rejected', `Runware не вернул картинку${detail ? ` (${detail})` : ''}`);
    }
    return {
      bytes: Buffer.from(result.imageBase64Data, 'base64'),
      cost: typeof result.cost === 'number' ? result.cost : undefined,
      seed: typeof result.seed === 'number' ? result.seed : undefined,
    };
  }

  throw new RunwareError('unavailable', `Runware недоступен: ${lastProblem}`);
}
```

- [ ] **Step 4: Запустить и увидеть, что проходит**

Run: `npx vitest run tests/runware-client.test.mjs`
Expected: PASS, 14 тестов.

- [ ] **Step 5: Коммит**

```bash
git add factory/images/runware.mjs tests/runware-client.test.mjs
git diff --cached --name-only
git commit -m "Клиент Runware: запрос картинки, разбор ответа и ошибок, повторы" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Генератор недостающих картинок

**Files:**
- Create: `factory/images/generate.mjs`
- Test: `tests/image-generate.test.mjs`

**Interfaces:**
- Consumes:
  - `loadSiteDirInput(dir)` из `src/lib/site-dir.mjs` → `{ input: { brand?, pages: [{ slug, meta, blocks: [{ type, props }] }] }, images, warnings }`.
    Бросает исключение, если файл не читается или в папке нет страниц.
  - `loadPromptFile`, `createPromptPicker`, `fillBrand` из Task 2.
  - `generateImage`, `RunwareError` из Task 3.
- Produces:
  - `generateMissingImages(options)` возвращает `Promise<{ generated: string[], skipped: string[], cost: number }>`.
    - `options`: `{ siteDir, brand = '', config, promptFile, fetchFn = fetch, sleep, random = Math.random, log = () => {} }`.
    - Никогда не бросает исключение: всё, что не получилось, пишется в `log`.
  - `collectImageNames(pages): string[]`.
  - `fileBaseFor(name): string`.
  - `altFor(name, brand): string`.

- [ ] **Step 1: Написать падающий тест**

`tests/image-generate.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  altFor,
  collectImageNames,
  fileBaseFor,
  generateMissingImages,
} from '../factory/images/generate.mjs';

const CONFIG = {
  apiKey: 'sentinel-runware-key-generate-3c7d',
  apiUrl: 'https://runware.test/v1',
  model: 'runware:400@6',
  guidance: 2,
  steps: 4,
  concurrency: 1,
};

let dirs = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

// A site folder on disk, the same shape the factory reads: page files plus optional site.json,
// images.json and files under public/images.
function writeSite({ blocks, site, images, imageFiles = [] }) {
  const dir = tempDir('site-factory-gen-site-');
  writeFileSync(join(dir, 'home.json'), JSON.stringify({ title: 'Home', blocks }));
  if (site) writeFileSync(join(dir, 'site.json'), JSON.stringify(site));
  if (images !== undefined) {
    writeFileSync(join(dir, 'images.json'), typeof images === 'string' ? images : JSON.stringify(images));
  }
  for (const file of imageFiles) {
    mkdirSync(join(dir, 'public', 'images'), { recursive: true });
    writeFileSync(join(dir, 'public', 'images', file), 'already here');
  }
  return dir;
}

function writePrompts(prompts = ['a casino hall for {brand}', 'a cricket stadium']) {
  const dir = tempDir('site-factory-gen-prompts-');
  const file = join(dir, 'images.json');
  writeFileSync(file, JSON.stringify({ width: 1024, height: 576, negativePrompt: 'text', prompts }));
  return file;
}

function heroWith(...content) {
  return [{ type: 'hero', content: [{ type: 'title', h1: 'Hero' }, ...content] }];
}

// Answers like Runware; `failures` maps a call number (1-based) to the HTTP status to fail it with.
function fakeRunware({ failures = {} } = {}) {
  const tasks = [];
  const fetchFn = async (_url, init) => {
    const [task] = JSON.parse(init.body);
    tasks.push(task);
    const status = failures[tasks.length];
    if (status) {
      return new Response(JSON.stringify({ errors: [{ message: `failed with ${status}` }] }), { status });
    }
    const bytes = Buffer.from(`webp-${tasks.length}`).toString('base64');
    return new Response(
      JSON.stringify({ data: [{ taskUUID: task.taskUUID, imageBase64Data: bytes, cost: 0.0017 }] }),
      { status: 200 },
    );
  };
  return { fetchFn, tasks };
}

function readRegistry(siteDir) {
  return JSON.parse(readFileSync(join(siteDir, 'images.json'), 'utf8'));
}

async function run(siteDir, overrides = {}) {
  const lines = [];
  const summary = await generateMissingImages({
    siteDir,
    config: CONFIG,
    promptFile: writePrompts(),
    sleep: async () => {},
    log: (line) => lines.push(line),
    ...overrides,
  });
  return { summary, lines };
}

describe('collectImageNames', () => {
  it('finds a picture wherever an image key sits, and names each one once', () => {
    const pages = [
      {
        blocks: [
          {
            type: 'hero',
            props: {
              content: [
                { image: 'hero' },
                { type: 'image', image: 'hero' },
                { type: 'cards', items: [{ title: 'A', image: 'card-a' }, { title: 'B' }] },
              ],
            },
          },
        ],
      },
      { blocks: [{ type: 'section', props: { content: [{ image: 'card-a' }, { image: 42 }, { image: '' }] } }] },
    ];
    expect(collectImageNames(pages)).toEqual(['hero', 'card-a']);
  });
});

describe('fileBaseFor and altFor', () => {
  it('turns a picture name into a safe file name', () => {
    expect(fileBaseFor('Casino Hero')).toBe('casino-hero');
    expect(fileBaseFor('slots_banner-2')).toBe('slots-banner-2');
    expect(fileBaseFor('Казино')).toBe('image');
  });

  it('builds alt text from the brand and the words of the name', () => {
    expect(altFor('casino-hero', '899OK')).toBe('899OK casino hero');
    expect(altFor('app_screen', '')).toBe('app screen');
  });
});

describe('generateMissingImages', () => {
  it('generates only the pictures images.json does not have yet', async () => {
    const siteDir = writeSite({
      blocks: heroWith({ image: 'casino-hero' }, { image: 'kept' }),
      site: { brand: { name: '899OK' } },
      images: { kept: { src: '/images/kept.png', alt: 'Mine' } },
    });
    const { fetchFn, tasks } = fakeRunware();
    const { summary, lines } = await run(siteDir, { fetchFn });

    expect(tasks).toHaveLength(1);
    expect(summary).toEqual({ generated: ['casino-hero'], skipped: [], cost: 0.0017 });
    expect(readRegistry(siteDir)).toEqual({
      kept: { src: '/images/kept.png', alt: 'Mine' },
      'casino-hero': { src: '/images/casino-hero.webp', alt: '899OK casino hero', width: 1024, height: 576 },
    });
    expect(readFileSync(join(siteDir, 'public', 'images', 'casino-hero.webp'), 'utf8')).toBe('webp-1');
    expect(lines[0]).toBe('Картинки: нужно сгенерировать 1 — casino-hero');
    expect(lines[1]).toMatch(/^Картинка casino-hero готова — \d+\.\d с, \$0\.0017$/);
    expect(lines.at(-1)).toBe('Картинки: готово 1 из 1, потрачено $0.0017');
  });

  it('creates images.json when the site has none', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }) });
    const { fetchFn } = fakeRunware();
    await run(siteDir, { fetchFn });
    expect(Object.keys(readRegistry(siteDir))).toEqual(['hero']);
  });

  it('prefers the brand from the form over the one in site.json', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }), site: { brand: { name: 'Site Brand' } } });
    const { fetchFn, tasks } = fakeRunware();
    await run(siteDir, { fetchFn, brand: 'Form Brand', random: () => 0 });
    expect(readRegistry(siteDir).hero.alt).toBe('Form Brand hero');
    expect(tasks[0].positivePrompt).toBe('a casino hall for Form Brand');
  });

  it('draws a different prompt for each picture while unused ones remain', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'one' }, { image: 'two' }) });
    const { fetchFn, tasks } = fakeRunware();
    await run(siteDir, { fetchFn, random: () => 0 });
    expect(new Set(tasks.map((task) => task.positivePrompt)).size).toBe(2);
  });

  it('never overwrites a file already in public/images', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }), imageFiles: ['hero.webp'] });
    const { fetchFn } = fakeRunware();
    await run(siteDir, { fetchFn });
    expect(readFileSync(join(siteDir, 'public', 'images', 'hero.webp'), 'utf8')).toBe('already here');
    expect(readRegistry(siteDir).hero.src).toBe('/images/hero-2.webp');
    expect(existsSync(join(siteDir, 'public', 'images', 'hero-2.webp'))).toBe(true);
  });

  it('leaves a broken images.json alone and asks Runware for nothing', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }), images: '{ not json' });
    const { fetchFn, tasks } = fakeRunware();
    const { lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(0);
    expect(readFileSync(join(siteDir, 'images.json'), 'utf8')).toBe('{ not json');
    expect(lines.join('\n')).toContain('images.json');
  });

  it('skips generation with a message when there is no key', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }) });
    const { fetchFn, tasks } = fakeRunware();
    const { summary, lines } = await run(siteDir, { fetchFn, config: { ...CONFIG, apiKey: '' } });
    expect(tasks).toHaveLength(0);
    expect(summary.skipped).toEqual(['hero']);
    expect(lines).toEqual(['Картинки: ключ Runware не задан в .env — пропущено 1: hero']);
    expect(existsSync(join(siteDir, 'images.json'))).toBe(false);
  });

  it('does nothing at all when every picture is already there', async () => {
    const siteDir = writeSite({
      blocks: heroWith({ image: 'hero' }),
      images: { hero: { src: '/images/hero.webp', alt: 'Hero' } },
    });
    const { fetchFn, tasks } = fakeRunware();
    const { summary, lines } = await run(siteDir, { fetchFn, config: { ...CONFIG, apiKey: '' } });
    expect(tasks).toHaveLength(0);
    expect(lines).toEqual([]);
    expect(summary).toEqual({ generated: [], skipped: [], cost: 0 });
  });

  it('stops after a refused key instead of failing every remaining picture the same way', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'a' }, { image: 'b' }, { image: 'c' }) });
    const { fetchFn, tasks } = fakeRunware({ failures: { 1: 401 } });
    const { summary, lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(1);
    expect(summary.generated).toEqual([]);
    expect([...summary.skipped].sort()).toEqual(['a', 'b', 'c']);
    expect(lines).toContain('Картинки: Runware не принял ключ — генерация остановлена');
  });

  it('skips one refused picture and carries on with the rest', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'a' }, { image: 'b' }, { image: 'c' }) });
    const { fetchFn, tasks } = fakeRunware({ failures: { 1: 400 } });
    const { summary, lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(3);
    expect(summary.generated).toEqual(['b', 'c']);
    expect(summary.skipped).toEqual(['a']);
    expect(lines.some((line) => line.startsWith('Картинка a: Runware отклонил запрос (400'))).toBe(true);
    expect(lines.at(-1)).toBe('Картинки: готово 2 из 3, потрачено $0.0034');
  });

  it('skips generation when the prompt file is wrong', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }) });
    const promptDir = tempDir('site-factory-gen-bad-prompts-');
    const promptFile = join(promptDir, 'images.json');
    writeFileSync(promptFile, JSON.stringify({ width: 1000, height: 576, prompts: ['x'] }));
    const { fetchFn, tasks } = fakeRunware();
    const { lines } = await run(siteDir, { fetchFn, promptFile });
    expect(tasks).toHaveLength(0);
    expect(lines.join('\n')).toContain('делиться на 16');
  });

  it('reports a site folder it cannot read instead of throwing', async () => {
    const siteDir = tempDir('site-factory-gen-empty-');
    const { fetchFn, tasks } = fakeRunware();
    const { summary, lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(0);
    expect(summary).toEqual({ generated: [], skipped: [], cost: 0 });
    expect(lines[0]).toMatch(/^Картинки: не удалось прочитать сайт/);
  });
});
```

- [ ] **Step 2: Запустить и увидеть падение**

Run: `npx vitest run tests/image-generate.test.mjs`
Expected: FAIL — `Failed to load url ../factory/images/generate.mjs`.

- [ ] **Step 3: Написать генератор**

`factory/images/generate.mjs`:

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSiteDirInput } from '../../src/lib/site-dir.mjs';
import { createPromptPicker, fillBrand, loadPromptFile } from './prompts.mjs';
import { generateImage, RunwareError } from './runware.mjs';

// Fills in the pictures a site's content asks for but its images.json does not have yet: each
// missing name gets one picture from a random prompt, saved under public/images, with its entry
// added to images.json straight away — so a run cut short keeps what it finished, and the next run
// only makes the rest. Nothing already in images.json or public/ is ever changed.
//
// It never throws. Every problem becomes a line in the log and the site builds anyway: a picture
// that did not appear is dropped from the page with a warning, the same as any unknown name.

const IMAGES_FILE = 'images.json';
const IMAGES_URL_DIR = '/images';
// After these, every further request would fail exactly the same way.
const STOPPING_KINDS = new Set(['auth', 'balance']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Every string an `image` key holds anywhere inside a page's blocks — a picture element, or a card
// in a list — which is exactly where the engine looks pictures up (resolveNested in
// src/lib/content.mjs). Names are kept exactly as written, since images.json is matched by that
// exact key.
export function collectImageNames(pages) {
  const names = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isPlainObject(value)) return;
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'image') {
        if (typeof inner === 'string' && inner !== '') names.add(inner);
      } else {
        visit(inner);
      }
    }
  };
  for (const page of Array.isArray(pages) ? pages : []) {
    if (isPlainObject(page)) visit(page.blocks);
  }
  return [...names];
}

export function fileBaseFor(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'image';
}

export function altFor(name, brand) {
  const words = name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [brand, words].filter(Boolean).join(' ');
}

function uniqueFileName(imagesDir, base, taken) {
  let candidate = `${base}.webp`;
  let number = 2;
  while (taken.has(candidate) || existsSync(join(imagesDir, candidate))) {
    candidate = `${base}-${number}.webp`;
    number += 1;
  }
  taken.add(candidate);
  return candidate;
}

// Throws on a file that is not a JSON object: writing our entry into it would mean replacing the
// owner's file with one we made up.
function readRegistry(siteDir) {
  const path = join(siteDir, IMAGES_FILE);
  if (!existsSync(path)) return {};
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`images.json сайта не читается как JSON (${error.message})`);
  }
  if (!isPlainObject(raw)) throw new Error('images.json сайта должен быть объектом');
  return raw;
}

// Read, add, write — synchronously, so two pictures finishing at once cannot interleave and lose
// one another's entry.
function addToRegistry(siteDir, name, entry) {
  const registry = readRegistry(siteDir);
  registry[name] = entry;
  writeFileSync(join(siteDir, IMAGES_FILE), `${JSON.stringify(registry, null, 2)}\n`);
}

const formatSeconds = (ms) => `${(ms / 1000).toFixed(1)} с`;
const formatCost = (cost) => `$${cost.toFixed(4)}`;

export async function generateMissingImages({
  siteDir,
  brand = '',
  config,
  promptFile,
  fetchFn = fetch,
  sleep,
  random = Math.random,
  log = () => {},
}) {
  const summary = { generated: [], skipped: [], cost: 0 };

  let pages;
  let siteBrand = '';
  try {
    const { input } = loadSiteDirInput(siteDir);
    pages = input.pages;
    if (typeof input.brand?.name === 'string') siteBrand = input.brand.name.trim();
  } catch (error) {
    log(`Картинки: не удалось прочитать сайт — ${error.message}. Генерация пропущена`);
    return summary;
  }

  let registry;
  try {
    registry = readRegistry(siteDir);
  } catch (error) {
    log(`Картинки: ${error.message} — генерация пропущена, файл не тронут`);
    return summary;
  }

  const missing = collectImageNames(pages).filter((name) => !Object.hasOwn(registry, name));
  if (missing.length === 0) return summary;

  if (!config?.apiKey) {
    log(`Картинки: ключ Runware не задан в .env — пропущено ${missing.length}: ${missing.join(', ')}`);
    summary.skipped = missing;
    return summary;
  }

  let promptSet;
  try {
    promptSet = loadPromptFile(promptFile);
  } catch (error) {
    log(`Картинки: ${error.message}. Генерация пропущена`);
    summary.skipped = missing;
    return summary;
  }

  const resolvedBrand = String(brand).trim() || siteBrand;
  const pick = createPromptPicker(promptSet.prompts, random);
  const imagesDir = join(siteDir, 'public', 'images');
  const takenFiles = new Set();
  log(`Картинки: нужно сгенерировать ${missing.length} — ${missing.join(', ')}`);

  const queue = [...missing];
  let stopped = false;
  const worker = async () => {
    while (queue.length > 0 && !stopped) {
      const name = queue.shift();
      const started = Date.now();
      try {
        const { bytes, cost } = await generateImage(
          {
            prompt: fillBrand(pick(), resolvedBrand),
            negativePrompt: promptSet.negativePrompt,
            width: promptSet.width,
            height: promptSet.height,
          },
          { config, fetchFn, sleep },
        );
        const fileName = uniqueFileName(imagesDir, fileBaseFor(name), takenFiles);
        mkdirSync(imagesDir, { recursive: true });
        writeFileSync(join(imagesDir, fileName), bytes);
        addToRegistry(siteDir, name, {
          src: `${IMAGES_URL_DIR}/${fileName}`,
          alt: altFor(name, resolvedBrand),
          width: promptSet.width,
          height: promptSet.height,
        });
        summary.generated.push(name);
        if (typeof cost === 'number') summary.cost += cost;
        const costNote = typeof cost === 'number' ? `, ${formatCost(cost)}` : '';
        log(`Картинка ${name} готова — ${formatSeconds(Date.now() - started)}${costNote}`);
      } catch (error) {
        summary.skipped.push(name);
        if (error instanceof RunwareError && STOPPING_KINDS.has(error.kind)) {
          if (!stopped) log(`Картинки: ${error.message} — генерация остановлена`);
          stopped = true;
        } else {
          log(`Картинка ${name}: ${error.message} — пропущена`);
        }
      }
    }
  };

  const workers = Math.max(1, Math.floor(config.concurrency) || 1);
  await Promise.all(Array.from({ length: workers }, worker));
  summary.skipped.push(...queue);

  const spent = summary.cost > 0 ? `, потрачено ${formatCost(summary.cost)}` : '';
  log(`Картинки: готово ${summary.generated.length} из ${missing.length}${spent}`);
  return summary;
}
```

- [ ] **Step 4: Запустить и увидеть, что проходит**

Run: `npx vitest run tests/image-generate.test.mjs`
Expected: PASS, 15 тестов.

- [ ] **Step 5: Коммит**

```bash
git add factory/images/generate.mjs tests/image-generate.test.mjs
git diff --cached --name-only
git commit -m "Генерация недостающих картинок по меткам image" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Генерация перед сборкой в фабрике

**Files:**
- Modify: `factory/server.mjs` — импорты и константы вверху, `startBuild` (строки 159–201),
  `createApp` (строка 273), `/api/generate` (строки 342–363).
- Modify: `factory/public/index.html`, `factory/public/app.js`, `factory/public/styles.css`.
- Test: `tests/server.test.mjs`.

**Interfaces:**
- Consumes: `readRunwareConfig(envFile)` из Task 1; `generateMissingImages(options)` из Task 4.
- Produces:
  - `createApp({ envFile, fetchFn, promptFile } = {})`. По умолчанию `envFile` — `<корень>/.env`,
    `fetchFn` — встроенный `fetch`, `promptFile` — `factory/prompts/images.json`.
  - `startBuild(options, spawnFn)`. В `options` появляются два поля:
    - `prepare?: (log: (line: string) => void) => Promise<unknown>` — выполняется до Astro;
    - `env` — теперь объект **или** функция, которая возвращает объект. Функция вызывается
      непосредственно перед запуском Astro.
  - `POST /api/generate` принимает `skipImages: boolean`.

**Две ловушки, из-за которых задача устроена именно так:**
1. **Деньги.** Тесты сервера многократно собирают `899ok` через `/api/generate`. Без параметров
   `createApp()` читал бы настоящий `.env` и тратил бы деньги на Runware. Поэтому тестовое
   приложение создаётся с несуществующим `.env` и с `fetch`, который бросает ошибку.
2. **Папка `public/`.** Сейчас `PUBLIC_DIR` вычисляется в момент запроса, то есть до генерации.
   У сайта, у которого папки `public/` ещё не было, свежая картинка выпала бы из сборки.
   Поэтому `env` передаётся функцией и вычисляется прямо перед запуском Astro. Тест
   «generates missing pictures before the build…» ниже ловит именно это.

Без `prepare` Astro запускается синхронно, как сейчас. На этом держатся существующие тесты с
поддельным процессом: они посылают `close` сразу после вызова `startBuild`.

- [ ] **Step 1: Написать падающие тесты**

В `tests/server.test.mjs`:

1. В импорт `vitest` в строке 1 добавить `beforeEach`.
2. В импорт `node:fs` (строки 3–11) добавить `mkdtempSync`.
3. Сразу после импортов добавить `import { tmpdir } from 'node:os';`.
4. Строку 26 `server = createApp().listen(0);` заменить так, чтобы тесты никогда не видели
   настоящий ключ и не ходили в сеть:

```js
// The main test app must never see the owner's real .env or reach Runware: it builds 899ok again
// and again, and a real key there would spend real money.
const NO_ENV_FILE = join(tmpdir(), 'site-factory-no-such-dir', '.env');
const refuseNetwork = async () => {
  throw new Error('tests must not reach the network');
};
```

Этот блок ставится перед `beforeAll`. Внутри `beforeAll`:

```js
  server = createApp({ envFile: NO_ENV_FILE, fetchFn: refuseNetwork }).listen(0);
```

5. `readUntilDone` (строки 35–47) получает второй параметр — адрес сервера:

```js
async function readUntilDone(buildId, origin = base) {
  const response = await fetch(`${origin}/api/builds/${buildId}/log`);
```

Остальное тело функции не меняется.

6. Перед `describe('build log line splitting'` добавить:

```js
describe('pictures are generated before the build', () => {
  const siteId = 'image-generation-fixture';
  const siteDir = join('data', 'sites', siteId);
  const SENTINEL = 'sentinel-runware-key-server-4e8b';
  let envDir;
  let pictureServer;
  let pictureBase;
  let requests;
  let respond;

  const picture = (task) =>
    new Response(
      JSON.stringify({
        data: [{ taskUUID: task.taskUUID, imageBase64Data: Buffer.from('fake webp').toString('base64'), cost: 0.001 }],
      }),
      { status: 200 },
    );

  function listFilesRecursively(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? listFilesRecursively(join(dir, entry.name)) : [join(dir, entry.name)],
    );
  }

  async function generate(domain, extra = {}) {
    rmSync(join('output', domain), { recursive: true, force: true });
    const start = await fetch(`${pictureBase}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: siteId, domain, ...extra }),
    }).then((r) => r.json());
    const log = await readUntilDone(start.buildId, pictureBase);
    const status = await fetch(`${pictureBase}/api/builds/${start.buildId}`).then((r) => r.json());
    return { log, status };
  }

  beforeAll(async () => {
    envDir = mkdtempSync(join(tmpdir(), 'site-factory-server-env-'));
    writeFileSync(join(envDir, '.env'), `RUNWARE_API_KEY=${SENTINEL}\n`);
    const fetchFn = async (_url, init) => {
      requests.push(init);
      return respond(JSON.parse(init.body)[0]);
    };
    pictureServer = createApp({ envFile: join(envDir, '.env'), fetchFn }).listen(0);
    await new Promise((resolve) => pictureServer.once('listening', resolve));
    pictureBase = `http://127.0.0.1:${pictureServer.address().port}`;
  });

  // Every test starts from a site whose one picture is missing: no images.json, no public/.
  beforeEach(() => {
    rmSync(siteDir, { recursive: true, force: true });
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(
      join(siteDir, 'home.json'),
      JSON.stringify({
        title: 'Pictures',
        blocks: [{ type: 'hero', content: [{ type: 'title', h1: 'Pictures' }, { image: 'hero-shot' }] }],
      }),
    );
    requests = [];
    respond = picture;
  });

  afterAll(() => {
    pictureServer?.close();
    rmSync(siteDir, { recursive: true, force: true });
    rmSync(envDir, { recursive: true, force: true });
  });

  it('generates missing pictures before the build, and the page shows them', async () => {
    const domain = 'image-generation-test.com';
    try {
      const { log, status } = await generate(domain);
      expect(status.status).toBe('ok');
      expect(requests).toHaveLength(1);
      const ready = log.indexOf('Картинка hero-shot готова');
      expect(ready).toBeGreaterThan(-1);
      expect(ready).toBeLessThan(log.indexOf('[build]'));
      // The site had no public/ folder when the request came in; the build must still see the
      // picture generation just put there.
      expect(readFileSync(join('output', domain, 'index.html'), 'utf8')).toContain(
        'src="/images/hero-shot.webp"',
      );
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });

  it('skips generation entirely when asked to', async () => {
    const domain = 'image-generation-skip-test.com';
    try {
      const { log, status } = await generate(domain, { skipImages: true });
      expect(status.status).toBe('ok');
      expect(requests).toHaveLength(0);
      expect(log).not.toContain('Картинк');
      expect(existsSync(join(siteDir, 'images.json'))).toBe(false);
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });

  it('still builds the site when Runware refuses', async () => {
    const domain = 'image-generation-refused-test.com';
    respond = () =>
      new Response(JSON.stringify({ errors: [{ message: 'no money' }] }), { status: 402 });
    try {
      const { log, status } = await generate(domain);
      expect(log).toContain('на счёте Runware недостаточно денег');
      expect(status.status).toBe('ok');
      expect(existsSync(join('output', domain, 'index.html'))).toBe(true);
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });

  it('keeps the key out of the build process and out of every file of the built site', async () => {
    const domain = 'image-generation-leak-test.com';
    try {
      const { log } = await generate(domain);
      // The key really was used — so its absence below means something.
      expect(requests[0].headers.Authorization).toBe(`Bearer ${SENTINEL}`);
      // The build process gets `{ ...process.env, ...options.env }`: with the key in neither, it
      // never has it.
      expect(Object.values(process.env).some((value) => value?.includes(SENTINEL))).toBe(false);
      expect(log).not.toContain(SENTINEL);
      for (const file of listFilesRecursively(join('output', domain))) {
        expect(readFileSync(file).includes(SENTINEL), `${file} holds the key`).toBe(false);
      }
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });
});

describe('startBuild runs a prepare step first', () => {
  it('logs what prepare says before starting Astro, and reads env only then', async () => {
    const fakeChild = new EventEmitter();
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();
    const order = [];
    let spawnedEnv;
    const build = startBuild(
      {
        domain: '__prepare_step__',
        outDir: '/tmp/__prepare_step__',
        prepare: async (log) => {
          order.push('prepare');
          log('prepared');
        },
        env: () => {
          order.push('env');
          return { MARK: 'late' };
        },
      },
      (_bin, _args, options) => {
        order.push('spawn');
        spawnedEnv = options.env;
        return fakeChild;
      },
    );

    expect(build.status).toBe('running');
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(['prepare', 'env', 'spawn']);
    expect(spawnedEnv.MARK).toBe('late');
    fakeChild.emit('close', 0);
    expect(build.lines).toEqual(['prepared', 'Готово']);
    expect(build.status).toBe('ok');
  });

  it('still starts Astro when prepare fails, with the reason in the log', async () => {
    const fakeChild = new EventEmitter();
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();
    const build = startBuild(
      {
        domain: '__prepare_failure__',
        outDir: '/tmp/__prepare_failure__',
        env: {},
        prepare: async () => {
          throw new Error('boom');
        },
      },
      () => fakeChild,
    );
    await new Promise((resolve) => setImmediate(resolve));
    fakeChild.emit('close', 0);
    expect(build.lines).toEqual(['Подготовка сборки не удалась: boom', 'Готово']);
  });
});
```

- [ ] **Step 2: Запустить и увидеть падение**

Run: `npx vitest run tests/server.test.mjs`
Expected: FAIL. Новые тесты сервера падают: без генерации нет строки «Картинка hero-shot
готова», `requests` пустой. Тесты `startBuild` падают: `prepare` не вызывается. Старые тесты
проходят.

- [ ] **Step 3: Изменить сервер**

В `factory/server.mjs`:

**1. Импорты.** После строки `import { isPageFileName } from '../src/lib/site-dir.mjs';` добавить:

```js
import { readRunwareConfig } from './images/env.mjs';
import { generateMissingImages } from './images/generate.mjs';
```

**2. Константы.** После строки `const PUBLIC_UI_DIR = join(HERE, 'public');` добавить:

```js
const ENV_FILE = join(ROOT, '.env');
const IMAGE_PROMPTS_FILE = join(HERE, 'prompts', 'images.json');
```

**3. `startBuild`.** Функцию целиком (от `export function startBuild(options, spawnFn = spawn) {`
до её закрывающей `}` перед комментарием `// Content is not required to place a page at "/"`)
заменить на:

```js
// Exported for tests only (it lets tests start a build with a fake spawnFn instead of a real
// Astro process). It is not a public entry point: the 409 "already running" guard lives in the
// /api/generate route handler below, not here, so calling this directly skips that check.
//
// `options.prepare`, when given, runs first — generating missing pictures — inside this same
// build record: its lines land in the same log and the domain counts as busy throughout. Whether
// it succeeds or not, Astro runs after it. `options.env` may be a function, called only once
// prepare is done, so the build sees what prepare left on disk (a public/ folder that did not
// exist when the request came in). Without prepare, Astro starts synchronously, exactly as before.
export function startBuild(options, spawnFn = spawn) {
  const build = {
    id: randomUUID(),
    status: 'running',
    domain: options.domain,
    outDir: options.outDir,
    lines: [],
    listeners: new Set(),
  };
  builds.set(build.id, build);

  const runAstro = () => {
    const env = typeof options.env === 'function' ? options.env() : options.env;
    const child = spawnFn(ASTRO_BIN, ['build'], {
      cwd: ROOT,
      env: { ...process.env, ...env },
    });

    // stdout and stderr are independent byte streams, so each needs its own splitter/decoder —
    // sharing one would let a partial multi-byte character from one stream get "completed" with
    // bytes from the other.
    const stdoutSplitter = createLineSplitter((line) => pushLine(build, line));
    const stderrSplitter = createLineSplitter((line) => pushLine(build, line));

    child.stdout.on('data', stdoutSplitter.write);
    child.stderr.on('data', stderrSplitter.write);

    child.on('error', (error) => {
      pushLine(build, `Не удалось запустить сборку: ${error.message}`);
      finishBuild(build, 'failed');
    });

    child.on('close', (code) => {
      // A failed spawn fires both 'error' and 'close'; the 'error' handler above already
      // finished and reported the build, so skip the redundant, confusing second report.
      if (build.status !== 'running') return;

      stdoutSplitter.flush();
      stderrSplitter.flush();
      pushLine(build, code === 0 ? 'Готово' : `Сборка завершилась с кодом ${code}`);
      finishBuild(build, code === 0 ? 'ok' : 'failed');
    });
  };

  if (typeof options.prepare === 'function') {
    Promise.resolve()
      .then(() => options.prepare((line) => pushLine(build, line)))
      .catch((error) => pushLine(build, `Подготовка сборки не удалась: ${error.message}`))
      .then(runAstro);
  } else {
    runAstro();
  }

  return build;
}
```

**4. `createApp`.** Строку `export function createApp() {` заменить на:

```js
// envFile, fetchFn and promptFile exist for tests: they let a test app read a temporary .env and
// answer Runware requests itself, so no test ever sees the owner's real key or spends money.
export function createApp({
  envFile = ENV_FILE,
  fetchFn = fetch,
  promptFile = IMAGE_PROMPTS_FILE,
} = {}) {
```

**5. `/api/generate`.** Блок от `const outDir = join(OUTPUT_DIR, domain);` до
`res.json({ buildId: build.id, domain, outDir });` заменить на:

```js
    const outDir = join(OUTPUT_DIR, domain);
    const sitePublic = join(siteDir, 'public');
    const brand = String(body.brand ?? '');

    // Missing pictures are generated first, unless the form asked for a plain rebuild. The .env is
    // read here, per request, so a key added while the factory is running is picked up without a
    // restart.
    const prepare =
      body.skipImages === true
        ? undefined
        : (log) =>
            generateMissingImages({
              siteDir,
              brand,
              config: readRunwareConfig(envFile),
              promptFile,
              fetchFn,
              log,
            });

    const build = startBuild({
      domain,
      outDir,
      prepare,
      // A function, so PUBLIC_DIR is decided once generation is done: a site that had no public/
      // folder before this build may have one now.
      env: () => ({
        SITE_DIR: siteDir,
        PUBLIC_DIR: existsSync(sitePublic) ? sitePublic : '',
        TEMPLATE: templateInput,
        SCHEME: scheme,
        OUT_DIR: outDir,
        SITE_URL: `https://${domain}`,
        DOMAIN: domain,
        BRAND: brand,
        GEO: String(body.geo ?? ''),
        LOCALE: String(body.locale ?? ''),
        PARTNER_URL: String(body.partnerUrl ?? ''),
      }),
    });

    res.json({ buildId: build.id, domain, outDir });
```

- [ ] **Step 4: Добавить галочку в форму**

**`factory/public/index.html`.** В `<fieldset class="card">` с легендой «Шаблон и контент»,
сразу после строки
`<p class="note">Пустые поля бренда, гео и языка берутся из site.json выбранного сайта</p>`
добавить:

```html
            <label class="check"><input name="skipImages" type="checkbox" /> Без генерации картинок</label>
            <p class="note">Иначе перед сборкой генерируются картинки для меток image, которых нет в images.json</p>
```

**`factory/public/styles.css`.** После блока `input:focus, select:focus { … }` добавить:

```css
/* A checkbox reads as one line with its caption, unlike the stacked text fields above it. */
.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--ink);
}

.check input {
  margin: 0;
  padding: 0;
}
```

**`factory/public/app.js`.** В обработчике `submit` строки

```js
  setStatus('Собираем…');

  try {
    const payload = Object.fromEntries(new FormData(form).entries());
```

заменить на:

```js
  // FormData reports a checkbox as "on" or leaves it out; the server wants a real boolean.
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.skipImages = form.elements.skipImages.checked;
  setStatus(payload.skipImages ? 'Собираем…' : 'Генерируем картинки и собираем…');

  try {
```

- [ ] **Step 5: Запустить и увидеть, что проходит**

Run: `npx vitest run tests/server.test.mjs`
Expected: PASS — все старые тесты и 6 новых.

Run: `npm test`
Expected: PASS, весь набор.

- [ ] **Step 6: Коммит**

```bash
git add factory/server.mjs factory/public/index.html factory/public/app.js factory/public/styles.css tests/server.test.mjs
git diff --cached --name-only
git commit -m "Фабрика генерирует недостающие картинки перед сборкой" -m "Галочка «Без генерации картинок» пропускает этот шаг. Окружение сборки вычисляется после генерации, чтобы сборка видела новую папку public/." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Команда `generate:images` и README

**Files:**
- Create: `scripts/generate-images.mjs`
- Modify: `package.json`, `README.md`, `tests/smoke.test.mjs`
- Test: `tests/generate-images-cli.test.mjs`

**Interfaces:**
- Consumes: `readRunwareConfig` (Task 1), `generateMissingImages` (Task 4).
- Produces: `npm run generate:images -- <папка сайта>`. Код выхода 1, если папка не указана или
  не найдена. Иначе 0.

- [ ] **Step 1: Написать падающий тест**

`tests/generate-images-cli.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// These runs only ever reach cases that need no Runware request — a bad folder name, or a site
// whose pictures are all in place — because the script reads the project's real .env.
function runCli(...args) {
  return spawnSync(process.execPath, [join('scripts', 'generate-images.mjs'), ...args], {
    encoding: 'utf8',
  });
}

describe('npm run generate:images', () => {
  it('asks for a site folder when none is given', () => {
    const result = runCli();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Укажите папку сайта');
  });

  it('refuses a folder that is not in data/sites', () => {
    const result = runCli('../../etc');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('не найдена');
  });

  it('says so when every picture of the site is already in images.json', () => {
    const siteId = 'cli-images-fixture';
    const siteDir = join('data', 'sites', siteId);
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(
      join(siteDir, 'home.json'),
      JSON.stringify({ title: 'Home', blocks: [{ type: 'hero', content: [{ image: 'hero' }] }] }),
    );
    writeFileSync(join(siteDir, 'images.json'), JSON.stringify({ hero: { src: '/images/hero.webp', alt: 'Hero' } }));
    try {
      const result = runCli(siteId);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('все метки уже есть в images.json');
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
    }
  });
});
```

В `tests/smoke.test.mjs` строку

```js
      expect.arrayContaining(['dev', 'test', 'build:site', 'check:matrix']),
```

заменить на

```js
      expect.arrayContaining(['dev', 'test', 'build:site', 'check:matrix', 'generate:images']),
```

- [ ] **Step 2: Запустить и увидеть падение**

Run: `npx vitest run tests/generate-images-cli.test.mjs tests/smoke.test.mjs`
Expected: FAIL. Скрипта нет: `Cannot find module`, код выхода 1 без нужного текста. Smoke:
в `package.json` нет `generate:images`.

- [ ] **Step 3: Написать скрипт и добавить команду**

`scripts/generate-images.mjs`:

```js
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRunwareConfig } from '../factory/images/env.mjs';
import { generateMissingImages } from '../factory/images/generate.mjs';

// Generates a site's missing pictures without building it — the same step the factory runs before
// every build. The brand for alt text and prompts comes from the site's own site.json.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = process.argv[2];

if (!site) {
  console.error('Укажите папку сайта: npm run generate:images -- 899ok');
  process.exit(1);
}

// A plain folder name only: anything with a path separator or a leading dot could step outside
// data/sites.
const siteDir = join(ROOT, 'data', 'sites', site);
if (/[/\\]/.test(site) || site.startsWith('.') || !existsSync(siteDir)) {
  console.error(`Папка сайта «${site}» не найдена в data/sites`);
  process.exit(1);
}

const summary = await generateMissingImages({
  siteDir,
  config: readRunwareConfig(join(ROOT, '.env')),
  promptFile: join(ROOT, 'factory', 'prompts', 'images.json'),
  log: (line) => console.log(line),
});

if (summary.generated.length === 0 && summary.skipped.length === 0) {
  console.log('Картинки: все метки уже есть в images.json');
}
```

В `package.json`, в `scripts`, после строки `"import:sheet": "node scripts/import-sheet.mjs"`
поставить запятую и добавить:

```json
    "generate:images": "node scripts/generate-images.mjs"
```

- [ ] **Step 4: README**

В `README.md` перед строкой `## Тесты` вставить:

````markdown
## Картинки

Картинку на страницу ставит метка `{ "image": "имя" }`. Если такого имени ещё нет в
`images.json` сайта, фабрика перед сборкой сама генерирует картинку через Runware:

- берёт случайный промпт из `factory/prompts/images.json`;
- кладёт файл в `data/sites/<сайт>/public/images/`;
- дописывает `images.json`.

Готовые картинки повторно не генерируются. Галочка «Без генерации картинок» в форме пропускает
этот шаг. Чтобы перегенерировать картинку, удалите её запись из `images.json`.

Ключ Runware хранится в файле `.env` в корне проекта. Этот файл не попадает ни в git, ни в
собранный сайт.

```bash
cp .env.example .env                 # затем вписать RUNWARE_API_KEY
npm run generate:images -- 899ok     # только картинки, без сборки
```

Подробности — в `docs/specs/2026-09-15-image-generation-design.md`.

````

В разделе «Что дальше» слово `медиа-пайплайн` заменить на `генерация логотипа и текстов`.

- [ ] **Step 5: Запустить и увидеть, что проходит**

Run: `npx vitest run tests/generate-images-cli.test.mjs tests/smoke.test.mjs`
Expected: PASS.

Run: `npm test`
Expected: PASS, весь набор.

- [ ] **Step 6: Коммит**

```bash
git add scripts/generate-images.mjs package.json README.md tests/smoke.test.mjs tests/generate-images-cli.test.mjs
git diff --cached --name-only
git commit -m "Команда generate:images и раздел о картинках в README" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## После всех задач

1. Финальное ревью всей ветки.
2. Слияние в `main`.
3. Проверка формы в браузере: галочка на месте, статус меняется.
4. **Настоящий запуск только с разрешения владельца.** Владелец кладёт свой ключ в `.env` в
   основной папке проекта, потом запускается `npm run generate:images -- 899ok` или кнопка
   фабрики. Это списывает деньги с баланса Runware.
