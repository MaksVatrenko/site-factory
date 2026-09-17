# Генерация текстов через OpenAI: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** фабрика сама пишет папку нового сайта — тексты страниц, `site.json` и метки картинок — по
выбранному шаблону, бренду, гео, языку и списку страниц.

**Architecture:**
- Структуру описывает **шаблон**: новый `templates/<id>/content.json` и папка `examples/`. Промпт
  собирается из `content.json`, а не пишется руками, поэтому новый шаблон получает корректный
  промпт сам.
- Каркас (сколько секций, вопросов, картинок) разыгрывает **фабрика** до первого запроса, по зерну
  от имени папки. Модель структуру не выбирает и не может её сломать.
- Два этапа на страницу: дешёвый **план** (заголовки, брифы, элементы, картинки, ссылки), затем
  **наполнение** по секциям. Ответы ограничены строгой JSON-схемой.
- Страницу собирает фабрика: оглавление строится из заголовков секций, блок «другие страницы» — из
  меню, все проверки — после модели.
- Результат — папка в `data/sites/`, неотличимая от собранной из таблицы. Логотип, картинки и
  сборка работают дальше без изменений и об этом этапе не знают.

**Tech Stack:** Node ≥ 22.12 (ESM), Express 5, Astro 7, Vitest 5, OpenAI Responses API.

**Спецификация:** `docs/specs/2026-09-17-text-generation-design.md`. Если план с ней расходится —
спросить владельца. Правила про ключ, `.env` и «этап не валит сборку» пришли из
`docs/specs/2026-09-15-image-generation-design.md` и действуют здесь тоже.

## Global Constraints

**Зависимости и оформление**
- Новых зависимостей нет вообще. Запросы — через `fetch`, схемы — обычные объекты.
- Комментарии в коде на английском и объясняют «почему». Сообщения в логе, ошибки и тексты
  интерфейса на русском.
- Каждый модуль держит свои крошечные проверки вроде `isPlainObject` у себя, в общий модуль их не
  выносить: так решил владелец. Логику, а не проверки, не копировать: общее выносится в модуль.
- Правила и промпты живут в JSON-файлах (`factory/prompts/texts.json`, `templates/<id>/content.json`)
  и правятся без правки кода.

**Ключ и тесты**
- Поддельные ответы OpenAI для тестов живут в `tests/helpers/openai.mjs` (создаётся в Task 2).
  Каждый файл тестов **импортирует** оттуда `answer`, `truncated`, `refused`, `failed` и не заводит
  свою копию. В задачах 7, 8, 10, 11 и 12 куски тестов показывают форму ответа для чтения — писать
  её заново не нужно, нужен импорт.
- Ключ OpenAI живёт только в `.env`. Он читается в объект и **никогда** не попадает в
  `process.env`, в лог, в тексты ошибок и в готовый сайт. Тексты ошибок OpenAI очищаются от ключа.
- Тесты не ходят в сеть и не читают настоящий `.env`: `fetchFn` и путь к `.env` передаются
  параметрами, тестовый ключ имеет вид `sentinel-openai-key-…`.
- Генерация никогда не бросает наружу: любая беда — строка в логе.

**Деньги**
- OpenAI не возвращает стоимость. Цена считается умножением `usage` на цены из `.env`
  (`OPENAI_PRICE_INPUT`, `OPENAI_PRICE_CACHED_INPUT`, `OPENAI_PRICE_OUTPUT`, доллары за миллион
  токенов). Лог показывает и токены, и деньги.
- Неизменная часть запроса (правила, `content.json`, примеры) идёт в `instructions`, изменяемая — в
  `input`. Порядок обязателен: иначе кеш промпта не попадает и запрос дорожает вдесятеро.

**Git и коммиты**
- Никогда не коммитить `data/sites/899ok/home.json`, `data/sites/899ok/images.json`,
  `data/sites/899ok/public/`: это локальные файлы владельца.
- Перед каждым коммитом проверять `git diff --cached --name-only`. В индексе должны быть только
  файлы задачи.
- Коммиты на русском, в конце `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

**Имена и значения**
- Промежуточный вид элемента от модели использует ключ `kind`, а не `type`: `title`, `text`,
  `list`, `table`, `cards`, `toggle`, `image`. В наш формат его переводит `assemble.mjs`.
  Причина — в схеме нельзя выразить наш «ключ и есть тег» (`{ "type": "title", "h2": "…" }`).
- Схема строгая: у каждого объекта `additionalProperties: false`, **все** поля перечислены в
  `required`, необязательное поле выражается как «тип или `null`».
- Ответ читается из `output`: элемент `type: "message"` → `content` → `type: "output_text"`.
  Отказ — `type: "refusal"`. Обрыв — `status: "incomplete"` и `incomplete_details.reason`.

**Тестовые команды**
- Один файл: `npx vitest run tests/<файл>`.
- Весь набор: `npm test`. Перед планом в нём 479 тестов, все зелёные.
- Node 22 обязателен: `nvm use 22` или `PATH=~/.nvm/versions/node/v22.14.0/bin:$PATH`.

---

## Файлы

**Создаются**

| Файл | Ответственность |
|---|---|
| `factory/env-file.mjs` | Чтение `.env` в объект. Общее для Runware и OpenAI |
| `factory/texts/env.mjs` | Настройки OpenAI из `.env` |
| `factory/texts/openai.mjs` | Один запрос со схемой: повторы, ошибки, отказ, обрыв, цена |
| `tests/helpers/openai.mjs` | Поддельные ответы OpenAI для всех тестов этапа |
| `factory/texts/template.mjs` | Чтение `content.json` и примеров шаблона |
| `factory/texts/texts-prompts.mjs` | Чтение `factory/prompts/texts.json`, язык по гео |
| `factory/texts/skeleton.mjs` | Жребий каркаса по зерну |
| `factory/texts/schema.mjs` | Схемы плана и наполнения из словаря шаблона |
| `factory/texts/plan.mjs` | Этап 1: план страницы и его подрезка под бюджеты |
| `factory/texts/fill.mjs` | Этап 2: наполнение секции и FAQ |
| `factory/texts/assemble.mjs` | Сборка страницы, оглавление, проверки |
| `factory/texts/site-json.mjs` | Меню, футер, слоган |
| `factory/texts/generate-site.mjs` | Оркестровка, лог, деньги |
| `factory/prompts/texts.json` | Правила и таблица языков |
| `templates/review/content.json` | Правила каркаса «Обзорного» |
| `templates/review/examples/*.json` | Две страницы-образца |
| `scripts/generate-texts.mjs` | Команда `npm run generate:texts` |

**Меняются**

| Файл | Что в нём меняется |
|---|---|
| `factory/images/env.mjs` | `readEnvFile` переезжает в `factory/env-file.mjs` |
| `.env.example` | Настройки OpenAI |
| `factory/server.mjs` | Маршруты вкладки «Тексты» |
| `factory/public/index.html` | Вкладка «Тексты» |
| `factory/public/app.js` | Её поведение |
| `package.json` | Команда `generate:texts` |
| `README.md` | Раздел про генерацию текстов |

---

### Task 1: Настройки OpenAI

**Files:**
- Create: `factory/env-file.mjs`, `factory/texts/env.mjs`
- Modify: `factory/images/env.mjs`, `.env.example`
- Test: `tests/openai-env.test.mjs`

**Interfaces:**
- Produces: `readEnvFile(envFile) -> object` из `factory/env-file.mjs`.
- Produces: `OPENAI_DEFAULTS` и `readOpenAiConfig(envFile) -> { apiKey, apiKeyInvalid, apiUrl,
  model, concurrency, priceInput, priceCachedInput, priceOutput }` из `factory/texts/env.mjs`.
  Все дальнейшие задачи получают этот объект под именем `config`.

- [ ] **Step 1: Общий читатель `.env`.** Создать `factory/env-file.mjs`:

```js
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Settings for the paid services live in the project's .env. They are parsed into a plain object
// and deliberately never copied into process.env: the factory starts every Astro build with
// `{ ...process.env, ...options.env }`, so a key that is not in process.env physically cannot
// reach the build process, and so cannot end up in a built site.
//
// A missing or unreadable .env is not an error here: without a key, a generation step reports that
// it skipped its work, and the site still builds.
export function readEnvFile(envFile) {
  try {
    return parseEnv(readFileSync(envFile, 'utf8'));
  } catch {
    return {};
  }
}
```

В `factory/images/env.mjs` удалить его собственную `readEnvFile` вместе с двумя импортами
(`readFileSync`, `parseEnv`) и поставить сверху `import { readEnvFile } from '../env-file.mjs';`.
Комментарий над `RUNWARE_DEFAULTS` не трогать.

- [ ] **Step 2: Прогон.** `npx vitest run tests/runware-env.test.mjs` — PASS, ничего не сломалось.

- [ ] **Step 3: Тест новых настроек.** Создать `tests/openai-env.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPENAI_DEFAULTS, readOpenAiConfig } from '../factory/texts/env.mjs';

const SENTINEL = 'sentinel-openai-key-env-3d71';

let dirs = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function envFile(body) {
  const dir = mkdtempSync(join(tmpdir(), 'site-factory-openai-env-'));
  dirs.push(dir);
  const file = join(dir, '.env');
  writeFileSync(file, body);
  return file;
}

describe('readOpenAiConfig', () => {
  it('falls back to the defaults when only the key is set', () => {
    const config = readOpenAiConfig(envFile(`OPENAI_API_KEY=${SENTINEL}\n`));
    expect(config.apiKey).toBe(SENTINEL);
    expect(config.apiKeyInvalid).toBe(false);
    expect(config.apiUrl).toBe(OPENAI_DEFAULTS.apiUrl);
    expect(config.model).toBe(OPENAI_DEFAULTS.model);
    expect(config.concurrency).toBe(OPENAI_DEFAULTS.concurrency);
    expect(config.priceInput).toBe(OPENAI_DEFAULTS.priceInput);
    expect(config.priceCachedInput).toBe(OPENAI_DEFAULTS.priceCachedInput);
    expect(config.priceOutput).toBe(OPENAI_DEFAULTS.priceOutput);
  });

  it('takes every setting from the file when it is there', () => {
    const config = readOpenAiConfig(
      envFile(
        `OPENAI_API_KEY=${SENTINEL}\nOPENAI_API_URL=https://proxy.test/v1/responses\n` +
          'OPENAI_MODEL=gpt-5.6-terra\nOPENAI_CONCURRENCY=3\n' +
          'OPENAI_PRICE_INPUT=2\nOPENAI_PRICE_CACHED_INPUT=0.2\nOPENAI_PRICE_OUTPUT=12\n',
      ),
    );
    expect(config.apiUrl).toBe('https://proxy.test/v1/responses');
    expect(config.model).toBe('gpt-5.6-terra');
    expect(config.concurrency).toBe(3);
    expect(config.priceInput).toBe(2);
    expect(config.priceCachedInput).toBe(0.2);
    expect(config.priceOutput).toBe(12);
  });

  // A free model is a real case, and 0 must not be mistaken for "not set" the way a positive-only
  // check would: prices are the one setting where zero is meaningful.
  it('keeps a price of zero instead of replacing it with the default', () => {
    const config = readOpenAiConfig(envFile(`OPENAI_API_KEY=${SENTINEL}\nOPENAI_PRICE_OUTPUT=0\n`));
    expect(config.priceOutput).toBe(0);
  });

  it('reports no key at all when the file does not exist', () => {
    const config = readOpenAiConfig(join(tmpdir(), 'site-factory-no-such-dir', '.env'));
    expect(config.apiKey).toBe('');
    expect(config.apiKeyInvalid).toBe(false);
    expect(config.model).toBe(OPENAI_DEFAULTS.model);
  });

  // A Bearer header value cannot carry a space or a line break; trying anyway is what once let a
  // raw fetch error quote the whole "Bearer <key>" back into a log line.
  it('refuses a key with a space in it, and says the key is wrong rather than missing', () => {
    const config = readOpenAiConfig(envFile('OPENAI_API_KEY=key with a space\n'));
    expect(config.apiKey).toBe('');
    expect(config.apiKeyInvalid).toBe(true);
  });

  it('treats a bogus concurrency as absent', () => {
    const config = readOpenAiConfig(envFile(`OPENAI_API_KEY=${SENTINEL}\nOPENAI_CONCURRENCY=nope\n`));
    expect(config.concurrency).toBe(OPENAI_DEFAULTS.concurrency);
  });
});
```

- [ ] **Step 4: Прогон.** `npx vitest run tests/openai-env.test.mjs`. Ожидается FAIL: модуля
`factory/texts/env.mjs` нет.

- [ ] **Step 5: Код.** Создать `factory/texts/env.mjs`:

```js
import { readEnvFile } from '../env-file.mjs';

export const OPENAI_DEFAULTS = Object.freeze({
  // The Responses API: OpenAI recommends it over Chat Completions for new work, and it is the one
  // whose `text.format` carries the strict JSON schema this stage depends on.
  apiUrl: 'https://api.openai.com/v1/responses',
  model: 'gpt-5.6-luna',
  concurrency: 1,
  // Prices are settings, not facts. Unlike Runware, which answers with `cost`, OpenAI answers only
  // with token counts, so the only way to report what a run cost is to multiply them out here.
  // Dollars per million tokens, matching the default model above: change the model and these have
  // to change with it, or the log quietly lies.
  priceInput: 0.2,
  priceCachedInput: 0.02,
  priceOutput: 1.2,
});

// Same reasoning as factory/images/env.mjs: a Bearer header value cannot safely carry a space, a
// line break or any other non-printable character, and trying anyway is exactly what let a raw
// fetch error leak a key once. Caught here, once, so every caller gets a clean "no usable key".
const VISIBLE_ASCII = /^[\x21-\x7E]+$/;

function positiveInteger(raw, fallback) {
  const number = Number(raw);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

// Zero is a legitimate price (a free model), so this accepts it — unlike the positive-only helpers
// above, where zero really does mean "not set".
function price(raw, fallback) {
  if (raw === '') return fallback;
  const number = Number(raw);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function readOpenAiConfig(envFile) {
  const values = readEnvFile(envFile);
  const text = (key) => (typeof values[key] === 'string' ? values[key].trim() : '');
  const rawKey = text('OPENAI_API_KEY');
  const apiKeyInvalid = rawKey !== '' && !VISIBLE_ASCII.test(rawKey);
  return {
    apiKey: apiKeyInvalid ? '' : rawKey,
    apiKeyInvalid,
    apiUrl: text('OPENAI_API_URL') || OPENAI_DEFAULTS.apiUrl,
    model: text('OPENAI_MODEL') || OPENAI_DEFAULTS.model,
    concurrency: positiveInteger(text('OPENAI_CONCURRENCY'), OPENAI_DEFAULTS.concurrency),
    priceInput: price(text('OPENAI_PRICE_INPUT'), OPENAI_DEFAULTS.priceInput),
    priceCachedInput: price(text('OPENAI_PRICE_CACHED_INPUT'), OPENAI_DEFAULTS.priceCachedInput),
    priceOutput: price(text('OPENAI_PRICE_OUTPUT'), OPENAI_DEFAULTS.priceOutput),
  };
}
```

Дописать в конец `.env.example`:

```
# Генерация текстов через OpenAI (https://platform.openai.com). Ключ вписывается сюда же.
OPENAI_API_KEY=
OPENAI_API_URL=https://api.openai.com/v1/responses
OPENAI_MODEL=gpt-5.6-luna
OPENAI_CONCURRENCY=1
# Цены в долларах за миллион токенов — под ту модель, что выбрана выше. OpenAI не присылает
# стоимость в ответе, поэтому фабрика считает её сама. Сменили модель — поменяйте и цены.
OPENAI_PRICE_INPUT=0.20
OPENAI_PRICE_CACHED_INPUT=0.02
OPENAI_PRICE_OUTPUT=1.20
```

- [ ] **Step 6: Проверка.** `npx vitest run tests/openai-env.test.mjs tests/runware-env.test.mjs` —
PASS оба файла.

- [ ] **Step 7: Коммит.**

```bash
git add factory/env-file.mjs factory/texts/env.mjs factory/images/env.mjs .env.example tests/openai-env.test.mjs
git diff --cached --name-only
git commit -m "Настройки OpenAI в .env и общий читатель файла

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Клиент OpenAI

**Files:**
- Create: `factory/texts/openai.mjs`
- Test: `tests/openai-client.test.mjs`

**Interfaces:**
- Consumes: `config` из Task 1.
- Produces: `OpenAiError` с полем `kind` (`'auth' | 'balance' | 'rejected' | 'unavailable' |
  'refused' | 'truncated'`), `RETRY_DELAYS_MS`, `costOf(usage, config) -> number` и
  `askJson({ instructions, input, schemaName, schema, cacheKey, maxOutputTokens },
  { config, fetchFn, sleep, timeoutMs }) -> { data, cost, usage }`.
  Все задачи с 7 по 11 обращаются к OpenAI **только** через `askJson`.

- [ ] **Step 1: Общий помощник тестов.** Создать `tests/helpers/openai.mjs`. Он нужен шести файлам
тестов, а в репозитории для такого уже есть `tests/helpers/` (см. `build.mjs`):

```js
// The shapes the Responses API answers with, for tests. Shared because six test files need them,
// and a copy per file is six places for the shape to drift from the one the client really parses.
export function answer(data, usage = {}) {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
      usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 0 }, ...usage },
    }),
    { status: 200 },
  );
}

// A run that hit the output limit. The API reports this itself rather than leaving broken JSON.
export function truncated(reason = 'max_output_tokens') {
  return new Response(
    JSON.stringify({ status: 'incomplete', incomplete_details: { reason }, output: [] }),
    { status: 200 },
  );
}

export function refused(text = 'I cannot help with that') {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: text }] }],
    }),
    { status: 200 },
  );
}

export function failed(status, error = { message: 'nope' }) {
  return new Response(JSON.stringify({ error }), { status });
}
```

- [ ] **Step 2: Тест.** Создать `tests/openai-client.test.mjs`. Поддельные ответы берутся из
помощника выше — `import { answer, failed, refused, truncated } from './helpers/openai.mjs';` — а
показанное здесь объявление `answer` не переписывается:

```js
import { describe, it, expect } from 'vitest';
import { askJson, costOf, OpenAiError, RETRY_DELAYS_MS } from '../factory/texts/openai.mjs';

const SENTINEL = 'sentinel-openai-key-client-8b4e';
const CONFIG = {
  apiKey: SENTINEL,
  apiKeyInvalid: false,
  apiUrl: 'https://openai.test/v1/responses',
  model: 'gpt-5.6-luna',
  concurrency: 1,
  priceInput: 0.2,
  priceCachedInput: 0.02,
  priceOutput: 1.2,
};

const SCHEMA = {
  type: 'object',
  properties: { headline: { type: 'string' } },
  required: ['headline'],
  additionalProperties: false,
};

// Shapes an answer the way the Responses API does: the JSON we asked for arrives as the text of an
// `output_text` part inside a `message` item, not as a field of its own.
function answer(data, usage = {}) {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
      usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 0 }, ...usage },
    }),
    { status: 200 },
  );
}

const ask = (options, overrides = {}) =>
  askJson(
    { instructions: 'rules', input: 'page: casino', schemaName: 'page_plan', schema: SCHEMA, ...options },
    { config: CONFIG, sleep: async () => {}, ...overrides },
  );

describe('askJson', () => {
  it('asks with a strict schema, static text first, and returns the parsed answer', async () => {
    let sent;
    const fetchFn = async (url, init) => {
      sent = { url, init, body: JSON.parse(init.body) };
      return answer({ headline: 'Casino' });
    };
    const result = await ask({}, { fetchFn });

    expect(sent.url).toBe(CONFIG.apiUrl);
    expect(sent.init.headers.Authorization).toBe(`Bearer ${SENTINEL}`);
    expect(sent.body.model).toBe('gpt-5.6-luna');
    // The cache only hits when the unchanging part leads: instructions carry the rules and the
    // examples, input carries what differs per call.
    expect(sent.body.instructions).toBe('rules');
    expect(sent.body.input).toEqual([{ role: 'user', content: 'page: casino' }]);
    expect(sent.body.text.format).toEqual({
      type: 'json_schema',
      name: 'page_plan',
      strict: true,
      schema: SCHEMA,
    });
    expect(result.data).toEqual({ headline: 'Casino' });
  });

  it('passes a cache key and an output limit when given them', async () => {
    let body;
    const fetchFn = async (_url, init) => {
      body = JSON.parse(init.body);
      return answer({ headline: 'x' });
    };
    await ask({ cacheKey: 'sf-plan-review', maxOutputTokens: 900 }, { fetchFn });
    expect(body.prompt_cache_key).toBe('sf-plan-review');
    expect(body.max_output_tokens).toBe(900);
  });

  it('counts money from the token counters, charging cached input at its own price', async () => {
    const fetchFn = async () =>
      answer({ headline: 'x' }, {
        input_tokens: 30_000,
        output_tokens: 1_000,
        input_tokens_details: { cached_tokens: 25_000 },
      });
    const result = await ask({}, { fetchFn });
    // 5000 fresh × $0.20 + 25000 cached × $0.02 + 1000 out × $1.20, per million.
    expect(result.cost).toBeCloseTo((5000 * 0.2 + 25_000 * 0.02 + 1000 * 1.2) / 1e6, 12);
    expect(result.usage.cachedTokens).toBe(25_000);
  });

  it('treats a rejected key as final and does not retry it', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
    };
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({ kind: 'auth' });
    expect(calls).toBe(1);
  });

  // A 429 is usually "too fast" and worth retrying, but the same status also carries "you are out
  // of money" — and that one will answer the same way for the rest of the run.
  it('tells an out-of-money 429 apart from a too-fast one', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ error: { code: 'insufficient_quota', message: 'no funds' } }),
        { status: 429 },
      );
    };
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({ kind: 'balance' });
    expect(calls).toBe(1);
  });

  // The specific billing code is not always one we know, but the broad type is: a 429 that names
  // the category must be terminal even when its code is a string this client has never seen.
  // The code below is deliberately NOT in QUOTA_CODES — a code from that set would pass this test
  // through the code branch alone, and the test would still pass with the type check deleted,
  // which is the very regression it exists to catch.
  it('treats an unknown billing code as out of money when the type says so', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return failed(429, { type: 'insufficient_quota', code: 'some_future_billing_code', message: 'no funds' });
    };
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({ kind: 'balance' });
    expect(calls).toBe(1);
  });

  it('retries a plain 429 and succeeds on a later attempt', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      if (calls < 3) return new Response(JSON.stringify({ error: { message: 'slow down' } }), { status: 429 });
      return answer({ headline: 'at last' });
    };
    const result = await ask({}, { fetchFn });
    expect(calls).toBe(3);
    expect(result.data).toEqual({ headline: 'at last' });
  });

  it('waits at least as long as Retry-After asks', async () => {
    const waited = [];
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: 'slow down' } }), {
          status: 429,
          headers: { 'Retry-After': '7' },
        });
      }
      return answer({ headline: 'ok' });
    };
    await ask({}, { fetchFn, sleep: async (ms) => waited.push(ms) });
    expect(waited[0]).toBeGreaterThanOrEqual(7000);
  });

  it('reports a run that hit the output limit as truncated, not as a broken answer', async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }),
        { status: 200 },
      );
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({ kind: 'truncated' });
  });

  it('reports a refusal as a refusal', async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help with that' }] }],
        }),
        { status: 200 },
      );
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({ kind: 'refused' });
  });

  it('gives up with "unavailable" after the last retry', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: 'down' } }), { status: 503 });
    };
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({ kind: 'unavailable' });
    expect(calls).toBe(RETRY_DELAYS_MS.length + 1);
  });

  it('never lets the key into an error message, whoever put it there', async () => {
    const fetchFn = async () =>
      new Response(JSON.stringify({ error: { message: `your key ${SENTINEL} is odd` } }), { status: 400 });
    await expect(ask({}, { fetchFn })).rejects.toSatisfy(
      (error) => error instanceof OpenAiError && !error.message.includes(SENTINEL),
    );
  });

  it('survives an answer whose text is not JSON at all', async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'sorry, plain prose' }] }],
        }),
        { status: 200 },
      );
    await expect(ask({}, { fetchFn })).rejects.toMatchObject({ kind: 'rejected' });
  });
});

describe('costOf', () => {
  it('is zero for an answer with no counters', () => {
    expect(costOf(undefined, CONFIG)).toBe(0);
  });
});
```

- [ ] **Step 3: Прогон.** `npx vitest run tests/openai-client.test.mjs`. Ожидается FAIL: модуля
`factory/texts/openai.mjs` нет.

- [ ] **Step 4: Код.** Создать `factory/texts/openai.mjs`:

```js
// One request, one JSON answer, over OpenAI's Responses API. The schema goes in `text.format` with
// strict: true, which constrains decoding itself — a completed answer cannot be malformed JSON or
// carry a field the schema does not name. Only two things can still go wrong with the content, and
// both are reported by the API rather than guessed at: the model refusing, and the answer running
// into the output limit. Everything else here is transport.
export const RETRY_DELAYS_MS = Object.freeze([1000, 2000, 4000]);
const DEFAULT_TIMEOUT_MS = 120_000;

// `kind` is what the caller acts on. 'auth' and 'balance' mean every further request fails the same
// way, so the run stops. 'refused' and 'truncated' are this one request's problem and are worth
// asking again. 'rejected' is a request the API would refuse identically forever. 'unavailable'
// means OpenAI never answered properly even after retrying. Messages never contain the key.
export class OpenAiError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'OpenAiError';
    this.kind = kind;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A 429 means two different things: "too fast", which is worth another try, and "out of money",
// which will answer the same way for the rest of the run — retrying it only wastes the remaining
// pages' time. Billing reports itself in two places and neither alone is enough: `code` carries the
// specific cause, which is not always the same string, while `type` stays the broad category. So
// both are consulted, and a billing answer is terminal whichever one names it.
const QUOTA_CODES = new Set([
  'insufficient_quota',
  'billing_hard_limit_reached',
  'credit_balance_exhausted',
]);
const QUOTA_TYPES = new Set(['insufficient_quota']);

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

// OpenAI's own error text is composed from our request, and one field of that request is the key.
// Echoed back, it would land straight in a log line, so any occurrence is scrubbed before use —
// whatever put it there.
function scrubKey(message, apiKey) {
  if (!apiKey) return message;
  return String(message).split(apiKey).join('***');
}

function errorOf(payload) {
  const error = payload?.error;
  return {
    code: typeof error?.code === 'string' ? error.code : '',
    type: typeof error?.type === 'string' ? error.type : '',
    message: typeof error?.message === 'string' ? error.message : '',
  };
}

// The answer we asked for is the text of an `output_text` part inside a `message` item. Walked
// rather than read from a convenience field, because this client talks to the API directly.
function outputText(payload) {
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return '';
}

// A refusal replaces the schema-shaped answer. It is documented as an output item; it is also
// accepted here as a content part, because either shape means the same thing and guessing wrong
// would turn a clear refusal into a confusing "no answer".
function refusalText(payload) {
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type === 'refusal' && typeof item.refusal === 'string') return item.refusal;
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === 'refusal' && typeof part.refusal === 'string') return part.refusal;
    }
  }
  return '';
}

// Retry-After is a floor, not a replacement: when OpenAI names a wait, honouring anything shorter
// just earns another 429.
function retryAfterMs(response) {
  const header = response.headers?.get?.('retry-after');
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

// The answer carries token counters, not money — there is no `cost` field to read, unlike Runware.
// Cached input is billed at its own much lower rate, and `input_tokens` already includes it, so the
// fresh part is what is left after taking the cached part out.
export function costOf(usage, config) {
  const input = Number(usage?.input_tokens) || 0;
  const cached = Number(usage?.input_tokens_details?.cached_tokens) || 0;
  const output = Number(usage?.output_tokens) || 0;
  const fresh = Math.max(input - cached, 0);
  return (
    (fresh * config.priceInput + cached * config.priceCachedInput + output * config.priceOutput) /
    1_000_000
  );
}

export async function askJson(
  { instructions, input, schemaName, schema, cacheKey, maxOutputTokens },
  { config, fetchFn = fetch, sleep = defaultSleep, timeoutMs = DEFAULT_TIMEOUT_MS },
) {
  const request = {
    model: config.model,
    // Static first, dynamic last. This is not style: the prompt cache only hits on an unchanged
    // prefix, and the rules plus the examples are far and away the biggest part of every request.
    instructions,
    input: [{ role: 'user', content: input }],
    text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } },
  };
  if (cacheKey) request.prompt_cache_key = cacheKey;
  if (maxOutputTokens) request.max_output_tokens = maxOutputTokens;
  const body = JSON.stringify(request);

  let lastProblem = '';
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(Math.max(RETRY_DELAYS_MS[attempt - 1], lastRetryAfter));

    let response;
    try {
      response = await fetchFn(config.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // Never interpolate error.message here: undici's message for an invalid header value quotes
      // the whole header back, which is the entire "Bearer <key>" this request tried to send.
      lastProblem =
        error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? `нет ответа за ${Math.round(timeoutMs / 1000)} с`
          : `сеть недоступна (${error?.cause?.code ?? error?.name ?? 'неизвестная ошибка'})`;
      lastRetryAfter = 0;
      continue;
    }

    const payload = await readJson(response);
    const { code, type, message } = errorOf(payload);

    if (response.status === 401 || response.status === 403) {
      throw new OpenAiError('auth', 'OpenAI не принял ключ');
    }
    if (QUOTA_CODES.has(code) || QUOTA_TYPES.has(type)) {
      throw new OpenAiError('balance', 'на счёте OpenAI недостаточно денег');
    }
    if (response.status === 429 || response.status >= 500) {
      lastProblem = `OpenAI ответил ${response.status}`;
      lastRetryAfter = retryAfterMs(response);
      continue;
    }
    if (!response.ok) {
      const detail = scrubKey(message, config.apiKey) || 'без описания';
      throw new OpenAiError('rejected', `OpenAI отклонил запрос (${response.status}: ${detail})`);
    }

    if (payload?.status === 'incomplete') {
      const reason = payload?.incomplete_details?.reason ?? 'без причины';
      throw new OpenAiError('truncated', `OpenAI оборвал ответ (${reason})`);
    }
    const refusal = refusalText(payload);
    if (refusal) {
      throw new OpenAiError('refused', `OpenAI отказался отвечать (${scrubKey(refusal, config.apiKey)})`);
    }

    const text = outputText(payload);
    if (text === '') throw new OpenAiError('rejected', 'OpenAI вернул ответ без текста');
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Strict mode makes this all but impossible, so it means something unexpected happened
      // rather than the model being sloppy. The text itself is not logged: it is the model's own
      // words about our request and has no place in a build log.
      throw new OpenAiError('rejected', 'OpenAI вернул не JSON');
    }

    const usage = payload?.usage;
    return {
      data,
      cost: costOf(usage, config),
      usage: {
        inputTokens: Number(usage?.input_tokens) || 0,
        cachedTokens: Number(usage?.input_tokens_details?.cached_tokens) || 0,
        outputTokens: Number(usage?.output_tokens) || 0,
      },
    };
  }

  throw new OpenAiError('unavailable', `OpenAI недоступен: ${lastProblem}`);
}
```

Объявить `let lastRetryAfter = 0;` рядом с `let lastProblem = '';` — она нужна циклу, чтобы пауза
перед следующей попыткой была не короче, чем просил заголовок.

- [ ] **Step 5: Проверка.** `npx vitest run tests/openai-client.test.mjs` — PASS, весь файл.

- [ ] **Step 6: Коммит.**

```bash
git add factory/texts/openai.mjs tests/helpers/openai.mjs tests/openai-client.test.mjs
git diff --cached --name-only
git commit -m "Клиент OpenAI: строгая схема, повторы, отказ и обрыв

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Шаблон описывает себя

**Files:**
- Create: `templates/review/content.json`, `templates/review/examples/casino.json`,
  `templates/review/examples/slots.json`, `factory/texts/template.mjs`
- Test: `tests/template-content.test.mjs`

**Interfaces:**
- Produces: `loadTemplateContent(templateId, root) -> { blocks, images: [min, max], lengths, home }`,
  `loadTemplateExamples(templateId, root) -> object[]` и `describeTemplate(content) -> string`.
  `describeTemplate` — единственное место, где правила шаблона превращаются в текст промпта; Task 7
  и Task 8 берут его оттуда и **не** пишут правила руками.
- Формат блока: `{ type, count?, auto?, content? }`. Число — точное значение, пара `[min, max]` —
  диапазон. `auto: true` значит «заполняет фабрика», у такого блока нет `content`.

- [ ] **Step 1: Файлы шаблона.** Скопировать две неизменённые страницы 899ok в примеры — именно
неизменённые, потому что `home.json` у владельца правлен локально:

```bash
mkdir -p templates/review/examples
cp data/sites/899ok/casino.json templates/review/examples/casino.json
cp data/sites/899ok/slots.json templates/review/examples/slots.json
git diff --stat data/sites/899ok/casino.json data/sites/899ok/slots.json
```
Последняя команда должна не напечатать ничего: если какой-то файл правлен, взять его версию из
`git show HEAD:data/sites/899ok/casino.json`.

Создать `templates/review/content.json`:

```json
{
  "blocks": [
    { "type": "hero", "content": { "title": 1, "text": [1, 2], "image": [0, 1] } },
    { "type": "toc", "auto": true },
    { "type": "section", "count": [8, 10],
      "content": { "title": 1, "text": [2, 6], "list": [0, 1], "table": [0, 1], "cards": [0, 1], "image": [0, 1] } },
    { "type": "links", "auto": true },
    { "type": "faq", "content": { "title": 1, "toggle": [5, 8] } }
  ],
  "images": [0, 3],
  "lengths": {
    "title": 60,
    "description": [120, 160],
    "h1": 60,
    "text": [200, 400],
    "listItems": [3, 8],
    "tableRows": [3, 10],
    "cards": [2, 4]
  },
  "home": { "sectionsBonus": 2 }
}
```

- [ ] **Step 2: Тест.** Создать `tests/template-content.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  describeTemplate,
  loadTemplateContent,
  loadTemplateExamples,
} from '../factory/texts/template.mjs';

let roots = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

// A throwaway template tree, so these tests never depend on what templates/review happens to hold.
function writeTemplate({ manifest, content, examples = {} }) {
  const root = mkdtempSync(join(tmpdir(), 'site-factory-template-'));
  roots.push(root);
  const dir = join(root, 'templates', 'demo');
  mkdirSync(join(dir, 'blocks'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  if (content !== undefined) {
    writeFileSync(join(dir, 'content.json'), typeof content === 'string' ? content : JSON.stringify(content));
  }
  if (Object.keys(examples).length > 0) mkdirSync(join(dir, 'examples'), { recursive: true });
  for (const [name, page] of Object.entries(examples)) {
    writeFileSync(join(dir, 'examples', name), JSON.stringify(page));
  }
  return root;
}

const MANIFEST = {
  id: 'demo',
  name: 'Demo',
  blocks: ['hero', 'toc', 'section', 'links', 'faq'],
  elements: ['title', 'text', 'list', 'table', 'cards', 'toggle', 'image'],
};
const CONTENT = {
  blocks: [
    { type: 'hero', content: { title: 1, text: [1, 2], image: [0, 1] } },
    { type: 'toc', auto: true },
    { type: 'section', count: [8, 10], content: { title: 1, text: [2, 6], list: [0, 1] } },
    { type: 'links', auto: true },
    { type: 'faq', content: { title: 1, toggle: [5, 8] } },
  ],
  images: [0, 3],
  lengths: { title: 60, description: [120, 160], h1: 60, text: [200, 400], listItems: [3, 8] },
  home: { sectionsBonus: 2 },
};

// `CONTENT` above is the raw on-disk shape, which is what `writeTemplate` needs. `describeTemplate`
// never sees that shape: its only caller hands it `loadTemplateContent`'s output, where every count
// is already a `[min, max]` pair and every block carries one. So it gets its own fixture, in the
// shape it is actually contracted to accept — feeding it the raw one would be testing a shape no
// real caller produces, and would push the "number or pair" rule into a second place in the code.
const LOADED = {
  blocks: [
    { type: 'hero', auto: false, count: [1, 1], content: { title: [1, 1], text: [1, 2], image: [0, 1] } },
    { type: 'toc', auto: true, count: [1, 1], content: {} },
    { type: 'section', auto: false, count: [8, 10], content: { title: [1, 1], text: [2, 6], list: [0, 1] } },
    { type: 'links', auto: true, count: [1, 1], content: {} },
    { type: 'faq', auto: false, count: [1, 1], content: { title: [1, 1], toggle: [5, 8] } },
  ],
  images: [0, 3],
  lengths: { title: 60, description: [120, 160], h1: 60, text: [200, 400], listItems: [3, 8] },
  home: { sectionsBonus: 2 },
};

describe('loadTemplateContent', () => {
  it('reads the blocks, the image budget and the lengths', () => {
    const root = writeTemplate({ manifest: MANIFEST, content: CONTENT });
    const content = loadTemplateContent('demo', root);
    expect(content.blocks.map((block) => block.type)).toEqual(['hero', 'toc', 'section', 'links', 'faq']);
    expect(content.blocks[2].count).toEqual([8, 10]);
    expect(content.blocks[1].auto).toBe(true);
    expect(content.images).toEqual([0, 3]);
    expect(content.lengths.text).toEqual([200, 400]);
    expect(content.home.sectionsBonus).toBe(2);
  });

  it('refuses a template with no content.json, naming it', () => {
    const root = writeTemplate({ manifest: MANIFEST });
    expect(() => loadTemplateContent('demo', root)).toThrow(/demo/);
  });

  // The manifest already says which blocks a template can render. A content.json that asks for one
  // it cannot render would generate text that silently renders as a plain section.
  it('refuses a block the manifest does not declare', () => {
    const content = { ...CONTENT, blocks: [...CONTENT.blocks, { type: 'promo', content: { text: 1 } }] };
    const root = writeTemplate({ manifest: MANIFEST, content });
    expect(() => loadTemplateContent('demo', root)).toThrow(/promo/);
  });

  it('refuses an element the manifest does not declare', () => {
    const blocks = [{ type: 'section', count: [1, 2], content: { video: 1 } }];
    const root = writeTemplate({ manifest: MANIFEST, content: { ...CONTENT, blocks } });
    expect(() => loadTemplateContent('demo', root)).toThrow(/video/);
  });

  it('refuses a range whose lower bound is above its upper one', () => {
    const blocks = [{ type: 'section', count: [10, 8], content: { text: 1 } }];
    const root = writeTemplate({ manifest: MANIFEST, content: { ...CONTENT, blocks } });
    expect(() => loadTemplateContent('demo', root)).toThrow(/section/);
  });

  it('refuses broken JSON, naming the file', () => {
    const root = writeTemplate({ manifest: MANIFEST, content: '{ not json' });
    expect(() => loadTemplateContent('demo', root)).toThrow(/content\.json/);
  });
});

describe('loadTemplateExamples', () => {
  it('reads every example page, sorted by file name', () => {
    const root = writeTemplate({
      manifest: MANIFEST,
      content: CONTENT,
      examples: {
        'b.json': { title: 'B', blocks: [] },
        'a.json': { title: 'A', blocks: [] },
      },
    });
    expect(loadTemplateExamples('demo', root).map((page) => page.title)).toEqual(['A', 'B']);
  });

  it('refuses a template with no examples at all', () => {
    const root = writeTemplate({ manifest: MANIFEST, content: CONTENT });
    expect(() => loadTemplateExamples('demo', root)).toThrow(/demo/);
  });
});

describe('describeTemplate', () => {
  it('turns the rules into prompt text that names every block and its counts', () => {
    const text = describeTemplate(LOADED);
    expect(text).toContain('hero');
    expect(text).toContain('8');
    expect(text).toContain('10');
    // A block the factory fills itself must never be described as something to write.
    expect(text).not.toContain('toc');
    expect(text).not.toContain('links');
  });
});
```

- [ ] **Step 3: Прогон.** `npx vitest run tests/template-content.test.mjs`. Ожидается FAIL: модуля
`factory/texts/template.mjs` нет.

- [ ] **Step 4: Код.** Создать `factory/texts/template.mjs`:

```js
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest, TEMPLATES_DIR } from '../../src/lib/templates.mjs';

// A template says what it can render (manifest.json: blocks and elements) and, for text
// generation, what a page made with it looks like (content.json: order, counts, lengths).
//
// content.json is the single source for both halves of the job: the factory rolls a site's
// skeleton from it, and describeTemplate() below renders the same file as the rules the model is
// given. Written twice, the two would drift; derived from one file, they cannot. That is what lets
// a new template arrive with a correct prompt and no prompt editing at all.

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Either an exact count (3) or a range ([2, 6]). Normalised to a range so callers have one shape.
function readRange(raw, where) {
  if (Number.isInteger(raw) && raw >= 0) return [raw, raw];
  const isPair =
    Array.isArray(raw) && raw.length === 2 && raw.every((n) => Number.isInteger(n) && n >= 0);
  if (!isPair || raw[0] > raw[1]) {
    throw new Error(`в ${where} нужно целое число или пара [меньше, больше] — сейчас ${JSON.stringify(raw)}`);
  }
  return [raw[0], raw[1]];
}

function contentPath(templateId, root) {
  return join(root, TEMPLATES_DIR, templateId, 'content.json');
}

export function loadTemplateContent(templateId, root = process.cwd()) {
  const file = contentPath(templateId, root);
  if (!existsSync(file)) {
    throw new Error(
      `шаблон «${templateId}» не поддерживает генерацию текстов: нет файла ${file}`,
    );
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`не удалось прочитать content.json шаблона «${templateId}»: ${error.message}`);
  }
  if (!isPlainObject(raw)) throw new Error(`content.json шаблона «${templateId}» должен быть объектом`);

  const manifest = readManifest(templateId, root);
  const knownBlocks = new Set(manifest.blocks);
  const knownElements = new Set(manifest.elements);

  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) {
    throw new Error(`в content.json шаблона «${templateId}» нужен непустой список blocks`);
  }
  const blocks = raw.blocks.map((block) => {
    if (!isPlainObject(block) || typeof block.type !== 'string' || block.type === '') {
      throw new Error(`в blocks шаблона «${templateId}» каждый блок должен иметь строковый type`);
    }
    if (!knownBlocks.has(block.type)) {
      throw new Error(
        `шаблон «${templateId}» не умеет блок «${block.type}»: его нет в blocks манифеста`,
      );
    }
    if (block.auto === true) return { type: block.type, auto: true, count: [1, 1], content: {} };
    const content = {};
    for (const [element, value] of Object.entries(isPlainObject(block.content) ? block.content : {})) {
      if (!knownElements.has(element)) {
        throw new Error(
          `шаблон «${templateId}» не умеет элемент «${element}»: его нет в elements манифеста`,
        );
      }
      content[element] = readRange(value, `блоке «${block.type}» шаблона «${templateId}»`);
    }
    return {
      type: block.type,
      auto: false,
      count: readRange(block.count ?? 1, `блоке «${block.type}» шаблона «${templateId}»`),
      content,
    };
  });

  const lengths = isPlainObject(raw.lengths) ? raw.lengths : {};
  return {
    blocks,
    images: readRange(raw.images ?? 0, `images шаблона «${templateId}»`),
    lengths,
    home: { sectionsBonus: Number(raw.home?.sectionsBonus) || 0 },
  };
}

export function loadTemplateExamples(templateId, root = process.cwd()) {
  const dir = join(root, TEMPLATES_DIR, templateId, 'examples');
  const names = existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
    : [];
  if (names.length === 0) {
    throw new Error(`у шаблона «${templateId}» нет ни одной страницы-образца в examples/`);
  }
  return names.map((name) => {
    try {
      return JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch (error) {
      throw new Error(`образец ${name} шаблона «${templateId}» не читается: ${error.message}`);
    }
  });
}

const plural = ([min, max]) => (min === max ? `exactly ${min}` : `between ${min} and ${max}`);

// The rules the model is shown, rendered from the same content.json the skeleton is rolled from.
// Blocks marked `auto` are left out on purpose: the factory builds those itself, and describing
// them would invite the model to write something that is then thrown away.
export function describeTemplate(content) {
  const lines = [];
  for (const block of content.blocks) {
    if (block.auto) continue;
    const parts = Object.entries(block.content).map(([element, range]) => `${plural(range)} ${element}`);
    const count = block.count[0] === 1 && block.count[1] === 1 ? '' : ` (${plural(block.count)} of them)`;
    lines.push(`- ${block.type}${count}: ${parts.join(', ')}`);
  }
  for (const [name, value] of Object.entries(content.lengths)) {
    const range = Array.isArray(value) ? `${value[0]}–${value[1]}` : `up to ${value}`;
    lines.push(`- ${name}: ${range} characters or items`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 5: Проверка.** `npx vitest run tests/template-content.test.mjs` — PASS. Затем проверить
настоящий шаблон:

```bash
PATH=~/.nvm/versions/node/v22.14.0/bin:$PATH node --input-type=module -e "
import { loadTemplateContent, loadTemplateExamples, describeTemplate } from './factory/texts/template.mjs';
const content = loadTemplateContent('review');
console.log(describeTemplate(content));
console.log('образцов:', loadTemplateExamples('review').length);
"
```
Ожидается: описание блоков `hero`, `section`, `faq` без `toc` и `links`, и «образцов: 2».

- [ ] **Step 6: Коммит.**

```bash
git add templates/review/content.json templates/review/examples factory/texts/template.mjs tests/template-content.test.mjs
git diff --cached --name-only
git commit -m "Шаблон описывает себя: content.json, образцы и правила для промпта

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Общий файл правил и язык по гео

**Files:**
- Create: `factory/prompts/texts.json`, `factory/texts/texts-prompts.mjs`
- Test: `tests/texts-prompts.test.mjs`

**Interfaces:**
- Produces: `loadTextsPromptFile(path) -> { rules: string[], languageByGeo: Record<string, string> }`
  и `languageFor(geo, languageByGeo) -> { locale, known }`. `known: false` значит «гео незнакомое,
  взят английский» — вызывающий пишет об этом строку в лог.

- [ ] **Step 1: Тест.** Создать `tests/texts-prompts.test.mjs`:

```js
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
```

- [ ] **Step 2: Прогон.** `npx vitest run tests/texts-prompts.test.mjs`. Ожидается FAIL: модуля нет.

- [ ] **Step 3: Файлы.** Создать `factory/prompts/texts.json`:

```json
{
  "rules": [
    "Write clear, useful, reader-focused content.",
    "Do not copy text from the examples — write completely new content.",
    "Do not mention competitors, rankings, search results or the research.",
    "Do not invent payment methods, licences, bonus amounts, withdrawal times, ratings, reviews or legal claims that are not in the examples.",
    "Avoid unsupported first-person experience, fabricated testimonials and absolute promises.",
    "Keep the meta title and description accurate and natural, without keyword stuffing."
  ],
  "languageByGeo": {
    "Bangladesh": "en-US",
    "Philippines": "en-US",
    "Pakistan": "en-US",
    "India": "en-IN",
    "Indonesia": "id-ID",
    "Mexico": "es-MX",
    "Brazil": "pt-BR"
  }
}
```

Создать `factory/texts/texts-prompts.mjs`:

```js
import { readFileSync } from 'node:fs';

// The half of the prompt that does not depend on the template: what to write like, what never to
// invent, and which language a geo speaks. Editable without touching code, like the other files in
// factory/prompts/.
//
// Everything about *structure* lives with the template instead (templates/<id>/content.json), so
// adding a template never means editing this file.

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DEFAULT_LOCALE = 'en-US';

export function loadTextsPromptFile(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`не удалось прочитать файл правил ${path}: ${error.message}`);
  }
  if (!isPlainObject(raw)) throw new Error(`файл правил ${path} должен быть объектом`);

  const { rules, languageByGeo } = raw;
  if (
    !Array.isArray(rules) ||
    rules.length === 0 ||
    rules.some((rule) => typeof rule !== 'string' || rule.trim() === '')
  ) {
    throw new Error(`в файле правил ${path} нужен непустой список rules из непустых строк`);
  }
  if (
    !isPlainObject(languageByGeo) ||
    Object.values(languageByGeo).some((locale) => typeof locale !== 'string' || locale.trim() === '')
  ) {
    throw new Error(`в файле правил ${path} languageByGeo должен быть объектом «гео → язык»`);
  }
  return {
    rules: rules.map((rule) => rule.trim()),
    // Geo names keep their exact spelling from the file here. Matching ignores case and spacing
    // over in languageFor, the one place that needs it — this loader stays a plain read-and-validate
    // step instead of a second place with its own normalization rules that could drift from the first.
    languageByGeo: Object.fromEntries(
      Object.entries(languageByGeo).map(([geo, locale]) => [geo, locale.trim()]),
    ),
  };
}

// The form's own language field wins over this; it is consulted only when that field is empty.
// An unknown geo is not an error — English is a defensible default for the markets this factory
// serves — but the caller is told, so it can say so in the log instead of quietly guessing.
//
// Looks up the geo by scanning the table's own entries with a case/space-insensitive comparison,
// rather than lower-casing the input and indexing straight into languageByGeo: object property
// lookup is case-sensitive, so a direct index would silently miss any table whose keys are not
// already all-lowercase (including the one loadTextsPromptFile hands back, which keeps the file's
// original spelling — see the comment there).
export function languageFor(geo, languageByGeo) {
  const key = String(geo ?? '').trim().toLowerCase();
  if (key !== '') {
    for (const [geoName, locale] of Object.entries(languageByGeo)) {
      if (geoName.trim().toLowerCase() === key) return { locale, known: true };
    }
  }
  return { locale: DEFAULT_LOCALE, known: false };
}
```

- [ ] **Step 4: Проверка.** `npx vitest run tests/texts-prompts.test.mjs` — PASS.

- [ ] **Step 5: Коммит.**

```bash
git add factory/prompts/texts.json factory/texts/texts-prompts.mjs tests/texts-prompts.test.mjs
git diff --cached --name-only
git commit -m "Общий файл правил генерации текстов и язык по гео

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Каркас по зерну

**Files:**
- Create: `factory/texts/skeleton.mjs`
- Test: `tests/skeleton.test.mjs`

**Interfaces:**
- Consumes: `content` из Task 3.
- Produces: `rollSkeleton({ content, pages, seed }) -> { [page]: { sections, faq, images } }`.
  Числа, не содержание. Task 7 передаёт их в схему плана как точные значения.

- [ ] **Step 1: Тест.** Создать `tests/skeleton.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { rollSkeleton } from '../factory/texts/skeleton.mjs';

const CONTENT = {
  blocks: [
    { type: 'hero', auto: false, count: [1, 1], content: { title: [1, 1], text: [1, 2] } },
    { type: 'toc', auto: true, count: [1, 1], content: {} },
    { type: 'section', auto: false, count: [8, 10], content: { title: [1, 1], text: [2, 6] } },
    { type: 'links', auto: true, count: [1, 1], content: {} },
    { type: 'faq', auto: false, count: [1, 1], content: { title: [1, 1], toggle: [5, 8] } },
  ],
  images: [0, 3],
  lengths: {},
  home: { sectionsBonus: 2 },
};
const PAGES = ['home', 'casino', 'slots', 'bonus'];

describe('rollSkeleton', () => {
  it('gives every page a section, faq and image count inside the template ranges', () => {
    const skeleton = rollSkeleton({ content: CONTENT, pages: PAGES, seed: '520bdapp' });
    expect(Object.keys(skeleton).sort()).toEqual([...PAGES].sort());
    for (const page of ['casino', 'slots', 'bonus']) {
      expect(skeleton[page].sections).toBeGreaterThanOrEqual(8);
      expect(skeleton[page].sections).toBeLessThanOrEqual(10);
      expect(skeleton[page].faq).toBeGreaterThanOrEqual(5);
      expect(skeleton[page].faq).toBeLessThanOrEqual(8);
      expect(skeleton[page].images).toBeGreaterThanOrEqual(0);
      expect(skeleton[page].images).toBeLessThanOrEqual(3);
    }
  });

  // Re-running a stopped generation must not reshuffle the pages that already exist.
  it('gives the same answer for the same seed', () => {
    const first = rollSkeleton({ content: CONTENT, pages: PAGES, seed: '520bdapp' });
    const second = rollSkeleton({ content: CONTENT, pages: PAGES, seed: '520bdapp' });
    expect(second).toEqual(first);
  });

  // This is the whole point of rolling at all: two sites in one network must not share a skeleton.
  it('gives different answers for different seeds', () => {
    const a = rollSkeleton({ content: CONTENT, pages: PAGES, seed: 'site-one' });
    const b = rollSkeleton({ content: CONTENT, pages: PAGES, seed: 'site-two' });
    expect(a).not.toEqual(b);
  });

  it('makes the home page longer than the range alone allows', () => {
    const skeleton = rollSkeleton({ content: CONTENT, pages: PAGES, seed: '520bdapp' });
    expect(skeleton.home.sections).toBeGreaterThanOrEqual(8 + 2);
    expect(skeleton.home.sections).toBeLessThanOrEqual(10 + 2);
  });

  it('does not care in which order the pages are given', () => {
    const forwards = rollSkeleton({ content: CONTENT, pages: PAGES, seed: 'x' });
    const backwards = rollSkeleton({ content: CONTENT, pages: [...PAGES].reverse(), seed: 'x' });
    expect(backwards).toEqual(forwards);
  });

  it('survives a template with no faq block and no image budget', () => {
    const content = {
      ...CONTENT,
      blocks: CONTENT.blocks.filter((block) => block.type !== 'faq'),
      images: [0, 0],
    };
    const skeleton = rollSkeleton({ content, pages: ['home'], seed: 'x' });
    expect(skeleton.home.faq).toBe(0);
    expect(skeleton.home.images).toBe(0);
  });
});
```

- [ ] **Step 2: Прогон.** `npx vitest run tests/skeleton.test.mjs`. Ожидается FAIL: модуля нет.

- [ ] **Step 3: Код.** Создать `factory/texts/skeleton.mjs`:

```js
// How big each page of this site is: how many sections, how many FAQ questions, how many pictures.
// Rolled here, before a single request is made, so the model never chooses the shape of a page and
// therefore cannot break it. Two sites made from the same template get different shapes, which is
// what keeps a network of them from looking like one stamped-out set.
//
// The roll is seeded by the site's folder name, so it is reproducible: a run that stopped halfway
// picks up with the same skeleton instead of reshuffling the pages that already exist.

// FNV-1a: a small, well-behaved string hash. Only used to turn a folder name into a seed number.
function hashSeed(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

// mulberry32: a tiny seeded generator. Math.random cannot be seeded, and nothing here needs
// cryptographic quality — only repeatability.
function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between([min, max], random) {
  if (max <= min) return min;
  return min + Math.floor(random() * (max - min + 1));
}

function blockOf(content, type) {
  return content.blocks.find((block) => block.type === type);
}

export function rollSkeleton({ content, pages, seed }) {
  const section = blockOf(content, 'section');
  const faq = blockOf(content, 'faq');
  const sectionRange = section?.count ?? [1, 1];
  const faqRange = faq?.content?.toggle ?? [0, 0];
  const bonus = content.home?.sectionsBonus ?? 0;

  const skeleton = {};
  // Sorted, so the answer depends on which pages were asked for and not on the order they arrived
  // in: the same site described two ways must come out the same.
  for (const page of [...pages].sort()) {
    // Each page gets its own generator, seeded by site and page together. Without this, adding one
    // page to the list would shift every later page's numbers.
    const random = mulberry32(hashSeed(`${seed}:${page}`));
    skeleton[page] = {
      sections: between(sectionRange, random) + (page === 'home' ? bonus : 0),
      faq: between(faqRange, random),
      images: between(content.images ?? [0, 0], random),
    };
  }
  return skeleton;
}
```

- [ ] **Step 4: Проверка.** `npx vitest run tests/skeleton.test.mjs` — PASS.

- [ ] **Step 5: Коммит.**

```bash
git add factory/texts/skeleton.mjs tests/skeleton.test.mjs
git diff --cached --name-only
git commit -m "Каркас сайта: жребий по зерну от имени папки

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Схемы ответа

**Files:**
- Create: `factory/texts/schema.mjs`
- Test: `tests/texts-schema.test.mjs`

**Interfaces:**
- Consumes: `elements` (список из манифеста шаблона) и числа каркаса из Task 5.
- Produces: `ELEMENT_KINDS`, `planSchema({ sections, faq }, elements) -> object`,
  `sectionSchema(elements) -> object`, `faqSchema(count) -> object`, плюс помощники
  `object(properties)` и `string` — Task 10 строит свою схему ими же, чтобы правила строгого
  режима были записаны в одном месте.
  Все три отдаются в `askJson` как поле `schema`.

- [ ] **Step 1: Тест.** Создать `tests/texts-schema.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { ELEMENT_KINDS, faqSchema, planSchema, sectionSchema } from '../factory/texts/schema.mjs';

const ELEMENTS = ['title', 'text', 'list', 'table', 'cards', 'toggle', 'image'];

// Strict mode is only strict if every object in the schema obeys it: additionalProperties must be
// false and every declared property must be listed as required. Checked over the whole tree rather
// than spot-checked, so a schema grown later cannot quietly break the guarantee.
function everyObjectIsStrict(node, path = 'schema') {
  const problems = [];
  if (Array.isArray(node)) {
    node.forEach((item, index) => problems.push(...everyObjectIsStrict(item, `${path}[${index}]`)));
    return problems;
  }
  if (node === null || typeof node !== 'object') return problems;
  if (node.type === 'object') {
    if (node.additionalProperties !== false) problems.push(`${path}: additionalProperties не false`);
    const declared = Object.keys(node.properties ?? {}).sort();
    const required = [...(node.required ?? [])].sort();
    if (JSON.stringify(declared) !== JSON.stringify(required)) {
      problems.push(`${path}: required ≠ properties (${required} против ${declared})`);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    problems.push(...everyObjectIsStrict(value, `${path}.${key}`));
  }
  return problems;
}

describe('planSchema', () => {
  it('pins the section and faq counts to exactly what the skeleton rolled', () => {
    const schema = planSchema({ sections: 9, faq: 6 }, ELEMENTS);
    expect(schema.properties.sections.minItems).toBe(9);
    expect(schema.properties.sections.maxItems).toBe(9);
    expect(schema.properties.faq.minItems).toBe(6);
    expect(schema.properties.faq.maxItems).toBe(6);
  });

  it('offers only the elements this template can render', () => {
    const schema = planSchema({ sections: 2, faq: 2 }, ['text', 'list']);
    expect(schema.properties.sections.items.properties.elements.items.enum).toEqual(['text', 'list']);
  });

  // Optional fields cannot be left out in strict mode; they are expressed as "or null" instead.
  it('lets the hero and a section have no picture, without dropping the field', () => {
    const schema = planSchema({ sections: 2, faq: 2 }, ELEMENTS);
    expect(schema.properties.heroImage.type).toEqual(['string', 'null']);
    expect(schema.properties.sections.items.properties.image.type).toEqual(['string', 'null']);
    expect(schema.required).toContain('heroImage');
  });

  it('is strict everywhere', () => {
    expect(everyObjectIsStrict(planSchema({ sections: 9, faq: 6 }, ELEMENTS))).toEqual([]);
  });
});

describe('sectionSchema', () => {
  it('describes every element kind the template declares, and no others', () => {
    const schema = sectionSchema(['text', 'list']);
    expect(Object.keys(schema.$defs).sort()).toEqual(['list', 'text']);
    expect(schema.properties.items.items.anyOf.map((ref) => ref.$ref)).toEqual([
      '#/$defs/text',
      '#/$defs/list',
    ]);
  });

  it('knows all seven kinds of our content format', () => {
    expect([...ELEMENT_KINDS].sort()).toEqual([...ELEMENTS].sort());
    expect(Object.keys(sectionSchema(ELEMENTS).$defs)).toHaveLength(7);
  });

  it('drops an element name it has no shape for instead of making one up', () => {
    const schema = sectionSchema(['text', 'video']);
    expect(Object.keys(schema.$defs)).toEqual(['text']);
  });

  it('refuses to build a schema with nothing in it', () => {
    expect(() => sectionSchema(['video'])).toThrow(/элемент/);
  });

  it('offers only h3, because the factory writes every section heading itself', () => {
    expect(sectionSchema(ELEMENTS).$defs.title.properties.level.enum).toEqual(['h3']);
  });

  it('is strict everywhere', () => {
    expect(everyObjectIsStrict(sectionSchema(ELEMENTS))).toEqual([]);
  });
});

describe('faqSchema', () => {
  it('pins the answer count and stays strict', () => {
    const schema = faqSchema(6);
    expect(schema.properties.answers.minItems).toBe(6);
    expect(schema.properties.answers.maxItems).toBe(6);
    expect(everyObjectIsStrict(schema)).toEqual([]);
  });
});
```

- [ ] **Step 2: Прогон.** `npx vitest run tests/texts-schema.test.mjs`. Ожидается FAIL: модуля нет.

- [ ] **Step 3: Код.** Создать `factory/texts/schema.mjs`:

```js
// The JSON schemas the model answers against. Strict mode constrains decoding itself, so these are
// not documentation — they are the thing that makes a malformed answer impossible.
//
// Two rules of strict mode shape everything below: every object must set additionalProperties to
// false, and every property it declares must be listed in `required`. A field that is genuinely
// optional is therefore expressed as "this type or null", not left out.
//
// The model answers in an intermediate shape keyed by `kind`, which assemble.mjs then turns into
// our real content format. That indirection exists because our format puts the heading level in the
// key itself ({ "type": "title", "h2": "…" }), and a schema cannot describe a key that varies.

// `enum` with a single value, not `const`: enum is on the documented list of keywords strict mode
// supports, and const is not. One less thing to be surprised by.
const kind = (name) => ({ type: 'string', enum: [name] });

// Exported: site-json.mjs builds a schema of its own and must obey the same two rules of strict
// mode. Two copies would be two places to get them wrong.
export const string = { type: 'string' };

export const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

// Declared after `string` because it uses it. Two top-level consts in the wrong order fail at
// import time, not at first call, so the whole module would refuse to load.
const strings = { type: 'array', items: string };

const ELEMENT_DEFS = {
  // Only h3. A page has exactly one h1, and every section's own h2 is written by the factory from
  // the plan, so the only heading left for the model is a subheading inside a section. Offering h2
  // here would let a section heading drift away from the table of contents built from those same
  // plan headings — the one mismatch this whole design exists to make impossible.
  title: object({ kind: kind('title'), level: { type: 'string', enum: ['h3'] }, text: { type: 'string' } }),
  text: object({ kind: kind('text'), text: { type: 'string' } }),
  list: object({ kind: kind('list'), items: strings }),
  table: object({ kind: kind('table'), columns: strings, rows: { type: 'array', items: strings } }),
  cards: object({
    kind: kind('cards'),
    cards: {
      type: 'array',
      items: object({ title: { type: 'string' }, text: { type: 'string' }, image: { type: ['string', 'null'] } }),
    },
  }),
  toggle: object({ kind: kind('toggle'), title: { type: 'string' }, text: { type: 'string' } }),
  image: object({ kind: kind('image'), name: { type: 'string' } }),
};

export const ELEMENT_KINDS = Object.freeze(Object.keys(ELEMENT_DEFS));

// The counts come from the skeleton, which has already rolled them, so minItems and maxItems are
// the same number: the model cannot return eight sections when the page is meant to have nine.
export function planSchema({ sections, faq }, elements) {
  const known = elements.filter((element) => Object.hasOwn(ELEMENT_DEFS, element));
  return object({
    title: { type: 'string' },
    description: { type: 'string' },
    h1: { type: 'string' },
    heroText: strings,
    heroImage: { type: ['string', 'null'] },
    sections: {
      type: 'array',
      minItems: sections,
      maxItems: sections,
      items: object({
        heading: { type: 'string' },
        brief: { type: 'string' },
        elements: { type: 'array', items: { type: 'string', enum: known } },
        image: { type: ['string', 'null'] },
        links: strings,
      }),
    },
    faq: { type: 'array', minItems: faq, maxItems: faq, items: { type: 'string' } },
  });
}

export function sectionSchema(elements) {
  // An element the template declares but this module has no shape for is dropped rather than
  // guessed at: inventing a shape would produce content the renderer cannot draw.
  const kinds = elements.filter((element) => Object.hasOwn(ELEMENT_DEFS, element));
  if (kinds.length === 0) {
    throw new Error('ни один элемент шаблона не описан схемой — генерировать нечего');
  }
  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: { anyOf: kinds.map((name) => ({ $ref: `#/$defs/${name}` })) },
      },
    },
    required: ['items'],
    additionalProperties: false,
    $defs: Object.fromEntries(kinds.map((name) => [name, ELEMENT_DEFS[name]])),
  };
}

// The FAQ is filled in one request: the questions are already in the plan, so only the answers come
// back, in the same order.
export function faqSchema(count) {
  return object({
    answers: { type: 'array', minItems: count, maxItems: count, items: { type: 'string' } },
  });
}
```

- [ ] **Step 4: Проверка.** `npx vitest run tests/texts-schema.test.mjs` — PASS, включая обе
проверки строгости по всему дереву.

- [ ] **Step 5: Коммит.**

```bash
git add factory/texts/schema.mjs tests/texts-schema.test.mjs
git diff --cached --name-only
git commit -m "Схемы ответа: план, секция и FAQ в строгом режиме

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Этап 1 — план страницы

**Files:**
- Create: `factory/texts/plan.mjs`
- Test: `tests/texts-plan.test.mjs`

**Interfaces:**
- Consumes: `askJson` (Task 2), `describeTemplate` (Task 3), `planSchema` (Task 6).
- Produces: `buildInstructions({ rules, templateText, examples }) -> string`,
  `trimPlan(plan, { budgets, pages, sectionContent }) -> { plan, warnings }` и
  `planPage({ page, pages, brand, geo, locale, budgets, elements, sectionContent, instructions },
  { config, fetchFn, sleep }) -> { plan, warnings, cost, usage }`.
- `budgets` — это `{ sections, faq, images }` из Task 5. `sectionContent` — `block.content` блока
  `section` из Task 3, то есть диапазоны на каждый вид элемента.

- [ ] **Step 1: Тест.** Создать `tests/texts-plan.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { buildInstructions, planPage, trimPlan } from '../factory/texts/plan.mjs';

const CONFIG = {
  apiKey: 'sentinel-openai-key-plan-4f92',
  apiUrl: 'https://openai.test/v1/responses',
  model: 'gpt-5.6-luna',
  priceInput: 0.2,
  priceCachedInput: 0.02,
  priceOutput: 1.2,
};
const SECTION_CONTENT = { title: [1, 1], text: [2, 6], list: [0, 1], table: [0, 1], image: [0, 1] };
const PAGES = ['home', 'casino', 'bonus'];

function plannedSection(overrides = {}) {
  return { heading: 'Payments', brief: 'how to pay', elements: ['text', 'text'], image: null, links: [], ...overrides };
}

function answer(plan) {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(plan) }] }],
      usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } },
    }),
    { status: 200 },
  );
}

describe('buildInstructions', () => {
  it('puts the rules, the template description and the examples in one unchanging block', () => {
    const text = buildInstructions({
      rules: ['Be clear.'],
      templateText: '- section: between 8 and 10',
      examples: [{ title: 'Casino', blocks: [] }],
    });
    expect(text).toContain('Be clear.');
    expect(text).toContain('between 8 and 10');
    expect(text).toContain('"title": "Casino"');
  });

  // The prompt cache only hits on an unchanged prefix, so nothing page-specific may live here.
  it('does not change from page to page', () => {
    const args = { rules: ['Be clear.'], templateText: 'x', examples: [] };
    expect(buildInstructions(args)).toBe(buildInstructions(args));
  });
});

describe('trimPlan', () => {
  const budgets = { sections: 2, faq: 2, images: 1 };

  it('keeps a plan that is already inside its budgets, with nothing to say', () => {
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: null,
      sections: [plannedSection(), plannedSection()], faq: ['q1', 'q2'],
    };
    const result = trimPlan(plan, { budgets, pages: PAGES, sectionContent: SECTION_CONTENT });
    expect(result.warnings).toEqual([]);
    expect(result.plan.sections).toHaveLength(2);
  });

  it('drops pictures over the page budget, keeping the earliest', () => {
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: 'hero-shot',
      sections: [plannedSection({ image: 'one' }), plannedSection({ image: 'two' })], faq: ['q1', 'q2'],
    };
    const result = trimPlan(plan, { budgets, pages: PAGES, sectionContent: SECTION_CONTENT });
    expect(result.plan.heroImage).toBe('hero-shot');
    expect(result.plan.sections.map((section) => section.image)).toEqual([null, null]);
    expect(result.warnings.join(' ')).toMatch(/картин/i);
  });

  it('drops a link to a page this site does not have', () => {
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: null,
      sections: [plannedSection({ links: ['/casino', '/nope'] }), plannedSection()], faq: ['q1', 'q2'],
    };
    const result = trimPlan(plan, { budgets, pages: PAGES, sectionContent: SECTION_CONTENT });
    expect(result.plan.sections[0].links).toEqual(['/casino']);
    expect(result.warnings.join(' ')).toContain('/nope');
  });

  it('drops elements asked for more often than the template allows', () => {
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: null,
      sections: [plannedSection({ elements: ['text', 'text', 'list', 'list', 'list'] }), plannedSection()],
      faq: ['q1', 'q2'],
    };
    const result = trimPlan(plan, { budgets, pages: PAGES, sectionContent: SECTION_CONTENT });
    expect(result.plan.sections[0].elements.filter((e) => e === 'list')).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain('list');
  });
});

describe('planPage', () => {
  it('asks with the page brief and gives back a trimmed plan and what it cost', async () => {
    let body;
    const fetchFn = async (_url, init) => {
      body = JSON.parse(init.body);
      return answer({
        title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: null,
        sections: [plannedSection()], faq: ['q1'],
      });
    };
    const result = await planPage(
      {
        page: 'casino', pages: PAGES, brand: 'Acme', geo: 'Bangladesh', locale: 'en-US',
        budgets: { sections: 1, faq: 1, images: 1 },
        elements: ['title', 'text', 'list', 'table', 'image'],
        sectionContent: SECTION_CONTENT,
        instructions: 'RULES',
      },
      { config: CONFIG, fetchFn, sleep: async () => {} },
    );

    expect(body.instructions).toBe('RULES');
    expect(String(body.input[0].content)).toContain('casino');
    expect(String(body.input[0].content)).toContain('Acme');
    expect(body.text.format.schema.properties.sections.minItems).toBe(1);
    expect(body.prompt_cache_key).toContain('plan');
    expect(result.plan.h1).toBe('H');
    expect(result.cost).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Прогон.** `npx vitest run tests/texts-plan.test.mjs`. Ожидается FAIL: модуля нет.

- [ ] **Step 3: Код.** Создать `factory/texts/plan.mjs`:

```js
import { askJson } from './openai.mjs';
import { planSchema } from './schema.mjs';

// Stage one: what the page is about, before a word of it is written. The answer is small and cheap,
// which is the point — it buys coherence (sections that do not repeat one another, links spread
// sensibly) without paying for prose until the shape is agreed.

// Everything here is identical for every page of every site built from this template, so it goes in
// `instructions` and is what the prompt cache actually caches. Nothing page-specific may be added:
// one changed byte and every later request pays full price.
export function buildInstructions({ rules, templateText, examples }) {
  const parts = [
    'You are writing content for a website. Return only what the schema asks for.',
    rules.join('\n'),
    'The page must follow this structure:',
    templateText,
    'Examples of finished pages in this template — follow their structure and depth, never their wording:',
    ...examples.map((example) => JSON.stringify(example, null, 2)),
  ];
  return parts.join('\n\n');
}

// There is deliberately no check for a section having FEWER elements than the template's minimum.
// `title` in a section's `elements` means an optional h3 subheading; the section's own heading is a
// different channel entirely (the plan's `heading` field, always present). Comparing the two would
// misfire on every well-formed plan that simply does not add a subheading — including the example in
// the design document. Shortfalls are not among the trims the design asks for, either.
//
// The schema already pins the number of sections and questions. What it cannot express is a budget
// spread across the page (pictures) or a per-kind limit inside one list (at most one table), so
// those are enforced here, by trimming rather than by refusing: a plan that is slightly too rich is
// still a good plan once the extras are taken off.
export function trimPlan(plan, { budgets, pages, sectionContent }) {
  const warnings = [];
  const allowed = new Set(pages.map((page) => (page === 'home' ? '/' : `/${page}`)));

  let imagesLeft = budgets.images;
  let heroImage = plan.heroImage ?? null;
  if (heroImage && imagesLeft > 0) imagesLeft -= 1;
  else if (heroImage) {
    // Reported like every other trim: a picture that quietly vanishes is the one the owner asks
    // about later, having no way to tell it from a picture the model never asked for.
    warnings.push(`картинка «${heroImage}» в шапке сверх бюджета — убрана`);
    heroImage = null;
  }

  const sections = plan.sections.map((section) => {
    let image = section.image ?? null;
    if (image && imagesLeft > 0) imagesLeft -= 1;
    else if (image) {
      warnings.push(`картинка «${image}» в разделе «${section.heading}» сверх бюджета — убрана`);
      image = null;
    }

    const links = section.links.filter((href) => {
      const ok = allowed.has(href) || href.startsWith('#');
      if (!ok) warnings.push(`ссылка ${href} в разделе «${section.heading}» ведёт в никуда — убрана`);
      return ok;
    });

    const used = new Map();
    const elements = section.elements.filter((element) => {
      const max = sectionContent[element]?.[1] ?? 0;
      const seen = used.get(element) ?? 0;
      if (seen >= max) {
        warnings.push(`элемент ${element} в разделе «${section.heading}» сверх нормы шаблона — убран`);
        return false;
      }
      used.set(element, seen + 1);
      return true;
    });

    return { ...section, image, links, elements };
  });

  return { plan: { ...plan, heroImage, sections }, warnings };
}

export async function planPage(
  { page, pages, brand, geo, locale, budgets, elements, sectionContent, instructions },
  options,
) {
  const brief = [
    `Brand: ${brand}`,
    `Geo: ${geo}`,
    `Language: ${locale}`,
    `Page: ${page}`,
    `Pages on this site: ${pages.join(', ')}`,
    `This page has ${budgets.sections} sections, ${budgets.faq} FAQ questions and at most ${budgets.images} pictures.`,
    'Plan the page: a heading and a one-line brief for each section, which elements suit it, where a',
    'picture belongs and which other pages are worth linking to. Do not write the body text yet.',
  ].join('\n');

  const { data, cost, usage } = await askJson(
    {
      instructions,
      input: brief,
      schemaName: 'page_plan',
      schema: planSchema(budgets, elements),
      // One cache per call type: the schema is part of the cached prefix, and plan and fill have
      // different schemas, so they cannot share an entry anyway.
      cacheKey: 'site-factory-plan',
    },
    options,
  );

  const { plan, warnings } = trimPlan(data, { budgets, pages, sectionContent });
  return { plan, warnings, cost, usage };
}
```

- [ ] **Step 4: Проверка.** `npx vitest run tests/texts-plan.test.mjs` — PASS.

- [ ] **Step 5: Коммит.**

```bash
git add factory/texts/plan.mjs tests/texts-plan.test.mjs
git diff --cached --name-only
git commit -m "Этап 1: план страницы и подрезка под бюджеты шаблона

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Этап 2 — наполнение секции и FAQ

**Files:**
- Create: `factory/texts/fill.mjs`
- Test: `tests/texts-fill.test.mjs`

**Interfaces:**
- Consumes: `askJson` (Task 2), `sectionSchema` и `faqSchema` (Task 6), план из Task 7.
- Produces: `fillSection({ section, siblings, brand, locale, instructions, attempts }, options) ->
  { items, cost, usage }` и `fillFaq({ questions, brand, locale, instructions, attempts }, options)
  -> { answers, cost, usage }`. `items` — элементы в промежуточном виде с ключом `kind`; в наш
  формат их переводит Task 9.
- `attempts` по умолчанию 3: одна попытка и два повтора, как требует спецификация.

- [ ] **Step 1: Тест.** Создать `tests/texts-fill.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { fillFaq, fillSection } from '../factory/texts/fill.mjs';

const CONFIG = {
  apiKey: 'sentinel-openai-key-fill-7c30',
  apiUrl: 'https://openai.test/v1/responses',
  model: 'gpt-5.6-luna',
  priceInput: 0.2,
  priceCachedInput: 0.02,
  priceOutput: 1.2,
};
const SECTION = { heading: 'Payments', brief: 'how to pay', elements: ['title', 'text'], image: null, links: ['/bonus'] };

function answer(data) {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
      usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } },
    }),
    { status: 200 },
  );
}
const truncated = () =>
  new Response(
    JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }),
    { status: 200 },
  );

const ITEMS = { items: [{ kind: 'text', text: 'Body.' }, { kind: 'text', text: 'More.' }] };
const run = (overrides, fetchFn) =>
  fillSection(
    { section: SECTION, siblings: ['Bonuses', 'Games'], brand: 'Acme', locale: 'en-US', instructions: 'RULES', ...overrides },
    { config: CONFIG, fetchFn, sleep: async () => {} },
  );

describe('fillSection', () => {
  it('asks only for this section, and tells the model what the neighbours cover', async () => {
    let body;
    const result = await run({}, async (_url, init) => {
      body = JSON.parse(init.body);
      return answer(ITEMS);
    });

    expect(body.instructions).toBe('RULES');
    const input = String(body.input[0].content);
    expect(input).toContain('Payments');
    expect(input).toContain('how to pay');
    // Without the neighbours, every section drifts into saying the same thing.
    expect(input).toContain('Bonuses');
    expect(input).toContain('Games');
    // The section heading is the factory's to write, so the plan's first "title" is taken off the
    // list and only "text" is left to ask for.
    expect(Object.keys(body.text.format.schema.$defs)).toEqual(['text']);
    expect(result.items).toHaveLength(2);
  });

  it('asks again when the answer was cut off, and keeps the one that worked', async () => {
    let calls = 0;
    const result = await run({}, async () => {
      calls += 1;
      return calls === 1 ? truncated() : answer(ITEMS);
    });
    expect(calls).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it('gives up after the allowed number of attempts and says why', async () => {
    let calls = 0;
    await expect(
      run({ attempts: 3 }, async () => {
        calls += 1;
        return truncated();
      }),
    ).rejects.toMatchObject({ kind: 'truncated' });
    expect(calls).toBe(3);
  });

  it('does not retry a refusal that is really a rejected request', async () => {
    let calls = 0;
    await expect(
      run({}, async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { message: 'bad schema' } }), { status: 400 });
      }),
    ).rejects.toMatchObject({ kind: 'rejected' });
    expect(calls).toBe(1);
  });
});

describe('fillFaq', () => {
  it('answers every question in one request, in order', async () => {
    let body;
    const result = await fillFaq(
      { questions: ['Is it safe?', 'How fast?'], brand: 'Acme', locale: 'en-US', instructions: 'RULES' },
      {
        config: CONFIG,
        sleep: async () => {},
        fetchFn: async (_url, init) => {
          body = JSON.parse(init.body);
          return answer({ answers: ['Yes.', 'Fast.'] });
        },
      },
    );
    expect(body.text.format.schema.properties.answers.minItems).toBe(2);
    expect(result.answers).toEqual(['Yes.', 'Fast.']);
  });
});
```

- [ ] **Step 2: Прогон.** `npx vitest run tests/texts-fill.test.mjs`. Ожидается FAIL: модуля нет.

- [ ] **Step 3: Код.** Создать `factory/texts/fill.mjs`:

```js
import { askJson } from './openai.mjs';
import { faqSchema, sectionSchema } from './schema.mjs';

// Stage two: the words. One request per section, each small enough that running into the output
// limit is a surprise rather than a routine hazard — which is the whole reason the page is not
// written in one go.

const DEFAULT_ATTEMPTS = 3;

// Two failures are the model's, not the request's: refusing, and running out of room. Both are
// worth asking again, because the same request can succeed the second time. Everything else —
// a rejected request, a bad key, an empty balance — will fail the same way forever, so retrying it
// would only spend time and money.
const WORTH_ASKING_AGAIN = new Set(['refused', 'truncated']);

async function askWithRetries(request, options, attempts) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await askJson(request, options);
    } catch (error) {
      if (!WORTH_ASKING_AGAIN.has(error?.kind)) throw error;
      last = error;
    }
  }
  throw last;
}

export async function fillSection(
  { section, siblings, brand, locale, instructions, attempts = DEFAULT_ATTEMPTS },
  options,
) {
  // The section's own heading is written by the factory, from the plan, so that the table of
  // contents and the heading itself can never disagree. The plan still lists a "title" element,
  // because the rendered section really does have one — so exactly one is taken off here, leaving
  // any second one as the subheading the model is meant to write.
  let headingTaken = false;
  const wanted = section.elements.filter((element) => {
    if (element === 'title' && !headingTaken) {
      headingTaken = true;
      return false;
    }
    return true;
  });

  const brief = [
    `Brand: ${brand}`,
    `Language: ${locale}`,
    `Section heading: ${section.heading}`,
    `What this section covers: ${section.brief}`,
    `Write these elements, in this order: ${wanted.join(', ')}`,
    section.links.length > 0 ? `Link to these pages from inside the text, using [words](/path): ${section.links.join(', ')}` : '',
    // The neighbours are named but not quoted: enough for the model to stay off their topics,
    // cheap enough to send with every section.
    `Other sections of this page, which you must not duplicate: ${siblings.join('; ')}`,
  ]
    .filter(Boolean)
    .join('\n');

  const { data, cost, usage } = await askWithRetries(
    {
      instructions,
      input: brief,
      schemaName: 'section_content',
      schema: sectionSchema(wanted),
      cacheKey: 'site-factory-fill',
    },
    options,
    attempts,
  );
  return { items: data.items, cost, usage };
}

export async function fillFaq(
  { questions, brand, locale, instructions, attempts = DEFAULT_ATTEMPTS },
  options,
) {
  const brief = [
    `Brand: ${brand}`,
    `Language: ${locale}`,
    'Answer each question in two or three sentences, in the same order:',
    ...questions.map((question, index) => `${index + 1}. ${question}`),
  ].join('\n');

  const { data, cost, usage } = await askWithRetries(
    { instructions, input: brief, schemaName: 'faq_answers', schema: faqSchema(questions.length), cacheKey: 'site-factory-faq' },
    options,
    attempts,
  );
  return { answers: data.answers, cost, usage };
}
```

- [ ] **Step 4: Проверка.** `npx vitest run tests/texts-fill.test.mjs` — PASS.

- [ ] **Step 5: Коммит.**

```bash
git add factory/texts/fill.mjs tests/texts-fill.test.mjs
git diff --cached --name-only
git commit -m "Этап 2: наполнение секций и FAQ с повтором на обрыве и отказе

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Сборка страницы и проверки

**Files:**
- Create: `factory/texts/assemble.mjs`
- Test: `tests/texts-assemble.test.mjs`

**Interfaces:**
- Consumes: план из Task 7, `items` из Task 8.
- Produces: `assemblePage({ plan, sections, faq, pages, labels, lengths }) -> { page, warnings }`.
  - `lengths` — `content.lengths` из Task 3.
  - `sections` — `[{ heading, items }]`, где `items` в промежуточном виде с ключом `kind`.
  - `faq` — `[{ question, answer }]`.
  - `labels` — `{ toc, links, faq }`, заголовки служебных блоков на языке сайта, из Task 10.
  - `page` — готовый объект страницы нашего формата, годный для записи в `data/sites/<сайт>/`.

- [ ] **Step 1: Тест.** Создать `tests/texts-assemble.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { assemblePage } from '../factory/texts/assemble.mjs';

const LABELS = { toc: 'Contents', links: 'Other pages', faq: 'Questions' };
const PAGES = ['home', 'casino', 'bonus'];

const PLAN = {
  title: 'Casino guide',
  description: 'A description of the page.',
  h1: 'Casino guide',
  heroText: ['Opening words.'],
  heroImage: null,
  sections: [
    { heading: 'Payments', brief: '', elements: ['title', 'text'], image: null, links: ['/bonus'] },
    { heading: 'Games', brief: '', elements: ['title', 'text'], image: 'games-shot', links: [] },
  ],
  faq: ['Is it safe?'],
};
const SECTIONS = [
  { heading: 'Payments', items: [{ kind: 'text', text: 'Pay with [the bonus](/bonus) first.' }] },
  { heading: 'Games', items: [{ kind: 'text', text: 'Many games.' }, { kind: 'image', name: 'games-shot' }] },
];
const FAQ = [{ question: 'Is it safe?', answer: 'Yes.' }];

const LENGTHS = { title: 60, description: [120, 160], h1: 60, text: [200, 400] };
const build = (overrides = {}) =>
  assemblePage({ plan: PLAN, sections: SECTIONS, faq: FAQ, pages: PAGES, labels: LABELS, lengths: LENGTHS, ...overrides });

const blockOf = (page, type) => page.blocks.find((block) => block.type === type);

describe('assemblePage', () => {
  it('builds the page in our own content format, in template order', () => {
    const { page } = build();
    expect(page.title).toBe('Casino guide');
    expect(page.description).toBe('A description of the page.');
    expect(page.blocks.map((block) => block.type)).toEqual(['hero', 'toc', 'section', 'section', 'links', 'faq']);
    expect(blockOf(page, 'hero').content[0]).toEqual({ type: 'title', h1: 'Casino guide' });
  });

  // The one coupling the model used to break on every page: the table of contents is built from the
  // section headings, so it cannot disagree with them.
  it('builds the table of contents from the section headings, in order', () => {
    const { page } = build();
    const list = blockOf(page, 'toc').content.find((item) => item.type === 'list');
    expect(list.items).toEqual(['Payments', 'Games']);
  });

  it('writes each section heading itself, ahead of what the model returned', () => {
    const { page } = build();
    const first = page.blocks.filter((block) => block.type === 'section')[0];
    expect(first.content[0]).toEqual({ type: 'title', h2: 'Payments' });
    expect(first.content[1].type).toBe('text');
  });

  it('names the service blocks in the language of the site', () => {
    const { page } = build();
    expect(blockOf(page, 'toc').content[0]).toEqual({ type: 'title', h2: 'Contents' });
    expect(blockOf(page, 'links').content[0]).toEqual({ type: 'title', h2: 'Other pages' });
    expect(blockOf(page, 'faq').content[0]).toEqual({ type: 'title', h2: 'Questions' });
  });

  it('turns the FAQ into toggles, question and answer together', () => {
    const { page } = build();
    expect(blockOf(page, 'faq').content[1]).toEqual({ type: 'toggle', title: 'Is it safe?', text: 'Yes.' });
  });

  it('keeps a link to a page this site really has', () => {
    const { page } = build();
    const text = page.blocks.filter((block) => block.type === 'section')[0].content[1];
    expect(text.text).toContain('[the bonus](/bonus)');
  });

  it('unwraps a link to a page that does not exist, keeping the words', () => {
    const sections = [
      { heading: 'Payments', items: [{ kind: 'text', text: 'See [the app](/app) for more.' }] },
      SECTIONS[1],
    ];
    const { page, warnings } = build({ sections });
    const text = page.blocks.filter((block) => block.type === 'section')[0].content[1];
    expect(text.text).toBe('See the app for more.');
    expect(warnings.join(' ')).toContain('/app');
  });

  it('drops a picture the plan never asked for', () => {
    const sections = [
      { heading: 'Payments', items: [{ kind: 'image', name: 'never-planned' }] },
      SECTIONS[1],
    ];
    const { page, warnings } = build({ sections });
    const first = page.blocks.filter((block) => block.type === 'section')[0];
    expect(JSON.stringify(first)).not.toContain('never-planned');
    expect(warnings.join(' ')).toContain('never-planned');
  });

  it('keeps the picture the plan did ask for', () => {
    const { page } = build();
    const second = page.blocks.filter((block) => block.type === 'section')[1];
    expect(second.content).toContainEqual({ image: 'games-shot' });
  });

  it('turns every element kind into its own shape', () => {
    const sections = [
      {
        heading: 'Everything',
        items: [
          { kind: 'title', level: 'h3', text: 'Sub' },
          { kind: 'list', items: ['one', 'two'] },
          { kind: 'table', columns: ['A'], rows: [['1'], ['2']] },
          { kind: 'cards', cards: [{ title: 'C', text: 'T', image: null }] },
          { kind: 'toggle', title: 'Q', text: 'A' },
        ],
      },
      SECTIONS[1],
    ];
    const content = build({ sections }).page.blocks.filter((block) => block.type === 'section')[0].content;
    expect(content[1]).toEqual({ type: 'title', h3: 'Sub' });
    expect(content[2]).toEqual({ type: 'list', items: ['one', 'two'] });
    expect(content[3]).toEqual({ type: 'table', columns: ['A'], rows: [['1'], ['2']] });
    expect(content[4]).toEqual({ type: 'cards', items: [{ title: 'C', text: 'T' }] });
    expect(content[5]).toEqual({ type: 'toggle', title: 'Q', text: 'A' });
  });

  it('puts the hero picture in when the plan asked for one', () => {
    const { page } = build({ plan: { ...PLAN, heroImage: 'hero-shot' } });
    expect(blockOf(page, 'hero').content).toContainEqual({ image: 'hero-shot' });
  });

  // Lengths are reported, never enforced: cutting a paragraph mid-sentence is worse than a long
  // paragraph, and the engine does not care either way.
  it('mentions a paragraph well outside the template length, without touching it', () => {
    const sections = [
      { heading: 'Payments', items: [{ kind: 'text', text: 'Short.' }] },
      SECTIONS[1],
    ];
    const { page, warnings } = build({ sections });
    const written = page.blocks.filter((block) => block.type === 'section')[0].content[1];
    expect(written.text).toBe('Short.');
    expect(warnings.join(' ')).toContain('text');
  });

  it('mentions an h1 longer than the template allows, without shortening it', () => {
    const h1 = 'A headline far longer than the sixty characters this template asks a heading to keep';
    const { page, warnings } = build({ plan: { ...PLAN, h1 } });
    expect(blockOf(page, 'hero').content[0]).toEqual({ type: 'title', h1 });
    expect(warnings.join(' ')).toContain('h1');
  });

  it('leaves exactly one h1 on the page', () => {
    const { page } = build();
    const h1s = JSON.stringify(page).match(/"h1"/g) ?? [];
    expect(h1s).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Прогон.** `npx vitest run tests/texts-assemble.test.mjs`. Ожидается FAIL: модуля нет.

- [ ] **Step 3: Код.** Создать `factory/texts/assemble.mjs`:

```js
// Turns a plan and a pile of filled sections into one page of our own content format.
//
// Everything structural happens here rather than in the model: the table of contents is built from
// the section headings, each section's own heading is written from the plan, and the service blocks
// are labelled in the site's language. The couplings that a model breaks most often — a contents
// list that does not match the sections, a second h1, a link to a page that was never made — are
// not checked here so much as made impossible by construction.

// [words](/target). Deliberately narrow: no nesting, no whitespace tricks, the same shape the
// engine's own link parser accepts (see docs/content-format.md).
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function hrefsOf(pages) {
  return new Set(pages.map((page) => (page === 'home' ? '/' : `/${page}`)));
}

// A link is kept only when it points at a page this site actually has, or at an anchor on this one.
// Anything else — an invented external address, a page from the example site — loses its brackets
// and stays as plain words, which reads fine and links nowhere.
function keepLinks(text, allowed, warnings) {
  return String(text).replace(LINK, (whole, label, href) => {
    if (href.startsWith('#') || allowed.has(href)) return whole;
    warnings.push(`ссылка ${href} ведёт в никуда — осталась текстом`);
    return label;
  });
}

function toElement(item, { images, allowed, warnings }) {
  const link = (text) => keepLinks(text, allowed, warnings);
  const picture = (name) => {
    if (name && images.has(name)) return name;
    if (name) warnings.push(`картинка «${name}» не объявлена планом — убрана`);
    return '';
  };

  switch (item.kind) {
    case 'title':
      return { type: 'title', [item.level]: item.text };
    case 'text':
      return { type: 'text', text: link(item.text) };
    case 'list':
      return { type: 'list', items: item.items.map(link) };
    case 'table':
      return { type: 'table', columns: item.columns, rows: item.rows.map((row) => row.map(link)) };
    case 'cards':
      return {
        type: 'cards',
        items: item.cards.map((card) => {
          const image = picture(card.image);
          return { title: card.title, text: link(card.text), ...(image ? { image } : {}) };
        }),
      };
    case 'toggle':
      return { type: 'toggle', title: item.title, text: link(item.text) };
    case 'image': {
      const image = picture(item.name);
      return image ? { image } : null;
    }
    default:
      // Strict mode should make this unreachable; dropping beats writing something the renderer
      // would silently skip anyway.
      warnings.push(`элемент неизвестного вида «${item.kind}» — пропущен`);
      return null;
  }
}

// Lengths from content.json are reported, never enforced. Trimming a paragraph to fit would cut it
// mid-sentence, which is worse than a long paragraph, and the engine imposes no limit of its own —
// these numbers exist so the layout stays pleasant, not so the build can fail.
function noteLength(what, value, range, warnings) {
  if (!range) return;
  const [min, max] = Array.isArray(range) ? range : [0, range];
  const length = String(value).length;
  if (length > max) warnings.push(`${what}: ${length} знаков вместо ${max} — оставлено как есть`);
  else if (min > 0 && length < min) warnings.push(`${what}: ${length} знаков вместо ${min} — оставлено как есть`);
}

export function assemblePage({ plan, sections, faq, pages, labels, lengths = {} }) {
  const warnings = [];
  const allowed = hrefsOf(pages);
  const images = new Set(
    [plan.heroImage, ...plan.sections.map((section) => section.image)].filter(Boolean),
  );
  const context = { images, allowed, warnings };

  const hero = {
    type: 'hero',
    content: [
      { type: 'title', h1: plan.h1 },
      ...(plan.heroImage ? [{ image: plan.heroImage }] : []),
      ...plan.heroText.map((text) => ({ type: 'text', text: keepLinks(text, allowed, warnings) })),
    ],
  };

  // Built from the headings, not from anything the model wrote: one entry per section, same order.
  const toc = {
    type: 'toc',
    content: [
      { type: 'title', h2: labels.toc },
      { type: 'list', items: sections.map((section) => section.heading) },
    ],
  };

  const body = sections.map((section) => ({
    type: 'section',
    content: [
      { type: 'title', h2: section.heading },
      ...section.items
        .map((item) => {
          // Named after the content-format field, like the page's own title and description below:
          // the warning points at what to look for in content.json, not at a synonym for it.
          if (item.kind === 'text') noteLength('text абзаца', item.text, lengths.text, warnings);
          return toElement(item, context);
        })
        .filter(Boolean),
    ],
  }));

  // The "other pages" grid is drawn from site.json's own menu, so this block only needs its title.
  const links = { type: 'links', content: [{ type: 'title', h2: labels.links }] };

  const questions = {
    type: 'faq',
    content: [
      { type: 'title', h2: labels.faq },
      ...faq.map((entry) => ({
        type: 'toggle',
        title: entry.question,
        text: keepLinks(entry.answer, allowed, warnings),
      })),
    ],
  };

  noteLength('title страницы', plan.title, lengths.title, warnings);
  noteLength('description страницы', plan.description, lengths.description, warnings);
  // The h1 belongs here with them: content.json gives it a limit, it is the most prominent text on
  // the page, and unlike the item counts it is never trimmed anywhere earlier in the pipeline.
  noteLength('h1 страницы', plan.h1, lengths.h1, warnings);

  return {
    page: {
      title: plan.title,
      description: plan.description,
      blocks: [hero, toc, ...body, links, questions],
    },
    warnings,
  };
}
```

- [ ] **Step 4: Проверка.** `npx vitest run tests/texts-assemble.test.mjs` — PASS, все 13 тестов.

- [ ] **Step 5: Коммит.**

```bash
git add factory/texts/assemble.mjs tests/texts-assemble.test.mjs
git diff --cached --name-only
git commit -m "Сборка страницы: оглавление из заголовков, проверка ссылок и картинок

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: site.json на языке сайта

**Files:**
- Create: `factory/texts/site-json.mjs`
- Test: `tests/texts-site-json.test.mjs`

**Interfaces:**
- Consumes: `askJson` (Task 2).
- Produces: `generateSiteJson({ brand, geo, locale, domain, pages, instructions }, options) ->
  { site, labels, cost, usage }`. `labels` — `{ toc, links, faq }` для Task 9, `site` — готовый
  объект `site.json`.
- `payments` в футере **не генерируется**: выдумывать способы оплаты запрещено правилами. Список
  остаётся пустым, владелец заполняет его сам.

- [ ] **Step 1: Тест.** Создать `tests/texts-site-json.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { generateSiteJson } from '../factory/texts/site-json.mjs';

const CONFIG = {
  apiKey: 'sentinel-openai-key-site-1a55',
  apiUrl: 'https://openai.test/v1/responses',
  model: 'gpt-5.6-luna',
  priceInput: 0.2,
  priceCachedInput: 0.02,
  priceOutput: 1.2,
};

const ANSWER = {
  tagline: 'Juegos en vivo cada dia.',
  navLabels: ['Casino', 'Bonos'],
  footer: {
    ageWarning: '18+',
    ageText: 'Debes tener 18 anos.',
    quickLinksTitle: 'ENLACES',
    paymentsTitle: 'PAGOS',
    copyright: '© Acme 2026.',
  },
  blockLabels: { toc: 'Contenido', links: 'Otras paginas', faq: 'Preguntas' },
};

function answer(data) {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
      usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } },
    }),
    { status: 200 },
  );
}

const run = (fetchFn) =>
  generateSiteJson(
    {
      brand: 'Acme',
      geo: 'Mexico',
      locale: 'es-MX',
      domain: 'acme.mx',
      pages: ['home', 'casino', 'bonus'],
      instructions: 'RULES',
    },
    { config: CONFIG, fetchFn, sleep: async () => {} },
  );

describe('generateSiteJson', () => {
  it('builds site.json with the menu in the language of the site', async () => {
    const { site } = await run(async () => answer(ANSWER));
    expect(site.domain).toBe('acme.mx');
    expect(site.locale).toBe('es-MX');
    expect(site.brand).toEqual({ name: 'Acme', tagline: 'Juegos en vivo cada dia.' });
    // Addresses are the factory's, labels are the model's: a page added to the list turns up in the
    // menu on its own.
    expect(site.nav).toEqual([
      { label: 'Casino', href: '/casino' },
      { label: 'Bonos', href: '/bonus' },
    ]);
  });

  it('leaves the home page out of the menu', async () => {
    let body;
    const { site } = await run(async (_url, init) => {
      body = JSON.parse(init.body);
      return answer(ANSWER);
    });
    expect(site.nav.map((item) => item.href)).not.toContain('/');
    // Two menu items for three pages: the schema asks for exactly as many labels as there are
    // pages besides home.
    expect(body.text.format.schema.properties.navLabels.minItems).toBe(2);
  });

  it('never invents payment methods', async () => {
    const { site } = await run(async () => answer(ANSWER));
    expect(site.footer.payments).toEqual([]);
    expect(site.footer.paymentsTitle).toBe('PAGOS');
  });

  it('hands the service-block labels to the page assembler', async () => {
    const { labels } = await run(async () => answer(ANSWER));
    expect(labels).toEqual({ toc: 'Contenido', links: 'Otras paginas', faq: 'Preguntas' });
  });

  it('reports what it cost', async () => {
    const { cost } = await run(async () => answer(ANSWER));
    expect(cost).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Прогон.** `npx vitest run tests/texts-site-json.test.mjs`. Ожидается FAIL: модуля нет.

- [ ] **Step 3: Код.** Создать `factory/texts/site-json.mjs`:

```js
import { askJson } from './openai.mjs';
import { object, string } from './schema.mjs';

// Everything a reader sees that is not a page: the menu, the footer, the age warning, the tagline,
// and the headings of the blocks the factory builds itself. Without this, a Spanish site would
// arrive with an English menu — the pages translated and the frame left behind.
//
// Addresses are the factory's and labels are the model's, so a page added to the list turns up in
// the menu and the footer on its own.

function siteSchema(menuSize) {
  return object({
    tagline: string,
    navLabels: { type: 'array', minItems: menuSize, maxItems: menuSize, items: string },
    footer: object({
      ageWarning: string,
      ageText: string,
      quickLinksTitle: string,
      paymentsTitle: string,
      copyright: string,
    }),
    // The factory writes these blocks itself, so their headings are the only part of them the model
    // is asked for — in the site's language, like everything else here.
    blockLabels: object({ toc: string, links: string, faq: string }),
  });
}

export async function generateSiteJson({ brand, geo, locale, domain, pages, instructions }, options) {
  const menu = pages.filter((page) => page !== 'home');
  const brief = [
    `Brand: ${brand}`,
    `Geo: ${geo}`,
    `Language: ${locale}`,
    `Menu pages, in this order: ${menu.join(', ')}`,
    'Write the site frame: a short tagline, one menu label per page above, the footer texts and the',
    'headings of the contents, other-pages and FAQ blocks. Everything in the language above.',
  ].join('\n');

  const { data, cost, usage } = await askJson(
    { instructions, input: brief, schemaName: 'site_frame', schema: siteSchema(menu.length), cacheKey: 'site-factory-site' },
    options,
  );

  return {
    site: {
      domain,
      locale,
      brand: { name: brand, tagline: data.tagline },
      nav: menu.map((page, index) => ({ label: data.navLabels[index], href: `/${page}` })),
      footer: {
        ...data.footer,
        // Payment methods are a fact about the client's business, not something to write. The rules
        // forbid inventing them, so the list is left for the owner to fill in.
        payments: [],
      },
    },
    labels: data.blockLabels,
    cost,
    usage,
  };
}
```

- [ ] **Step 4: Проверка.** `npx vitest run tests/texts-site-json.test.mjs` — PASS.

- [ ] **Step 5: Коммит.**

```bash
git add factory/texts/site-json.mjs tests/texts-site-json.test.mjs
git diff --cached --name-only
git commit -m "site.json на языке сайта: меню, футер и заголовки служебных блоков

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Оркестровка и команда

**Files:**
- Create: `factory/texts/generate-site.mjs`, `scripts/generate-texts.mjs`
- Modify: `package.json`
- Test: `tests/generate-site.test.mjs`

**Interfaces:**
- Consumes: всё, что сделали задачи 1–10.
- Produces: `generateSite({ siteDir, templateId, brand, geo, locale, pages, config, root, promptFile,
  fetchFn, sleep, log }) -> { written: string[], skipped: string[], cost: number }`.
  Функция **никогда не бросает наружу**: любая беда — строка в логе.
- Готовые файлы не перезаписываются. Кадр сайта (`site.json`) запрашивается всегда, потому что из
  него берутся заголовки служебных блоков, но на диск пишется только если файла ещё нет.

- [ ] **Step 1: Тест.** Создать `tests/generate-site.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSite } from '../factory/texts/generate-site.mjs';

const SENTINEL = 'sentinel-openai-key-site-run-6e12';
const CONFIG = {
  apiKey: SENTINEL,
  apiKeyInvalid: false,
  apiUrl: 'https://openai.test/v1/responses',
  model: 'gpt-5.6-luna',
  concurrency: 1,
  priceInput: 0.2,
  priceCachedInput: 0.02,
  priceOutput: 1.2,
};
const PAGES = ['home', 'casino'];

let dirs = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function siteDir() {
  const dir = mkdtempSync(join(tmpdir(), 'site-factory-generate-site-'));
  dirs.push(dir);
  return join(dir, 'newsite');
}

function reply(data) {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
      usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 900 } },
    }),
    { status: 200 },
  );
}

// Answers by schema name, which is how the three call types tell themselves apart.
function fakeOpenAi({ failPlanFor = '' } = {}) {
  const asked = [];
  const fetchFn = async (_url, init) => {
    const body = JSON.parse(init.body);
    const name = body.text.format.name;
    asked.push(name);
    if (name === 'site_frame') {
      const size = body.text.format.schema.properties.navLabels.minItems;
      return reply({
        tagline: 'Tagline.',
        navLabels: Array.from({ length: size }, (_, index) => `Page ${index + 1}`),
        footer: { ageWarning: '18+', ageText: 'Adults only.', quickLinksTitle: 'LINKS', paymentsTitle: 'PAY', copyright: '© 2026.' },
        blockLabels: { toc: 'Contents', links: 'Other pages', faq: 'Questions' },
      });
    }
    if (name === 'page_plan') {
      if (failPlanFor && String(body.input[0].content).includes(`Page: ${failPlanFor}`)) {
        return new Response(JSON.stringify({ error: { message: 'no' } }), { status: 400 });
      }
      const sections = body.text.format.schema.properties.sections.minItems;
      const faq = body.text.format.schema.properties.faq.minItems;
      return reply({
        title: 'T', description: 'D', h1: 'H', heroText: ['Hero.'], heroImage: null,
        sections: Array.from({ length: sections }, (_, index) => ({
          heading: `Section ${index + 1}`, brief: 'b', elements: ['title', 'text'], image: null, links: [],
        })),
        faq: Array.from({ length: faq }, (_, index) => `Question ${index + 1}?`),
      });
    }
    if (name === 'faq_answers') {
      const count = body.text.format.schema.properties.answers.minItems;
      return reply({ answers: Array.from({ length: count }, () => 'An answer.') });
    }
    return reply({ items: [{ kind: 'text', text: 'Body text of the section.' }] });
  };
  return { fetchFn, asked };
}

const run = (dir, overrides = {}) => {
  const lines = [];
  return generateSite({
    siteDir: dir, templateId: 'review', brand: 'Acme', geo: 'Bangladesh', locale: '',
    pages: PAGES, config: CONFIG, root: process.cwd(),
    promptFile: join('factory', 'prompts', 'texts.json'),
    sleep: async () => {}, log: (line) => lines.push(line),
    ...overrides,
  }).then((summary) => ({ summary, lines }));
};

describe('generateSite', () => {
  it('writes a page file per page, plus site.json', async () => {
    const dir = siteDir();
    const { summary } = await run(dir, fakeOpenAi());
    expect(summary.written.sort()).toEqual(['casino.json', 'home.json', 'site.json']);
    expect(existsSync(join(dir, 'home.json'))).toBe(true);
    const page = JSON.parse(readFileSync(join(dir, 'casino.json'), 'utf8'));
    expect(page.blocks[0].type).toBe('hero');
    expect(page.blocks.at(-1).type).toBe('faq');
    const site = JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8'));
    expect(site.nav).toEqual([{ label: 'Page 1', href: '/casino' }]);
  });

  it('takes the language from the geo when the form left it empty', async () => {
    const dir = siteDir();
    await run(dir, fakeOpenAi());
    expect(JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8')).locale).toBe('en-US');
  });

  it('reports what the run cost', async () => {
    const dir = siteDir();
    const { summary, lines } = await run(dir, fakeOpenAi());
    expect(summary.cost).toBeGreaterThan(0);
    expect(lines.join('\n')).toMatch(/\$\d+\.\d{4}/);
  });

  // A run that stopped halfway must carry on, not start over and pay twice.
  it('skips pages that are already on disk', async () => {
    const dir = siteDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'home.json'), JSON.stringify({ title: 'Mine', blocks: [] }));
    const { summary } = await run(dir, fakeOpenAi());
    expect(summary.skipped).toContain('home.json');
    expect(JSON.parse(readFileSync(join(dir, 'home.json'), 'utf8')).title).toBe('Mine');
    expect(summary.written).toContain('casino.json');
  });

  // One page failing is one page missing, not a lost run.
  it('keeps the other pages when one of them fails', async () => {
    const dir = siteDir();
    const { summary, lines } = await run(dir, fakeOpenAi({ failPlanFor: 'casino' }));
    expect(summary.written).toContain('home.json');
    expect(summary.written).not.toContain('casino.json');
    expect(lines.join('\n')).toContain('casino');
    // Paid for and lost is still paid for: the plan request for the failed page was billed.
    expect(summary.cost).toBeGreaterThan(0);
  });

  it('stops the whole run when the balance is empty, instead of failing page by page', async () => {
    const dir = siteDir();
    let calls = 0;
    const { summary, lines } = await run(dir, {
      fetchFn: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(
            JSON.stringify({
              status: 'completed',
              output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
                tagline: 't', navLabels: ['Casino'],
                footer: { ageWarning: '18+', ageText: 'a', quickLinksTitle: 'L', paymentsTitle: 'P', copyright: 'c' },
                blockLabels: { toc: 'C', links: 'O', faq: 'Q' },
              }) }] }],
              usage: { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 0 } },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'no funds' } }), { status: 429 });
      },
    });
    expect(summary.written).toEqual(['site.json']);
    expect(lines.join('\n')).toContain('остановлен');
    // The frame, then one page that failed — never a second attempt at the same wall.
    expect(calls).toBe(2);
  });

  it('says so and does nothing at all without a key', async () => {
    const dir = siteDir();
    const { summary, lines } = await run(dir, { ...fakeOpenAi(), config: { ...CONFIG, apiKey: '' } });
    expect(summary.written).toEqual([]);
    expect(lines.join('\n')).toContain('ключ');
    expect(existsSync(dir)).toBe(false);
  });

  it('never lets the key into the log or into a written file', async () => {
    const dir = siteDir();
    const { lines } = await run(dir, fakeOpenAi());
    expect(lines.join('\n')).not.toContain(SENTINEL);
    for (const name of ['home.json', 'casino.json', 'site.json']) {
      expect(readFileSync(join(dir, name), 'utf8')).not.toContain(SENTINEL);
    }
    expect(Object.values(process.env).some((value) => value?.includes(SENTINEL))).toBe(false);
  });

  it('refuses a template that cannot describe itself, without spending anything', async () => {
    const dir = siteDir();
    const fake = fakeOpenAi();
    const { summary, lines } = await run(dir, { ...fake, templateId: 'no-such-template' });
    expect(fake.asked).toEqual([]);
    expect(summary.cost).toBe(0);
    expect(lines.join('\n')).toContain('no-such-template');
  });
});

// The real proof: what this writes is a site folder Astro can build, not merely valid JSON.
describe('a generated folder builds', () => {
  it('passes a real Astro build', async () => {
    const dir = siteDir();
    await run(dir, fakeOpenAi());
    const { execFileSync } = await import('node:child_process');
    const out = join(dir, '..', 'out');
    execFileSync(join('node_modules', '.bin', 'astro'), ['build'], {
      env: { ...process.env, SITE_DIR: dir, TEMPLATE: 'review', SCHEME: 'dark', OUT_DIR: out, SITE_URL: 'https://example.com' },
      stdio: 'pipe',
    });
    expect(existsSync(join(out, 'index.html'))).toBe(true);
    expect(readFileSync(join(out, 'casino', 'index.html'), 'utf8')).toContain('Section 1');
  }, 120_000);
});
```

- [ ] **Step 2: Прогон.** `npx vitest run tests/generate-site.test.mjs`. Ожидается FAIL: модуля нет.

- [ ] **Step 3: Код.** Создать `factory/texts/generate-site.mjs`:

```js
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildInstructions, planPage } from './plan.mjs';
import { fillFaq, fillSection } from './fill.mjs';
import { assemblePage } from './assemble.mjs';
import { generateSiteJson } from './site-json.mjs';
import { rollSkeleton } from './skeleton.mjs';
import { describeTemplate, loadTemplateContent, loadTemplateExamples } from './template.mjs';
import { languageFor, loadTextsPromptFile } from './texts-prompts.mjs';
import { readManifest } from '../../src/lib/templates.mjs';

// The whole stage, start to finish. Like the picture and logo steps it never throws: every problem
// becomes one line in the log, because a half-written folder the owner can look at and re-run beats
// an exception in a terminal.

const formatCost = (cost) => `$${cost.toFixed(4)}`;

function writeIfNew(file, data) {
  // 'wx' makes the write itself the check: a file that appeared since the existsSync above is not
  // quietly overwritten. Nothing here ever replaces content that is already on disk.
  try {
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

export async function generateSite({
  siteDir,
  templateId,
  brand,
  geo,
  locale,
  pages,
  config,
  root = process.cwd(),
  promptFile,
  fetchFn,
  sleep,
  log = () => {},
}) {
  const summary = { written: [], skipped: [], cost: 0 };

  if (!config?.apiKey) {
    const reason = config?.apiKeyInvalid
      ? 'ключ OpenAI в .env записан неверно (недопустимые символы (пробелы, переносы строк, не-ASCII))'
      : 'ключ OpenAI не задан в .env';
    log(`Тексты: ${reason} — пропущены`);
    return summary;
  }

  // Everything that can be refused for free is checked before the first paid request.
  let content;
  let examples;
  let promptSet;
  let elements;
  try {
    content = loadTemplateContent(templateId, root);
    examples = loadTemplateExamples(templateId, root);
    elements = readManifest(templateId, root).elements;
    promptSet = loadTextsPromptFile(promptFile);
  } catch (error) {
    log(`Тексты: ${error.message} — пропущены`);
    return summary;
  }
  if (!pages.includes('home')) {
    log('Тексты: в списке страниц нет home — у сайта не будет главной, пропущено');
    return summary;
  }

  const byGeo = languageFor(geo, promptSet.languageByGeo);
  const language = locale.trim() || byGeo.locale;
  if (locale.trim() === '' && !byGeo.known) {
    log(`Тексты: гео «${geo}» незнакомое — язык взят английский`);
  }

  const instructions = buildInstructions({
    rules: promptSet.rules,
    templateText: describeTemplate(content),
    examples,
  });
  const sectionContent = content.blocks.find((block) => block.type === 'section')?.content ?? {};
  // Seeded by the folder name, so a re-run of a stopped generation keeps the same shapes.
  const skeleton = rollSkeleton({ content, pages, seed: siteDir.split(/[/\\]/).filter(Boolean).at(-1) });
  const options = { config, fetchFn, sleep };

  // Inside a try like everything else: this function's contract is that nothing ever throws out of
  // it, and an unwritable path or a plain file sitting on that name would otherwise reject the
  // promise — which the command awaits at top level with no catch, turning it into a stack trace.
  try {
    mkdirSync(siteDir, { recursive: true });
  } catch (error) {
    log(`Тексты: не удалось создать папку сайта — ${error.message} — пропущены`);
    return summary;
  }

  // Asked for every time, even on a re-run: the service-block headings live only in this answer,
  // and the pages below cannot be assembled without them. Only the file is protected, not the call.
  let labels;
  try {
    const frame = await generateSiteJson(
      { brand, geo, locale: language, domain: '', pages, instructions },
      options,
    );
    summary.cost += frame.cost;
    labels = frame.labels;
    const name = 'site.json';
    if (writeIfNew(join(siteDir, name), frame.site)) summary.written.push(name);
    else summary.skipped.push(name);
  } catch (error) {
    log(`Тексты: кадр сайта не получился — ${error.message}. Пропущено, ${formatCost(summary.cost)}`);
    return summary;
  }

  for (const page of pages) {
    const name = `${page}.json`;
    if (existsSync(join(siteDir, name))) {
      summary.skipped.push(name);
      log(`Тексты: ${name} уже есть — пропущена`);
      continue;
    }

    const started = Date.now();
    let spent = 0;
    try {
      const budgets = skeleton[page];
      const planned = await planPage(
        { page, pages, brand, geo, locale: language, budgets, elements, sectionContent, instructions },
        options,
      );
      spent += planned.cost;
      for (const warning of planned.warnings) log(`Тексты: ${name}: ${warning}`);
      // The plan is the only place a section's own heading exists, so it is what the assembler is
      // given below — never a heading a filled section happened to contain.

      const headings = planned.plan.sections.map((section) => section.heading);
      const sections = [];
      for (const [index, section] of planned.plan.sections.entries()) {
        const siblings = headings.filter((_, other) => other !== index);
        try {
          const filled = await fillSection(
            { section, siblings, brand, locale: language, instructions },
            options,
          );
          spent += filled.cost;
          sections.push({ heading: section.heading, items: filled.items });
        } catch (error) {
          // A bad key or an empty balance is not this section's problem — it is the run's, and it
          // answers the same way for every request left. Swallowing it here would spend a whole
          // page's worth of doomed requests before the outer handler ever saw it, so it is thrown
          // on. Everything else really is local: one section short is a shorter page, not a lost one.
          if (error?.kind === 'auth' || error?.kind === 'balance') throw error;
          log(`Тексты: ${name}: раздел «${section.heading}» не вышел — ${error.message}`);
          sections.push({ heading: section.heading, items: [] });
        }
      }

      let faq = [];
      if (planned.plan.faq.length > 0) {
        const answered = await fillFaq(
          { questions: planned.plan.faq, brand, locale: language, instructions },
          options,
        );
        spent += answered.cost;
        faq = planned.plan.faq.map((question, index) => ({
          question,
          answer: answered.answers[index] ?? '',
        }));
      }

      const { page: built, warnings } = assemblePage({
        plan: planned.plan,
        sections,
        faq,
        pages,
        labels,
        lengths: content.lengths,
      });
      for (const warning of warnings) log(`Тексты: ${name}: ${warning}`);

      if (writeIfNew(join(siteDir, name), built)) summary.written.push(name);
      else summary.skipped.push(name);
      log(`Тексты: ${name} готова — ${((Date.now() - started) / 1000).toFixed(1)} с, ${formatCost(spent)}`);
    } catch (error) {
      log(`Тексты: ${name} не вышла — ${error.message}, потрачено ${formatCost(spent)}`);
      // A bad key or an empty balance answers the same way for every page left. Carrying on would
      // just repeat the same failure once per page, slowly, so the run stops here instead. The cost
      // is not added here: `finally` below runs on the way out of a `break` too, and adding it in
      // both places counted this page's spend twice.
      if (error?.kind === 'auth' || error?.kind === 'balance') {
        log('Тексты: прогон остановлен — остальные страницы не пробовались');
        break;
      }
    } finally {
      summary.cost += spent;
    }
  }

  log(`Тексты: готово, страниц ${summary.written.length}, всего ${formatCost(summary.cost)}`);
  return summary;
}
```

Создать `scripts/generate-texts.mjs`:

```js
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOpenAiConfig } from '../factory/texts/env.mjs';
import { generateSite } from '../factory/texts/generate-site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The same escape hatch generate-images.mjs has, so tests never read the owner's real .env.
const ENV_FILE = process.env.OPENAI_ENV_FILE || join(ROOT, '.env');

function flags(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    values[argv[index].slice(2)] = argv[index + 1] ?? '';
  }
  return values;
}

const { template = 'review', out = '', brand = '', geo = '', locale = '', pages = '' } = flags(
  process.argv.slice(2),
);

if (out === '' || brand === '') {
  console.error(
    'Использование: npm run generate:texts -- --template review --out <папка> --brand <бренд> --geo <гео> [--locale en-US] [--pages home,casino]',
  );
  process.exit(1);
}

const list = pages
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

await generateSite({
  siteDir: join(ROOT, 'data', 'sites', out),
  templateId: template,
  brand,
  geo,
  locale,
  pages: list.length > 0 ? list : ['home'],
  config: readOpenAiConfig(ENV_FILE),
  root: ROOT,
  promptFile: join(ROOT, 'factory', 'prompts', 'texts.json'),
  log: (line) => console.log(line),
});
```

В `package.json` в `scripts` дописать после `generate:images`:

```json
    "generate:texts": "node scripts/generate-texts.mjs"
```

- [ ] **Step 4: Проверка.** `npx vitest run tests/generate-site.test.mjs` — PASS, включая настоящую
сборку Astro (она идёт под минуту, это нормально).

- [ ] **Step 5: Коммит.**

```bash
git add factory/texts/generate-site.mjs scripts/generate-texts.mjs package.json tests/generate-site.test.mjs
git diff --cached --name-only
git commit -m "Оркестровка генерации текстов и команда generate:texts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Вкладка «Тексты» и документация

**Files:**
- Modify: `factory/server.mjs`, `factory/public/index.html`, `factory/public/app.js`, `README.md`
- Test: `tests/server.test.mjs`

**Interfaces:**
- Produces: `startJob({ domain }, work) -> job` в `factory/server.mjs` — запись того же вида, что у
  `startBuild`, но без Astro, поэтому существующий `GET /api/builds/:id/log` показывает её лог без
  единой правки.
- Produces: `POST /api/texts` с телом `{ template, out, brand, geo, locale, pages }` → `{ jobId, site }`.
  `pages` — строка со страницами через запятую или перенос строки, либо список строк.

- [ ] **Step 1: Тесты сервера.** В `tests/server.test.mjs` дописать в конец файла:

```js
describe('the texts tab writes a whole site folder', () => {
  const siteId = 'texts-generation-fixture';
  const siteDir = join('data', 'sites', siteId);
  const SENTINEL = 'sentinel-openai-key-server-texts-2f8c';
  let envDir;
  let textsServer;
  let textsBase;

  const reply = (data) =>
    new Response(
      JSON.stringify({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
        usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } },
      }),
      { status: 200 },
    );

  beforeAll(async () => {
    rmSync(siteDir, { recursive: true, force: true });
    envDir = mkdtempSync(join(tmpdir(), 'site-factory-texts-env-'));
    writeFileSync(join(envDir, '.env'), `OPENAI_API_KEY=${SENTINEL}\n`);
    const fetchFn = async (_url, init) => {
      const body = JSON.parse(init.body);
      const { name, schema } = body.text.format;
      if (name === 'site_frame') {
        const size = schema.properties.navLabels.minItems;
        return reply({
          tagline: 'Tagline.',
          navLabels: Array.from({ length: size }, (_, i) => `Page ${i + 1}`),
          footer: { ageWarning: '18+', ageText: 'Adults only.', quickLinksTitle: 'LINKS', paymentsTitle: 'PAY', copyright: '© 2026.' },
          blockLabels: { toc: 'Contents', links: 'Other pages', faq: 'Questions' },
        });
      }
      if (name === 'page_plan') {
        const sections = schema.properties.sections.minItems;
        const faq = schema.properties.faq.minItems;
        return reply({
          title: 'T', description: 'D', h1: 'H', heroText: ['Hero.'], heroImage: null,
          sections: Array.from({ length: sections }, (_, i) => ({
            heading: `Section ${i + 1}`, brief: 'b', elements: ['title', 'text'], image: null, links: [],
          })),
          faq: Array.from({ length: faq }, (_, i) => `Question ${i + 1}?`),
        });
      }
      if (name === 'faq_answers') {
        const count = schema.properties.answers.minItems;
        return reply({ answers: Array.from({ length: count }, () => 'An answer.') });
      }
      return reply({ items: [{ kind: 'text', text: 'Body text.' }] });
    };
    textsServer = createApp({ envFile: join(envDir, '.env'), fetchFn }).listen(0);
    await new Promise((resolve) => textsServer.once('listening', resolve));
    textsBase = `http://127.0.0.1:${textsServer.address().port}`;
  });

  afterAll(() => {
    textsServer?.close();
    rmSync(siteDir, { recursive: true, force: true });
    rmSync(envDir, { recursive: true, force: true });
  });

  const start = (payload) =>
    fetch(`${textsBase}/api/texts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  it('writes the pages and site.json, and the new folder is listed as a site', async () => {
    const response = await start({
      template: 'review', out: siteId, brand: 'Acme', geo: 'Bangladesh', pages: 'home\ncasino',
    });
    expect(response.status).toBe(200);
    const { jobId } = await response.json();
    const log = await readUntilDone(jobId, textsBase);
    expect(log).toContain('event: done');
    expect(log).not.toContain(SENTINEL);

    expect(existsSync(join(siteDir, 'home.json'))).toBe(true);
    expect(existsSync(join(siteDir, 'casino.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(siteDir, 'site.json'), 'utf8')).nav).toHaveLength(1);

    // The point of the whole tab: the folder is now a site the Генерация tab can build.
    const sites = await fetch(`${textsBase}/api/sites`).then((r) => r.json());
    expect(sites.sites.some((site) => site.id === siteId)).toBe(true);
  });

  it('refuses a page list with no home page, before spending anything', async () => {
    const response = await start({ template: 'review', out: 'texts-no-home', brand: 'Acme', pages: 'casino' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('home');
    expect(existsSync(join('data', 'sites', 'texts-no-home'))).toBe(false);
  });

  it('refuses a template that cannot describe itself', async () => {
    const response = await start({ template: 'nope', out: 'texts-bad-template', brand: 'Acme', pages: 'home' });
    expect(response.status).toBe(400);
  });

  it('refuses a second run into the same folder while the first is going', async () => {
    const payload = { template: 'review', out: 'texts-busy', brand: 'Acme', pages: 'home' };
    const first = await start(payload).then((r) => r.json());
    const second = await start(payload);
    expect(second.status).toBe(409);
    await readUntilDone(first.jobId, textsBase);
    rmSync(join('data', 'sites', 'texts-busy'), { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Прогон.** `npx vitest run tests/server.test.mjs`. Ожидается FAIL: маршрута
`/api/texts` нет, ответ 404.

- [ ] **Step 3: Сервер.** В `factory/server.mjs` добавить импорты рядом с существующими:

```js
import { readOpenAiConfig } from './texts/env.mjs';
import { generateSite } from './texts/generate-site.mjs';
```

и константу рядом с `LOGO_PROMPTS_FILE`:

```js
const TEXTS_PROMPTS_FILE = join(HERE, 'prompts', 'texts.json');
```

Сразу после `startBuild` добавить:

```js
// A job that is not a build: same record, same log stream, no Astro. Generating texts writes a site
// folder instead of building one, but the form should watch it exactly the same way — so it shares
// `builds` and therefore GET /api/builds/:id/log without that route knowing anything new.
export function startJob({ domain }, work) {
  const job = { id: randomUUID(), status: 'running', domain, outDir: '', lines: [], listeners: new Set() };
  builds.set(job.id, job);
  Promise.resolve()
    .then(() => work((line) => pushLine(job, line)))
    .then(() => finishBuild(job, 'ok'))
    .catch((error) => {
      pushLine(job, `Не удалось: ${error.message}`);
      finishBuild(job, 'failed');
    });
  return job;
}
```

В `createApp`, сразу после маршрута `/api/generate`, добавить:

```js
  app.post('/api/texts', (req, res) => {
    const body = req.body ?? {};

    const templateInput = trimmedString(body.template);
    const template = templateInput || listTemplates(ROOT)[0]?.id || '';
    if (!listTemplates(ROOT).some((candidate) => candidate.id === template)) {
      res.status(400).json({ error: `Шаблон «${template}» не найден` });
      return;
    }
    // A template with no content.json cannot be generated for at all, and saying so now costs
    // nothing — finding out after the first paid request would not.
    try {
      loadTemplateContent(template, ROOT);
    } catch (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    const site = safeName(body.out, '');
    if (site === '') {
      res.status(400).json({ error: 'Нужно имя папки для нового сайта' });
      return;
    }
    const brand = trimmedString(body.brand);
    if (brand === '') {
      res.status(400).json({ error: 'Нужно название бренда' });
      return;
    }

    const raw = Array.isArray(body.pages) ? body.pages : String(body.pages ?? '').split(/[\s,]+/);
    const pages = [...new Set(raw.map((name) => safeName(name, '')).filter(Boolean))];
    if (!pages.includes('home')) {
      res.status(400).json({ error: 'В списке страниц нужна home — иначе у сайта не будет главной' });
      return;
    }

    if (isBuildRunning(site)) {
      res.status(409).json({ error: `Для папки «${site}» уже что-то выполняется` });
      return;
    }

    const job = startJob({ domain: site }, async (log) => {
      await generateSite({
        siteDir: join(SITES_DIR, site),
        templateId: template,
        brand,
        geo: trimmedString(body.geo),
        locale: trimmedString(body.locale),
        pages,
        config: readOpenAiConfig(envFile),
        root: ROOT,
        promptFile: TEXTS_PROMPTS_FILE,
        fetchFn,
        log,
      });
    });

    res.json({ jobId: job.id, site });
  });
```

Дописать импорт `loadTemplateContent`:

```js
import { loadTemplateContent } from './texts/template.mjs';
```

- [ ] **Step 4: Форма.** В `factory/public/index.html` добавить кнопку вкладки после «Генерация»:

```html
      <button class="tab" type="button" data-tab="texts">Тексты</button>
```

и панель после секции `data-panel="generate"`:

```html
      <section class="panel" data-panel="texts">
        <p class="hint">Шаблон, бренд, гео и список страниц → готовая папка сайта в data/sites/</p>

        <form id="texts-form" class="grid">
          <fieldset class="card">
            <legend>Новый сайт</legend>
            <label>Шаблон<select name="template" id="texts-template"></select></label>
            <label>Папка<input name="out" type="text" placeholder="520bdapp" required /></label>
            <label>Бренд<input name="brand" type="text" placeholder="520BD" required /></label>
            <label>Гео<input name="geo" type="text" placeholder="Bangladesh" /></label>
            <label>Язык<input name="locale" type="text" placeholder="пусто — по гео" /></label>
          </fieldset>

          <fieldset class="card">
            <legend>Страницы</legend>
            <label>По одной на строку<textarea name="pages" id="texts-pages" rows="9"></textarea></label>
            <p class="note">Имя файла становится адресом и задаёт тему страницы. home обязательна</p>
          </fieldset>

          <fieldset class="card">
            <legend>Результат</legend>
            <p class="status" id="texts-status" aria-live="polite">Готово к генерации</p>
            <p class="note">Папка появится в списке сайтов на вкладке «Генерация»</p>
          </fieldset>
        </form>

        <button class="primary" id="texts-submit" type="submit" form="texts-form">Сгенерировать тексты</button>
        <pre class="log" id="texts-log" aria-live="polite"></pre>
      </section>
```

- [ ] **Step 5: Поведение формы.** В `factory/public/app.js` дописать в конец файла:

```js
// The texts tab. It watches its job through the very same log stream a build uses, so there is
// nothing new to learn here: post, then follow /api/builds/<id>/log until it says done.
const textsForm = document.querySelector('#texts-form');
const textsSubmit = document.querySelector('#texts-submit');
const textsStatus = document.querySelector('#texts-status');
const textsLog = document.querySelector('#texts-log');
const textsPages = document.querySelector('#texts-pages');

const DEFAULT_PAGES = ['home', 'casino', 'slots', 'games', 'betting', 'bonus', 'app', 'login'];
textsPages.value = DEFAULT_PAGES.join('\n');

function followTextsJob(jobId) {
  const stream = new EventSource(`/api/builds/${jobId}/log`);
  stream.addEventListener('message', (event) => {
    textsLog.textContent += `${JSON.parse(event.data)}\n`;
    textsLog.scrollTop = textsLog.scrollHeight;
  });
  stream.addEventListener('done', (event) => {
    stream.close();
    textsSubmit.disabled = false;
    const ok = JSON.parse(event.data) === 'ok';
    textsStatus.textContent = ok ? 'Готово — папка появилась на вкладке «Генерация»' : 'Не получилось — смотри лог';
    textsStatus.className = ok ? 'status is-ok' : 'status is-bad';
    // The new folder only shows up in the site picker once the lists are read again.
    if (ok) loadLists();
  });
  stream.addEventListener('error', () => {
    stream.close();
    textsSubmit.disabled = false;
    textsStatus.textContent = 'Связь с сервером прервалась';
    textsStatus.className = 'status is-bad';
  });
}

textsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  textsSubmit.disabled = true;
  textsLog.textContent = '';
  textsStatus.textContent = 'Пишем тексты…';
  textsStatus.className = 'status';

  const payload = Object.fromEntries(new FormData(textsForm).entries());
  try {
    const response = await fetch('/api/texts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      textsStatus.textContent = data.error ?? 'Сервер отклонил запрос';
      textsStatus.className = 'status is-bad';
      textsSubmit.disabled = false;
      return;
    }
    followTextsJob(data.jobId);
  } catch (error) {
    textsStatus.textContent = `Ошибка запроса: ${error.message}`;
    textsStatus.className = 'status is-bad';
    textsSubmit.disabled = false;
  }
});
```

В функции `loadLists` после строки `fillSelect(document.querySelector('#field-template'), templates.templates);`
дописать:

```js
    fillSelect(document.querySelector('#texts-template'), templates.templates);
```

- [ ] **Step 6: Документация.** В `README.md` после раздела «Картинки и логотип» добавить:

```markdown
## Тексты

Вкладка «Тексты» пишет папку нового сайта целиком: страницы, `site.json` и метки картинок. На входе
шаблон, имя папки, бренд, гео, язык и список страниц — по одной на строку. Имя страницы становится
её адресом и задаёт тему: `bonus` → `/bonus`. Страница `home` обязательна.

Структуру задаёт шаблон, а не сайт-образец: `templates/<id>/content.json` описывает порядок блоков,
сколько их и какой длины текст, а `templates/<id>/examples/` держит одну-две готовые страницы.
Промпт собирается из этих файлов, поэтому новый шаблон получает корректный промпт сам — править
промпт под каждый шаблон не нужно.

Каркас каждого сайта (сколько секций, вопросов и картинок) фабрика разыгрывает сама, по зерну от
имени папки. Поэтому сайты сети отличаются друг от друга по структуре, а повторный запуск той же
папки даёт те же формы и пропускает уже написанные страницы.

Готовая папка появляется в списке сайтов на вкладке «Генерация». Дальше всё как обычно: логотип,
картинки, сборка.

```bash
npm run generate:texts -- --template review --out 520bdapp \
  --brand "520BD" --geo Bangladesh --pages home,casino,slots,bonus
```

Ключ OpenAI лежит в том же `.env`, что и ключ Runware. Цену OpenAI в ответе не присылает, поэтому
фабрика считает её из счётчиков токенов и цен в `.env` — сменили `OPENAI_MODEL`, поменяйте и три
`OPENAI_PRICE_*`, иначе лог будет врать. Подробности — в
`docs/specs/2026-09-17-text-generation-design.md`.
```

- [ ] **Step 7: Проверка.** `npm test` — весь набор зелёный. Затем поднять фабрику и посмотреть
вкладку глазами:

```bash
PATH=~/.nvm/versions/node/v22.14.0/bin:$PATH PORT=3010 npm run dev
```
Открыть `http://localhost:3010`, вкладка «Тексты»: список шаблонов заполнен, страницы заполнены по
умолчанию, консоль браузера без ошибок. Без ключа в `.env` запуск должен дать в логе строку
«Тексты: ключ OpenAI не задан в .env — пропущены» и завершиться, ничего не записав.

- [ ] **Step 8: Коммит.**

```bash
git add factory/server.mjs factory/public/index.html factory/public/app.js README.md tests/server.test.mjs
git diff --cached --name-only
git commit -m "Вкладка «Тексты» в фабрике и документация

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
