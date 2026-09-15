# Генерация логотипа через Runware: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** перед сборкой фабрика сама делает логотип по названию бренда. Прозрачная надпись
`logo` идёт в шапку. Квадрат `logo-square` 512×512 на градиенте идёт в разметку schema.org
`Organization`, в `og:image` и в иконку сайта.

**Architecture:**
- Ideogram 4.0 рисует надпись, RemBG убирает фон — оба через Runware. Картинка передаётся
  из первой задачи во вторую по `imageUUID`.
- Фабрика средствами `sharp` обрезает прозрачные края и собирает квадрат с градиентом.
- Новый шаг `generateLogo` идёт в том же `prepare` перед сборкой и раньше картинок.
- Движок сам берёт `logo` для шапки, если в `site.json` нет `brand.logo`. При наличии
  `logo-square` он выводит теги в `<head>`.

**Tech Stack:** Node ≥ 22.12 (ESM), Express 5, Astro 7, Vitest 5, `sharp` 0.35, Runware REST API.

**Спецификация:** `docs/specs/2026-09-15-logo-generation-design.md`. Если план с ней расходится,
спросить владельца. Предыдущий этап, картинки, описан в
`docs/specs/2026-09-15-image-generation-design.md`: его правила про ключ и `images.json` действуют
и здесь.

## Global Constraints

**Зависимости и оформление**
- Единственная новая зависимость — `sharp` (`^0.35.4`, уже стоит в `node_modules` через Astro).
  Её нужно записать в `dependencies`. Других новых зависимостей нет.
- Комментарии в коде на английском и объясняют «почему». Сообщения в логе, ошибки и тексты
  интерфейса на русском.
- Каждый модуль держит свои крошечные проверки вроде `isPlainObject` у себя, в общий модуль их не
  выносить: так решил владелец. Логику, а не проверки, не копировать: общее выносится в модуль.

**Ключ и тесты**
- Ключ Runware живёт только в `.env`. Он читается в объект и никогда не попадает в
  `process.env`, в лог, в тексты ошибок и в готовый сайт. Тексты ошибок самого Runware
  очищаются от ключа.
- Тесты не ходят в сеть и не читают настоящий `.env`: `fetch` и путь к `.env` передаются
  параметрами, тестовый ключ имеет вид `sentinel-runware-key-…`. Скрипт `generate-images.mjs`
  берёт путь к `.env` из `RUNWARE_ENV_FILE`.
- Генерация никогда не валит сборку: любая ошибка становится строкой в логе.

**Git и коммиты**
- Никогда не коммитить `data/sites/899ok/home.json`, `data/sites/899ok/images.json`,
  `data/sites/899ok/public/`: это локальные файлы владельца.
- Перед каждым коммитом проверять `git diff --cached --name-only`. В индексе должны быть только
  файлы задачи.
- Коммиты на русском, в конце `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

**Имена и значения**
- В `images.json`: записи `logo` (прозрачный WebP, высота не больше 144 px) и `logo-square`
  (PNG 512×512).
- Файлы кладутся в `public/images/`, существующие не перезаписываются. Новые получают номер:
  `logo-2.webp`.
- В `.env`: `RUNWARE_LOGO_MODEL`, по умолчанию `ideogram:4@0`, и `RUNWARE_BG_MODEL`, по
  умолчанию `runware:109@1`.
- Надпись: задача `imageInference` без `steps`, `CFGScale` и `outputType`, с
  `outputFormat: "PNG"`, `numberResults: 1`, `includeCost: true`.
- Фон: задача `removeBackground` с `inputs.image = imageUUID`, `outputType: "base64Data"`,
  `outputFormat: "PNG"`, `includeCost: true`. Ответ ищется только по `taskUUID`.
- Квадрат: логотип вписан не шире 80% и не выше 60% стороны, диагональный градиент из пары
  цветов `#rrggbb`.

**Тестовые команды**
- Один файл: `npx vitest run tests/<файл>`.
- Весь набор: `npm test`. Перед планом в нём 428 тестов, все зелёные.

---

## Файлы

| Файл | Что делает |
|---|---|
| `factory/images/env.mjs`, `.env.example` | Настройки `logoModel`, `bgModel` |
| `factory/images/runware.mjs` | Общий `runTask`, на нём `generateImage` (как было), `generateLogoArtwork`, `removeBackground` |
| `factory/prompts/logo.json` (новый) | Размер холста, негатив-промпт, стили, градиенты |
| `factory/images/logo-prompts.mjs` (новый) | `loadLogoPromptFile` |
| `factory/images/compose.mjs` (новый) | `makeHeaderLogo`, `makeSquareLogo` на `sharp` |
| `factory/images/registry.mjs` (новый) | `readRegistry`, `addEntries`, `uniqueFileName`, `writeUniqueFile` — вынесены из `generate.mjs` |
| `factory/images/generate.mjs` | Берёт помощники из `registry.mjs`, поведение не меняется |
| `factory/images/logo.mjs` (новый) | `generateLogo` — весь шаг |
| `src/lib/normalize.mjs`, `src/layouts/Base.astro` | Запасной `logo`, поле `brand.square`, теги в `<head>` |
| `factory/server.mjs`, `scripts/generate-images.mjs`, `factory/public/index.html`, `factory/public/app.js` | Логотип перед картинками, текст галочки |
| `package.json`, `package-lock.json` | `sharp` в `dependencies` |
| `README.md`, `docs/content-format.md` | Описание |
| Тесты | `tests/runware-env.test.mjs`, `tests/runware-client.test.mjs`, `tests/logo-prompts.test.mjs` (новый), `tests/compose.test.mjs` (новый), `tests/logo.test.mjs` (новый), `tests/render.test.mjs`, `tests/server.test.mjs`, `tests/generate-images-cli.test.mjs` |

---

### Task 1: Настройки моделей логотипа

**Files:**
- Modify: `factory/images/env.mjs`, `.env.example`
- Test: `tests/runware-env.test.mjs`

**Interfaces:**
- Produces: `readRunwareConfig(envFile)` дополнительно возвращает
  `logoModel: string` и `bgModel: string`. `RUNWARE_DEFAULTS` получает
  `logoModel: 'ideogram:4@0'` и `bgModel: 'runware:109@1'`.

- [ ] **Step 1: Тесты.** В `tests/runware-env.test.mjs`:
  1. В тест `reads every setting from the .env file` добавить в `.env` строки
     `RUNWARE_LOGO_MODEL=ideogram:9@9` и `RUNWARE_BG_MODEL=runware:1@2`, а в ожидаемый объект —
     `logoModel: 'ideogram:9@9', bgModel: 'runware:1@2'`.
  2. Остальные проверки всего объекта берут значения из `...RUNWARE_DEFAULTS` и должны пройти
     сами. Если какая-то перечисляет поля явно, добавить в неё оба поля со значениями по
     умолчанию.
  3. В тест `.env.example lists every setting…` добавить:

```js
    expect(config.logoModel).toBe('ideogram:4@0');
    expect(config.bgModel).toBe('runware:109@1');
```

- [ ] **Step 2: Прогон.** `npx vitest run tests/runware-env.test.mjs`. Ожидается FAIL:
  `logoModel` равен `undefined`.

- [ ] **Step 3: Код.** В `factory/images/env.mjs` добавить в `RUNWARE_DEFAULTS`:

```js
  // The wordmark needs a model that renders text reliably; background removal is a separate,
  // much cheaper model. Both can be swapped in .env without touching code.
  logoModel: 'ideogram:4@0',
  bgModel: 'runware:109@1',
```

  В объект, который возвращает `readRunwareConfig`, после `model`:

```js
    logoModel: text('RUNWARE_LOGO_MODEL') || RUNWARE_DEFAULTS.logoModel,
    bgModel: text('RUNWARE_BG_MODEL') || RUNWARE_DEFAULTS.bgModel,
```

  В `.env.example` в конец:

```ini
# Модель, которая рисует надпись логотипа (умеет писать текст), и модель, которая убирает фон.
RUNWARE_LOGO_MODEL=ideogram:4@0
RUNWARE_BG_MODEL=runware:109@1
```

- [ ] **Step 4: Проверка.** `npx vitest run tests/runware-env.test.mjs` — PASS.

- [ ] **Step 5: Коммит.** `git add factory/images/env.mjs .env.example tests/runware-env.test.mjs`,
  проверить индекс, затем
  `git commit -m "Настройки моделей логотипа и удаления фона" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`.

---

### Task 2: Клиент Runware — надпись и удаление фона

**Files:**
- Modify: `factory/images/runware.mjs`
- Test: `tests/runware-client.test.mjs`

**Interfaces:**
- Consumes: из Task 1 поля настроек `config.logoModel` и `config.bgModel`.
- Produces:
  - `generateImage(request, options)` — без изменений.
  - `generateLogoArtwork({ prompt, negativePrompt, width, height }, { config, fetchFn, sleep, timeoutMs })`
    возвращает `Promise<{ imageUUID: string, cost: number | undefined }>`.
  - `removeBackground(imageUUID, { config, fetchFn, sleep, timeoutMs })` возвращает
    `Promise<{ bytes: Buffer, cost: number | undefined }>`.
  - Ошибки — тот же `RunwareError` с полем `kind`.

- [ ] **Step 1: Тесты.** В `tests/runware-client.test.mjs` в объект `CONFIG` добавить
  `logoModel: 'ideogram:4@0', bgModel: 'runware:109@1'`. В импорт добавить
  `generateLogoArtwork` и `removeBackground`. В конец файла:

```js
describe('generateLogoArtwork', () => {
  const LOGO_REQUEST = { prompt: 'a wordmark that reads "899OK"', negativePrompt: 'extra letters', width: 1536, height: 768 };

  it('asks the logo model for the wordmark without the quality knobs other models manage themselves', async () => {
    const { fetchFn, calls } = scriptedFetch([
      (task) => jsonResponse(200, { data: [{ taskUUID: task.taskUUID, imageUUID: 'art-1', cost: 0.09 }] }),
    ]);
    const result = await generateLogoArtwork(LOGO_REQUEST, { config: CONFIG, fetchFn });

    expect(result).toEqual({ imageUUID: 'art-1', cost: 0.09 });
    const [task] = JSON.parse(calls[0].init.body);
    expect(task).toMatchObject({
      taskType: 'imageInference',
      model: 'ideogram:4@0',
      positivePrompt: 'a wordmark that reads "899OK"',
      negativePrompt: 'extra letters',
      width: 1536,
      height: 768,
      numberResults: 1,
      outputFormat: 'PNG',
      includeCost: true,
    });
    expect(task).not.toHaveProperty('steps');
    expect(task).not.toHaveProperty('CFGScale');
    expect(task).not.toHaveProperty('outputType');
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${SENTINEL}`);
  });

  it('refuses an answer without the picture\'s imageUUID', async () => {
    const { fetchFn } = scriptedFetch([(task) => jsonResponse(200, { data: [{ taskUUID: task.taskUUID }] })]);
    const error = await failureOf(generateLogoArtwork(LOGO_REQUEST, { config: CONFIG, fetchFn }));
    expect(error.kind).toBe('rejected');
  });
});

describe('removeBackground', () => {
  it('hands the wordmark over by its imageUUID and returns the transparent PNG', async () => {
    const png = Buffer.from('fake png with alpha');
    const { fetchFn, calls } = scriptedFetch([
      // Runware's docs show the answer to a removeBackground task named differently from the
      // request, so it is matched by taskUUID alone.
      (task) =>
        jsonResponse(200, {
          data: [{ taskType: 'imageBackgroundRemoval', taskUUID: task.taskUUID, imageBase64Data: png.toString('base64'), cost: 0.001 }],
        }),
    ]);
    const result = await removeBackground('art-1', { config: CONFIG, fetchFn });

    expect(result.bytes.equals(png)).toBe(true);
    expect(result.cost).toBe(0.001);
    const [task] = JSON.parse(calls[0].init.body);
    expect(task).toMatchObject({
      taskType: 'removeBackground',
      model: 'runware:109@1',
      inputs: { image: 'art-1' },
      outputType: 'base64Data',
      outputFormat: 'PNG',
      includeCost: true,
    });
  });

  it('reports a refused payment the same way as for pictures', async () => {
    const { fetchFn } = scriptedFetch([() => jsonResponse(402, { errors: [{ message: 'no money' }] })]);
    const error = await failureOf(removeBackground('art-1', { config: CONFIG, fetchFn }));
    expect(error.kind).toBe('balance');
  });
});
```

- [ ] **Step 2: Прогон.** `npx vitest run tests/runware-client.test.mjs`. Новые тесты падают:
  функций ещё нет. Старые проходят.

- [ ] **Step 3: Код.** В `factory/images/runware.mjs` вынести из `generateImage` цикл запроса в
  общую функцию. Константы, `RunwareError`, `defaultSleep`, `isRetryableStatus`,
  `firstErrorMessage`, `readJson`, `scrubKey` не меняются. Функцию `generateImage` целиком
  заменить на:

```js
// One task, one request: sends it, retries what is worth retrying, and returns the answer that
// carries this task's taskUUID. `hasResult` says whether that answer holds what the caller needs —
// a picture's bytes, or just its imageUUID — so every task shares the same retry, error and
// key-scrubbing rules instead of repeating them.
async function runTask(
  task,
  { config, fetchFn = fetch, sleep = defaultSleep, timeoutMs = DEFAULT_TIMEOUT_MS },
  hasResult,
) {
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
      // Never interpolate error.message here: undici's own message for a header value with a
      // line break or NUL byte quotes the whole invalid header value back, which is the entire
      // "Bearer <key>" this request tried to send. error?.name (e.g. "TypeError") stays key-free.
      lastProblem =
        error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? `нет ответа за ${Math.round(timeoutMs / 1000)} с`
          : `сеть недоступна (${error?.cause?.code ?? error?.name ?? 'неизвестная ошибка'})`;
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
      const detail = scrubKey(firstErrorMessage(payload), config.apiKey) || 'без описания';
      throw new RunwareError('rejected', `Runware отклонил запрос (${response.status}: ${detail})`);
    }

    const result = Array.isArray(payload?.data)
      ? payload.data.find((item) => item?.taskUUID === task.taskUUID)
      : undefined;
    if (!result || !hasResult(result)) {
      const detail = scrubKey(firstErrorMessage(payload), config.apiKey);
      throw new RunwareError('rejected', `Runware не вернул картинку${detail ? ` (${detail})` : ''}`);
    }
    return result;
  }

  throw new RunwareError('unavailable', `Runware недоступен: ${lastProblem}`);
}

const hasImageData = (result) =>
  typeof result.imageBase64Data === 'string' && result.imageBase64Data !== '';
const costOf = (result) => (typeof result.cost === 'number' ? result.cost : undefined);

export async function generateImage(request, options) {
  const task = {
    taskType: 'imageInference',
    taskUUID: randomUUID(),
    model: options.config.model,
    positivePrompt: request.prompt,
    width: request.width,
    height: request.height,
    steps: options.config.steps,
    CFGScale: options.config.guidance,
    numberResults: 1,
    outputType: 'base64Data',
    outputFormat: 'WEBP',
    outputQuality: OUTPUT_QUALITY,
    includeCost: true,
  };
  if (request.negativePrompt) task.negativePrompt = request.negativePrompt;
  const result = await runTask(task, options, hasImageData);
  return {
    bytes: Buffer.from(result.imageBase64Data, 'base64'),
    cost: costOf(result),
    seed: typeof result.seed === 'number' ? result.seed : undefined,
  };
}

// The wordmark comes from a model chosen for rendering text (Ideogram by default). Only the fields
// such models all accept are sent — no steps or CFGScale, which they manage themselves — and the
// picture is not downloaded at all: removeBackground takes it straight from Runware by imageUUID.
export async function generateLogoArtwork(request, options) {
  const task = {
    taskType: 'imageInference',
    taskUUID: randomUUID(),
    model: options.config.logoModel,
    positivePrompt: request.prompt,
    width: request.width,
    height: request.height,
    numberResults: 1,
    outputFormat: 'PNG',
    includeCost: true,
  };
  if (request.negativePrompt) task.negativePrompt = request.negativePrompt;
  const result = await runTask(
    task,
    options,
    (answer) => typeof answer.imageUUID === 'string' && answer.imageUUID !== '',
  );
  return { imageUUID: result.imageUUID, cost: costOf(result) };
}

// Cuts the wordmark out of its plain background. The answer is matched by taskUUID like every
// other: Runware's docs show it named "imageBackgroundRemoval", not the "removeBackground" asked for.
export async function removeBackground(imageUUID, options) {
  const task = {
    taskType: 'removeBackground',
    taskUUID: randomUUID(),
    model: options.config.bgModel,
    inputs: { image: imageUUID },
    outputType: 'base64Data',
    outputFormat: 'PNG',
    includeCost: true,
  };
  const result = await runTask(task, options, hasImageData);
  return { bytes: Buffer.from(result.imageBase64Data, 'base64'), cost: costOf(result) };
}
```

  Комментарий в начале файла про «one picture per request» поправить так, чтобы он говорил
  про одну задачу на запрос.

- [ ] **Step 4: Проверка.** `npx vitest run tests/runware-client.test.mjs` — PASS, старые тесты
  без изменений. Затем `npm test` — всё зелёное.

- [ ] **Step 5: Коммит.** `git add factory/images/runware.mjs tests/runware-client.test.mjs`,
  проверить индекс, затем
  `git commit -m "Клиент Runware: надпись логотипа и удаление фона" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`.

---

### Task 3: Файл промптов логотипа

**Files:**
- Create: `factory/prompts/logo.json`, `factory/images/logo-prompts.mjs`
- Test: `tests/logo-prompts.test.mjs`

**Interfaces:**
- Consumes: `loadPromptFile(path)` из `factory/images/prompts.mjs`. Он проверяет размер, список
  промптов и `negativePrompt` и бросает `Error` с русским текстом.
- Produces: `loadLogoPromptFile(path)` возвращает
  `{ width, height, negativePrompt, prompts: string[], gradients: [string, string][] }` или
  бросает `Error` с путём в тексте.

- [ ] **Step 1: Тест.** Создать `tests/logo-prompts.test.mjs`:

```js
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
```

- [ ] **Step 2: Прогон.** `npx vitest run tests/logo-prompts.test.mjs`. Ожидается FAIL: модуля
  нет.

- [ ] **Step 3: Файлы.** `factory/prompts/logo.json`:

```json
{
  "width": 1536,
  "height": 768,
  "negativePrompt": "misspelled words, extra letters, missing letters, distorted letters, duplicated text, watermark, busy background, scenery",
  "prompts": [
    "a casino logo wordmark that reads \"{brand}\", glossy 3D gold letters with a thin red edge and soft reflections, centered, isolated on a plain white background",
    "a casino logo wordmark that reads \"{brand}\", aged bronze serif letters on an ornate Victorian steampunk plaque with scrolls and small gears, centered, isolated on a plain white background",
    "a casino logo wordmark that reads \"{brand}\", bright neon tube letters in pink and cyan with a soft glow, centered, isolated on a plain black background",
    "a casino logo wordmark that reads \"{brand}\", polished chrome 3D letters with blue highlights, centered, isolated on a plain white background",
    "a casino logo wordmark that reads \"{brand}\", bold red and gold 3D letters with a small crown above the first letter, centered, isolated on a plain white background",
    "a casino logo wordmark that reads \"{brand}\", emerald green glass 3D letters with a gold outline, centered, isolated on a plain white background",
    "a casino logo wordmark that reads \"{brand}\", royal purple 3D letters with a silver bevel and small sparkling stars, centered, isolated on a plain white background",
    "a casino logo wordmark that reads \"{brand}\", fiery orange 3D letters with flame accents, centered, isolated on a plain white background"
  ],
  "gradients": [
    ["#3b1a8c", "#7b3fe4"],
    ["#7a2e0e", "#d9622b"],
    ["#0b3d91", "#1e88e5"],
    ["#0f5132", "#20c997"],
    ["#5c0a2e", "#c2185b"],
    ["#1a1a2e", "#4a4e69"],
    ["#8a6d00", "#ffb800"],
    ["#003c43", "#77b0aa"]
  ]
}
```

`factory/images/logo-prompts.mjs`:

```js
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
```

- [ ] **Step 4: Проверка.** `npx vitest run tests/logo-prompts.test.mjs` — PASS.

- [ ] **Step 5: Коммит.** `git add factory/prompts/logo.json factory/images/logo-prompts.mjs tests/logo-prompts.test.mjs`,
  проверить индекс, затем
  `git commit -m "Файл промптов логотипа: стили и градиенты" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`.

---

### Task 4: Сборка логотипа и квадрата на `sharp`

**Files:**
- Create: `factory/images/compose.mjs`
- Modify: `package.json`, `package-lock.json` (через `npm install`)
- Test: `tests/compose.test.mjs`

**Interfaces:**
- Produces:
  - `makeHeaderLogo(cutoutPng: Buffer)` возвращает
    `Promise<{ bytes: Buffer (WebP), width: number, height: number, trimmed: Buffer (PNG) }>`.
  - `makeSquareLogo(logoBytes: Buffer, [from, to]: [string, string])` возвращает
    `Promise<Buffer (PNG 512×512)>`.
  - Константы `HEADER_LOGO_HEIGHT = 144` и `SQUARE_SIZE = 512`.

- [ ] **Step 1: Зависимость.** `npm install --save sharp@^0.35.4`. После этого `sharp` стоит в
  `dependencies` в `package.json`, `package-lock.json` обновлён.

- [ ] **Step 2: Тест.** Создать `tests/compose.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { HEADER_LOGO_HEIGHT, SQUARE_SIZE, makeHeaderLogo, makeSquareLogo } from '../factory/images/compose.mjs';

// What RemBG hands back: an opaque mark in the middle of a transparent canvas.
async function cutout({ canvas = [1536, 768], mark = [900, 300], colour = '#ffb800' } = {}) {
  const [markWidth, markHeight] = mark;
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${markWidth}" height="${markHeight}"><rect width="100%" height="100%" rx="24" fill="${colour}"/></svg>`,
  );
  return sharp({ create: { width: canvas[0], height: canvas[1], channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: svg, gravity: 'centre' }])
    .png()
    .toBuffer();
}

async function pixel(bytes, left, top) {
  const raw = await sharp(bytes).extract({ left, top, width: 1, height: 1 }).raw().toBuffer();
  return [...raw].slice(0, 3);
}

describe('makeHeaderLogo', () => {
  it('cuts away the transparent margin and shrinks the mark to the header height', async () => {
    const logo = await makeHeaderLogo(await cutout());
    const meta = await sharp(logo.bytes).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.hasAlpha).toBe(true);
    expect([logo.width, logo.height]).toEqual([432, HEADER_LOGO_HEIGHT]);
    expect([meta.width, meta.height]).toEqual([432, HEADER_LOGO_HEIGHT]);
    expect(await sharp(logo.trimmed).metadata().then((m) => [m.width, m.height])).toEqual([900, 300]);
  });

  it('never enlarges a mark smaller than the header height', async () => {
    const logo = await makeHeaderLogo(await cutout({ mark: [300, 100] }));
    expect([logo.width, logo.height]).toEqual([300, 100]);
  });
});

describe('makeSquareLogo', () => {
  it('centres the logo on a diagonal gradient', async () => {
    const { trimmed } = await makeHeaderLogo(await cutout());
    const square = await makeSquareLogo(trimmed, ['#3b1a8c', '#7b3fe4']);
    const meta = await sharp(square).metadata();
    expect(meta.format).toBe('png');
    expect([meta.width, meta.height]).toEqual([SQUARE_SIZE, SQUARE_SIZE]);
    expect(await pixel(square, 0, 0)).toEqual([59, 26, 140]);
    expect(await pixel(square, 256, 256)).toEqual([255, 184, 0]);
  });

  it('keeps the logo within 80% of the width', async () => {
    const { trimmed } = await makeHeaderLogo(await cutout({ mark: [1400, 100] }));
    const square = await makeSquareLogo(trimmed, ['#000000', '#000000']);
    // 80% of 512 is 410, so the mark ends at column 461 at the latest; column 470 is background.
    expect(await pixel(square, 470, 256)).toEqual([0, 0, 0]);
    expect(await pixel(square, 60, 256)).toEqual([255, 184, 0]);
  });
});
```

- [ ] **Step 3: Прогон.** `npx vitest run tests/compose.test.mjs`. Ожидается FAIL: модуля нет.

- [ ] **Step 4: Код.** `factory/images/compose.mjs`:

```js
import sharp from 'sharp';

// Turns the transparent PNG RemBG returns into the two pictures a site needs. Pure image work — no
// network, no files — so it is tested on pictures the test draws itself.
export const HEADER_LOGO_HEIGHT = 144;
export const SQUARE_SIZE = 512;
// The logo sits inside this share of the square, so it never touches the edges and a wide wordmark
// does not crowd a small favicon.
const SQUARE_LOGO_MAX_WIDTH = 0.8;
const SQUARE_LOGO_MAX_HEIGHT = 0.6;

// RemBG keeps the whole canvas and only makes the background transparent, so the lettering sits in
// a wide empty margin; shown as is, the header would draw it tiny. Trimming leaves the lettering
// itself. 144 px is four times the header's 36 px, so it stays sharp on dense screens, and a mark
// already smaller than that is left at its own size rather than blown up. The trimmed PNG is handed
// back too: the square is drawn from it, at full resolution.
export async function makeHeaderLogo(cutoutPng) {
  const trimmed = await sharp(cutoutPng).trim().png().toBuffer();
  const { data, info } = await sharp(trimmed)
    .resize({ height: HEADER_LOGO_HEIGHT, withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height, trimmed };
}

// The gradient is drawn as SVG and rasterised by sharp. The two colours come from logo.json, which
// only lets through #rrggbb, so nothing but a colour ever lands inside the SVG.
export async function makeSquareLogo(logoBytes, [from, to]) {
  const gradient = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SQUARE_SIZE}" height="${SQUARE_SIZE}">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
      `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );
  const fitted = await sharp(logoBytes)
    .resize({
      width: Math.round(SQUARE_SIZE * SQUARE_LOGO_MAX_WIDTH),
      height: Math.round(SQUARE_SIZE * SQUARE_LOGO_MAX_HEIGHT),
      fit: 'inside',
    })
    .toBuffer();
  return sharp(gradient).composite([{ input: fitted, gravity: 'centre' }]).png().toBuffer();
}
```

- [ ] **Step 5: Проверка.** `npx vitest run tests/compose.test.mjs` — PASS. Если значение
  пикселя на краю градиента отличается на 1–2 единицы из-за сглаживания, это расхождение
  описать в отчёте, а не ослаблять проверку молча. Затем `npm test` — всё зелёное.

- [ ] **Step 6: Коммит.** `git add factory/images/compose.mjs tests/compose.test.mjs package.json package-lock.json`,
  проверить индекс, затем
  `git commit -m "Логотип для шапки и квадрат на градиенте через sharp" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`.

---

### Task 5: Шаг «логотип» и общий модуль `images.json`

**Files:**
- Create: `factory/images/registry.mjs`, `factory/images/logo.mjs`
- Modify: `factory/images/generate.mjs` (только импорт помощников, поведение прежнее)
- Test: `tests/logo.test.mjs`. `tests/image-generate.test.mjs` должен пройти без изменений.

**Interfaces:**
- Consumes:
  - `loadSiteDirInput(dir)` из `src/lib/site-dir.mjs` → `{ input: { brand?, … } }`, бросает
    исключение для нечитаемой папки;
  - `loadLogoPromptFile` (Task 3);
  - `generateLogoArtwork`, `removeBackground`, `RunwareError` (Task 2);
  - `makeHeaderLogo`, `makeSquareLogo` (Task 4).
- Produces:
  - `factory/images/registry.mjs`:
    - `readRegistry(siteDir): object` — бросает исключение, если файл не JSON или не объект;
    - `addEntries(siteDir, entries: object): void`;
    - `uniqueFileName(imagesDir, base, taken: Set, ext = '.webp'): string`;
    - `writeUniqueFile(imagesDir, fileName, base, taken, bytes, ext = '.webp'): string`
      (записывает с флагом `wx`).
  - `factory/images/logo.mjs`:
    - `generateLogo({ siteDir, brand = '', config, promptFile, fetchFn = fetch, sleep, random = Math.random, log = () => {} })`
      возвращает `Promise<{ generated: boolean, cost: number }>` и никогда не бросает;
    - `LOGO_NAME = 'logo'`, `SQUARE_NAME = 'logo-square'`.

- [ ] **Step 1: Вынести помощники.** Создать `factory/images/registry.mjs`. Перенести в него из
  `generate.mjs`:
  - `readRegistry` без изменений;
  - `uniqueFileName` и `writeUniqueFile` с дополнительным последним параметром
    `ext = '.webp'` вместо зашитого `.webp`;
  - `MAX_WRITE_ATTEMPTS`;
  - `IMAGES_FILE`.

  Комментарии переносятся вместе с кодом. Функцию `addToRegistry` заменить на `addEntries`:

```js
// Read, merge, write — synchronously, so two runs finishing at once cannot interleave and lose one
// another's entries. Several entries land in one write, so a logo and its square never end up in
// images.json one without the other.
export function addEntries(siteDir, entries) {
  const registry = readRegistry(siteDir);
  Object.assign(registry, entries);
  writeFileSync(join(siteDir, IMAGES_FILE), `${JSON.stringify(registry, null, 2)}\n`);
}
```

  В `generate.mjs` импортировать всё это из `./registry.mjs`. Вызов
  `addToRegistry(siteDir, name, {...})` заменить на `addEntries(siteDir, { [name]: {...} })`.
  Проверить, что имя `__proto__` до этого вызова по-прежнему не доходит: фильтр в `generate.mjs`
  стоит раньше.

  Прогнать `npx vitest run tests/image-generate.test.mjs`: должен пройти **без правок тестов**.

- [ ] **Step 2: Тест шага.** Создать `tests/logo.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { generateLogo } from '../factory/images/logo.mjs';

const SENTINEL = 'sentinel-runware-key-logo-6a2f';
const CONFIG = {
  apiKey: SENTINEL,
  apiKeyInvalid: false,
  apiUrl: 'https://runware.test/v1',
  model: 'runware:400@6',
  logoModel: 'ideogram:4@0',
  bgModel: 'runware:109@1',
  guidance: 2,
  steps: 4,
  concurrency: 1,
};
const PROMPT_FILE = join('factory', 'prompts', 'logo.json');

let dirs = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function writeSite({ site, images, files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'site-factory-logo-site-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'home.json'), JSON.stringify({ title: 'Home', blocks: [] }));
  if (site) writeFileSync(join(dir, 'site.json'), JSON.stringify(site));
  if (images !== undefined) {
    writeFileSync(join(dir, 'images.json'), typeof images === 'string' ? images : JSON.stringify(images));
  }
  for (const [name, bytes] of Object.entries(files)) {
    mkdirSync(join(dir, 'public', 'images'), { recursive: true });
    writeFileSync(join(dir, 'public', 'images', name), bytes);
  }
  return dir;
}

async function cutoutPng() {
  const mark = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="100%" height="100%" rx="24" fill="#ffb800"/></svg>');
  return sharp({ create: { width: 1536, height: 768, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toBuffer();
}

// Answers like Runware: the wordmark task with an imageUUID, the removal task with the cut-out PNG.
// `fail` maps a taskType to an HTTP status to fail that task with.
function fakeRunware({ cutout, fail = {} } = {}) {
  const tasks = [];
  const fetchFn = async (_url, init) => {
    const [task] = JSON.parse(init.body);
    tasks.push(task);
    const status = fail[task.taskType];
    if (status) return new Response(JSON.stringify({ errors: [{ message: `failed with ${status}` }] }), { status });
    if (task.taskType === 'imageInference') {
      return new Response(JSON.stringify({ data: [{ taskUUID: task.taskUUID, imageUUID: 'art-1', cost: 0.09 }] }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ data: [{ taskType: 'imageBackgroundRemoval', taskUUID: task.taskUUID, imageBase64Data: cutout.toString('base64'), cost: 0.001 }] }),
      { status: 200 },
    );
  };
  return { fetchFn, tasks };
}

function registryOf(siteDir) {
  return JSON.parse(readFileSync(join(siteDir, 'images.json'), 'utf8'));
}

async function run(siteDir, overrides = {}) {
  const lines = [];
  const summary = await generateLogo({
    siteDir,
    config: CONFIG,
    promptFile: PROMPT_FILE,
    sleep: async () => {},
    random: () => 0,
    log: (line) => lines.push(line),
    ...overrides,
  });
  return { summary, lines };
}

describe('generateLogo', () => {
  it('makes the header logo and the square in one go, and records both', async () => {
    const siteDir = writeSite({ site: { brand: { name: '899OK' } }, images: { hero: { src: '/images/hero.webp', alt: 'Hero' } } });
    const { fetchFn, tasks } = fakeRunware({ cutout: await cutoutPng() });
    const { summary, lines } = await run(siteDir, { fetchFn });

    expect(tasks.map((task) => task.taskType)).toEqual(['imageInference', 'removeBackground']);
    expect(tasks[0].positivePrompt).toContain('reads "899OK"');
    expect(tasks[1].inputs).toEqual({ image: 'art-1' });
    // 0.09 + 0.001 is not exactly 0.091 in floating point, so the sum is compared, not matched.
    expect(summary.generated).toBe(true);
    expect(summary.cost).toBeCloseTo(0.091, 10);

    const registry = registryOf(siteDir);
    expect(registry.hero).toEqual({ src: '/images/hero.webp', alt: 'Hero' });
    expect(registry.logo).toEqual({ src: '/images/logo.webp', alt: '899OK', width: 432, height: 144 });
    expect(registry['logo-square']).toEqual({ src: '/images/logo-square.png', alt: '899OK logo', width: 512, height: 512 });
    expect(await sharp(join(siteDir, 'public', 'images', 'logo.webp')).metadata().then((m) => m.hasAlpha)).toBe(true);
    expect(await sharp(join(siteDir, 'public', 'images', 'logo-square.png')).metadata().then((m) => [m.width, m.height])).toEqual([512, 512]);
    expect(lines[0]).toBe('Логотип: делаю для «899OK»');
    expect(lines.at(-1)).toMatch(/^Логотип готов — \d+\.\d с, \$0\.0910$/);
  });

  it('takes the brand from the form over site.json', async () => {
    const siteDir = writeSite({ site: { brand: { name: 'Site Brand' } } });
    const { fetchFn, tasks } = fakeRunware({ cutout: await cutoutPng() });
    await run(siteDir, { fetchFn, brand: 'Form Brand' });
    expect(tasks[0].positivePrompt).toContain('reads "Form Brand"');
    expect(registryOf(siteDir).logo.alt).toBe('Form Brand');
  });

  it('leaves a site with its own logo in site.json alone', async () => {
    const siteDir = writeSite({ site: { brand: { name: 'Own', logo: 'mine' } } });
    const { fetchFn, tasks } = fakeRunware({ cutout: await cutoutPng() });
    const { lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(0);
    expect(lines).toEqual([]);
  });

  it('does nothing when both pictures are already recorded', async () => {
    const siteDir = writeSite({
      site: { brand: { name: 'Done' } },
      images: { logo: { src: '/images/logo.webp', alt: 'Done' }, 'logo-square': { src: '/images/logo-square.png', alt: 'Done logo' } },
    });
    const { fetchFn, tasks } = fakeRunware({ cutout: await cutoutPng() });
    const { lines } = await run(siteDir, { fetchFn, config: { ...CONFIG, apiKey: '' } });
    expect(tasks).toHaveLength(0);
    expect(lines).toEqual([]);
  });

  it('rebuilds a missing square from the existing logo for free, even without a key', async () => {
    const logo = await sharp(await cutoutPng()).trim().webp().toBuffer();
    const siteDir = writeSite({
      site: { brand: { name: 'Keep' } },
      images: { logo: { src: '/images/logo.webp', alt: 'Keep' } },
      files: { 'logo.webp': logo },
    });
    const { fetchFn, tasks } = fakeRunware({ cutout: await cutoutPng() });
    const { lines } = await run(siteDir, { fetchFn, config: { ...CONFIG, apiKey: '' } });
    expect(tasks).toHaveLength(0);
    expect(registryOf(siteDir)['logo-square']).toEqual({ src: '/images/logo-square.png', alt: 'Keep logo', width: 512, height: 512 });
    expect(registryOf(siteDir).logo).toEqual({ src: '/images/logo.webp', alt: 'Keep' });
    expect(lines).toEqual(['Логотип: квадрат собран из готового логотипа']);
  });

  it('cannot rebuild the square from a logo that is not a local file', async () => {
    const siteDir = writeSite({
      site: { brand: { name: 'Remote' } },
      images: { logo: { src: 'https://cdn.example.com/logo.png', alt: 'Remote' } },
    });
    const { lines } = await run(siteDir, { fetchFn: fakeRunware({ cutout: await cutoutPng() }).fetchFn });
    expect(existsSync(join(siteDir, 'public'))).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Логотип: квадрат не собран — /);
  });

  it('never overwrites a file already sitting under the logo\'s name', async () => {
    const siteDir = writeSite({ site: { brand: { name: 'Taken' } }, files: { 'logo.webp': 'not mine to touch' } });
    const { fetchFn } = fakeRunware({ cutout: await cutoutPng() });
    await run(siteDir, { fetchFn });
    expect(readFileSync(join(siteDir, 'public', 'images', 'logo.webp'), 'utf8')).toBe('not mine to touch');
    expect(registryOf(siteDir).logo.src).toBe('/images/logo-2.webp');
  });

  it('skips a site with no brand name anywhere, asking nothing', async () => {
    const siteDir = writeSite();
    const { fetchFn, tasks } = fakeRunware({ cutout: await cutoutPng() });
    const { lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(0);
    expect(lines).toEqual(['Логотип: нет названия бренда — пропущен']);
  });

  it.each([
    [{ apiKey: '' }, 'Логотип: ключ Runware не задан в .env — пропущен'],
    [{ apiKey: '', apiKeyInvalid: true }, 'Логотип: ключ Runware в .env записан неверно (недопустимые символы (пробелы, переносы строк, не-ASCII)) — пропущен'],
  ])('skips without a usable key: %j', async (keyFields, line) => {
    const siteDir = writeSite({ site: { brand: { name: 'NoKey' } } });
    const { fetchFn, tasks } = fakeRunware({ cutout: await cutoutPng() });
    const { lines } = await run(siteDir, { fetchFn, config: { ...CONFIG, ...keyFields } });
    expect(tasks).toHaveLength(0);
    expect(lines).toEqual([line]);
  });

  it('writes nothing when background removal fails, but still reports what the wordmark cost', async () => {
    const siteDir = writeSite({ site: { brand: { name: 'Half' } } });
    const { fetchFn } = fakeRunware({ cutout: await cutoutPng(), fail: { removeBackground: 400 } });
    const { summary, lines } = await run(siteDir, { fetchFn });
    expect(summary).toEqual({ generated: false, cost: 0.09 });
    expect(existsSync(join(siteDir, 'images.json'))).toBe(false);
    expect(existsSync(join(siteDir, 'public', 'images', 'logo.webp'))).toBe(false);
    expect(lines.at(-1)).toMatch(/^Логотип: Runware отклонил запрос \(400: failed with 400\) — пропущен, потрачено \$0\.0900$/);
  });

  it('never puts the key into a log line', async () => {
    const siteDir = writeSite({ site: { brand: { name: 'Leak' } } });
    const { fetchFn } = fakeRunware({ cutout: await cutoutPng(), fail: { imageInference: 401 } });
    const { lines } = await run(siteDir, { fetchFn });
    expect(lines.join('\n')).not.toContain(SENTINEL);
    expect(lines.at(-1)).toBe('Логотип: Runware не принял ключ — пропущен');
  });

  it('leaves a broken images.json alone', async () => {
    const siteDir = writeSite({ site: { brand: { name: 'Broken' } }, images: '[]' });
    const { fetchFn, tasks } = fakeRunware({ cutout: await cutoutPng() });
    const { lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(0);
    expect(readFileSync(join(siteDir, 'images.json'), 'utf8')).toBe('[]');
    expect(lines[0]).toMatch(/^Логотип: images\.json сайта должен быть объектом/);
  });
});
```

- [ ] **Step 3: Прогон.** `npx vitest run tests/logo.test.mjs`. Ожидается FAIL: модуля нет.

- [ ] **Step 4: Код.** `factory/images/logo.mjs`:

```js
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSiteDirInput } from '../../src/lib/site-dir.mjs';
import { fillBrand } from './prompts.mjs';
import { loadLogoPromptFile } from './logo-prompts.mjs';
import { generateLogoArtwork, removeBackground } from './runware.mjs';
import { makeHeaderLogo, makeSquareLogo } from './compose.mjs';
import { addEntries, readRegistry, uniqueFileName, writeUniqueFile } from './registry.mjs';

// Makes a site's logo before its build, when the site has none: the brand name drawn by a model
// chosen for lettering, its background removed, then trimmed into the header logo and set on a
// gradient square for schema.org, og:image and the favicon (see
// docs/specs/2026-09-15-logo-generation-design.md). Like the picture step, it never throws — every
// problem is one log line, and the site builds regardless.
export const LOGO_NAME = 'logo';
export const SQUARE_NAME = 'logo-square';
const IMAGES_URL_DIR = '/images';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const formatSeconds = (ms) => `${(ms / 1000).toFixed(1)} с`;
const formatCost = (cost) => `$${cost.toFixed(4)}`;

function pickGradient(gradients, random) {
  const index = Math.min(Math.floor(random() * gradients.length), gradients.length - 1);
  return gradients[index];
}

// Only a file the site itself ships can be rebuilt into a square: a remote logo would mean a
// download, and a missing file has nothing to rebuild from.
function localLogoPath(siteDir, entry) {
  const src = isPlainObject(entry) ? textOf(entry.src) : '';
  if (!src.startsWith(`${IMAGES_URL_DIR}/`) || src.includes('..')) return null;
  const path = join(siteDir, 'public', src);
  return existsSync(path) ? path : null;
}

async function rebuildSquare({ siteDir, registry, brand, promptFile, random, log }) {
  try {
    const path = localLogoPath(siteDir, registry[LOGO_NAME]);
    if (!path) throw new Error('у записи logo нет локального файла в public/images');
    const { gradients } = loadLogoPromptFile(promptFile);
    const square = await makeSquareLogo(readFileSync(path), pickGradient(gradients, random));
    const imagesDir = join(siteDir, 'public', 'images');
    const taken = new Set();
    const squareName = writeUniqueFile(imagesDir, uniqueFileName(imagesDir, SQUARE_NAME, taken, '.png'), SQUARE_NAME, taken, square, '.png');
    addEntries(siteDir, {
      [SQUARE_NAME]: { src: `${IMAGES_URL_DIR}/${squareName}`, alt: [brand, 'logo'].filter(Boolean).join(' '), width: 512, height: 512 },
    });
    log('Логотип: квадрат собран из готового логотипа');
  } catch (error) {
    log(`Логотип: квадрат не собран — ${error.message}`);
  }
}

export async function generateLogo({
  siteDir,
  brand = '',
  config,
  promptFile,
  fetchFn = fetch,
  sleep,
  random = Math.random,
  log = () => {},
}) {
  const summary = { generated: false, cost: 0 };

  let siteBrand = '';
  try {
    const { input } = loadSiteDirInput(siteDir);
    const brandInput = isPlainObject(input.brand) ? input.brand : {};
    // A logo the owner named in site.json is theirs; the factory makes one only for a site without.
    if (textOf(brandInput.logo) !== '') return summary;
    siteBrand = textOf(brandInput.name);
  } catch (error) {
    log(`Логотип: не удалось прочитать сайт — ${error.message}. Пропущен`);
    return summary;
  }

  let registry;
  try {
    registry = readRegistry(siteDir);
  } catch (error) {
    log(`Логотип: ${error.message} — пропущен, файл не тронут`);
    return summary;
  }

  const resolvedBrand = textOf(String(brand)) || siteBrand;
  const hasLogo = Object.hasOwn(registry, LOGO_NAME);
  if (hasLogo && Object.hasOwn(registry, SQUARE_NAME)) return summary;
  if (hasLogo) {
    await rebuildSquare({ siteDir, registry, brand: resolvedBrand, promptFile, random, log });
    return summary;
  }

  if (resolvedBrand === '') {
    log('Логотип: нет названия бренда — пропущен');
    return summary;
  }
  if (!config?.apiKey) {
    const reason = config?.apiKeyInvalid
      ? 'ключ Runware в .env записан неверно (недопустимые символы (пробелы, переносы строк, не-ASCII))'
      : 'ключ Runware не задан в .env';
    log(`Логотип: ${reason} — пропущен`);
    return summary;
  }

  let promptSet;
  try {
    promptSet = loadLogoPromptFile(promptFile);
  } catch (error) {
    log(`Логотип: ${error.message}. Пропущен`);
    return summary;
  }

  const imagesDir = join(siteDir, 'public', 'images');
  try {
    // Before anything is paid for: a folder that cannot be created means nothing could be saved.
    mkdirSync(imagesDir, { recursive: true });
  } catch (error) {
    log(`Логотип: ${error.message} — пропущен`);
    return summary;
  }

  log(`Логотип: делаю для «${resolvedBrand}»`);
  const started = Date.now();
  const promptIndex = Math.min(Math.floor(random() * promptSet.prompts.length), promptSet.prompts.length - 1);
  try {
    const artwork = await generateLogoArtwork(
      {
        prompt: fillBrand(promptSet.prompts[promptIndex], resolvedBrand),
        negativePrompt: promptSet.negativePrompt,
        width: promptSet.width,
        height: promptSet.height,
      },
      { config, fetchFn, sleep },
    );
    if (typeof artwork.cost === 'number') summary.cost += artwork.cost;
    const cutout = await removeBackground(artwork.imageUUID, { config, fetchFn, sleep });
    if (typeof cutout.cost === 'number') summary.cost += cutout.cost;

    // Both pictures are made in memory first and written only once both exist, so a failure
    // anywhere leaves no half-made logo on disk.
    const header = await makeHeaderLogo(cutout.bytes);
    const square = await makeSquareLogo(header.trimmed, pickGradient(promptSet.gradients, random));
    const taken = new Set();
    const logoName = writeUniqueFile(imagesDir, uniqueFileName(imagesDir, LOGO_NAME, taken, '.webp'), LOGO_NAME, taken, header.bytes, '.webp');
    const squareName = writeUniqueFile(imagesDir, uniqueFileName(imagesDir, SQUARE_NAME, taken, '.png'), SQUARE_NAME, taken, square, '.png');
    addEntries(siteDir, {
      [LOGO_NAME]: { src: `${IMAGES_URL_DIR}/${logoName}`, alt: resolvedBrand, width: header.width, height: header.height },
      [SQUARE_NAME]: { src: `${IMAGES_URL_DIR}/${squareName}`, alt: `${resolvedBrand} logo`, width: 512, height: 512 },
    });
    summary.generated = true;
    log(`Логотип готов — ${formatSeconds(Date.now() - started)}, ${formatCost(summary.cost)}`);
  } catch (error) {
    const spent = summary.cost > 0 ? `, потрачено ${formatCost(summary.cost)}` : '';
    log(`Логотип: ${error.message} — пропущен${spent}`);
  }
  return summary;
}
```

  На заметку: если `writeUniqueFile` записал `logo.webp`, а квадрат записать не удалось,
  останется один файл без записи в `images.json`. Это допустимо: он ни на что не ссылается и
  ничего не ломает. Лог при этом честно говорит «пропущен». Отдельный тест не нужен.

- [ ] **Step 5: Проверка.** `npx vitest run tests/logo.test.mjs tests/image-generate.test.mjs` —
  PASS. Если какое-то ожидание текста в тесте расходится с кодом плана, остановиться и
  сообщить, а не подгонять. Затем `npm test` — всё зелёное.

- [ ] **Step 6: Коммит.** `git add factory/images/registry.mjs factory/images/logo.mjs factory/images/generate.mjs tests/logo.test.mjs`,
  проверить индекс, затем
  `git commit -m "Шаг «логотип»: надпись, удаление фона, логотип для шапки и квадрат" -m "Работа с images.json вынесена в registry.mjs и общая с картинками." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`.

---

### Task 6: Движок — логотип по умолчанию и теги в `<head>`

**Files:**
- Modify: `src/lib/normalize.mjs` (`resolveLogo` и объект `brand`), `src/layouts/Base.astro`
  (frontmatter и `<head>`)
- Test: `tests/render.test.mjs`

**Interfaces:**
- Produces: `site.brand.logo` — если в `site.json` нет `brand.logo`, берётся картинка `logo`
  из `images.json`. Новое поле `site.brand.square` — картинка `logo-square` или `null`. Оба
  без предупреждений, если картинки нет.

- [ ] **Step 1: Тесты.** В `tests/render.test.mjs` после `describe('a logo that does not resolve'…)`
  добавить:

```js
describe('the generated logo and its square', () => {
  let dir;
  let html;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'site-factory-square-'));
    const publicDir = join(dir, 'public');
    mkdirSync(join(publicDir, 'images'), { recursive: true });
    writeFileSync(join(publicDir, 'images', 'logo.webp'), 'x');
    writeFileSync(join(publicDir, 'images', 'logo-square.png'), 'x');
    writeSiteDirFromContent(dir, {
      // No brand.logo: the engine is to pick up the factory's own "logo" by itself. The "<" in the
      // name is there to prove the JSON-LD cannot be broken out of.
      brand: { name: 'Square </script> Brand' },
      nav: [{ label: 'Home', href: '/' }],
      pages: [{ slug: '/', meta: {}, blocks: [{ type: 'hero', props: { content: [{ type: 'title', h1: 'Hero' }] } }] }],
    });
    writeFileSync(
      join(dir, 'images.json'),
      JSON.stringify({
        logo: { src: '/images/logo.webp', alt: 'Square Brand', width: 432, height: 144 },
        'logo-square': { src: '/images/logo-square.png', alt: 'Square Brand logo', width: 512, height: 512 },
      }),
    );
    html = readOutput(
      buildSite({ outDir: join('output', 'test-logo-square'), env: { SITE_DIR: dir, PUBLIC_DIR: publicDir } }).outDir,
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('puts the generated logo in the header when site.json names none', () => {
    expect(html).toMatch(/<img[^>]*src="\/images\/logo\.webp"[^>]*alt="Square Brand"/);
  });

  it('uses the square as the link preview and the site icon', () => {
    expect(html).toMatch(/<meta property="og:image" content="https:\/\/example\.com\/images\/logo-square\.png"/);
    expect(html).toMatch(/<link rel="icon" type="image\/png" href="\/images\/logo-square\.png"/);
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/images\/logo-square\.png"/);
  });

  it('describes the organisation for search engines with absolute addresses', () => {
    const json = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    expect(JSON.parse(json)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Square </script> Brand',
      url: 'https://example.com/',
      logo: 'https://example.com/images/logo-square.png',
    });
    // The brand's own "</script>" must not be able to close the tag early.
    expect(json).not.toContain('</script>');
    expect(json).toContain('\\u003c/script>');
  });
});

describe('a site without the square', () => {
  it('adds no preview image, icon or organisation markup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-no-square-'));
    try {
      writeSiteDirFromContent(dir, {
        brand: { name: 'Plain' },
        pages: [{ slug: '/', meta: {}, blocks: [{ type: 'hero', props: { content: [{ type: 'title', h1: 'Hero' }] } }] }],
      });
      const html = readOutput(buildSite({ outDir: join('output', 'test-no-square'), env: { SITE_DIR: dir } }).outDir);
      expect(html).not.toContain('og:image');
      expect(html).not.toContain('rel="icon"');
      expect(html).not.toContain('application/ld+json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Прогон.** `npx vitest run tests/render.test.mjs -t "square"`. Ожидается FAIL: нет
  логотипа в шапке и нет тегов.

- [ ] **Step 3: `normalize.mjs`.** Функцию `resolveLogo` заменить на:

```js
// The logo is a picture from images.json like any other, named in site.json — "brand.logo": "main".
// One that does not resolve is dropped with a warning instead of shipping as a broken image in the
// header of every page. Its alt text falls back to the brand name in the layout, so a logo with no
// alt of its own is not worth a warning. A site that names no logo gets the one the factory
// generates under the fixed name "logo" (factory/images/logo.mjs), silently: nothing was asked for,
// so a missing one is nothing to warn about.
const GENERATED_LOGO = 'logo';
const GENERATED_SQUARE = 'logo-square';

function resolveLogo(value, images, warnings) {
  const name = toText(value, '');
  if (name === '') return images.resolve(GENERATED_LOGO).image ?? null;
  const { image, problem } = images.resolve(name);
  if (!image) warnings.push(`Логотип: ${problem} — не выводится`);
  return image;
}

// The square version of the logo (a gradient with the logo centred), which the factory generates
// next to it. It is what search engines, link previews and the browser tab get; absent, the site
// simply has none of those.
function resolveSquare(images) {
  return images.resolve(GENERATED_SQUARE).image ?? null;
}
```

  В объекте `brand` после `logo: …` добавить `square: resolveSquare(images),`.

- [ ] **Step 4: `Base.astro`.** Во frontmatter строку
  `const canonical = pageUrl(resolveOrigin(Astro.site, site.domain), page.slug);` заменить на:

```js
const origin = resolveOrigin(Astro.site, site.domain);
const canonical = pageUrl(origin, page.slug);

// The square logo stands in for the whole site wherever one picture is wanted: the link preview,
// the browser tab, and the schema.org Organization search engines read. Link previews and
// structured data need absolute addresses; a src that is already absolute (https://…) stays as it is.
const square = site.brand.square;
const squareUrl = square ? new URL(square.src, `${origin}/`).href : '';
const ICON_TYPES = { '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const iconType = square ? ICON_TYPES[(square.src.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase()] : undefined;
// JSON inside a <script> is closed by the first "</script>" it contains, wherever that is — even
// inside a string. Escaping every "<" as \u003c keeps the brand name (content written by someone
// else) from ever ending the tag early, and JSON readers decode it back to "<".
const organizationJson = square
  ? JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: site.brand.name,
      url: `${origin}/`,
      logo: squareUrl,
    }).replace(/</g, '\\u003c')
  : '';
```

  В `<head>` после `<meta property="og:url" content={canonical} />` добавить:

```astro
    {square && <meta property="og:image" content={squareUrl} />}
    {square && <link rel="icon" type={iconType} href={square.src} />}
    {square && <link rel="apple-touch-icon" href={square.src} />}
    {square && <script type="application/ld+json" is:inline set:html={organizationJson} />}
```

- [ ] **Step 5: Проверка.** `npx vitest run tests/render.test.mjs` — PASS, включая старые
  тесты логотипа. Затем `npm test` — всё зелёное.

- [ ] **Step 6: Коммит.** `git add src/lib/normalize.mjs src/layouts/Base.astro tests/render.test.mjs`,
  проверить индекс, затем
  `git commit -m "Сайт: логотип фабрики в шапке, квадрат в og:image, иконке и разметке schema.org" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`.

---

### Task 7: Логотип в фабрике и в команде, документация

**Files:**
- Modify: `factory/server.mjs`, `scripts/generate-images.mjs`, `factory/public/index.html`,
  `factory/public/app.js`, `README.md`, `docs/content-format.md`
- Test: `tests/server.test.mjs`, `tests/generate-images-cli.test.mjs`

**Interfaces:**
- Consumes: `generateLogo` (Task 5), `readRunwareConfig` (Task 1).
- Produces:
  - `createApp({ envFile, fetchFn, promptFile, logoPromptFile } = {})`; `logoPromptFile` по
    умолчанию `factory/prompts/logo.json`.
  - Шаг `prepare`: сначала логотип, потом картинки, с одним чтением `.env`.

- [ ] **Step 1: Тесты команды.** В `tests/generate-images-cli.test.mjs`:
  1. В тесте «says so when every picture of the site is already in images.json» в
     `images.json` фикстуры добавить записи
     `logo: { src: '/images/logo.webp', alt: 'X' }` и
     `'logo-square': { src: '/images/logo-square.png', alt: 'X logo' }`, чтобы шаг логотипа
     молчал. Ожидаемую строку заменить на `Картинки и логотип: всё уже на месте`.
  2. В тесте нечитаемого сайта строку, которой быть не должно, заменить на
     `всё уже на месте`.

- [ ] **Step 2: Тест сервера.** В `tests/server.test.mjs` в `describe('pictures are generated before the build'…)`:
  1. Функцию `fetchFn` в `beforeAll` оставить как есть: сайт-фикстура без `site.json`
     не имеет бренда, поэтому логотип пропускается без запросов, и старые проверки
     `requests.toHaveLength(1)` верны.
  2. Добавить отдельный `describe` с логотипом:

```js
describe('the logo is made before the pictures', () => {
  const siteId = 'logo-generation-fixture';
  const siteDir = join('data', 'sites', siteId);
  const SENTINEL = 'sentinel-runware-key-server-logo-9c1d';
  let envDir;
  let logoServer;
  let logoBase;
  let cutout;

  beforeAll(async () => {
    const { default: sharp } = await import('sharp');
    const mark = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="100%" height="100%" rx="24" fill="#ffb800"/></svg>');
    cutout = await sharp({ create: { width: 1536, height: 768, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: mark, gravity: 'centre' }])
      .png()
      .toBuffer();
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(join(siteDir, 'site.json'), JSON.stringify({ brand: { name: 'Logo Brand' }, nav: [{ label: 'Home', href: '/' }] }));
    writeFileSync(
      join(siteDir, 'home.json'),
      JSON.stringify({ title: 'Logo', blocks: [{ type: 'hero', content: [{ type: 'title', h1: 'Logo' }, { image: 'hero-shot' }] }] }),
    );
    envDir = mkdtempSync(join(tmpdir(), 'site-factory-server-logo-env-'));
    writeFileSync(join(envDir, '.env'), `RUNWARE_API_KEY=${SENTINEL}\n`);
    const fetchFn = async (_url, init) => {
      const [task] = JSON.parse(init.body);
      if (task.taskType === 'removeBackground') {
        return new Response(JSON.stringify({ data: [{ taskUUID: task.taskUUID, imageBase64Data: cutout.toString('base64'), cost: 0.001 }] }), { status: 200 });
      }
      if (task.model === 'ideogram:4@0') {
        return new Response(JSON.stringify({ data: [{ taskUUID: task.taskUUID, imageUUID: 'art-1', cost: 0.09 }] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ data: [{ taskUUID: task.taskUUID, imageBase64Data: Buffer.from('fake webp').toString('base64'), cost: 0.001 }] }),
        { status: 200 },
      );
    };
    logoServer = createApp({ envFile: join(envDir, '.env'), fetchFn }).listen(0);
    await new Promise((resolve) => logoServer.once('listening', resolve));
    logoBase = `http://127.0.0.1:${logoServer.address().port}`;
  });

  afterAll(() => {
    logoServer?.close();
    rmSync(siteDir, { recursive: true, force: true });
    rmSync(envDir, { recursive: true, force: true });
  });

  it('logs the logo first, then the pictures, then the build — and the page carries all of it', async () => {
    const domain = 'logo-generation-test.com';
    rmSync(join('output', domain), { recursive: true, force: true });
    try {
      const start = await fetch(`${logoBase}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: siteId, domain }),
      }).then((r) => r.json());
      const log = await readUntilDone(start.buildId, logoBase);
      const status = await fetch(`${logoBase}/api/builds/${start.buildId}`).then((r) => r.json());
      expect(status.status).toBe('ok');

      const logoReady = log.indexOf('Логотип готов');
      const pictureReady = log.indexOf('Картинка hero-shot готова');
      expect(logoReady).toBeGreaterThan(-1);
      expect(logoReady).toBeLessThan(pictureReady);
      expect(pictureReady).toBeLessThan(log.indexOf('[build]'));
      expect(log).not.toContain(SENTINEL);

      const html = readFileSync(join('output', domain, 'index.html'), 'utf8');
      expect(html).toMatch(/<img[^>]*src="\/images\/logo\.webp"/);
      expect(html).toContain(`<meta property="og:image" content="https://${domain}/images/logo-square.png"`);
      expect(html).toContain('application/ld+json');
      expect(existsSync(join('output', domain, 'images', 'logo-square.png'))).toBe(true);
    } finally {
      rmSync(join('output', domain), { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Прогон.** `npx vitest run tests/server.test.mjs -t "logo" tests/generate-images-cli.test.mjs`.
  Ожидается FAIL: логотип не делается, текста «всё уже на месте» нет.

- [ ] **Step 4: Сервер.** В `factory/server.mjs`:
  1. Добавить `import { generateLogo } from './images/logo.mjs';`.
  2. После `IMAGE_PROMPTS_FILE` добавить
     `const LOGO_PROMPTS_FILE = join(HERE, 'prompts', 'logo.json');`.
  3. В `createApp` добавить параметр `logoPromptFile = LOGO_PROMPTS_FILE` и дописать его в
     комментарий над функцией.
  4. Блок `const prepare = …` заменить на:

```js
    // Before the build: the logo first (a site without one gets it), then any missing pictures,
    // unless the form asked for a plain rebuild. The .env is read here, per request and once for
    // both steps, so a key added while the factory is running is picked up without a restart.
    const prepare =
      body.skipImages === true
        ? undefined
        : async (log) => {
            const config = readRunwareConfig(envFile);
            await generateLogo({ siteDir, brand, config, promptFile: logoPromptFile, fetchFn, log });
            await generateMissingImages({ siteDir, brand, config, promptFile, fetchFn, log });
          };
```

- [ ] **Step 5: Команда.** В `scripts/generate-images.mjs`:
  1. Импортировать `generateLogo` из `../factory/images/logo.mjs`.
  2. Прочитать настройки один раз: `const config = readRunwareConfig(envFile);`.
  3. Перед `generateMissingImages` вызвать
     `await generateLogo({ siteDir, config, promptFile: join(ROOT, 'factory', 'prompts', 'logo.json'), log })`,
     где `log` — та же функция, что ставит `loggedAnything`.
  4. Итоговую строку заменить на `Картинки и логотип: всё уже на месте`.
  5. Поправить комментарии и строку в начале файла: команда делает и логотип.

- [ ] **Step 6: Форма.**
  1. `factory/public/index.html`: текст галочки — `Без генерации картинок и логотипа`.
     Пояснение под ней:
     `Иначе перед сборкой делаются логотип, если его нет, и картинки для меток image, которых нет в images.json`.
  2. `factory/public/app.js`: статус без галочки — `Генерируем логотип и картинки, собираем…`.

- [ ] **Step 7: Документация.**
  1. `README.md`: раздел `## Картинки` переименовать в `## Картинки и логотип` и в конец раздела
     перед строкой «Подробности» вставить:

```markdown
Логотип фабрика делает сама, если в `site.json` нет своего `brand.logo`. Ideogram 4.0 рисует
название бренда в случайном стиле из `factory/prompts/logo.json`, RemBG убирает фон. Получаются
две картинки в `images.json`: `logo` для шапки и `logo-square` — квадрат 512×512 на градиенте.
Квадрат идёт в превью ссылки, в иконку сайта и в разметку schema.org. Чтобы получить другой
вариант, удалите запись `logo` и соберите сайт заново. Модели задаются в `.env`:
`RUNWARE_LOGO_MODEL` и `RUNWARE_BG_MODEL`.
```

     В строку «Подробности — …» добавить спецификацию
     `docs/specs/2026-09-15-logo-generation-design.md`.
  2. `docs/content-format.md`, таблица настроек `site.json`, строка `brand.logo`: после Task 6
     фраза «Можно не указывать — тогда в шапке название бренда текстом» неверна. Ячейку описания
     заменить на: «Имя картинки из `images.json`. Можно не указывать — тогда в шапке логотип `logo`
     из `images.json` (его делает фабрика), а если его нет — название бренда текстом».
  3. `docs/content-format.md`: в конец раздела `## images.json — картинки`, перед заголовком
     `## Файл страницы`, добавить абзац:

```markdown
Два имени зарезервированы за фабрикой. `logo` — логотип для шапки: его берёт сайт, если в
`site.json` нет своего `brand.logo`. `logo-square` — квадратный логотип: он идёт в превью ссылки
(`og:image`), в иконку сайта и в разметку schema.org `Organization`. Обе записи фабрика создаёт
сама перед сборкой, но их можно положить и руками.
```

- [ ] **Step 8: Проверка.** `npx vitest run tests/server.test.mjs tests/generate-images-cli.test.mjs` —
  PASS. Затем `npm test` — всё зелёное. `ls data/sites` показывает только `899ok`.

- [ ] **Step 9: Коммит.** `git add factory/server.mjs scripts/generate-images.mjs factory/public/index.html factory/public/app.js README.md docs/content-format.md tests/server.test.mjs tests/generate-images-cli.test.mjs`,
  проверить индекс, затем
  `git commit -m "Фабрика делает логотип перед картинками" -m "Галочка «Без генерации картинок и логотипа» пропускает оба шага; команда generate:images тоже делает логотип." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`.

---

## После всех задач

1. Финальное ревью всей ветки.
2. Слияние в `main`.
3. Проверка формы в браузере.
4. **Первый настоящий запуск — только с разрешения владельца.** Он проверяет, что Ideogram 4.0
   принимает такой запрос, и списывает около $0.09.
