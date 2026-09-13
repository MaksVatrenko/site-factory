# Формат контента v2 — план реализации

> **Для исполнителей-агентов:** обязательный навык — superpowers:subagent-driven-development
> (рекомендуется) или superpowers:executing-plans. Шаги отмечены чекбоксами (`- [ ]`).

**Цель:** все блоки страницы устроены одинаково (`type` + `content`), заголовок пишется ключом-тегом
(`{"type": "title", "h2": "…"}`), адрес страницы берётся из имени файла, картинки вставляются по имени
из `images.json`.

**Архитектура:** движок приводит контент к одному виду, шаблон только рисует. Разбор адреса — в
`src/lib/site-dir.mjs`; реестр картинок — новый `src/lib/images.mjs`; приведение `content` страницы —
новый `src/lib/content.mjs`, который вызывает `normalizeSite`. Проверка файла картинки на диске
подключается к `normalizeSite` снаружи функцией — так же, как сейчас подключается проверка слагов.

**Стек:** Node ≥ 22.12, Astro 7.3, Vitest 5, Express 5.

**Спецификация:** `docs/specs/2026-09-14-content-format-v2-design.md`

## Общие ограничения

- Контент не может уронить сборку. Фатальны ровно два случая: файл контента не читается или не JSON
  (теперь и `images.json`) и папка сайта без страниц. Всё остальное — предупреждение.
- Предупреждения пишутся по-русски. В лог сборки их выводит `src/lib/site-context.mjs` с префиксом
  `[factory] `. Предупреждение о содержимом страницы начинается со слага страницы: `/casino: …`.
- В собранном сайте ноль JavaScript: ни одного `<script>`.
- Движок (`src/`) не называет ни один шаблон. Шаблоны не импортируют из `src/` (единственное
  исключение уже существует: `templates/_shared/ElementRenderer.astro` читает манифест).
- Комментарии в коде — по-английски, в стиле соседних файлов: объясняют «почему», а не «что».
- Коммиты — по-русски, заголовок одной строкой, в конце трейлер
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. После каждого коммита — `git push origin main`
  (владелец репозитория разрешил коммитить и пушить в `main`).
- Тесты гоняются на macOS: APFS не различает регистр и форму NFC/NFD в именах файлов, так что два
  таких имени в одной папке существовать не могут.
- В конце каждой задачи `npm test` зелёный. Полный прогон — около 40 секунд; один файл —
  `npx vitest run tests/<файл>`.

## Карта файлов

| Файл | Задача | Что делает после изменений |
|---|---|---|
| `src/lib/site-dir.mjs` | 1 | Читает папку сайта: адрес из имени файла, список служебных файлов, `images.json` |
| `src/lib/images.mjs` (новый) | 2 | Реестр картинок: имя → `{ src, alt, width, height }` или причина отказа |
| `src/lib/content.mjs` (новый) | 3 | Приводит `content` одной страницы к виду для шаблона, правило одного `h1` |
| `src/lib/normalize.mjs` | 4, 5 | Вызывает `content.mjs`; неизвестный тип блока → `section`; логотип из реестра |
| `src/lib/site-context.mjs` | 1, 5 | Печатает предупреждения папки; передаёт реестр и проверку файла в нормализатор |
| `src/lib/anchors.mjs` | 4 | Заголовок любого блока — первый `title`; оглавление — первый `list` в `toc` |
| `src/layouts/Base.astro` | 5 | Логотип — объект картинки |
| `factory/server.mjs` | 1 | Считает страницы по общему правилу из `site-dir.mjs` |
| `templates/_shared/props.mjs` | 4 | `asEntries(content)` — элементы, которые можно нарисовать |
| `templates/_shared/ElementRenderer.astro` | 4 | Передаёт элементу `context` от блока |
| `templates/review/Content.astro` (новый) | 4 | Рисует `content` блока по порядку |
| `templates/review/Heading.astro` | 4 | Принимает `h1`: градиент без полосы |
| `templates/review/blocks/*.astro` | 4 | Все пять блоков рисуют `content` в своей оболочке |
| `templates/review/elements/toggle.astro` (новый) | 4 | Раскрывашка `<details>` |
| `templates/review/elements/image.astro` (новый) | 5 | Картинка |
| `templates/review/elements/cards.astro` | 5 | Картинка у карточки |
| `templates/review/manifest.json` | 4, 5 | `elements` += `toggle`, `image` |
| `scripts/sheet-to-json.mjs`, `scripts/import-sheet.mjs` | 6 | Новый формат, без `slug`, главная — `home.json` |
| `data/sites/899ok/*.json` | 1, 4 | Без `slug`, потом новый формат блоков |
| `data/sites/broken/*` | 4, 5 | Ломает уже новый формат |
| `docs/*`, `README.md` | 7 | Описание нового формата |
| `tests/helpers/build.mjs` | 1 | Фикстура пишет страницу в `<адрес>.json` |

---

## Задача 1: Адрес страницы — из имени файла

Поле `slug` перестаёт что-либо значить: `casino.json` — это `/casino`, `home.json` (в любом регистре) —
`/`. Нормализатор по-прежнему получает сырой слаг и прогоняет его через те же правила и пробер —
только теперь слаг подставляет переходник, а не автор файла.

**Files:**
- Modify: `src/lib/site-dir.mjs` (переписать целиком)
- Modify: `src/lib/site-context.mjs` (вызов `loadSiteDirInput` и печать предупреждений)
- Modify: `factory/server.mjs` (функция `pageFileNames`)
- Modify: `tests/helpers/build.mjs` (`writeSiteDirFromContent`)
- Modify: `tests/site-dir.test.mjs`, `tests/render.test.mjs`, `tests/seo.test.mjs`,
  `tests/review-template.test.mjs`, `tests/site-context.test.mjs`, `tests/server.test.mjs`
- Modify: `data/sites/899ok/*.json` (убрать `slug`)

**Interfaces:**
- Produces (`src/lib/site-dir.mjs`):
  - `SERVICE_FILE_NAMES` — `Object.freeze(['site.json', 'images.json'])`
  - `isPageFileName(name: string): boolean`
  - `slugFromFileName(name: string): string` — `'home.json'`/`'Home.json'` → `'/'`, `'casino.json'` → `'/casino'`
  - `loadSiteDirInput(dir: string): { input: object, images: unknown, warnings: string[] }` —
    `input` = настройки из `site.json` плюс `pages: [{ slug, meta: { title, description }, blocks }]`
    (страница-не-объект передаётся как есть); `images` — разобранный `images.json` или `undefined`.
- Produces (`tests/helpers/build.mjs`): `pageFileNameFor(slug: string): string`;
  `writeSiteDirFromContent(dir, content)` пишет каждую страницу в `<адрес>.json`.

- [ ] **Step 1: Написать падающие модульные тесты для `site-dir.mjs`**

В `tests/site-dir.test.mjs` заменить строку импортов из `node:fs` и добавить импорт модуля, затем
вставить новые блоки `describe` сразу после функции `outputPathFor` (до
`describe('loadContext with SITE_DIR: …`):

```js
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, readOutput } from './helpers/build.mjs';
import {
  SERVICE_FILE_NAMES,
  isPageFileName,
  loadSiteDirInput,
  slugFromFileName,
} from '../src/lib/site-dir.mjs';
```

```js
// A folder of files, written from a { fileName: content } map. A string is written verbatim (for
// the "not valid JSON" case); anything else is written as JSON.
function writeFolder(files) {
  const dir = makeSiteDir();
  for (const [name, data] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof data === 'string' ? data : JSON.stringify(data));
  }
  return dir;
}

describe('a page address comes from its file name', () => {
  it('maps a file name to a route', () => {
    expect(slugFromFileName('casino.json')).toBe('/casino');
    expect(slugFromFileName('live-dealer.json')).toBe('/live-dealer');
  });

  it('treats home.json as the site root, in any case', () => {
    expect(slugFromFileName('home.json')).toBe('/');
    expect(slugFromFileName('Home.json')).toBe('/');
    expect(slugFromFileName('HOME.json')).toBe('/');
  });

  it('does not treat a name that merely contains "home" as the root', () => {
    expect(slugFromFileName('homepage.json')).toBe('/homepage');
    expect(slugFromFileName('my-home.json')).toBe('/my-home');
  });

  it('leaves the rest of the name alone — cleaning it is the slug rules\' job', () => {
    expect(slugFromFileName('Live Dealer.json')).toBe('/Live Dealer');
  });
});

describe('service files are not pages', () => {
  it('names exactly the two service files', () => {
    expect(SERVICE_FILE_NAMES).toEqual(['site.json', 'images.json']);
  });

  it('tells a page file from a service file or a non-JSON file', () => {
    expect(isPageFileName('casino.json')).toBe(true);
    expect(isPageFileName('site.json')).toBe(false);
    expect(isPageFileName('images.json')).toBe(false);
    expect(isPageFileName('notes.txt')).toBe(false);
  });
});

describe('loadSiteDirInput', () => {
  it('gives each page the address of its file, home first, the rest by file name', () => {
    const dir = writeFolder({
      'site.json': { brand: { name: 'Folder' } },
      'casino.json': { title: 'Casino' },
      'about.json': { title: 'About' },
      'home.json': { title: 'Home' },
    });
    try {
      const { input, warnings } = loadSiteDirInput(dir);
      expect(input.pages.map((page) => [page.slug, page.meta.title])).toEqual([
        ['/', 'Home'],
        ['/about', 'About'],
        ['/casino', 'Casino'],
      ]);
      expect(input.brand).toEqual({ name: 'Folder' });
      expect(warnings).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads images.json as the image registry, not as a page', () => {
    const registry = { main: { src: '/images/main.webp', alt: 'Main' } };
    const dir = writeFolder({ 'home.json': { title: 'Home' }, 'images.json': registry });
    try {
      const { input, images } = loadSiteDirInput(dir);
      expect(input.pages).toHaveLength(1);
      expect(images).toEqual(registry);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns no registry when the folder has no images.json', () => {
    const dir = writeFolder({ 'home.json': { title: 'Home' } });
    try {
      expect(loadSiteDirInput(dir).images).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores a slug field left in a page file, and says which file and which address won', () => {
    // A forgotten "slug": "/promo" in bonus.json would otherwise silently give /bonus, and the
    // reader would go looking for where /promo went.
    const dir = writeFolder({
      'home.json': { title: 'Home' },
      'bonus.json': { slug: '/promo', title: 'Bonus' },
    });
    try {
      const { input, warnings } = loadSiteDirInput(dir);
      expect(input.pages.map((page) => page.slug)).toEqual(['/', '/bonus']);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('bonus.json');
      expect(warnings[0]).toContain('/bonus');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns when the folder has no home.json', () => {
    const dir = writeFolder({ 'casino.json': { title: 'Casino' } });
    try {
      const { input, warnings } = loadSiteDirInput(dir);
      expect(input.pages.map((page) => page.slug)).toEqual(['/casino']);
      expect(warnings.join(' ')).toContain('home.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not read pages from subfolders, public/ included', () => {
    const dir = writeFolder({ 'home.json': { title: 'Home' } });
    try {
      mkdirSync(join(dir, 'bn'));
      writeFileSync(join(dir, 'bn', 'casino.json'), JSON.stringify({ title: 'Nested' }));
      mkdirSync(join(dir, 'public'));
      writeFileSync(join(dir, 'public', 'data.json'), '{}');
      expect(loadSiteDirInput(dir).input.pages.map((page) => page.slug)).toEqual(['/']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes a page file that is not an object through for the normalizer to drop', () => {
    const dir = writeFolder({ 'home.json': { title: 'Home' }, 'odd.json': '"just a string"' });
    try {
      expect(loadSiteDirInput(dir).input.pages[1]).toBe('just a string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails on an images.json that is not JSON, naming the file', () => {
    const dir = writeFolder({ 'home.json': { title: 'Home' }, 'images.json': '{ nope' });
    try {
      expect(() => loadSiteDirInput(dir)).toThrow(/images\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still fails on a folder with no pages, even one holding both service files', () => {
    const dir = writeFolder({ 'site.json': {}, 'images.json': {} });
    try {
      expect(() => loadSiteDirInput(dir)).toThrow(/no pages/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/site-dir.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../src/lib/site-dir.mjs' does not provide an export named 'SERVICE_FILE_NAMES'`.

- [ ] **Step 3: Переписать `src/lib/site-dir.mjs`**

Заменить содержимое файла целиком:

```js
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Files in a site folder that configure the site rather than being one of its pages. Listed once,
// here: factory/server.mjs counts pages with isPageFileName below instead of keeping its own copy
// of the rule, which is exactly how the two would drift the day a third service file appears.
export const SERVICE_FILE_NAMES = Object.freeze(['site.json', 'images.json']);

const SITE_SETTINGS_FILE = 'site.json';
const IMAGES_FILE = 'images.json';
const HOME_FILE_BASE = 'home';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPageFileName(name) {
  return typeof name === 'string' && name.endsWith('.json') && !SERVICE_FILE_NAMES.includes(name);
}

// A page's address is its file name: casino.json is /casino. home.json is the site root, matched
// without regard to case — Home.json and home.json cannot even coexist on a case-insensitive
// filesystem, so treating them differently would make the answer depend on the machine. Nothing
// else about the name is touched here: the result goes through normalizeSite's own slug rules and
// the filesystem prober exactly like a hand-written slug used to, which is what still stops a
// file called sitemap.xml.json from overwriting the sitemap.
export function slugFromFileName(name) {
  const base = name.slice(0, -'.json'.length);
  return base.toLowerCase() === HOME_FILE_BASE ? '/' : `/${base}`;
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read content from ${path}: ${error.message}`);
  }
}

// Files only, never directories: a site folder holds public/ (and, once languages arrive, one
// subfolder per language), and none of what sits inside those is a page of this site's root.
function listJsonFileNames(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Cannot read site directory ${dir}: ${error.message}`);
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
}

// A page file is `{ title, description, blocks }`; normalizeSite reads a page shaped
// `{ slug, meta: { title, description }, blocks }`. The slug is the file's own address, never a
// field of the file. A page that is not an object is passed through untouched so normalizeSite's
// own check — which already drops it with a warning naming its position — stays the one thing
// that rejects it.
function toPageInput({ raw, slug }) {
  if (!isPlainObject(raw)) return raw;
  const { title, description, blocks } = raw;
  return {
    slug,
    meta: { title, description },
    blocks: Array.isArray(blocks) ? blocks.map(toBlockInput) : blocks,
  };
}

// Same translation one level down: a block on disk is `{ type, ...fields }` — flat, which is what
// makes it easy to rearrange by hand — while normalizeSite reads a block's fields from `props`.
function toBlockInput(raw) {
  if (!isPlainObject(raw)) return raw;
  const { type, ...props } = raw;
  return { type, props };
}

// Reads a site folder into what the engine needs: the shared settings from site.json spread at the
// top level with the pages beside them (home first, then the rest by file name — a plain string
// sort, so the order is the same on every platform), the raw image registry from images.json, and
// the warnings only this loader is in a position to give.
//
// Only two failures are this loader's to throw — the two content-side failures the engine allows
// at all: a file that cannot be read or parsed as JSON, and a folder with no page files. The
// latter is deliberate: an empty folder is not content shaped strangely, it is the operator
// pointing at the wrong path.
export function loadSiteDirInput(dir) {
  const jsonFileNames = listJsonFileNames(dir);
  const pageFileNames = jsonFileNames.filter(isPageFileName);

  if (pageFileNames.length === 0) {
    throw new Error(
      `Site directory ${dir} has no pages: found no *.json file besides ${SERVICE_FILE_NAMES.join(', ')}`,
    );
  }

  const settingsRaw = jsonFileNames.includes(SITE_SETTINGS_FILE)
    ? readJsonFile(join(dir, SITE_SETTINGS_FILE))
    : {};
  const settings = isPlainObject(settingsRaw) ? settingsRaw : {};
  const images = jsonFileNames.includes(IMAGES_FILE)
    ? readJsonFile(join(dir, IMAGES_FILE))
    : undefined;

  const warnings = [];
  const records = pageFileNames.map((name) => {
    const raw = readJsonFile(join(dir, name));
    const slug = slugFromFileName(name);
    if (isPlainObject(raw) && raw.slug !== undefined) {
      warnings.push(
        `«${name}»: поле slug больше не используется — адрес страницы берётся из имени файла (${slug})`,
      );
    }
    return { raw, slug };
  });

  const homeIndex = records.findIndex((record) => record.slug === '/');
  if (homeIndex === -1) {
    warnings.push('В папке нет home.json — у сайта не будет главной страницы');
  }
  const ordered =
    homeIndex <= 0
      ? records
      : [records[homeIndex], ...records.filter((_, index) => index !== homeIndex)];

  return { input: { ...settings, pages: ordered.map(toPageInput) }, images, warnings };
}
```

- [ ] **Step 4: Подключить новый ответ `loadSiteDirInput` в `src/lib/site-context.mjs`**

Заменить строку

```js
  const raw = loadSiteDirInput(dir);
```

на

```js
  // `images` is read here too, but only wired into the normalizer once pictures are rendered.
  const { input: raw, warnings: folderWarnings } = loadSiteDirInput(dir);
```

и строку

```js
  for (const warning of warnings) console.warn(`[factory] ${warning}`);
```

на

```js
  for (const warning of [...folderWarnings, ...warnings]) console.warn(`[factory] ${warning}`);
```

- [ ] **Step 5: Считать страницы на сервере по общему правилу (`factory/server.mjs`)**

Добавить импорт рядом с остальными импортами из `../src/lib/`:

```js
import { isPageFileName } from '../src/lib/site-dir.mjs';
```

Заменить комментарий и функцию `pageFileNames` целиком:

```js
// A page file is whatever src/lib/site-dir.mjs says it is — any *.json file in the folder itself
// that is not a service file (site.json, images.json). Imported rather than restated: the rule
// used to be copied here, and a copy is exactly what drifts when a service file is added.
function pageFileNames(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isPageFileName(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
```

- [ ] **Step 6: Прогнать модульные тесты `site-dir`**

Run: `npx vitest run tests/site-dir.test.mjs -t "file name|service files|loadSiteDirInput"`
Expected: PASS — все новые тесты зелёные.

- [ ] **Step 7: Фикстура тестов пишет страницу в `<адрес>.json`**

В `tests/helpers/build.mjs` заменить длинный комментарий над `writeSiteDirFromContent` и саму функцию:

```js
// A page's address is its file name now (see slugFromFileName in src/lib/site-dir.mjs), so a
// fixture page is written to `<slug>.json`, with "/" going to home.json. A slug that cannot be one
// file name — a nested "/a/b", a missing slug, two slugs a case-insensitive filesystem would store
// as the same file — throws instead of being written somewhere else: a test whose scenario the
// folder format can no longer express must fail loudly, not keep passing while it checks something
// different. Those scenarios live on as unit tests of normalizeSite, which still takes a raw slug.
//
// Pages come back from a folder home first, then by file name — not in this array's order.
export function pageFileNameFor(slug) {
  if (slug === '/') return 'home.json';
  const name = typeof slug === 'string' ? slug.slice(1) : '';
  if (!String(slug).startsWith('/') || name === '' || name.includes('/')) {
    throw new Error(`writeSiteDirFromContent: slug ${JSON.stringify(slug)} cannot be a page file name`);
  }
  return `${name}.json`;
}

export function writeSiteDirFromContent(dir, content) {
  const { pages, ...settings } = content;
  writeFileSync(join(dir, 'site.json'), JSON.stringify(settings));
  const written = new Set();
  for (const page of pages) {
    const fileName = pageFileNameFor(page.slug);
    const key = fileName.toLowerCase();
    if (written.has(key)) {
      throw new Error(`writeSiteDirFromContent: two pages would share the file ${fileName}`);
    }
    written.add(key);
    const { meta, blocks } = page;
    writeFileSync(
      join(dir, fileName),
      JSON.stringify({
        title: meta?.title,
        description: meta?.description,
        blocks: Array.isArray(blocks)
          ? blocks.map((block) =>
              block && typeof block === 'object' && !Array.isArray(block)
                ? { type: block.type, ...(block.props ?? {}) }
                : block,
            )
          : blocks,
      }),
    );
  }
}
```

- [ ] **Step 8: Убрать `slug` из страниц 899ok**

Run:

```bash
node --input-type=module -e "
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = 'data/sites/899ok';
for (const name of readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'site.json')) {
  const page = JSON.parse(readFileSync(dir + '/' + name, 'utf8'));
  delete page.slug;
  writeFileSync(dir + '/' + name, JSON.stringify(page, null, 2) + '\n');
}
"
git diff --stat data/sites/899ok
```

Expected: 8 файлов, в каждом ровно одна удалённая строка (`"slug": …`). Файлы уже названы по
адресам (`home.json`, `casino.json`, …), переименовывать ничего не нужно.

`data/sites/broken/sloppy.json` **не трогать**: его `"slug": "sloppy//"` теперь — оставшийся `slug`,
ровно тот случай, о котором сборка должна предупредить. Адрес страницы остаётся `/sloppy` — теперь
из имени файла.

- [ ] **Step 9: Убрать `slug` из фикстур, которые пишут файлы страниц напрямую**

1. `tests/site-dir.test.mjs`, три существующих сквозных теста: убрать поле `slug` из объектов страниц —
   `slug: '/'` в тестах «no site.json», «malformed nav» (там объект записан в одну строку) и «reordered»,
   и `slug: '/mixed'` там же (файл `mixed.json` сам даёт `/mixed`).
2. `tests/review-template.test.mjs`, функция `buildSingleBlockPage`: удалить строку `slug: '/',`.
3. `tests/site-context.test.mjs`: `JSON.stringify({ slug: '/', title: 'F4 Home', blocks: [] })` →
   `JSON.stringify({ title: 'F4 Home', blocks: [] })`.
4. `tests/server.test.mjs`: `JSON.stringify({ slug: '/', title: 'Fixture Site Content', blocks: [] })` →
   `JSON.stringify({ title: 'Fixture Site Content', blocks: [] })`.
5. `tests/server.test.mjs`, функция `pageCountOnDisk` — считать без обоих служебных файлов, по-прежнему
   независимо от кода сервера. Заменить комментарий и функцию:

```js
// Same "read the filesystem independently" principle as the two helpers above, applied to a site
// folder under data/sites: the page count is every *.json file in the folder except the two
// service files, site.json and images.json — spelled out here rather than imported from
// src/lib/site-dir.mjs, so the assertions below check the /api/sites route against content on disk,
// not against the same rule the route itself calls.
function pageCountOnDisk(siteId) {
  return readdirSync(join('data', 'sites', siteId)).filter(
    (name) => name.endsWith('.json') && name !== 'site.json' && name !== 'images.json',
  ).length;
}
```

6. `tests/server.test.mjs`, в `describe('factory API', …)` сразу после теста
   `'lists site folders read from disk, each with its page count and brand name'` добавить:

```js
  it('does not count images.json as a page', async () => {
    const siteId = 'images-count-fixture';
    const siteDir = join('data', 'sites', siteId);
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(join(siteDir, 'home.json'), JSON.stringify({ title: 'Home', blocks: [] }));
    writeFileSync(
      join(siteDir, 'images.json'),
      JSON.stringify({ main: { src: '/images/main.webp', alt: 'Main' } }),
    );
    try {
      const data = await fetch(`${base}/api/sites`).then((r) => r.json());
      expect(data.sites.find((site) => site.id === siteId)?.pages).toBe(1);
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 10: Перевести сквозные тесты на опасные слаги в опасные имена файлов (`tests/render.test.mjs`)**

Большая часть того, что эти тесты подсовывали через поле `slug`, не может быть именем файла: `/` внутри,
NUL, 300 символов, одиночный суррогат, кодовая точка, которую APFS не создаёт, пары имён, различающиеся
только регистром или NFC/NFD. Эти правила остаются в модульных тестах `tests/normalize.test.mjs` — они
не меняются. Здесь остаётся всё, что реальная папка сайта может содержать.

**10a.** Заменить блок `describe('hostile slugs that used to crash the build (C1)', …)` целиком
(вместе с комментарием над ним, начинающимся с `// Finding C1: normalizeSlug only collapsed`):

```js
// Finding C1: hostile names reached Astro's own path resolution unexamined and crashed the build
// outright. The page address comes from the file name now, so each case is a real file in a real
// folder going through a real `astro build`. Two of the original six — a path-traversal slug and a
// "." segment — cannot be a file name at all (a name cannot contain "/"), so they are gone from here
// and stay pinned by the normalizeSite unit tests.
describe('hostile page names that used to crash the build (C1)', () => {
  function buildWithSlug(slug, dirName) {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-hostile-slug-'));
    writeSiteDirFromContent(dir, {
      domain: 'example.com',
      locale: 'en-US',
      brand: { name: 'Hostile' },
      pages: [
        { slug: '/', meta: { title: 'Home' }, blocks: [] },
        { slug, meta: { title: 'Hostile Page' }, blocks: [] },
      ],
    });
    try {
      return buildSite({ outDir: join('output', dirName), env: { SITE_DIR: dir } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('strips a backslash out of a page name', () => {
    const { outDir } = buildWithSlug('/a\\b', 'test-slug-backslash');
    expect(readOutput(outDir, join('ab', 'index.html'))).toContain('Hostile Page');
  });

  it('strips a newline control character out of a page name', () => {
    const { outDir } = buildWithSlug('/a\nb', 'test-slug-control-newline');
    expect(readOutput(outDir, join('ab', 'index.html'))).toContain('Hostile Page');
  });

  it('strips a tab control character out of a page name', () => {
    const { outDir } = buildWithSlug('/a\tb', 'test-slug-control-tab');
    expect(readOutput(outDir, join('ab', 'index.html'))).toContain('Hostile Page');
  });

  it('caps an oversized page name instead of letting mkdir hit ENAMETOOLONG', () => {
    // 250 characters plus ".json" is 255 bytes — the longest name the filesystem will hold.
    const longName = 'a'.repeat(250);
    const { outDir } = buildWithSlug(`/${longName}`, 'test-slug-too-long');
    expect(readOutput(outDir, join(longName.slice(0, 100), 'index.html'))).toContain('Hostile Page');
  });

  it('refuses a page named index.html, which would collide with the home page, falling back to page-N', () => {
    const { outDir, log } = buildWithSlug('/index.html', 'test-slug-index-html');
    expect(readOutput(outDir, join('page-1', 'index.html'))).toContain('Hostile Page');
    expect(log).toContain('index.html');
  });
});
```

**10b.** Заменить блок `describe('normalizeSlug holds as an invariant across a wide range of hostile slugs, not six special cases (final-fix-3)', …)`
целиком — вместе с двумя абзацами комментария над ним (`// Follow-up review: …` и `// final-fix-5 changed what …`):

```js
// The folder format gives every page its address from its file name, so the hostile inputs that
// can reach a real build are hostile FILE NAMES now. Much of what this test used to feed in cannot
// be a file name at all — a "/" inside the slug, a NUL byte, a 300-character segment, a lone
// surrogate, a code point APFS refuses — and on a filesystem that folds case and NFC/NFD (APFS,
// which this runs on) neither can two names differing only that way. Those shapes stay pinned by
// tests/normalize.test.mjs, which hands normalizeSite a raw slug directly. Everything a real folder
// CAN hold is here, in one real build, and every page is accounted for: it landed at the route its
// own name implies with no warning, or it landed at a fallback and the log says why.
describe('hostile page file names, all in one real build', () => {
  const BEL = String.fromCharCode(7);
  const UNIT_SEPARATOR = String.fromCharCode(31);
  const DEL = String.fromCharCode(127);
  const SOH = String.fromCharCode(1);
  const STX = String.fromCharCode(2);

  // `route`: where the page must land, unwarned. `null`: the name is unusable or already taken, so
  // the page must fall back to a page-N address and the log must say so.
  const pages = [
    { file: 'home.json', route: '/', label: 'home' },
    { file: 'about.json', route: '/about', label: 'plain name' },
    { file: `${'café'.normalize('NFC')}.json`, route: '/café', label: 'non-ASCII name' },
    { file: '日本語.json', route: '/日本語', label: 'non-Latin name' },
    { file: '%41.json', route: '/A', label: 'percent escape decoded' },
    { file: 'Page-1.json', route: '/Page-1', label: 'name shaped like a fallback' },
    { file: `${'x'.repeat(99)}😀.json`, route: `/${'x'.repeat(99)}😀`, label: 'astral character exactly at the cap' },
    { file: `${'y'.repeat(100)}😀.json`, route: `/${'y'.repeat(100)}`, label: 'astral character just past the cap' },
    // 250 + ".json" is 255 bytes, the longest name the filesystem holds; the slug rules cap at 100.
    { file: `${'q'.repeat(250)}.json`, route: `/${'q'.repeat(100)}`, label: 'longest possible name' },
    { file: `ctrl${BEL}${UNIT_SEPARATOR}${DEL}name.json`, route: '/ctrlname', label: 'control characters amid text' },
    // Pages are claimed home first, then in file-name order, and "%" (0x25) sorts before "D"
    // (0x44): this one decodes to /Dup and claims it first, so Dup.json is the one that loses.
    { file: '%44up.json', route: '/Dup', label: 'percent escape decoding onto another page' },
    { file: 'Dup.json', route: null, label: 'name another page already decoded onto' },
    { file: 'index.html.json', route: null, label: 'index.html' },
    { file: 'sitemap.xml.json', route: null, label: 'sitemap.xml' },
    { file: 'ROBOTS.TXT.json', route: null, label: 'robots.txt in upper case' },
    { file: '.prerender.json', route: null, label: 'Astro build staging directory' },
    { file: '%.json', route: null, label: 'percent only' },
    { file: '%%%.json', route: null, label: 'triple percent' },
    { file: '...json', route: null, label: 'dot dot' },
    { file: '\\.json', route: null, label: 'lone backslash' },
    { file: `${SOH}${STX}.json`, route: null, label: 'only control characters' },
    // A file the public folder copies to the output root. Not a name the engine reserves — it
    // depends on this build's public folder — so only the live filesystem prober refuses it.
    { file: 'banner.png.json', route: null, label: 'same name as a public file' },
  ];

  const titleOf = (index) => `Hostile page ${index}: ${pages[index].label}`;
  const rawSlugOf = (file) => `/${file.slice(0, -'.json'.length)}`;
  const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pageFile = (route) =>
    route === '/' ? 'index.html' : join(...route.slice(1).split('/'), 'index.html');

  function countIndexHtmlFiles(dir) {
    let count = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) count += countIndexHtmlFiles(full);
      else if (entry.name === 'index.html') count += 1;
    }
    return count;
  }

  function readAllPageHtml(dir) {
    const htmls = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) htmls.push(...readAllPageHtml(full));
      else if (entry.name === 'index.html') htmls.push(readFileSync(full, 'utf8'));
    }
    return htmls;
  }

  // Reverses what src/pages/sitemap.xml.js and src/lib/urls.mjs do to build each <loc>, to recover
  // the on-disk path each sitemap entry claims to point at.
  function sitemapLocPaths(outDir) {
    const xml = readOutput(outDir, 'sitemap.xml');
    return [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((match) => {
      const unescaped = match[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
      const { pathname } = new URL(unescaped);
      const segments =
        pathname === '/' ? [] : pathname.slice(1).split('/').map((part) => decodeURIComponent(part));
      return join(outDir, ...segments, 'index.html');
    });
  }

  it('builds, and puts every page at its own route or at a fallback the log reports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-hostile-names-'));
    const publicDir = join(dir, 'public');
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(join(publicDir, 'banner.png'), 'not really a png');
    writeFileSync(
      join(dir, 'site.json'),
      JSON.stringify({ domain: 'example.com', locale: 'en-US', brand: { name: 'Hostile Names' } }),
    );
    pages.forEach((page, index) => {
      writeFileSync(join(dir, page.file), JSON.stringify({ title: titleOf(index), blocks: [] }));
    });

    try {
      // One file per entry, or every count below is meaningless: a name the filesystem folded onto
      // another would silently have overwritten it.
      expect(
        readdirSync(dir).filter((name) => name.endsWith('.json') && name !== 'site.json'),
      ).toHaveLength(pages.length);

      const { outDir, log } = buildSite({
        outDir: join('output', 'test-hostile-names'),
        env: { SITE_DIR: dir, PUBLIC_DIR: publicDir },
      });

      // Nothing lost and nothing duplicated: exactly one index.html per page file.
      expect(countIndexHtmlFiles(outDir)).toBe(pages.length);

      const allHtml = readAllPageHtml(outDir);
      pages.forEach((page, index) => {
        const title = titleOf(index);
        const warning = new RegExp(
          `Слаг «${escapeRegExp(rawSlugOf(page.file))}» (?:недопустим|уже занят)`,
        );
        if (page.route) {
          expect(readOutput(outDir, pageFile(page.route)), `${page.label} at ${page.route}`).toContain(title);
          expect(log, `${page.label} should not be warned about`).not.toMatch(warning);
        } else {
          expect(allHtml.some((html) => html.includes(title)), `${page.label} must be built`).toBe(true);
          expect(log, `${page.label} must be reported`).toMatch(warning);
        }
      });

      // Every fallback reported exactly once, and never as the dropping path's "дубликат".
      const fallbacks = pages.filter((page) => page.route === null).length;
      expect((log.match(/Слаг «[^»]*» (?:недопустим|уже занят)/g) || []).length).toBe(fallbacks);
      expect(log).not.toContain('дубликат');

      // No URL the sitemap advertises may be missing its page on disk (final-fix-6, F1).
      for (const target of sitemapLocPaths(outDir)) {
        expect(existsSync(target), `sitemap.xml advertises a page not on disk: ${target}`).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

**10c.** Заменить блок `describe('a publicDir asset sharing a reserved name cannot disable the whole prober (final-fix-6, F2)', …)`
целиком — вместе с комментарием над ним (`// Final-fix-6, F2: createOutputProber used to seed …`):

```js
// Final-fix-6, F2: createOutputProber used to seed its reserved-name marker files before mirroring
// publicDir in, so a public/ directory named like a reserved name (here: sitemap.xml/) crashed the
// mirror copy and took the whole prober down with it — handing slug resolution back to the old
// predictive path, which cannot save a page only the filesystem can judge. Reproduced exactly that
// way: one public/sitemap.xml directory plus one such page, in the same real build.
describe('a publicDir asset sharing a reserved name cannot disable the whole prober (final-fix-6, F2)', () => {
  it('still builds, still mirrors the publicDir asset, and still saves a page only a live prober can catch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-prober-publicdir-'));
    const publicDir = join(dir, 'public');
    mkdirSync(join(publicDir, 'sitemap.xml'), { recursive: true });
    writeFileSync(join(publicDir, 'sitemap.xml', 'note.txt'), 'not actually a sitemap');
    // The page only a live prober can save is named like a file this public folder copies to the
    // output root. The engine does not reserve that name — it depends on what this build's public
    // folder holds — so no predictive rule refuses it. (This used to be a slug with an unassigned
    // code point; APFS will not create a FILE with such a name, so a folder cannot carry it.)
    writeFileSync(join(publicDir, 'banner.png'), 'not really a png');

    writeSiteDirFromContent(dir, {
      domain: 'example.com',
      locale: 'en-US',
      brand: { name: 'ProberPublicDir' },
      pages: [
        { slug: '/', meta: { title: 'ProberPublicDir Home' }, blocks: [] },
        { slug: '/banner.png', meta: { title: 'Public Asset Collision Page' }, blocks: [] },
      ],
    });

    try {
      const { outDir, log } = buildSite({
        outDir: join('output', 'test-prober-publicdir-collision'),
        env: { SITE_DIR: dir, PUBLIC_DIR: publicDir },
      });

      expect(existsSync(join(outDir, 'index.html'))).toBe(true);

      // The colliding page survived at a page-N fallback and was reported as invalid — proof the
      // PROBER resolved it: the predictive path has no rule for a public file at all.
      expect(log).toContain('недопустим');
      const fallbackTitles = readdirSync(outDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('page-'))
        .map((entry) => readOutput(outDir, join(entry.name, 'index.html')));
      expect(fallbackTitles.some((html) => html.includes('Public Asset Collision Page'))).toBe(true);

      // The degradation warning (final-fix-6, F5) is absent: the prober was never disabled.
      expect(log).not.toContain('Проверка слагов через файловую систему недоступна');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

**10d.** Удалить целиком два последних блока файла вместе с их комментариями:
`describe('a missing slug\'s generated default cannot steal a slug another page really asked for (M2)', …)`
и `describe('case-insensitive slug duplicates are collapsed before Astro ever writes them (M3)', …)`.
Страницы без адреса больше не бывает (адрес — имя файла), а `about.json`, `About.json` и `ABOUT.json` на
APFS — один и тот же файл. Оба правила остаются в модульных тестах `normalizeSite`
(`final-fix-4: … (M2)` и `… (M3)` в `tests/normalize.test.mjs`).

**10e.** В тесте `'survives a broken content folder'` после строки `expect(broken.log).toContain('carousel');`
добавить:

```js
    // sloppy.json still carries "slug": "sloppy//" — ignored now, and the log says so.
    expect(broken.log).toContain('поле slug больше не используется');
```

- [ ] **Step 11: Сравнивать canonical и sitemap как множества (`tests/seo.test.mjs`)**

Страницы из папки идут «главная, потом по имени файла», а не в порядке массива в тесте. В тесте
`'keeps every canonical href identical to its sitemap loc once decoded'` заменить тело целиком:

```js
  it('keeps every canonical href identical to its sitemap loc once decoded', () => {
    const xml = readOutput(outDir, 'sitemap.xml');
    const locs = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((match) =>
      decodeXmlEntities(match[1]),
    );
    const canonicals = pages.map((page) => {
      const htmlFile = page.slug === '/' ? 'index.html' : `${page.slug.slice(1)}/index.html`;
      const match = readOutput(outDir, htmlFile).match(/<link rel="canonical" href="([^"]*)"/);
      expect(match).not.toBeNull();
      return decodeXmlEntities(match[1]);
    });
    // Compared as sets: a folder lists pages home first, then by file name — not in this array's
    // order — so what matters is that every page's canonical is exactly one of the sitemap's locs.
    expect([...canonicals].sort()).toEqual([...locs].sort());
  });
```

- [ ] **Step 12: Прогнать все тесты**

Run: `npm test`
Expected: PASS, все файлы зелёные.

- [ ] **Step 13: Коммит**

```bash
git add src/lib/site-dir.mjs src/lib/site-context.mjs factory/server.mjs tests/ data/sites/899ok/
git commit -m "$(cat <<'EOF'
Адрес страницы — из имени файла

casino.json — это /casino, home.json — главная. Поле slug игнорируется
с предупреждением, images.json не считается страницей.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Задача 2: Реестр картинок `src/lib/images.mjs`

Чистый модуль: по имени отдаёт картинку или причину, почему её нельзя вывести. Сам ничего не читает с
диска — «есть ли файл» спрашивает через переданную функцию. В этой задаче ни к чему не подключается.

**Files:**
- Create: `src/lib/images.mjs`
- Test: `tests/images.test.mjs`

**Interfaces:**
- Produces: `createImageResolver(raw: unknown, { fileExists?: (src: string) => boolean }): { resolve, warnings }`
  - `raw` — разобранный `images.json` или `undefined` (файла нет — это не ошибка);
  - `warnings: string[]` — о кривом реестре (не объект; запись не объект);
  - `resolve(name: unknown): { image: { src, alt, width?, height? } | null, problem: string | null, missingAlt: boolean }` —
    `problem` — готовая фраза без хвоста «— не выводится» (хвост добавляет вызывающий);
    `fileExists` получает путь от корня сайта (`'/images/main.webp'`), по умолчанию всегда `true`.

- [ ] **Step 1: Написать падающие тесты**

Создать `tests/images.test.mjs`:

```js
import { describe, it, expect, vi } from 'vitest';
import { createImageResolver } from '../src/lib/images.mjs';

describe('createImageResolver: turning a name into a picture', () => {
  it('resolves a local picture with its alt text and dimensions', () => {
    const { resolve, warnings } = createImageResolver(
      { main: { src: '/images/main.webp', alt: 'Main banner', width: 800, height: 450 } },
      { fileExists: () => true },
    );
    expect(resolve('main')).toEqual({
      image: { src: '/images/main.webp', alt: 'Main banner', width: 800, height: 450 },
      problem: null,
      missingAlt: false,
    });
    expect(warnings).toEqual([]);
  });

  it("ignores fields it does not know, such as a generator's own prompt", () => {
    const { resolve } = createImageResolver({
      main: { src: '/images/main.webp', alt: 'A', prompt: 'a casino at night', seed: 42 },
    });
    expect(resolve('main').image).toEqual({ src: '/images/main.webp', alt: 'A' });
  });

  it('adds the leading slash a path left out', () => {
    const { resolve } = createImageResolver({ main: { src: 'images/main.webp', alt: 'A' } });
    expect(resolve('main').image.src).toBe('/images/main.webp');
  });

  it('checks a local file through the function it was given, with the site-rooted path', () => {
    const fileExists = vi.fn(() => true);
    const { resolve } = createImageResolver(
      { main: { src: '/images/main.webp', alt: 'A' } },
      { fileExists },
    );
    resolve('main');
    expect(fileExists).toHaveBeenCalledWith('/images/main.webp');
  });

  it('uses a web address as it stands, without asking the disk', () => {
    const fileExists = vi.fn(() => false);
    const { resolve } = createImageResolver(
      { remote: { src: 'https://cdn.example.com/a.webp', alt: 'A' } },
      { fileExists },
    );
    expect(resolve('remote').image.src).toBe('https://cdn.example.com/a.webp');
    expect(fileExists).not.toHaveBeenCalled();
  });

  it('refuses a src that is neither a path inside the site nor a web address', () => {
    const { resolve } = createImageResolver({
      data: { src: 'data:image/png;base64,AAAA', alt: 'A' },
      script: { src: 'javascript:alert(1)', alt: 'A' },
      other: { src: '//other.example.com/a.webp', alt: 'A' },
      up: { src: '/images/../../secret.webp', alt: 'A' },
      back: { src: '/images\\a.webp', alt: 'A' },
    });
    for (const name of ['data', 'script', 'other', 'up', 'back']) {
      const result = resolve(name);
      expect(result.image, name).toBeNull();
      expect(result.problem, name).toContain('недопустимый src');
    }
  });

  it('says so when the name is not in the registry, or there is no registry at all', () => {
    expect(createImageResolver({}).resolve('main').problem).toBe('картинки «main» нет в images.json');
    expect(createImageResolver(undefined).resolve('main').problem).toBe(
      'картинки «main» нет в images.json',
    );
  });

  it('says so when a record has no usable src', () => {
    const { resolve } = createImageResolver({
      none: { alt: 'A' },
      number: { src: 42, alt: 'A' },
      blank: { src: '   ', alt: 'A' },
    });
    for (const name of ['none', 'number', 'blank']) {
      expect(resolve(name).problem, name).toBe(`у картинки «${name}» в images.json нет src`);
    }
  });

  it('says which file is missing from the public folder', () => {
    const { resolve } = createImageResolver(
      { main: { src: '/images/main.webp', alt: 'A' } },
      { fileExists: () => false },
    );
    expect(resolve('main')).toEqual({
      image: null,
      problem: 'файл картинки «main» не найден: public/images/main.webp',
      missingAlt: false,
    });
  });

  it('still returns a picture with no alt text, and flags it', () => {
    const { resolve } = createImageResolver({
      main: { src: '/images/main.webp' },
      blank: { src: '/images/b.webp', alt: '  ' },
    });
    expect(resolve('main')).toEqual({
      image: { src: '/images/main.webp', alt: '' },
      problem: null,
      missingAlt: true,
    });
    expect(resolve('blank').missingAlt).toBe(true);
  });

  it('keeps only real pixel dimensions, accepting a number written as a string', () => {
    const { resolve } = createImageResolver({
      good: { src: '/a.webp', alt: 'A', width: '800', height: ' 450 ' },
      bad: { src: '/b.webp', alt: 'B', width: 0, height: -5 },
      worse: { src: '/c.webp', alt: 'C', width: 1.5, height: '12px' },
    });
    expect(resolve('good').image).toEqual({ src: '/a.webp', alt: 'A', width: 800, height: 450 });
    expect(resolve('bad').image).toEqual({ src: '/b.webp', alt: 'B' });
    expect(resolve('worse').image).toEqual({ src: '/c.webp', alt: 'C' });
  });

  it('never throws on a name that is not a usable string', () => {
    const { resolve } = createImageResolver({ main: { src: '/a.webp', alt: 'A' } });
    for (const name of [undefined, null, 42, {}, [], '']) {
      expect(resolve(name)).toEqual({
        image: null,
        problem: 'у картинки не указано имя',
        missingAlt: false,
      });
    }
  });
});

describe('createImageResolver: a registry in the wrong shape', () => {
  it('warns once and resolves nothing when images.json is not an object', () => {
    for (const raw of ['nope', 42, [], null]) {
      const { resolve, warnings } = createImageResolver(raw);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('images.json');
      expect(resolve('main').image).toBeNull();
    }
  });

  it('skips a record that is not an object, naming it, and keeps the rest', () => {
    const { resolve, warnings } = createImageResolver({
      good: { src: '/a.webp', alt: 'A' },
      broken: 'just a string',
    });
    expect(warnings).toEqual(['images.json: запись «broken» не объект — пропущена']);
    expect(resolve('good').image).not.toBeNull();
    expect(resolve('broken').problem).toBe('картинки «broken» нет в images.json');
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/images.test.mjs`
Expected: FAIL — `Failed to load url ../src/lib/images.mjs` (модуля ещё нет).

- [ ] **Step 3: Написать модуль**

Создать `src/lib/images.mjs`:

```js
// The image registry. images.json maps a name to one picture's data, and content only ever refers
// to a picture by that name: { "image": "main" }. Keeping the data in one place is what lets a
// future generator fill pictures in by writing this one file, and lets the same picture appear on
// ten pages without its alt text being copied ten times.
//
// This module turns a name into a picture a template can render, or into the reason it cannot. It
// never throws and never touches the disk itself: whether a file exists is a question it asks
// through the `fileExists` function it is given, so the normalizer stays a pure function and its
// unit tests need no real files.

const EXTERNAL = /^https?:\/\//i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// width/height only help when they are real pixel counts; anything else is dropped rather than
// shipped as a broken attribute. A numeric string is accepted because a hand-edited JSON file
// will have "800" in it sooner or later.
function toDimension(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : undefined;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const number = Number(value.trim());
    return number > 0 ? number : undefined;
  }
  return undefined;
}

// A src is a web address, used as it stands; a path inside the site, which must exist in the
// public folder; or anything else, which is refused. "Anything else" is mostly data: and
// javascript: — this file is written by a third party — and "//host/…", which looks like a path but
// is someone else's site. A path is always rooted at "/", and may not climb out with "..".
function classifySrc(value) {
  const src = typeof value === 'string' ? value.trim() : '';
  if (src === '') return { kind: 'missing' };
  if (EXTERNAL.test(src)) return { kind: 'external', src };
  if (src.startsWith('//') || ANY_SCHEME.test(src)) return { kind: 'refused', src };
  const path = src.startsWith('/') ? src : `/${src}`;
  if (path.includes('\\') || path.split('/').includes('..')) return { kind: 'refused', src };
  return { kind: 'local', src: path };
}

export function createImageResolver(raw, { fileExists } = {}) {
  const exists = typeof fileExists === 'function' ? fileExists : () => true;
  const warnings = [];
  const entries = new Map();

  // No images.json at all is not a mistake — most sites have no pictures yet. Only a file that is
  // there but shaped wrong is reported.
  if (raw !== undefined) {
    if (!isPlainObject(raw)) {
      warnings.push('images.json должен быть объектом «имя → картинка» — картинки не выводятся');
    } else {
      for (const [name, entry] of Object.entries(raw)) {
        if (isPlainObject(entry)) entries.set(name, entry);
        else warnings.push(`images.json: запись «${name}» не объект — пропущена`);
      }
    }
  }

  function resolve(name) {
    const fail = (problem) => ({ image: null, problem, missingAlt: false });
    if (typeof name !== 'string' || name === '') return fail('у картинки не указано имя');

    const entry = entries.get(name);
    if (!entry) return fail(`картинки «${name}» нет в images.json`);

    const src = classifySrc(entry.src);
    if (src.kind === 'missing') return fail(`у картинки «${name}» в images.json нет src`);
    if (src.kind === 'refused') return fail(`у картинки «${name}» недопустимый src «${src.src}»`);
    if (src.kind === 'local' && !exists(src.src)) {
      return fail(`файл картинки «${name}» не найден: public${src.src}`);
    }

    // A picture with no alt text still renders — losing it would be worse than shipping it
    // undescribed — but the caller is told, because for search it is a real loss.
    const alt = typeof entry.alt === 'string' ? entry.alt.trim() : '';
    const image = { src: src.src, alt };
    const width = toDimension(entry.width);
    const height = toDimension(entry.height);
    if (width !== undefined) image.width = width;
    if (height !== undefined) image.height = height;
    return { image, problem: null, missingAlt: alt === '' };
  }

  return { resolve, warnings };
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run tests/images.test.mjs`
Expected: PASS — 14 тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/images.mjs tests/images.test.mjs
git commit -m "$(cat <<'EOF'
Реестр картинок: имя из images.json в src и alt

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Задача 3: Приведение `content` страницы — `src/lib/content.mjs`

Чистый модуль: получает блоки одной страницы `{ type, props }` и возвращает их в виде, который рисует
шаблон. Знает по имени только два элемента — `title` и картинку; всё остальное пропускает как есть.
Картинки ищет через переданную функцию (в продакшене это `resolve` из задачи 2). В этой задаче ни к
чему не подключается.

**Files:**
- Create: `src/lib/content.mjs`
- Test: `tests/content.test.mjs`

**Interfaces:**
- Consumes: форма ответа `resolve` из задачи 2 — `{ image: object | null, problem: string | null, missingAlt: boolean }`.
- Produces: `normalizePageContent(blocks: unknown, { slug?: string, resolveImage?: (name) => result }): { blocks, warnings }`
  - на выходе каждый блок — `{ type, props: { content: [...] } }`, других полей в `props` нет;
  - заголовок — `{ type: 'title', tag: 'h1'…'h6', text }`;
  - картинка-элемент — `{ type: 'image', image: { src, alt, width?, height? } }`;
  - поле `image` у любого вложенного объекта — такой же объект картинки или отсутствует;
  - каждое предупреждение начинается с `` `${slug}: ` `` (если `slug` передан).

- [ ] **Step 1: Написать падающие тесты**

Создать `tests/content.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { normalizePageContent } from '../src/lib/content.mjs';

// Stands in for the resolver from src/lib/images.mjs: knows two pictures, one without alt text.
function fakeResolver() {
  const known = {
    main: { src: '/images/main.webp', alt: 'Main' },
    bare: { src: '/images/bare.webp', alt: '' },
  };
  return (name) =>
    known[name]
      ? { image: known[name], problem: null, missingAlt: known[name].alt === '' }
      : { image: null, problem: `картинки «${name}» нет в images.json`, missingAlt: false };
}

const block = (type, content) => ({ type, props: { content } });
const run = (blocks) =>
  normalizePageContent(blocks, { slug: '/page', resolveImage: fakeResolver() });

describe('normalizePageContent: titles', () => {
  it('turns the tag key into tag and text, keeping the order of content', () => {
    const { blocks, warnings } = run([
      block('section', [
        { type: 'title', h1: 'Page title' },
        { type: 'text', text: 'Body.' },
        { type: 'title', h3: 'Sub' },
      ]),
    ]);
    expect(blocks[0]).toEqual({
      type: 'section',
      props: {
        content: [
          { type: 'title', tag: 'h1', text: 'Page title' },
          { type: 'text', text: 'Body.' },
          { type: 'title', tag: 'h3', text: 'Sub' },
        ],
      },
    });
    expect(warnings).toEqual([]);
  });

  it('takes the first heading key when there are several, and says which ones', () => {
    const { blocks, warnings } = run([
      block('section', [
        { type: 'title', h1: 'Page' },
        { type: 'title', h3: 'Wins', h2: 'Ignored' },
      ]),
    ]);
    expect(blocks[0].props.content[1]).toEqual({ type: 'title', tag: 'h3', text: 'Wins' });
    expect(warnings).toEqual(['/page: у заголовка несколько ключей (h3, h2) — взят h3']);
  });

  it('drops a title with no heading key — including one still written the old way', () => {
    const { blocks, warnings } = run([
      block('section', [
        { type: 'title', h1: 'Page' },
        { type: 'title', tag: 'h2', text: 'Old style' },
        { type: 'title', h7: 'Not a tag' },
      ]),
    ]);
    expect(blocks[0].props.content).toEqual([{ type: 'title', tag: 'h1', text: 'Page' }]);
    expect(warnings).toEqual([
      '/page: у заголовка нет ключа h1–h6 — пропущен',
      '/page: у заголовка нет ключа h1–h6 — пропущен',
    ]);
  });

  it('drops a heading with nothing in it', () => {
    const { blocks, warnings } = run([
      block('section', [
        { type: 'title', h1: 'Page' },
        { type: 'title', h2: '   ' },
        { type: 'title', h2: 42 },
      ]),
    ]);
    expect(blocks[0].props.content).toHaveLength(1);
    expect(warnings).toEqual([
      '/page: заголовок h2 пустой — пропущен',
      '/page: заголовок h2 пустой — пропущен',
    ]);
  });
});

describe('normalizePageContent: one h1 per page', () => {
  it('keeps the first h1 and turns every later one into h2, across blocks', () => {
    const { blocks, warnings } = run([
      block('hero', [{ type: 'title', h1: 'First' }]),
      block('section', [
        { type: 'title', h1: 'Second' },
        { type: 'title', h1: 'Third' },
      ]),
    ]);
    expect(blocks[0].props.content[0].tag).toBe('h1');
    expect(blocks[1].props.content.map((entry) => entry.tag)).toEqual(['h2', 'h2']);
    expect(warnings).toEqual([
      '/page: второй h1 на странице стал h2: «Second»',
      '/page: второй h1 на странице стал h2: «Third»',
    ]);
  });

  it('warns when a page with content has no h1 at all', () => {
    expect(run([block('section', [{ type: 'title', h2: 'Only h2' }])]).warnings).toEqual([
      '/page: на странице нет h1',
    ]);
  });

  it('does not warn about h1 on a page with no content at all', () => {
    expect(run([block('section', [])]).warnings).toEqual([]);
    expect(run([]).warnings).toEqual([]);
  });
});

describe('normalizePageContent: pictures', () => {
  it('resolves a standalone picture written either way', () => {
    const { blocks, warnings } = run([
      block('section', [
        { type: 'title', h1: 'Page' },
        { image: 'main' },
        { type: 'image', image: 'main' },
      ]),
    ]);
    expect(blocks[0].props.content.slice(1)).toEqual([
      { type: 'image', image: { src: '/images/main.webp', alt: 'Main' } },
      { type: 'image', image: { src: '/images/main.webp', alt: 'Main' } },
    ]);
    expect(warnings).toEqual([]);
  });

  it('drops a standalone picture that does not resolve, giving the reason', () => {
    const { blocks, warnings } = run([
      block('section', [{ type: 'title', h1: 'Page' }, { image: 'nowhere' }]),
    ]);
    expect(blocks[0].props.content).toHaveLength(1);
    expect(warnings).toEqual(['/page: картинки «nowhere» нет в images.json — не выводится']);
  });

  it('resolves the image field of a card, and drops only the field when it does not resolve', () => {
    const { blocks, warnings } = run([
      block('section', [
        { type: 'title', h1: 'Page' },
        {
          type: 'cards',
          items: [
            { title: 'With picture', text: 'A', image: 'main' },
            { title: 'Broken picture', text: 'B', image: 'nowhere' },
          ],
        },
      ]),
    ]);
    expect(blocks[0].props.content[1].items).toEqual([
      { title: 'With picture', text: 'A', image: { src: '/images/main.webp', alt: 'Main' } },
      { title: 'Broken picture', text: 'B' },
    ]);
    expect(warnings).toEqual(['/page: картинки «nowhere» нет в images.json — не выводится']);
  });

  it('keeps a picture that has no alt text, and says so', () => {
    const { blocks, warnings } = run([
      block('section', [{ type: 'title', h1: 'Page' }, { image: 'bare' }]),
    ]);
    expect(blocks[0].props.content[1].image.src).toBe('/images/bare.webp');
    expect(warnings).toEqual(['/page: у картинки «bare» нет alt — выводится без описания']);
  });

  it('refuses an image value that is not a name', () => {
    const { blocks, warnings } = run([
      block('section', [
        { type: 'title', h1: 'Page' },
        { image: { src: '/inline.webp' } },
        { type: 'cards', items: [{ title: 'Card', image: 42 }] },
      ]),
    ]);
    expect(blocks[0].props.content).toEqual([
      { type: 'title', tag: 'h1', text: 'Page' },
      { type: 'cards', items: [{ title: 'Card' }] },
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings.every((warning) => warning.includes('поле image'))).toBe(true);
  });
});

describe('normalizePageContent: block shape', () => {
  it('names block fields other than content — what a block written the old way leaves behind', () => {
    const { blocks, warnings } = run([
      { type: 'hero', props: { heading: 'Old', paragraphs: ['Old'] } },
    ]);
    expect(blocks[0]).toEqual({ type: 'hero', props: { content: [] } });
    expect(warnings).toEqual([
      '/page: у блока «hero» поля heading, paragraphs не используются — содержимое блока пишется в content',
    ]);
  });

  it('treats a missing content as empty quietly, and a content that is not a list as empty loudly', () => {
    const quiet = run([{ type: 'links', props: {} }]);
    expect(quiet.blocks[0].props.content).toEqual([]);
    expect(quiet.warnings).toEqual([]);

    const loud = run([block('faq', 'not a list')]);
    expect(loud.blocks[0].props.content).toEqual([]);
    expect(loud.warnings).toEqual(['/page: у блока «faq» content не список — блок пуст']);
  });

  it('passes every other element through for the template to judge', () => {
    const entries = [
      { type: 'title', h1: 'Page' },
      { type: 'text', text: 'Body' },
      { type: 'toggle', title: 'Q?', text: 'A.' },
      { type: 'quote', text: 'Unknown to this file' },
      { note: 'no type at all' },
    ];
    expect(run([block('section', entries)]).blocks[0].props.content.slice(1)).toEqual(
      entries.slice(1),
    );
  });

  it('drops content entries that are not objects', () => {
    const { blocks } = run([
      block('section', [{ type: 'title', h1: 'Page' }, 'a string', null, 42, ['array']]),
    ]);
    expect(blocks[0].props.content).toEqual([{ type: 'title', tag: 'h1', text: 'Page' }]);
  });

  it('never throws on nonsense', () => {
    for (const input of [
      undefined,
      null,
      'blocks',
      [null, 42, 'x', { type: 'section' }],
      [{ type: 'section', props: 'x' }],
    ]) {
      expect(() => normalizePageContent(input)).not.toThrow();
    }
  });

  it('works with no slug and no resolver', () => {
    const { warnings } = normalizePageContent([
      block('section', [{ type: 'title', h1: 'Page' }, { image: 'main' }]),
    ]);
    expect(warnings).toEqual(['картинки «main» нет в images.json — не выводится']);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/content.test.mjs`
Expected: FAIL — `Failed to load url ../src/lib/content.mjs`.

- [ ] **Step 3: Написать модуль**

Создать `src/lib/content.mjs`:

```js
// Brings one page's blocks into the single shape the templates render.
//
// On disk every block is { type, content: [ … ] }, and a heading carries its tag as the key:
// { "type": "title", "h2": "…" }. A template should not have to know that spelling, nor look a
// picture's name up in images.json, nor count h1s across a page it only ever sees one block of —
// so all three happen here, once, with the whole page in view:
//
//   - a title becomes { type: 'title', tag, text };
//   - a picture — { "image": "main" }, or an `image` field on any other element — becomes the
//     picture's data, or disappears with a warning when it cannot be found;
//   - the first h1 on the page stays h1, every later one becomes h2.
//
// Nothing here knows any other element. text, list, table, cards, toggle and whatever comes next
// pass through untouched, to be drawn — or dropped with a warning — by the template.

const TITLE_KEYS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeOf(entry) {
  return typeof entry.type === 'string' ? entry.type.trim() : '';
}

// A standalone picture is an entry that names a picture and is not some other element. It is
// written { "image": "main" }, or { "type": "image", "image": "main" } by anyone writing it by
// analogy with every other element — both mean the same thing, and neither is worth a warning.
function isPictureEntry(entry) {
  const type = typeOf(entry);
  return (type === '' || type === 'image') && Object.hasOwn(entry, 'image');
}

// The first h1–h6 key in the order it was written wins. A title with none — which is exactly what
// a title still written the old way, { tag, text }, looks like — has nothing to show.
function normalizeTitle(entry, report) {
  const keys = Object.keys(entry).filter((key) => TITLE_KEYS.includes(key));
  if (keys.length === 0) {
    report('у заголовка нет ключа h1–h6 — пропущен');
    return null;
  }
  const [tag] = keys;
  if (keys.length > 1) report(`у заголовка несколько ключей (${keys.join(', ')}) — взят ${tag}`);
  const text = typeof entry[tag] === 'string' ? entry[tag].trim() : '';
  if (text === '') {
    report(`заголовок ${tag} пустой — пропущен`);
    return null;
  }
  return { type: 'title', tag, text };
}

function resolvePicture(name, resolveImage, report) {
  if (typeof name !== 'string') {
    report('поле image должно быть именем картинки из images.json — не выводится');
    return null;
  }
  const { image, problem, missingAlt } = resolveImage(name);
  if (!image) {
    report(`${problem} — не выводится`);
    return null;
  }
  if (missingAlt) report(`у картинки «${name}» нет alt — выводится без описания`);
  return image;
}

// Replaces every `image` key anywhere inside a value — on the element, on a card in its `items`,
// on anything nested deeper — with the picture it names, or removes the key when the name does not
// resolve. Walking every key instead of known element shapes is what lets a new element carry a
// picture without this file learning about it.
function resolveNested(value, resolveImage, report) {
  if (Array.isArray(value)) return value.map((item) => resolveNested(item, resolveImage, report));
  if (!isPlainObject(value)) return value;
  const result = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === 'image') {
      const picture = resolvePicture(inner, resolveImage, report);
      if (picture) result.image = picture;
    } else {
      result[key] = resolveNested(inner, resolveImage, report);
    }
  }
  return result;
}

const NO_REGISTRY = (name) => ({
  image: null,
  problem: `картинки «${name}» нет в images.json`,
  missingAlt: false,
});

export function normalizePageContent(blocks, { slug = '', resolveImage } = {}) {
  const warnings = [];
  const prefix = slug === '' ? '' : `${slug}: `;
  const report = (message) => warnings.push(`${prefix}${message}`);
  const resolve = typeof resolveImage === 'function' ? resolveImage : NO_REGISTRY;

  let seenH1 = false;
  let hasContent = false;

  const normalized = (Array.isArray(blocks) ? blocks : []).filter(isPlainObject).map((block) => {
    const props = isPlainObject(block.props) ? block.props : {};

    // Anything next to `content` is what a block written in the old format leaves behind (heading,
    // paragraphs, items). Rendering nothing for it silently would make that block just vanish.
    const extra = Object.keys(props).filter((key) => key !== 'content');
    if (extra.length > 0) {
      report(
        `у блока «${block.type}» поля ${extra.join(', ')} не используются — содержимое блока пишется в content`,
      );
    }

    let entries = props.content === undefined ? [] : props.content;
    if (!Array.isArray(entries)) {
      report(`у блока «${block.type}» content не список — блок пуст`);
      entries = [];
    }

    const content = [];
    for (const entry of entries) {
      if (!isPlainObject(entry)) continue;

      if (typeOf(entry) === 'title') {
        const title = normalizeTitle(entry, report);
        if (!title) continue;
        if (title.tag === 'h1') {
          if (seenH1) {
            report(`второй h1 на странице стал h2: «${title.text}»`);
            title.tag = 'h2';
          }
          seenH1 = true;
        }
        content.push(title);
      } else if (isPictureEntry(entry)) {
        const picture = resolvePicture(entry.image, resolve, report);
        if (picture) {
          const rest = Object.fromEntries(
            Object.entries(entry).filter(([key]) => key !== 'image' && key !== 'type'),
          );
          content.push({ ...resolveNested(rest, resolve, report), type: 'image', image: picture });
        }
      } else {
        content.push(resolveNested(entry, resolve, report));
      }
    }

    if (content.length > 0) hasContent = true;
    return { type: block.type, props: { content } };
  });

  // A page with nothing on it has nothing to title; a page with content and no h1 is the one that
  // loses in search.
  if (hasContent && !seenH1) report('на странице нет h1');

  return { blocks: normalized, warnings };
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run tests/content.test.mjs`
Expected: PASS — 18 тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/content.mjs tests/content.test.mjs
git commit -m "$(cat <<'EOF'
Приведение content страницы: заголовки, картинки, один h1

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Задача 4: Все блоки на `type` + `content`

Неделимая часть: движок, шаблоны и данные 899ok меняются вместе. Шаблоны рисуют то, что выдаёт
движок, а сквозные тесты читают данные 899ok — стоит поменять одно без другого, и сборка перестанет
выводить страницы. Картинки в этой задаче движок уже разбирает, но реестр ему пока никто не передаёт —
это задача 5. Элемента `image` в шаблоне тоже пока нет.

**Files:**
- Modify: `src/lib/normalize.mjs`, `src/lib/anchors.mjs`
- Modify: `templates/_shared/props.mjs`, `templates/_shared/ElementRenderer.astro`
- Create: `templates/review/Content.astro`, `templates/review/elements/toggle.astro`
- Modify: `templates/review/Heading.astro`, `templates/review/blocks/{hero,toc,section,links,faq}.astro`,
  `templates/review/manifest.json`
- Modify: `data/sites/899ok/*.json` (новый формат блоков), `data/sites/broken/sloppy.json`
- Test: `tests/normalize.test.mjs`, `tests/anchors.test.mjs`, `tests/render.test.mjs`,
  `tests/review-template.test.mjs`, `tests/site-dir.test.mjs`

**Interfaces:**
- Consumes: `normalizePageContent` (задача 3), `createImageResolver` (задача 2).
- Produces:
  - `normalizeSite(raw, { supportedBlocks, overrides, prober, images, imageFileExists })` — у каждого
    блока `props` = `{ content: [...] }`; неизвестный тип → `section`, если шаблон его объявляет;
    `images` и `imageFileExists` принимаются уже здесь, передавать их начнёт задача 5.
  - `linkAnchors(page)` — `props.anchor` у любого блока с `title`, кроме `toc`; у `toc` —
    `props.tocLinks: [{ label, anchor }]` из первого `list` в его `content`.
  - `asEntries(content)` в `templates/_shared/props.mjs` — записи `content` с непустым `type`.
  - `ElementRenderer` принимает проп `context` и передаёт его элементу как `context`.
  - `templates/review/Content.astro` — пропы `content`, `templateId`, `context`.

### Часть A: движок

- [ ] **Step 1: Обновить и дописать тесты `normalizeSite`**

В `tests/normalize.test.mjs`:

1. Тест `'gives every block a props object'` заменить на:

```js
  it('gives every block a props object holding its content', () => {
    const { site } = normalizeSite(
      { pages: [{ blocks: [{ type: 'hero' }] }] },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].blocks[0].props).toEqual({ content: [] });
  });
```

2. Тест `'drops blocks the template does not support'` заменить двумя:

```js
  it('renders a block type the template does not know as an ordinary section', () => {
    const { site, warnings } = normalizeSite(
      {
        pages: [
          {
            blocks: [
              { type: 'hero' },
              { type: 'carousel', props: { content: [{ type: 'text', text: 'Kept' }] } },
            ],
          },
        ],
      },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].blocks[1]).toEqual({
      type: 'section',
      props: { content: [{ type: 'text', text: 'Kept' }] },
    });
    expect(warnings.join(' ')).toContain('«carousel» — выведен как обычная секция');
  });

  it('drops an unknown block type when the template has no section to fall back on', () => {
    const { site, warnings } = normalizeSite(
      { pages: [{ blocks: [{ type: 'hero' }, { type: 'carousel' }] }] },
      { supportedBlocks: ['hero'] },
    );
    expect(site.pages[0].blocks.map((b) => b.type)).toEqual(['hero']);
    expect(warnings.join(' ')).toContain('carousel');
  });
```

3. В конец файла добавить:

```js
// Block content goes through src/lib/content.mjs (see tests/content.test.mjs for its own rules);
// these only pin that normalizeSite actually hands every page to it, with the page's slug and a
// registry built once for the whole site.
describe('normalizeSite: block content', () => {
  it("brings every block's content into the shape templates render", () => {
    const { site } = normalizeSite(
      {
        pages: [
          {
            slug: '/',
            blocks: [{ type: 'section', props: { content: [{ type: 'title', h1: 'Heading' }] } }],
          },
        ],
      },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].blocks[0].props.content).toEqual([
      { type: 'title', tag: 'h1', text: 'Heading' },
    ]);
  });

  it('keeps one h1 per page, naming the page in the warning', () => {
    const { site, warnings } = normalizeSite(
      {
        pages: [
          {
            slug: '/',
            blocks: [
              { type: 'hero', props: { content: [{ type: 'title', h1: 'First' }] } },
              { type: 'section', props: { content: [{ type: 'title', h1: 'Second' }] } },
            ],
          },
        ],
      },
      { supportedBlocks: BLOCKS },
    );
    expect(site.pages[0].blocks[1].props.content[0].tag).toBe('h2');
    expect(warnings).toContain('/: второй h1 на странице стал h2: «Second»');
  });

  it('resolves pictures through the registry and the file check it is given', () => {
    const { site, warnings } = normalizeSite(
      {
        pages: [
          {
            slug: '/',
            blocks: [
              {
                type: 'section',
                props: {
                  content: [{ type: 'title', h1: 'Page' }, { image: 'main' }, { image: 'gone' }],
                },
              },
            ],
          },
        ],
      },
      {
        supportedBlocks: BLOCKS,
        images: {
          main: { src: '/images/main.webp', alt: 'Main' },
          gone: { src: '/images/gone.webp', alt: 'Gone' },
        },
        imageFileExists: (src) => src === '/images/main.webp',
      },
    );
    expect(site.pages[0].blocks[0].props.content).toEqual([
      { type: 'title', tag: 'h1', text: 'Page' },
      { type: 'image', image: { src: '/images/main.webp', alt: 'Main' } },
    ]);
    expect(warnings).toContain(
      '/: файл картинки «gone» не найден: public/images/gone.webp — не выводится',
    );
  });

  it('reports a registry in the wrong shape once, not once per page', () => {
    const { warnings } = normalizeSite(
      { pages: [{ slug: '/' }, { slug: '/a' }] },
      { supportedBlocks: BLOCKS, images: 'nope' },
    );
    expect(warnings.filter((warning) => warning.includes('images.json'))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Перевести тесты `linkAnchors` на новый вид `toc`**

В `tests/anchors.test.mjs`:

1. После функции `section` добавить помощник:

```js
// A table of contents is the first `list` in a toc block's content now; the pairs linkAnchors
// makes land beside it as `tocLinks`.
function toc(items, heading) {
  const title = heading ? [{ type: 'title', tag: 'h2', text: heading }] : [];
  return { type: 'toc', props: { content: [...title, { type: 'list', items }] } };
}
```

2. Заменить в тестах:
   - `{ type: 'toc', props: { items: ['Первый пункт', 'Второй пункт'] } }` → `toc(['Первый пункт', 'Второй пункт'])`,
     а `result.blocks[0].props.items` → `result.blocks[0].props.tocLinks`;
   - `{ type: 'toc', props: { items: ['Welcome Bonus — No Fluff'] } }` → `toc(['Welcome Bonus — No Fluff'])`,
     и оба `result.blocks[0].props.items[0].anchor` → `result.blocks[0].props.tocLinks[0].anchor`;
   - `{ type: 'toc', props: { items: ['Есть раздел', 'Раздела нет'] } }` → `toc(['Есть раздел', 'Раздела нет'])`,
     и `result.blocks[0].props.items[1].anchor` → `result.blocks[0].props.tocLinks[1].anchor`;
   - `linkAnchors(page({ type: 'toc', props: { heading: 'Содержание', items: [] } }))` →
     `linkAnchors(page(toc([], 'Содержание')))`;
   - в `'survives malformed input'`: `{ blocks: [{ type: 'toc', props: { items: 'строка' } }] }` →
     `{ blocks: [{ type: 'toc', props: { content: [{ type: 'list', items: 'строка' }] } }] }`, и добавить
     строкой ниже
     `expect(() => linkAnchors({ blocks: [{ type: 'toc', props: { content: 'x' } }] })).not.toThrow();`

3. Перед `'survives malformed input'` добавить два теста:

```js
  it('anchors every kind of block by the first title in its content', () => {
    const titled = (type, text) => ({
      type,
      props: { content: [{ type: 'title', tag: 'h2', text }] },
    });
    const result = linkAnchors(
      page(titled('hero', 'Welcome'), titled('faq', 'Questions'), titled('links', 'More Pages')),
    );
    expect(result.blocks.map((block) => block.props.anchor)).toEqual([
      'welcome',
      'questions',
      'more-pages',
    ]);
  });

  it('takes the first list of a toc as its entries, wherever it sits', () => {
    const result = linkAnchors(
      page(
        {
          type: 'toc',
          props: {
            content: [
              { type: 'text', text: 'Intro' },
              { type: 'list', items: ['Only'] },
              { type: 'list', items: ['Ignored'] },
            ],
          },
        },
        section('Target'),
      ),
    );
    expect(result.blocks[0].props.tocLinks).toEqual([{ label: 'Only', anchor: 'target' }]);
  });
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `npx vitest run tests/normalize.test.mjs tests/anchors.test.mjs`
Expected: FAIL — среди прочего `expected { } to deeply equal { content: [] }` и `tocLinks` равен `undefined`.

- [ ] **Step 4: Подключить `content.mjs` к `normalizeSite` (`src/lib/normalize.mjs`)**

1. К импортам в начале файла добавить:

```js
import { createImageResolver } from './images.mjs';
import { normalizePageContent } from './content.mjs';
```

2. В `normalizeSite` сразу после строки `const warnings = [];` добавить:

```js
  // Built once per site, so a registry in the wrong shape is reported once rather than once for
  // every page that names a picture. Whether a picture's file exists is asked through
  // `imageFileExists`, which a real build supplies (see site-context.mjs) — this function stays
  // free of the filesystem, exactly as it does for slugs.
  const images = createImageResolver(options.images, { fileExists: options.imageFileExists });
  warnings.push(...images.warnings);
```

3. В цикле по блокам страницы заменить участок от `const type = toText(candidate.type, '');` до
   конца цикла `for (const candidate of toArray(page.blocks)) { … }` и следующего за ним блока с футером
   на:

```js
      let type = toText(candidate.type, '');
      if (type === '') {
        warnings.push(`${slug}: пропущен блок без поля type`);
        continue;
      }
      // Every block is one shape now — a type and a content list — so a type this template has no
      // shell for can still show its content as an ordinary section instead of vanishing. Only a
      // template that has no section either leaves nothing to fall back on.
      if (supported && !supported.has(type)) {
        if (supported.has('section')) {
          warnings.push(`${slug}: шаблон не знает блок «${type}» — выведен как обычная секция`);
          type = 'section';
        } else {
          warnings.push(`${slug}: шаблон не поддерживает блок «${type}» — пропущен`);
          continue;
        }
      }
      blocks.push({
        type,
        props: isPlainObject(candidate.props) ? candidate.props : {},
      });
    }

    const content = normalizePageContent(blocks, { slug, resolveImage: images.resolve });
    warnings.push(...content.warnings);
    const pageBlocks = content.blocks;

    const canRenderFooter = !supported || supported.has('footer');
    if (canRenderFooter && !pageBlocks.some((block) => block.type === 'footer')) {
      pageBlocks.push({ type: 'footer', props: {} });
    }
```

и в `normalizedPages.push({ … })` ниже заменить `blocks,` на `blocks: pageBlocks,`.

- [ ] **Step 5: Заголовок любого блока и оглавление из `list` (`src/lib/anchors.mjs`)**

1. Заменить функции `firstTitleText` и `headingOf` (вместе с комментарием над `firstTitleText`) на:

```js
function firstOfType(content, type) {
  const list = Array.isArray(content) ? content : [];
  return list.find(
    (entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && entry.type === type,
  );
}

// Every block names its heading the same way now: the first `title` element in its content,
// wherever it sits — content order is the author's call, so it is not always entry zero.
function headingOf(block) {
  const title = firstOfType(block.props.content, 'title');
  return title && typeof title.text === 'string' ? title.text : '';
}
```

2. Заменить второй цикл в `linkAnchors` (от комментария `// Then hand each contents entry …` до его
   закрывающей скобки) на:

```js
  // Then hand each contents entry the anchor of the section holding the same position after it.
  // The contents are the first list in the toc block's content; the pairs are stored beside it as
  // `tocLinks`, which the toc block draws in that list's place. An entry with no section left to
  // point at keeps its label and simply is not a link.
  for (const [index, block] of blocks.entries()) {
    if (block?.type !== 'toc' || !block.props) continue;
    const targets = blocks.slice(index + 1).filter((candidate) => candidate?.props?.anchor);
    const list = firstOfType(block.props.content, 'list');
    const labels = Array.isArray(list?.items) ? list.items : [];
    block.props.tocLinks = labels.map((label, position) => ({
      label: typeof label === 'string' ? label : '',
      anchor: targets[position]?.props.anchor ?? '',
    }));
  }
```

- [ ] **Step 6: Убедиться, что модульные тесты движка проходят**

Run: `npx vitest run tests/normalize.test.mjs tests/anchors.test.mjs tests/content.test.mjs tests/images.test.mjs`
Expected: PASS. Сквозные тесты (`render`, `review-template`, `site-dir`, `server`) на этом шаге ещё
падают — шаблоны и данные переводятся в частях B и C.

### Часть B: шаблоны

- [ ] **Step 7: Общие помощники шаблона**

1. `templates/_shared/props.mjs` — после функции `asRecords` добавить:

```js
// The entries of a block's `content` a template can render: plain objects that name a type.
// Anything else — a bare string, null, an object with no type — identifies nothing and is dropped
// the same quiet way every other malformed collection in the templates is.
export function asEntries(content) {
  return asRecords(content).filter((entry) => asText(entry.type) !== '');
}
```

2. `templates/_shared/ElementRenderer.astro` — строку `const { entry, templateId } = Astro.props;`
   заменить на

```js
// `context` is what the enclosing block tells its elements about where they sit — the hero asks its
// pictures to load at once — passed through untouched, so no element has to know which block it is in.
const { entry, templateId, context } = Astro.props;
```

   а последнюю строку `{Component && <Component {...entry} />}` — на
   `{Component && <Component {...entry} context={context} />}`.

3. Создать `templates/review/Content.astro`:

```astro
---
// Renders a block's content entries in order, each through its own element component. Every block
// of this template draws its body with this, inside its own shell — which is what makes a hero, a
// table of contents and an FAQ the same kind of thing underneath.
import { asEntries } from '../_shared/props.mjs';
import ElementRenderer from '../_shared/ElementRenderer.astro';

const { content, templateId, context = {} } = Astro.props;
const entries = asEntries(content);
---

{entries.map((entry) => (
  <ElementRenderer entry={entry} templateId={templateId} context={context} />
))}
```

- [ ] **Step 8: `Heading.astro` принимает `h1`**

Заменить `templates/review/Heading.astro` целиком:

```astro
---
// Every heading this template renders comes through here, via elements/title.astro. One component,
// so the look of a heading — the accent bar down the left of h2–h6, the gradient of the page's h1 —
// is defined once: Astro scopes a <style> to the component that owns the markup, so the same rule
// copied into several files would be several rules to keep in step.
import { asText } from '../_shared/props.mjs';

// h1 is allowed because the engine guarantees one per page (src/lib/content.mjs turns every later
// h1 into h2). Anything outside h1–h6 falls back to h2 rather than being thrown — content can never
// fail a build.
const ALLOWED_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const { tag, text } = Astro.props;
const value = asText(text);
// Capitalized on purpose: Astro only renders a variable as a dynamic tag when its name starts
// with an uppercase letter, otherwise it would emit a literal `<tag>` element.
const Tag = typeof tag === 'string' && ALLOWED_TAGS.has(tag) ? tag : 'h2';
const variant = Tag === 'h1' ? 'rheading--h1' : Tag === 'h2' ? null : 'rheading--sub';
---

{value && <Tag class:list={['rheading', variant]}>{value}</Tag>}

<style>
  .rheading {
    position: relative;
    padding-left: 1rem;
  }

  /* The bar is inset from the text's own line box rather than matching it exactly: a cap-height
     start and a baseline end read as aligned, where a bar spanning the full line box reads as
     too tall next to the letters. */
  .rheading::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0.18em;
    bottom: 0.18em;
    width: 4px;
    border-radius: 999px;
    background: var(--accent-primary);
    box-shadow: 0 0 12px var(--accent-glow);
  }

  .rheading--sub {
    padding-left: 0.8rem;
  }

  .rheading--sub::before {
    width: 3px;
  }

  /* The page's one h1 carries the scheme's gradient instead of the bar. The gradient runs across the
     whole heading box, so a second line starts part-way along it rather than restarting it. A
     scheme that wants a flat heading sets --heading-gradient to a single colour. */
  .rheading--h1 {
    padding-left: 0;
    background-image: var(--heading-gradient);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .rheading--h1::before {
    content: none;
  }

  /* Without background-clip the text would be painted `transparent` — that is, invisible. The
     colour comes back wherever the clip is unsupported. */
  @supports not ((-webkit-background-clip: text) or (background-clip: text)) {
    .rheading--h1 {
      background-image: none;
      color: var(--text-primary);
    }
  }
</style>
```

- [ ] **Step 9: Элемент `toggle`**

Создать `templates/review/elements/toggle.astro` (стили переезжают сюда из `faq.astro` с новыми
именами классов):

```astro
---
import { asText } from '../../_shared/props.mjs';
import RichText from '../RichText.astro';

// A question and its answer that opens on click — native <details>/<summary>, so it needs no script.
// Usable in any block: an FAQ is simply a block whose content is mostly these.
const { title, text } = Astro.props;
const question = asText(title);
const answer = asText(text);
---

{(question || answer) && (
  <details class="rtoggle">
    {question && <summary class="rtoggle__question">{question}</summary>}
    {answer && <p class="rtoggle__answer"><RichText text={answer} /></p>}
  </details>
)}

<style>
  .rtoggle {
    padding: 1.1rem 1.4rem;
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    /* Lets the height below animate to and from `auto`, which is what an answer of unknown length
       resolves to. Inherited, so declaring it here reaches ::details-content without switching
       the behaviour on for the whole document. */
    interpolate-size: allow-keywords;
  }

  /* The answer slides open instead of appearing whole. The details element's own content box is a
     pseudo-element that can be transitioned, so this needs no script and no wrapper. Where it is
     not supported the answer simply appears — nothing breaks, the motion is just missing.
     content-visibility has to travel with the height, or the answer would vanish before it
     finished collapsing. */
  .rtoggle::details-content {
    block-size: 0;
    overflow: hidden;
    transition:
      block-size 0.35s ease,
      content-visibility 0.35s allow-discrete;
  }

  .rtoggle[open]::details-content {
    block-size: auto;
  }

  @media (prefers-reduced-motion: reduce) {
    .rtoggle::details-content {
      transition: none;
    }
  }

  .rtoggle__question {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    color: var(--text-primary);
    font-weight: 650;
  }

  .rtoggle__question::-webkit-details-marker {
    display: none;
  }

  /* A CSS-only chevron (right and bottom border, rotated), pointing down while closed and up once
     open — no script, no glyph. */
  .rtoggle__question::after {
    content: '';
    flex-shrink: 0;
    width: 0.5rem;
    height: 0.5rem;
    border-right: 2px solid var(--text-tertiary);
    border-bottom: 2px solid var(--text-tertiary);
    transform: rotate(45deg);
    transition: transform 0.35s ease;
  }

  .rtoggle[open] .rtoggle__question::after {
    transform: rotate(-135deg);
  }

  .rtoggle__answer {
    margin-top: 0.85rem;
    color: var(--text-secondary);
  }
</style>
```

В `templates/review/manifest.json` строку `elements` заменить на
`"elements": ["title", "text", "list", "table", "cards", "toggle"],`.

- [ ] **Step 10: Все пять блоков рисуют `content`**

1. `templates/review/blocks/section.astro` — заменить целиком:

```astro
---
import { asEntries, asText } from '../../_shared/props.mjs';
import Content from '../Content.astro';

// The plainest shell: spacing, the anchor id, the container. What the section holds, and in what
// order, is entirely its content — see templates/review/Content.astro.
const { content, anchor, templateId } = Astro.props;
const entries = asEntries(content);
const anchorId = asText(anchor);
const idAttrs = anchorId ? { id: anchorId } : {};
---

{entries.length > 0 && (
  <section class="rsection section" {...idAttrs}>
    <div class="container rsection__inner">
      <Content content={entries} templateId={templateId} />
    </div>
  </section>
)}

<style>
  .rsection {
    scroll-margin-top: 5.5rem;
  }

  .rsection__inner {
    display: grid;
    gap: 1.1rem;
  }
</style>
```

2. `templates/review/blocks/hero.astro` — заменить целиком:

```astro
---
import { asEntries, asText } from '../../_shared/props.mjs';
import Content from '../Content.astro';

// The first screen: the brand as an eyebrow, then whatever the content holds — normally the page's
// h1 and a lead paragraph or two. Pictures here load at once: a first-screen picture left lazy is
// exactly what the browser waits for before the page counts as loaded (LCP).
const { content, site, anchor, templateId } = Astro.props;
const entries = asEntries(content);
const anchorId = asText(anchor);
const brandLabel = asText(site?.brand?.name);
---

{entries.length > 0 && (
  <section class="hero section" id={anchorId || undefined}>
    <div class="container hero__inner">
      {brandLabel && <p class="hero__eyebrow">{brandLabel}</p>}
      <div class="hero__content">
        <Content content={entries} templateId={templateId} context={{ eagerImages: true }} />
      </div>
    </div>
  </section>
)}

<style>
  .hero__inner,
  .hero__content {
    display: grid;
    justify-items: start;
    gap: 1.25rem;
  }

  .hero__eyebrow {
    padding: 0.35rem 0.9rem;
    border: 1px solid var(--border-default);
    border-radius: 999px;
    color: var(--text-secondary);
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  /* The hero's paragraphs read as a lead: larger and quieter than body text, held to a readable
     measure. They are drawn by the shared text element, so the look is applied from here to
     whatever paragraphs this block's content holds. */
  .hero__content :global(p) {
    color: var(--text-secondary);
    font-size: 1.15rem;
    max-width: 42rem;
  }
</style>
```

3. `templates/review/blocks/toc.astro` — заменить фронтматтер и разметку (всё до `<style>`), стили
   оставить как есть:

```astro
---
import { asEntries, asRecords, asText } from '../../_shared/props.mjs';
import ElementRenderer from '../../_shared/ElementRenderer.astro';

const { content, tocLinks, templateId } = Astro.props;
const entries = asEntries(content);

// The first list in the content is the table of contents itself. The engine has already paired its
// items with the sections that follow (tocLinks, see src/lib/anchors.mjs) — by position, because a
// contents entry usually paraphrases the heading rather than repeating it — and the grid of links
// is drawn in that list's place. An entry whose section is missing keeps its label as plain text: a
// link that goes nowhere is worse than no link. Everything else renders as it would anywhere.
const listIndex = entries.findIndex((entry) => entry.type === 'list');
const links = asRecords(tocLinks)
  .map((item) => ({ text: asText(item.label), anchor: asText(item.anchor) }))
  .filter((item) => item.text !== '');
const heading = entries.find((entry) => entry.type === 'title');
const label = asText(heading?.text, 'Table of contents');
const hasSomething = links.length > 0 || entries.some((_, index) => index !== listIndex);
---

{hasSomething && (
  <section class="toc section">
    <div class="container toc__inner">
      {entries.map((entry, index) =>
        index === listIndex ? (
          links.length > 0 && (
            <nav class="toc__card" aria-label={label}>
              <ul class="toc__grid">
                {links.map((link) => (
                  <li>
                    {link.anchor ? (
                      <a class="toc__link" href={`#${link.anchor}`}>{link.text}</a>
                    ) : (
                      <span class="toc__link toc__link--plain">{link.text}</span>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          )
        ) : (
          <ElementRenderer entry={entry} templateId={templateId} />
        ),
      )}
    </div>
  </section>
)}
```

4. `templates/review/blocks/links.astro` — заменить фронтматтер и разметку:

```astro
---
import { asEntries, asRecords, asText } from '../../_shared/props.mjs';
import Content from '../Content.astro';

// The "other pages" grid. Its links come from site.nav, not from the content — the menu already
// lists every page — so the content only carries what goes above the grid, normally a title. With no
// menu there is nothing for the block to be about, so it renders nothing at all.
const { content, site, anchor, templateId } = Astro.props;
const entries = asEntries(content);

// site.nav is already normalized by the engine, but every template treats `site` the same defensive
// way it treats its own props — never assume it stays that shape forever.
const navItems = asRecords(site?.nav)
  .map((item) => ({ label: asText(item.label), href: asText(item.href) }))
  .filter((item) => item.label !== '' && item.href !== '');

const anchorId = asText(anchor);
const idAttrs = anchorId ? { id: anchorId } : {};
---

{navItems.length > 0 && (
  <section class="links section" {...idAttrs}>
    <div class="container links__inner">
      <Content content={entries} templateId={templateId} />
      <div class="links__grid">
        {navItems.map((item) => (
          <a class="links__card" href={item.href}>
            <span class="links__label">{item.label}</span>
            <span class="links__arrow" aria-hidden="true"></span>
          </a>
        ))}
      </div>
    </div>
  </section>
)}
```

   и в стилях заменить правило `.links__grid { margin-top: 1.75rem; … }` на два:

```css
  .links__inner {
    display: grid;
    gap: 1.1rem;
  }

  .links__grid {
    margin-top: 0.65rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: 1rem;
  }
```

5. `templates/review/blocks/faq.astro` — заменить целиком (вид вопросов теперь у `toggle.astro`):

```astro
---
import { asEntries, asText } from '../../_shared/props.mjs';
import Content from '../Content.astro';

// An FAQ is an ordinary block whose content is mostly toggles (elements/toggle.astro carries their
// look). The type stays separate so structured FAQ data for search engines can be added here later
// without touching any other block.
const { content, anchor, templateId } = Astro.props;
const entries = asEntries(content);
const anchorId = asText(anchor);
const idAttrs = anchorId ? { id: anchorId } : {};
---

{entries.length > 0 && (
  <section class="faq section" {...idAttrs}>
    <div class="container faq__inner">
      <Content content={entries} templateId={templateId} />
    </div>
  </section>
)}

<style>
  .faq {
    scroll-margin-top: 5.5rem;
  }

  /* Questions sit closer together than ordinary section elements, so they read as one list; the
     heading keeps the usual distance from the first of them. */
  .faq__inner {
    display: grid;
    gap: 0.75rem;
  }

  .faq__inner > :global(.rheading) {
    margin-bottom: 1rem;
  }
</style>
```

### Часть C: данные и сквозные тесты

- [ ] **Step 11: Перевести страницы 899ok на новый формат блоков**

Разовый скрипт, в репозиторий не попадает. Повторный импорт таблицы здесь не годится: он стёр бы
ссылки `[текст](/casino)` и карточки, проставленные после импорта.

```bash
node --input-type=module -e "
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = 'data/sites/899ok';
const title = (tag, text) =>
  typeof text === 'string' && text.trim() !== '' ? [{ type: 'title', [tag]: text }] : [];
const texts = (values) => (Array.isArray(values) ? values : []).map((text) => ({ type: 'text', text }));
const convertEntry = (entry) =>
  entry && entry.type === 'title' && typeof entry.tag === 'string'
    ? { type: 'title', [entry.tag]: entry.text }
    : entry;
const convert = (block) => {
  switch (block.type) {
    case 'hero':
      return { type: 'hero', content: [...title('h1', block.heading), ...texts(block.paragraphs)] };
    case 'toc':
      return { type: 'toc', content: [...title('h2', block.heading), { type: 'list', items: block.items }] };
    case 'links':
      return { type: 'links', content: title('h2', block.heading) };
    case 'faq':
      return {
        type: 'faq',
        content: [
          ...title('h2', block.heading),
          ...block.items.map(({ q, a }) => ({ type: 'toggle', title: q, text: a })),
        ],
      };
    case 'section':
      return { type: 'section', content: block.content.map(convertEntry) };
    default:
      throw new Error('unexpected block type ' + block.type);
  }
};
for (const name of readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'site.json')) {
  const page = JSON.parse(readFileSync(dir + '/' + name, 'utf8'));
  page.blocks = page.blocks.map(convert);
  writeFileSync(dir + '/' + name, JSON.stringify(page, null, 2) + '\n');
  console.log(name, page.blocks.map((block) => block.type).join(' '));
}
"
grep -lE '"(heading|paragraphs|tag)":' data/sites/899ok/*.json || echo "старых полей не осталось"
```

Expected: восемь строк вида `home.json hero toc section … links faq` и `старых полей не осталось`.

- [ ] **Step 12: Переписать `data/sites/broken/sloppy.json`**

Папка должна ломать уже новый формат. `"slug": "sloppy//"` остаётся нарочно — это оставшийся `slug`.
Заменить файл целиком:

```json
{
  "slug": "sloppy//",
  "blocks": [
    { "type": "hero" },
    {
      "type": "hero",
      "heading": "Old-style heading nobody reads",
      "paragraphs": ["Old-style paragraph"]
    },
    { "title": "no type at all" },
    "just a string",
    {
      "type": "carousel",
      "content": [{ "type": "text", "text": "An unknown block type still shows its content" }]
    },
    { "type": "faq", "content": "not an array at all" },
    { "type": "faq", "content": [null, { "type": "toggle", "title": "only a question" }] },
    {
      "type": "section",
      "content": [
        "just a string",
        { "note": "entry with no type field" },
        { "type": "quote", "text": "Unknown element type, dropped with a warning" },
        { "type": "title", "tag": "h2", "text": "Old-style title with no heading key" },
        { "type": "title", "h2": "First heading key wins", "h3": "Second key ignored" },
        { "type": "title", "h1": "The one real h1" },
        { "type": "title", "h1": "A second h1 becomes h2" },
        { "type": "title", "h2": "   " },
        { "type": "list", "items": "Coerced into a single list item" },
        { "type": "table", "columns": ["A", "B"], "rows": [] },
        { "type": "text", "text": "Text still renders after every broken entry above it" }
      ]
    },
    { "type": "section", "content": "not an array at all" }
  ]
}
```

- [ ] **Step 13: Обновить сквозные тесты `tests/render.test.mjs`**

1. Из `describe('engine build', …)` удалить оба теста про папку `broken`:
   `'survives a broken content folder'` и `'drops orphaned markup for empty collections and bad headings'`.
   Сразу после закрывающей скобки `describe('engine build', …)` добавить вместо них:

```js
// data/sites/broken is a site folder broken in every way the content format allows. It must still
// build; everything that could be shown is shown, and everything that could not is named in the log.
describe('a content folder broken in every way the format allows', () => {
  let html;
  let log;

  beforeAll(() => {
    const built = buildSite({ site: 'broken', outDir: join('output', 'test-broken') });
    html = readOutput(built.outDir, join('sloppy', 'index.html'));
    log = built.log;
  });

  it('still builds the page, down to the last entry', () => {
    expect(html).toContain('Text still renders after every broken entry above it');
    expect(html).toContain('only a question');
  });

  it('shows an unknown block type as an ordinary section', () => {
    expect(html).toContain('An unknown block type still shows its content');
    expect(log).toContain('«carousel» — выведен как обычная секция');
  });

  it('names an element type the template does not declare instead of throwing', () => {
    expect(log).toContain('quote');
  });

  it('reports a slug left in the file, which no longer decides anything', () => {
    expect(log).toContain('поле slug больше не используется');
  });

  it('reports what a block written the old way leaves behind', () => {
    expect(html).not.toContain('Old-style heading nobody reads');
    expect(log).toContain('поля heading, paragraphs не используются');
  });

  it('drops a title with no heading key, and takes the first of several', () => {
    expect(html).not.toContain('Old-style title with no heading key');
    expect(log).toContain('нет ключа h1–h6');
    expect(html).toMatch(/<h2[^>]*>First heading key wins<\/h2>/);
    expect(html).not.toContain('Second key ignored');
  });

  it('keeps one h1 on the page', () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>The one real h1<\/h1>/);
    expect(html).toMatch(/<h2[^>]*>A second h1 becomes h2<\/h2>/);
    expect(log).toContain('второй h1');
  });

  it('leaves no orphaned markup behind', () => {
    expect(html).not.toContain('[object Object]');
    expect(html).not.toMatch(/<ul[^>]*>\s*<\/ul>/);
    expect(html).not.toMatch(/<table[^>]*>\s*<\/table>/);
    expect(html).not.toMatch(/<p>\s*<\/p>/);
    // A `list` whose `items` is a single string is coerced into a one-item list, not dropped.
    expect(html).toContain('Coerced into a single list item');
  });
});
```

2. В тесте `'matches a nav href to the page it names even when one of them carries a trailing slash'`
   заменить блоки страниц:
   `blocks: [{ type: 'hero', props: { heading: 'Home' } }]` →
   `blocks: [{ type: 'hero', props: { content: [{ type: 'title', h1: 'Home' }] } }]`,
   и так же для `'Casino'`.

3. В обоих тестах про логотип (`describe('brand logo copied from the public folder', …)` и
   `describe('a logo the public folder does not actually contain', …)`) заменить
   `blocks: [{ type: 'hero', props: { heading: 'Hero' } }]` на
   `blocks: [{ type: 'hero', props: { content: [{ type: 'title', h1: 'Hero' }] } }]`.
   Сам логотип в этой задаче не меняется — это задача 5.

- [ ] **Step 14: Обновить сквозные тесты шаблона `tests/review-template.test.mjs`**

1. `'still builds a section stripped down to just a heading'`: заголовок →
   `{ type: 'title', h2: 'Just a heading, nothing else' }`.

2. `'still builds when the five block types arrive in a scrambled order'`: массив блоков заменить на

```js
      [
        {
          type: 'faq',
          props: {
            content: [
              { type: 'title', h2: 'FAQ first' },
              { type: 'toggle', title: 'Q?', text: 'A.' },
            ],
          },
        },
        { type: 'links', props: { content: [{ type: 'title', h2: 'Links second' }] } },
        {
          type: 'section',
          props: {
            content: [
              { type: 'title', h2: 'Section third' },
              { type: 'text', text: 'Body text for section third.' },
            ],
          },
        },
        {
          type: 'toc',
          props: {
            content: [
              { type: 'title', h2: 'TOC fourth' },
              { type: 'list', items: ['Section third'] },
            ],
          },
        },
        {
          type: 'hero',
          props: {
            content: [
              { type: 'title', h1: 'Hero last' },
              { type: 'text', text: 'Lead text.' },
            ],
          },
        },
      ],
```

3. `'allows a paragraph after a table, two headings in a row, and a chosen heading level'`: три заголовка →
   `{ type: 'title', h2: 'First Heading' }`, `{ type: 'title', h2: 'Second Heading Right After' }`,
   `{ type: 'title', h4: 'A Chosen Heading Level' }`.

4. Тест `'falls back to h2 for a tag outside h2-h6, and never emits a second h1'` заменить на:

```js
  it('keeps one h1 per page: the first stays, a later one becomes h2', () => {
    const dir = buildSingleBlockPage([
      { type: 'hero', props: { content: [{ type: 'title', h1: 'The Page Title' }] } },
      { type: 'section', props: { content: [{ type: 'title', h1: 'Not A Second H1' }] } },
    ]);
    try {
      const { outDir, log } = buildSite({
        outDir: join('output', 'test-review-title-h1-guard'),
        env: { SITE_DIR: dir, TEMPLATE: 'review', SCHEME: 'dark' },
      });
      const html = readOutput(outDir);
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html).toMatch(/<h1[^>]*>The Page Title<\/h1>/);
      expect(html).toMatch(/<h2[^>]*>Not A Second H1<\/h2>/);
      expect(log).toContain('второй h1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders a toggle as a native disclosure in an ordinary section', () => {
    const dir = buildSingleBlockPage([
      {
        type: 'section',
        props: {
          content: [
            { type: 'title', h2: 'Not an FAQ' },
            { type: 'toggle', title: 'Can a toggle live here?', text: 'Yes, [anywhere](/casino).' },
          ],
        },
      },
    ]);
    try {
      const { outDir } = buildSite({
        outDir: join('output', 'test-review-toggle'),
        env: { SITE_DIR: dir, TEMPLATE: 'review', SCHEME: 'dark' },
      });
      const html = readOutput(outDir);
      expect(html).toMatch(/<details[^>]*class="rtoggle"/);
      expect(html).toMatch(/<summary[^>]*>Can a toggle live here\?<\/summary>/);
      expect(html).toMatch(/<a[^>]*href="\/casino"[^>]*>anywhere<\/a>/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shows a block type it has no shell for as an ordinary section', () => {
    const dir = buildSingleBlockPage([
      {
        type: 'promo',
        props: {
          content: [
            { type: 'title', h2: 'Promo Heading' },
            { type: 'text', text: 'Promo body.' },
          ],
        },
      },
    ]);
    try {
      const { outDir, log } = buildSite({
        outDir: join('output', 'test-review-unknown-block'),
        env: { SITE_DIR: dir, TEMPLATE: 'review', SCHEME: 'dark' },
      });
      const html = readOutput(outDir);
      expect(html).toContain('Promo Heading');
      expect(html).toContain('Promo body.');
      expect(log).toContain('«promo» — выведен как обычная секция');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
```

5. В блоке `describe('review template: links inside body text, and card sets', …)` три заголовка:
   `{ type: 'title', tag: 'h2', text: 'Linked Section' }` → `{ type: 'title', h2: 'Linked Section' }`,
   `'Unsafe'` → `{ type: 'title', h2: 'Unsafe' }`, `'Two Ways In'` → `{ type: 'title', h2: 'Two Ways In' }`.

- [ ] **Step 15: Обновить сквозные тесты `tests/site-dir.test.mjs`**

1. `'builds with default shared settings'`: `blocks: [{ type: 'hero', heading: 'Hello' }]` →
   `blocks: [{ type: 'hero', content: [{ type: 'title', h1: 'Hello' }] }]`.

2. Блок `describe('a page whose blocks are reordered or partially stripped still builds', …)` заменить
   целиком:

```js
describe('a page whose blocks are reordered or partially stripped still builds', () => {
  it('renders every block in the order it arrives, and shows an unknown block type as a section', () => {
    const dir = makeSiteDir();
    try {
      writeJson(dir, 'site.json', { brand: { name: 'Reorder' } });
      writeJson(dir, 'home.json', {
        title: 'Home',
        description: 'd',
        blocks: [{ type: 'hero', content: [{ type: 'title', h1: 'Home hero' }] }],
      });
      writeJson(dir, 'mixed.json', {
        title: 'Mixed',
        description: 'd',
        // Out of the "natural" hero-first order, with a stripped answer, and a block type
        // ("gallery") the review template has no shell for.
        blocks: [
          {
            type: 'faq',
            content: [
              { type: 'title', h2: 'Frequently Asked' },
              { type: 'toggle', title: 'Does this survive reordering?', text: 'Yes.' },
              { type: 'toggle', title: 'What about a stripped answer?' },
            ],
          },
          { type: 'gallery', content: [{ type: 'text', text: 'Shown as an ordinary section' }] },
          {
            type: 'section',
            content: [{ type: 'title', h2: 'A stripped section with nothing else' }],
          },
          { type: 'hero', content: [{ type: 'title', h1: 'Reordered hero' }] },
        ],
      });
      const { outDir, log } = buildSite({
        outDir: join('output', 'test-site-dir-reordered-blocks'),
        env: { SITE_DIR: dir },
      });
      const html = readOutput(outDir, join('mixed', 'index.html'));
      expect(html).toContain('Does this survive reordering?');
      expect(html).toContain('What about a stripped answer?');
      expect(log).toContain('«gallery» — выведен как обычная секция');

      const order = [
        'Frequently Asked',
        'Shown as an ordinary section',
        'A stripped section with nothing else',
        'Reordered hero',
      ].map((needle) => html.indexOf(needle));
      expect(order.every((position) => position > -1)).toBe(true);
      for (let i = 1; i < order.length; i += 1) {
        expect(order[i]).toBeGreaterThan(order[i - 1]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 16: Прогнать все тесты**

Run: `npm test`
Expected: PASS, все файлы зелёные.

- [ ] **Step 17: Посмотреть на 899ok глазами**

Run: `SITE_DIR=data/sites/899ok TEMPLATE=review SCHEME=dark OUT_DIR=output/899ok npx astro build`
Потом `PORT=3999 node factory/server.mjs` и открыть `http://localhost:3999/preview/899ok/`.
Expected: страница выглядит как до задачи — `h1` с градиентом, оглавление в рамке с заголовком
снаружи, FAQ раскрывается плавно, карточки и таблицы на месте. Остановить сервер.

- [ ] **Step 18: Коммит**

```bash
git add src/lib/normalize.mjs src/lib/anchors.mjs templates/ data/sites/899ok/ data/sites/broken/sloppy.json tests/
git commit -m "$(cat <<'EOF'
Все блоки на type + content

Заголовок пишется ключом-тегом, FAQ — элементами toggle, неизвестный тип
блока выводится как обычная секция. На странице остаётся один h1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Задача 5: Картинки на странице

Движок уже умеет разбирать картинки (задачи 2–4), но реестр ему пока никто не передаёт. Здесь
`site-context` передаёт `images.json` и проверку файла, логотип становится картинкой из реестра, а
шаблон учится рисовать картинку отдельно и в карточке.

**Files:**
- Modify: `src/lib/site-context.mjs`, `src/lib/normalize.mjs`, `src/layouts/Base.astro`
- Create: `templates/review/elements/image.astro`
- Modify: `templates/review/elements/cards.astro`, `templates/review/manifest.json`
- Create: `data/sites/broken/images.json`; Modify: `data/sites/broken/sloppy.json`
- Test: `tests/normalize.test.mjs`, `tests/render.test.mjs`, `tests/review-template.test.mjs`

**Interfaces:**
- Consumes: `loadSiteDirInput(dir).images` (задача 1); `normalizeSite(raw, { images, imageFileExists })` (задача 4).
- Produces: `site.brand.logo` — `{ src, alt, width?, height? }` или `null` (раньше была строка-путь);
  элемент шаблона `image` получает `{ image, context }`; `context.eagerImages` — грузить сразу.

- [ ] **Step 1: Написать падающие тесты**

1. `tests/normalize.test.mjs` — в конец файла:

```js
describe('normalizeSite: the logo is a picture from the registry', () => {
  it('resolves the logo named in site.json through the same registry as the pages', () => {
    const { site } = normalizeSite(
      { brand: { name: 'Acme', logo: 'mark' } },
      { supportedBlocks: BLOCKS, images: { mark: { src: '/images/mark.svg', alt: 'Acme mark' } } },
    );
    expect(site.brand.logo).toEqual({ src: '/images/mark.svg', alt: 'Acme mark' });
  });

  it('drops a logo that does not resolve, with a warning', () => {
    const { site, warnings } = normalizeSite(
      { brand: { name: 'Acme', logo: 'mark' } },
      { supportedBlocks: BLOCKS },
    );
    expect(site.brand.logo).toBeNull();
    expect(warnings).toContain('Логотип: картинки «mark» нет в images.json — не выводится');
  });

  it('has no logo when site.json names none', () => {
    expect(normalizeSite({}, { supportedBlocks: BLOCKS }).site.brand.logo).toBeNull();
  });
});
```

2. `tests/render.test.mjs` — заменить оба блока про логотип
   (`describe('brand logo copied from the public folder', …)` и
   `describe('a logo the public folder does not actually contain', …)`) на:

```js
describe('brand logo, named in site.json and found through images.json', () => {
  let dir;
  let outDir;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'site-factory-logo-'));
    const publicDir = join(dir, 'public');
    mkdirSync(join(publicDir, 'images'), { recursive: true });
    writeFileSync(join(publicDir, 'images', 'logo.svg'), '<svg/>');
    writeSiteDirFromContent(dir, {
      // The logo renders in the header, and the header renders only when there is a nav to show
      // (see Base.astro's `showHeader`) — so a nav entry is needed to see the logo at all.
      brand: { name: 'Has Logo', logo: 'logo' },
      nav: [{ label: 'Home', href: '/' }],
      pages: [
        {
          slug: '/',
          meta: {},
          blocks: [{ type: 'hero', props: { content: [{ type: 'title', h1: 'Hero' }] } }],
        },
      ],
    });
    writeFileSync(
      join(dir, 'images.json'),
      JSON.stringify({
        logo: { src: '/images/logo.svg', alt: 'Has Logo mark', width: 120, height: 36 },
      }),
    );
    outDir = buildSite({
      outDir: join('output', 'test-logo-present'),
      env: { SITE_DIR: dir, PUBLIC_DIR: publicDir },
    }).outDir;
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('puts the logo in the header with the alt text from images.json', () => {
    expect(readOutput(outDir)).toMatch(
      /<img[^>]*src="\/images\/logo\.svg"[^>]*alt="Has Logo mark"[^>]*width="120"/,
    );
  });

  it('copies the logo file into the output', () => {
    expect(existsSync(join(outDir, 'images', 'logo.svg'))).toBe(true);
  });
});

describe('a logo that does not resolve', () => {
  it('is dropped, with a warning in the log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-factory-logo-missing-'));
    try {
      writeSiteDirFromContent(dir, {
        brand: { name: 'No Logo Here', logo: 'missing' },
        nav: [{ label: 'Home', href: '/' }],
        pages: [
          {
            slug: '/',
            meta: {},
            blocks: [{ type: 'hero', props: { content: [{ type: 'title', h1: 'Hero' }] } }],
          },
        ],
      });
      writeFileSync(
        join(dir, 'images.json'),
        JSON.stringify({ missing: { src: '/images/missing.svg', alt: 'Missing' } }),
      );
      const built = buildSite({ outDir: join('output', 'test-missing-logo'), env: { SITE_DIR: dir } });
      expect(readOutput(built.outDir)).not.toContain('/images/missing.svg');
      expect(built.log).toContain('Логотип: файл картинки «missing» не найден');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

3. `tests/render.test.mjs` — в блок `describe('a content folder broken in every way the format allows', …)`
   добавить тест:

```js
  it('shows a picture it can find and names every one it cannot', () => {
    expect(html).toMatch(/<img[^>]*src="https:\/\/example\.com\/picture\.webp"/);
    expect(log).toContain('у картинки «no-alt» нет alt');
    expect(log).toContain('картинки «not-in-registry» нет в images.json');
    expect(log).toContain('файл картинки «missing-file» не найден');
    expect(log).toContain('у картинки «no-src» в images.json нет src');
    expect(log).toContain('у картинки «script» недопустимый src');
    expect(log).toContain('поле image должно быть именем картинки');
    expect(log).toContain('images.json: запись «not-an-object» не объект');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('/images/missing.webp');
  });
```

4. `tests/review-template.test.mjs` — в импорт из `node:fs` добавить `mkdirSync`, в конец файла:

```js
describe('review template: pictures from images.json', () => {
  // A single-page site with three real picture files in its public folder and a registry naming
  // them — the shape a real site folder has once it carries pictures.
  function buildWithPictures(blocks, outName) {
    const dir = buildSingleBlockPage(blocks);
    const publicDir = join(dir, 'public');
    mkdirSync(join(publicDir, 'images'), { recursive: true });
    for (const name of ['hero.webp', 'section.webp', 'card.webp']) {
      writeFileSync(join(publicDir, 'images', name), 'not really a picture');
    }
    writeFileSync(
      join(dir, 'images.json'),
      JSON.stringify({
        hero: { src: '/images/hero.webp', alt: 'Hero picture', width: 1200, height: 600 },
        section: { src: '/images/section.webp', alt: 'Section picture' },
        card: { src: '/images/card.webp', alt: 'Card picture' },
      }),
    );
    try {
      return buildSite({
        outDir: join('output', outName),
        env: { SITE_DIR: dir, PUBLIC_DIR: publicDir, TEMPLATE: 'review', SCHEME: 'dark' },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('loads a picture in a section lazily, and one in the hero at once', () => {
    const { outDir } = buildWithPictures(
      [
        { type: 'hero', props: { content: [{ type: 'title', h1: 'Pictures' }, { image: 'hero' }] } },
        { type: 'section', props: { content: [{ type: 'title', h2: 'Below' }, { image: 'section' }] } },
      ],
      'test-review-pictures',
    );
    const html = readOutput(outDir);
    const hero = html.match(/<img[^>]*src="\/images\/hero\.webp"[^>]*>/)?.[0] ?? '';
    const section = html.match(/<img[^>]*src="\/images\/section\.webp"[^>]*>/)?.[0] ?? '';
    expect(hero).toContain('alt="Hero picture"');
    expect(hero).toContain('loading="eager"');
    expect(hero).toContain('fetchpriority="high"');
    expect(hero).toContain('width="1200"');
    expect(section).toContain('alt="Section picture"');
    expect(section).toContain('loading="lazy"');
    expect(section).not.toContain('fetchpriority');
    expect(existsSync(join(outDir, 'images', 'hero.webp'))).toBe(true);
  });

  it('renders the picture of a card', () => {
    const { outDir } = buildWithPictures(
      [
        {
          type: 'section',
          props: {
            content: [
              { type: 'title', h1: 'Cards' },
              { type: 'cards', items: [{ title: 'With picture', text: 'A', image: 'card' }] },
            ],
          },
        },
      ],
      'test-review-card-picture',
    );
    expect(readOutput(outDir)).toMatch(/<img[^>]*src="\/images\/card\.webp"[^>]*alt="Card picture"/);
  });

  it('leaves out a picture it cannot find, and says so in the log', () => {
    const { outDir, log } = buildWithPictures(
      [{ type: 'section', props: { content: [{ type: 'title', h1: 'Gap' }, { image: 'nowhere' }] } }],
      'test-review-missing-picture',
    );
    expect(readOutput(outDir)).not.toMatch(/<img\b/);
    expect(log).toContain('картинки «nowhere» нет в images.json');
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/normalize.test.mjs tests/review-template.test.mjs`
Expected: FAIL — `site.brand.logo` пока строка, а у картинок в выводе нет `<img>`: элемента `image` в
шаблоне ещё нет, и реестр в сборку не передаётся.

- [ ] **Step 3: Логотип — картинка из реестра (`src/lib/normalize.mjs`)**

1. Перед `export function normalizeSite` добавить:

```js
// The logo is a picture from images.json like any other, named in site.json — "brand.logo": "main".
// One that does not resolve is dropped with a warning instead of shipping as a broken image in the
// header of every page. Its alt text falls back to the brand name in the layout, so a logo with no
// alt of its own is not worth a warning.
function resolveLogo(value, images, warnings) {
  const name = toText(value, '');
  if (name === '') return null;
  const { image, problem } = images.resolve(name);
  if (!image) warnings.push(`Логотип: ${problem} — не выводится`);
  return image;
}
```

2. В объекте `brand` строку `logo: toText(brandInput.logo, ''),` заменить на
   `logo: resolveLogo(brandInput.logo, images, warnings),`.

- [ ] **Step 4: Передать реестр и проверку файла в сборку (`src/lib/site-context.mjs`)**

1. Строки, добавленные в задаче 1:

```js
  // `images` is read here too, but only wired into the normalizer once pictures are rendered.
  const { input: raw, warnings: folderWarnings } = loadSiteDirInput(dir);
```

заменить на

```js
  const { input: raw, images, warnings: folderWarnings } = loadSiteDirInput(dir);
```

2. Строку `const { site, warnings } = normalizeSite(raw, {` предварить объявлением
   `const publicDir = resolvePublicDir(root);`, а в объект опций после `prober: …,` добавить:

```js
    images,
    // A picture named in the content but absent from the public folder would ship as a broken
    // image — the content and the public folder are separate deliveries and drift apart easily. The
    // normalizer asks this for every local picture, the logo included, and drops the ones missing.
    imageFileExists: (src) => existsSync(join(publicDir, src)),
```

3. Удалить старую проверку логотипа целиком — блок, начинающийся с комментария
   `// A logo named in the content but absent from the public folder …` и заканчивающийся закрывающей
   скобкой `if (site.brand.logo !== '') { … }`. Логотип теперь проверяется тем же путём, что и любая
   картинка.

- [ ] **Step 5: Логотип в шапке (`src/layouts/Base.astro`)**

Заменить

```astro
              <img src={site.brand.logo} alt={site.brand.name} />
```

на

```astro
              <img
                src={site.brand.logo.src}
                alt={site.brand.logo.alt || site.brand.name}
                width={site.brand.logo.width}
                height={site.brand.logo.height}
              />
```

- [ ] **Step 6: Элемент `image` и картинка у карточки**

1. Создать `templates/review/elements/image.astro`:

```astro
---
import { asText } from '../../_shared/props.mjs';

// A picture from the site's images.json. The engine has already turned the name into { src, alt,
// width, height } and dropped every picture it could not find (src/lib/content.mjs), so all this
// decides is how it loads: lazily, unless the enclosing block asks for it at once — the hero does,
// because a first-screen picture held back until scrolling is what the load metric waits on.
const { image, context } = Astro.props;
const src = asText(image?.src);
const alt = typeof image?.alt === 'string' ? image.alt : '';
const eager = Boolean(context?.eagerImages);
---

{src && (
  <img
    class="rimage"
    src={src}
    alt={alt}
    width={image.width}
    height={image.height}
    loading={eager ? 'eager' : 'lazy'}
    decoding="async"
    fetchpriority={eager ? 'high' : undefined}
  />
)}

<style>
  .rimage {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius);
  }
</style>
```

2. `templates/review/elements/cards.astro`:
   - строку `const { items } = Astro.props;` заменить на

```js
const { items, context } = Astro.props;
const eager = Boolean(context?.eagerImages);
```

   - в объект, который строит `.map((item) => ({ … }))`, добавить поле
     `image: asText(item.image?.src) ? item.image : null,`, а условие фильтра заменить на
     `.filter((card) => card.title !== '' || card.lines.length > 0 || card.image);`
   - внутри `<div class="rcards__item">` первой строкой добавить:

```astro
          {card.image && (
            <img
              class="rcards__image"
              src={card.image.src}
              alt={card.image.alt}
              width={card.image.width}
              height={card.image.height}
              loading={eager ? 'eager' : 'lazy'}
              decoding="async"
            />
          )}
```

   - в стили добавить:

```css
  .rcards__image {
    width: 100%;
    height: auto;
    border-radius: var(--radius-sm);
  }
```

3. `templates/review/manifest.json`: `"elements": ["title", "text", "list", "table", "cards", "toggle", "image"],`

- [ ] **Step 7: Кривые картинки в `broken`**

1. Создать `data/sites/broken/images.json`:

```json
{
  "missing-file": { "src": "/images/missing.webp", "alt": "A file that is not in public" },
  "no-src": { "alt": "A record with no src" },
  "no-alt": { "src": "https://example.com/picture.webp" },
  "script": { "src": "javascript:alert(1)", "alt": "Not a picture" },
  "not-an-object": "just a string"
}
```

2. В `data/sites/broken/sloppy.json`, в `content` блока `section` — перед последним элементом
   (`"Text still renders after every broken entry above it"`) — вставить:

```json
        { "image": "not-in-registry" },
        { "image": "missing-file" },
        { "image": "no-src" },
        { "image": "script" },
        { "type": "image", "image": "no-alt" },
        { "image": 42 },
```

У `broken` нет своей папки `public/`, так что локальный файл картинки не найдётся — это и нужно.

- [ ] **Step 8: Прогнать все тесты**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Коммит**

```bash
git add src/ templates/ data/sites/broken/ tests/
git commit -m "$(cat <<'EOF'
Картинки из images.json: в content, в карточках, в логотипе

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Задача 6: Конвертер таблицы и импорт на новый формат

Таблица заказчика не меняется — меняется JSON, который из неё получается. Конвертер перестаёт писать
`slug` и собственные поля блоков; импорт выбирает только имена файлов.

**Files:**
- Modify: `scripts/sheet-to-json.mjs`, `scripts/import-sheet.mjs`
- Test: `tests/sheet-to-json.test.mjs`, `tests/import-sheet.test.mjs`

**Interfaces:**
- Consumes: `slugFromFileName`, `SERVICE_FILE_NAMES` из `src/lib/site-dir.mjs` (задача 1).
- Produces:
  - `sheetToPage(csvText: string): { title, description, blocks }` — без второго параметра и без `slug`;
  - `classify(page)` — по-прежнему экспортируется и идемпотентна, но выдаёт новые формы блоков;
  - `isHomeSheet(sheetName): boolean`; `assignTargets(sheets): { targets: [{ ...sheet, file }], notes }` —
    у цели больше нет поля `slug`; `slugFor` удалена.

- [ ] **Step 1: Перевести тесты конвертера на новый формат**

В `tests/sheet-to-json.test.mjs`:

1. Помощник `title` заменить на `const title = (tag, text) => ({ type: 'title', [tag]: text });`
   Все существующие ожидания в `describe('classify: …')` после этого описывают новый формат без других
   правок.
2. В тесте `'does not touch a section that a block type already claimed'` вызов
   `sheetToPage(csv, '/')` заменить на `sheetToPage(csv)`.
3. В конец файла добавить:

```js
describe('sheetToPage: the page format it writes', () => {
  it('writes no slug — the file name is the address now', () => {
    const page = sheetToPage('title,Casino\ndescription,About the casino\nh1,Welcome');
    expect(page).not.toHaveProperty('slug');
    expect(page.title).toBe('Casino');
    expect(page.description).toBe('About the casino');
  });

  it('builds the hero as content, keeping paragraphs and lists in the order they were written', () => {
    const csv = [
      'h1,Welcome',
      ',First paragraph.',
      ',Here is what I noticed:',
      ',Fast payouts',
      ',Live tables',
      ',Closing paragraph.',
    ].join('\n');
    expect(sheetToPage(csv).blocks[0]).toEqual({
      type: 'hero',
      content: [
        { type: 'title', h1: 'Welcome' },
        { type: 'text', text: 'First paragraph.' },
        { type: 'text', text: 'Here is what I noticed:' },
        { type: 'list', items: ['Fast payouts', 'Live tables'] },
        { type: 'text', text: 'Closing paragraph.' },
      ],
    });
  });

  it('writes section headings with the tag as the key', () => {
    const csv = ['h2,Payments', ',Deposits are instant.', 'h3,bKash', ',Fast.'].join('\n');
    const titles = sheetToPage(csv).blocks[0].content.filter((entry) => entry.type === 'title');
    expect(titles).toEqual([
      { type: 'title', h2: 'Payments' },
      { type: 'title', h3: 'bKash' },
    ]);
  });

  it('turns an FAQ into toggles', () => {
    const csv = [
      'h2,FAQ',
      'h3,Is it legit?',
      ',Yes.',
      'h3,How fast?',
      ',Minutes.',
      'h3,Is there an app?',
      ',Android only.',
    ].join('\n');
    expect(sheetToPage(csv).blocks[0]).toEqual({
      type: 'faq',
      content: [
        { type: 'title', h2: 'FAQ' },
        { type: 'toggle', title: 'Is it legit?', text: 'Yes.' },
        { type: 'toggle', title: 'How fast?', text: 'Minutes.' },
        { type: 'toggle', title: 'Is there an app?', text: 'Android only.' },
      ],
    });
  });

  it('turns a table of contents into a title and a list', () => {
    const csv = ['h2,On this page', ',🎰 Casino', ',🏏 Cricket'].join('\n');
    expect(sheetToPage(csv).blocks[0]).toEqual({
      type: 'toc',
      content: [
        { type: 'title', h2: 'On this page' },
        { type: 'list', items: ['Casino', 'Cricket'] },
      ],
    });
  });

  it('turns a heading with nothing under it into the other-pages block', () => {
    expect(sheetToPage('h2,More pages').blocks[0]).toEqual({
      type: 'links',
      content: [{ type: 'title', h2: 'More pages' }],
    });
  });
});
```

- [ ] **Step 2: Перевести тесты импорта**

В `tests/import-sheet.test.mjs`:

1. В импорте заменить `slugFor,` на `isHomeSheet,`.
2. Блок `describe('fileNameFor / slugFor', …)` заменить на:

```js
describe('fileNameFor / isHomeSheet', () => {
  it('turns a sheet name into a file name', () => {
    expect(fileNameFor('Casino')).toBe('casino');
  });

  it('recognises the usual front-page names, and only those', () => {
    for (const name of ['Home', 'home', 'Index', 'Main', 'Главная', ' Домашняя ']) {
      expect(isHomeSheet(name), name).toBe(true);
    }
    expect(isHomeSheet('Casino')).toBe(false);
    expect(isHomeSheet('Homepage')).toBe(false);
  });

  it('handles spaces, punctuation and non-latin names', () => {
    expect(fileNameFor('Live Dealer!')).toBe('live-dealer');
    expect(fileNameFor('Бонусы')).toBe('бонусы');
  });

  it('falls back rather than producing an empty name', () => {
    expect(fileNameFor('!!!')).toBe('page');
    expect(fileNameFor('')).toBe('page');
  });
});
```

3. Блок `describe('assignTargets', …)` заменить на:

```js
describe('assignTargets', () => {
  it('gives every sheet its own file, and the front page always home.json', () => {
    const { targets } = assignTargets([
      { name: 'Main', gid: '1' },
      { name: 'Casino', gid: '2' },
    ]);
    expect(targets.map((t) => t.file)).toEqual(['home.json', 'casino.json']);
    expect(targets[1]).not.toHaveProperty('slug');
  });

  it('resolves two sheets that reduce to the same file name, and says so', () => {
    // The file name is the page's address, so two sheets on one file name would lose a page.
    const { targets, notes } = assignTargets([
      { name: 'Bonus', gid: '1' },
      { name: 'bonus!', gid: '2' },
    ]);
    expect(targets.map((t) => t.file)).toEqual(['bonus.json', 'bonus-2.json']);
    expect(notes.join(' ')).toContain('bonus!');
  });

  it('keeps only the first front-page sheet at home.json', () => {
    const { targets, notes } = assignTargets([
      { name: 'Home', gid: '1' },
      { name: 'Главная', gid: '2' },
    ]);
    expect(targets.map((t) => t.file)).toEqual(['home.json', 'home-2.json']);
    expect(notes).toHaveLength(1);
  });

  it('never names a page after a service file', () => {
    const { targets, notes } = assignTargets([
      { name: 'Site', gid: '1' },
      { name: 'Images', gid: '2' },
    ]);
    expect(targets.map((t) => t.file)).toEqual(['site-2.json', 'images-2.json']);
    expect(notes.join(' ')).toContain('служебным файлом site.json');
  });

  it('does not warn when there is nothing to resolve', () => {
    const { notes } = assignTargets([
      { name: 'Home', gid: '1' },
      { name: 'App', gid: '2' },
    ]);
    expect(notes).toEqual([]);
  });

  it('handles an empty sheet list', () => {
    expect(assignTargets([])).toEqual({ targets: [], notes: [] });
  });
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `npx vitest run tests/sheet-to-json.test.mjs tests/import-sheet.test.mjs`
Expected: FAIL — `isHomeSheet` не экспортирован, заголовки пока `{ tag, text }`, у страницы есть `slug`.

- [ ] **Step 4: Конвертер (`scripts/sheet-to-json.mjs`)**

1. Два абзаца в начале файла, от `// Every \`h2\`/\`h3\` row becomes …` до строки `// Usage: …`,
   заменить на:

```js
// Every block the converter writes is { type, content: [ … ] }, and every h1/h2/h3 row becomes a
// `title` entry carrying its tag as the key — { type: 'title', h2: '…' } — in exactly the position
// it was found. Unmarked rows become `text` or `list` entries the same way, and a `table` row a
// `table` entry. classify() below then looks at a section's whole content to recognise the handful
// of shapes the reference site renders differently (an FAQ, a table of contents, an "other pages"
// grid, a closing row of cards) — see its own comment. The page itself carries no address: that is
// the name of the file it is written to (src/lib/site-dir.mjs).
//
// Usage: node scripts/sheet-to-json.mjs <input.csv> [output.json]
```

2. Заменить всё, начиная с комментария `// Only \`hero\` still collects body text …` (над функцией
   `toParagraphsAndLists`) и до конца файла, на:

```js
export function sheetToPage(csvText) {
  const rows = parseCsv(csvText).map((cells) => cells.map((c) => c.trim()));
  const page = { title: '', description: '', blocks: [] };

  let current = null;
  let body = [];
  let table = null;

  // Body rows go into the open block's content in the order they were found — the hero's and a
  // section's alike, since every block is a content list now.
  const flushBody = () => {
    if (!current || body.length === 0) return;
    for (const part of splitBody(body)) {
      current.content.push(
        part.type === 'text'
          ? { type: 'text', text: part.text }
          : { type: 'list', items: part.items },
      );
    }
    body = [];
  };

  const flushSection = () => {
    flushBody();
    if (current) page.blocks.push(current);
    current = null;
    table = null;
  };

  // An h3/table marker needs a `section` to land in. The hero is the first screen, not a place for
  // subheadings and tables, so it is closed first and a fresh, possibly heading-less section is
  // opened — the same thing a stray h3 before the first h2 falls back to.
  const ensureSection = () => {
    if (current?.type === 'section') return;
    if (current) page.blocks.push(current);
    current = { type: 'section', content: [] };
  };

  for (const cells of rows) {
    const marker = cells[0] || '';
    const rest = cells.slice(1).filter((c) => c !== '');

    if (marker === '' && rest.length === 0) {
      flushSection();
      continue;
    }

    switch (marker) {
      case 'title':
        page.title = stripEmoji(rest[0] || '');
        break;
      case 'description':
        page.description = stripEmoji(rest[0] || '');
        break;
      case 'h1':
        flushSection();
        current = { type: 'hero', content: [{ type: 'title', h1: stripEmoji(rest[0] || '') }] };
        break;
      case 'h2':
        flushSection();
        current = { type: 'section', content: [{ type: 'title', h2: stripEmoji(rest[0] || '') }] };
        break;
      case 'h3':
        flushBody();
        ensureSection();
        current.content.push({ type: 'title', h3: stripEmoji(rest[0] || '') });
        break;
      case 'table':
        flushBody();
        ensureSection();
        table = { type: 'table', columns: rest.map(stripEmoji), rows: [] };
        current.content.push(table);
        break;
      default:
        if (table && rest.length > 1) {
          table.rows.push(rest.map(stripEmoji));
        } else {
          table = null;
          if (rest[0]) body.push(rest[0]);
        }
    }
  }
  flushSection();

  return classify(page);
}

const isTitle = (entry, tag) => entry.type === 'title' && typeof entry[tag] === 'string';

// Regroups a section's flat content back into "everything before the first h3" (`head` — the h2
// title plus whatever sits directly under it) and one group per h3 (that title plus everything up
// to the next one), which is the shape the pattern-recognition below reasons about.
function splitSubsections(content) {
  const head = [];
  const subs = [];
  for (const entry of content) {
    if (isTitle(entry, 'h3')) {
      subs.push({ heading: entry.h3, items: [] });
    } else if (subs.length > 0) {
      subs[subs.length - 1].items.push(entry);
    } else {
      head.push(entry);
    }
  }
  return { head, subs };
}

// The last two or three h3 subsections of a section are usually parallel sub-points rather than
// more prose — the reference site sets them side by side as framed cards. A trailing run of h3s
// carrying nothing but text is exactly that shape. The result is an ordinary `cards` element the
// JSON spells out in full, so it can be reordered, edited or split back into headings by hand.
//
// Two is the minimum: a single card is not a set, it is a subheading.
function groupTrailingCards(content) {
  const { head, subs } = splitSubsections(content);
  const isCard = (sub) => sub.items.length > 0 && sub.items.every((item) => item.type === 'text');

  let start = subs.length;
  while (start > 0 && isCard(subs[start - 1])) start -= 1;
  if (subs.length - start < 2) return content;

  const kept = subs
    .slice(0, start)
    .flatMap((sub) => [{ type: 'title', h3: sub.heading }, ...sub.items]);
  const cards = subs.slice(start).map((sub) => {
    const text = sub.items.map((item) => item.text);
    // One sentence stays a string; several stay separate paragraphs.
    return { title: sub.heading, text: text.length === 1 ? text[0] : text };
  });

  return [...head, ...kept, { type: 'cards', items: cards }];
}

// The spreadsheet has no notion of block types — every section is just an h2, optionally followed
// by h3s. These are the shapes the reference site renders differently, recognised here once so the
// template does not have to pattern-match on headings:
//   - 3+ h3 subsections, every one of them a question, and no list or table anywhere in the
//     section -> `faq`: the h2 title, then one `toggle` per question.
//   - nothing but a single run of list items under the h2 -> `toc`: the title and that list.
//   - nothing at all under the h2 -> `links`, the reference site's "other pages" grid (its links
//     come from the site's nav, not the spreadsheet — see templates/review/blocks/links.astro).
// Anything else stays an ordinary `section`, its trailing run of text-only h3s folded into cards.
//
// Exported so the same rules can be applied to page files converted before a shape was
// recognised. It only rewrites `section` blocks, so running it twice changes nothing the second time.
export function classify(page) {
  page.blocks = page.blocks.map((block) => {
    if (block.type !== 'section') return block;

    const content = Array.isArray(block.content) ? block.content : [];
    const h2 = content.find((entry) => isTitle(entry, 'h2'));
    const title = h2 ? [{ type: 'title', h2: h2.h2 }] : [];
    const { head, subs } = splitSubsections(content);
    const headBody = head.filter((entry) => entry !== h2);
    const hasTable = content.some((entry) => entry.type === 'table');
    const hasTopLevelList = headBody.some((entry) => entry.type === 'list');

    const isFaq =
      subs.length >= 3 && subs.every((s) => s.heading.includes('?')) && !hasTopLevelList && !hasTable;
    if (isFaq) {
      return {
        type: 'faq',
        content: [
          ...title,
          ...subs.map((s) => ({
            type: 'toggle',
            title: s.heading,
            text: s.items
              .filter((entry) => entry.type === 'text')
              .map((entry) => entry.text)
              .join(' '),
          })),
        ],
      };
    }

    const isToc =
      !hasTable && subs.length === 0 && headBody.length > 0 && headBody.every((e) => e.type === 'list');
    if (isToc) {
      return {
        type: 'toc',
        content: [...title, { type: 'list', items: headBody.flatMap((entry) => entry.items) }],
      };
    }

    // A section with a heading and nothing else is the reference site's "other pages" grid: the
    // spreadsheet holds only its title because the links come from the site's own page list.
    if (!hasTable && subs.length === 0 && headBody.length === 0) {
      return { type: 'links', content: title };
    }

    return { ...block, content: groupTrailingCards(content) };
  });
  return page;
}

// Guarded so importing this module (import-sheet.mjs does) cannot run the CLI path against the
// importer's own arguments.
const runDirectly = process.argv[1] && process.argv[1].endsWith('sheet-to-json.mjs');
const [input, output] = process.argv.slice(2);
if (runDirectly && input) {
  const page = sheetToPage(readFileSync(input, 'utf8'));
  const json = `${JSON.stringify(page, null, 2)}\n`;
  if (output) {
    writeFileSync(output, json);
    console.log(`${output}: ${page.blocks.length} блоков`);
  } else {
    process.stdout.write(json);
  }
}
```

- [ ] **Step 5: Импорт (`scripts/import-sheet.mjs`)**

1. Первый абзац шапки файла (от `// The spreadsheet holds one sheet per page.` до строки перед
   `// Usage:`) заменить на:

```js
// The spreadsheet holds one sheet per page. Doing this by hand means looking up each sheet's
// numeric id, downloading it, running the converter and inventing a file name — eight times per
// site, every time. The file name is not a detail: it is the page's address (src/lib/site-dir.mjs),
// so two sheets landing on one file name would silently lose a page.
```

2. После строки `import { join } from 'node:path';` добавить
   `import { SERVICE_FILE_NAMES, slugFromFileName } from '../src/lib/site-dir.mjs';`

3. Заменить функции `slugFor` и `assignTargets` вместе с комментарием над `assignTargets` на:

```js
export function isHomeSheet(sheetName) {
  return HOME_SHEET_NAMES.has(String(sheetName ?? '').trim().toLowerCase());
}

// Every sheet becomes one file, and the file name is the page's address. The front-page sheet is
// always home.json, whatever it is called; every other sheet is named after itself. A name already
// taken — by an earlier sheet ("Bonus" and "bonus!") or by one of the folder's service files (a
// sheet called "Site" or "Images") — gets a numbered name here, loudly, instead of overwriting what
// is already there.
export function assignTargets(sheets) {
  const taken = new Set(SERVICE_FILE_NAMES);
  const notes = [];

  return {
    targets: sheets.map((sheet) => {
      const base = isHomeSheet(sheet.name) ? 'home' : fileNameFor(sheet.name);
      let file = `${base}.json`;
      if (taken.has(file)) {
        let n = 2;
        while (taken.has(`${base}-${n}.json`)) n += 1;
        const renamed = `${base}-${n}.json`;
        notes.push(
          SERVICE_FILE_NAMES.includes(file)
            ? `Лист «${sheet.name}» совпадает со служебным файлом ${file} — использован «${renamed}»`
            : `Лист «${sheet.name}» даёт то же имя файла, что и предыдущий — использован «${renamed}»`,
        );
        file = renamed;
      }
      taken.add(file);
      return { ...sheet, file };
    }),
    notes,
  };
}
```

4. В `main()` заменить

```js
    const page = sheetToPage(csv, target.slug);
    writeFileSync(join(dir, target.file), `${JSON.stringify(page, null, 2)}\n`);
    console.log(`  ${target.file.padEnd(18)} ${target.slug.padEnd(12)} ${page.blocks.length} блоков`);
```

на

```js
    const page = sheetToPage(csv);
    writeFileSync(join(dir, target.file), `${JSON.stringify(page, null, 2)}\n`);
    const route = slugFromFileName(target.file);
    console.log(`  ${target.file.padEnd(18)} ${route.padEnd(12)} ${page.blocks.length} блоков`);
```

   и построение меню

```js
    const nav = targets
      .filter((target) => target.slug !== '/')
      .map((target) => ({ label: target.name, href: target.slug }));
```

   на

```js
    const nav = targets
      .map((target) => ({ label: target.name, href: slugFromFileName(target.file) }))
      .filter((item) => item.href !== '/');
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `npx vitest run tests/sheet-to-json.test.mjs tests/import-sheet.test.mjs`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add scripts/ tests/sheet-to-json.test.mjs tests/import-sheet.test.mjs
git commit -m "$(cat <<'EOF'
Конвертер и импорт пишут новый формат

Без slug, заголовки ключом-тегом, FAQ — элементами toggle. Главная всегда
home.json, лист не может занять имя служебного файла.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Задача 7: Документация

Формат описан в трёх местах: `docs/content-format.md` (для того, кто пишет JSON), `docs/content-template.json`
(скелет страницы) и `docs/spreadsheet-format.md` (для заказчика). Таблица заказчика не изменилась, но
одна фраза в его документе стала неправдой: название листа теперь попадает на сайт — это адрес страницы.

**Files:**
- Modify: `docs/content-format.md` (переписать целиком), `docs/content-template.json` (переписать целиком)
- Modify: `docs/spreadsheet-format.md`, `README.md`

- [ ] **Step 1: Переписать `docs/content-format.md`**

Заменить содержимое файла целиком:

````markdown
# Формат контента для сайта

Документ для того, кто пишет или правит JSON сайта руками. Заказчик заполняет таблицу
(`docs/spreadsheet-format.md`), и JSON получается из неё командой `npm run import:sheet`.

## Что сдаётся

Папка с названием сайта: по одному JSON-файлу на страницу и два служебных файла — оба необязательные.

```
moysite.com/
├── site.json          общие настройки сайта
├── images.json        картинки: имя → файл и описание
├── home.json          главная, адрес /
├── casino.json        адрес /casino
└── public/
    └── images/        файлы картинок
        └── main.webp
```

**Адрес страницы — это имя её файла.** `casino.json` открывается по `/casino`, `home.json` — главная
(регистр не важен: `Home.json` — тоже главная). Имя попадает в адрес как есть, поэтому его лучше писать
латиницей в нижнем регистре через дефис: `live-dealer.json` → `/live-dealer`. Страницы читаются только
из самой папки: вложенные папки, в том числе `public/`, страницами не считаются.

## site.json — общие настройки сайта

Один раз на весь сайт: домен, бренд, меню шапки, футер.

```jsonc
{
  "domain": "moysite.com",
  "locale": "id-ID",
  "brand": {
    "name": "Название бренда",
    "logo": "main",
    "tagline": "Короткий слоган для футера"
  },
  "nav": [
    { "label": "Пункт меню", "href": "/casino" }
  ],
  "footer": {
    "ageWarning": "18+",
    "ageText": "Текст возрастного предупреждения.",
    "quickLinksTitle": "БЫСТРЫЕ ССЫЛКИ",
    "paymentsTitle": "СПОСОБЫ ОПЛАТЫ",
    "payments": ["bKash", "Nagad"],
    "copyright": "© Название. Все права защищены 2026."
  }
}
```

| Поле | Что это |
|---|---|
| `domain` | Адрес сайта без `https://` |
| `locale` | Язык и страна: `id-ID`, `en-US`, `ar-AE`. Отсюда берётся направление письма — арабский и иврит разворачиваются справа налево автоматически |
| `brand.name` | Название бренда. Появляется в шапке, футере, плашке первого экрана и в заголовке вкладки |
| `brand.logo` | Имя картинки из `images.json`. Можно не указывать — тогда в шапке название бренда текстом |
| `brand.tagline` | Короткий слоган под названием бренда в футере |
| `nav` | Пункты меню в шапке; тот же список используют блок `links` и колонка «быстрые ссылки» в футере |
| `footer` | Возрастное предупреждение, способы оплаты, копирайт |

Бренд, домен, язык, гео и партнёрскую ссылку перекрывает форма фабрики при сборке. Меню и футер не
обязательны: если их нет, шапка и футер просто не выводятся.

## images.json — картинки

Все картинки сайта описаны в одном файле, а страницы ссылаются на них по имени.

```json
{
  "main": { "src": "/images/main.webp", "alt": "Логотип на тёмном фоне" },
  "bpl": { "src": "/images/bpl.webp", "alt": "Табло матча BPL", "width": 800, "height": 450 }
}
```

| Поле | Что это |
|---|---|
| ключ | Имя, по которому картинку вызывают со страниц и из `brand.logo`. Регистр важен |
| `src` | Путь от корня сайта: файл `public/images/main.webp` пишется как `/images/main.webp`. Можно указать адрес `https://…` |
| `alt` | Описание картинки для поисковика и экранного диктора. Без него картинка выводится, но в логе будет предупреждение |
| `width`, `height` | Необязательно. Размер в пикселях — пока картинка грузится, страница не прыгает |

Любые другие поля ничему не мешают: их можно использовать для заметок или для данных генератора картинок.

## Файл страницы

```jsonc
{
  "title": "Заголовок страницы для поисковика",
  "description": "Описание страницы для поисковика",
  "blocks": [ /* блоки страницы по порядку */ ]
}
```

| Поле | Что это |
|---|---|
| `title` | Заголовок в результатах поиска |
| `description` | Описание в результатах поиска |
| `blocks` | Блоки страницы. Порядок в списке — порядок на странице |

## Блоки

Любой блок устроен одинаково: `type` говорит, что это за секция, `content` — из чего она состоит,
по порядку.

```json
{ "type": "section", "content": [ { "type": "title", "h2": "Заголовок" }, { "type": "text", "text": "Абзац." } ] }
```

| Тип | Как выглядит |
|---|---|
| `hero` | Первый экран: название бренда плашкой, крупный `h1` с градиентом. Картинки в нём грузятся сразу |
| `section` | Обычная секция |
| `toc` | Оглавление: первый список в `content` становится сеткой ссылок на разделы ниже |
| `links` | «Другие страницы»: после `content` выводится сетка ссылок на страницы из меню `site.json` |
| `faq` | Вопросы и ответы: обычно заголовок и несколько `toggle` |

Блок неизвестного типа (например, `"type": "promo"`) не пропадает — он выводится как обычная `section`,
а в логе появляется предупреждение.

## Элементы content

| Элемент | Как пишется |
|---|---|
| Заголовок | `{ "type": "title", "h2": "Текст" }` |
| Абзац | `{ "type": "text", "text": "…" }` |
| Список | `{ "type": "list", "items": ["…", "…"] }` |
| Таблица | `{ "type": "table", "columns": ["…"], "rows": [["…"]] }` |
| Карточки | `{ "type": "cards", "items": [{ "title": "…", "text": "…", "image": "bpl" }] }` |
| Раскрывашка | `{ "type": "toggle", "title": "Вопрос?", "text": "Ответ." }` |
| Картинка | `{ "image": "main" }` |

### Заголовок

Ключ и есть тег: `{ "type": "title", "h3": "Подзаголовок" }` — это `h3`. Доступны `h1`–`h6`.

На странице бывает только один `h1` — обычно в `hero`. Второй выводится как `h2` с предупреждением в
логе; страница вовсе без `h1` тоже даёт предупреждение: для поисковика это потеря.

### Карточки

Набор карточек в рамках, рядом друг с другом. У карточки `title`, `text` и необязательная `image` — имя из
`images.json`. В `text` можно передать список строк: они станут отдельными абзацами. Заголовок карточки
остаётся настоящим заголовком `h3`.

### Раскрывашка

Вопрос, который открывается по клику и показывает ответ, — без JavaScript. Работает в любом блоке, не только
в `faq`.

### Картинка

`{ "image": "main" }` выводит картинку `main` из `images.json` там, где стоит элемент. Запись
`{ "type": "image", "image": "main" }` значит то же самое.

### Ссылки внутри текста

В любом тексте — абзаце, пункте списка, ячейке таблицы, тексте карточки или раскрывашки — ссылка пишется так:

```json
{ "type": "text", "text": "Открыть [весь каталог казино](/casino) можно без депозита." }
```

В квадратных скобках — то, что видит читатель, в круглых — куда ведёт ссылка. Адрес может быть
внутренним (`/casino`), якорем на этой же странице (`#bonus`), внешним (`https://…`), почтой или телефоном.
Всё остальное ссылкой не станет: слова в скобках останутся на месте. Если скобки не сложились в ссылку,
они так и останутся на странице символами — сборка от этого не падает.

## Оглавление

Пункты первого списка в `toc` связываются с разделами по порядку: первый пункт ведёт на первый раздел после
оглавления, второй — на второй. Слова пунктов не обязаны совпадать с заголовками разделов, но пунктов
должно быть столько же, сколько разделов, и в том же порядке.

## Рекомендуемые объёмы

Формально не проверяются. Но за этими границами вёрстка начинает выглядеть плохо.

| Что | Сколько |
|---|---|
| `title` | до 60 знаков |
| `description` | 120–160 знаков |
| `h1` | до 60 знаков, одна строка |
| Абзац | 200–400 знаков |
| Пунктов в оглавлении | 4–10, по числу разделов страницы |
| Пунктов в списке | 3–8 |
| Строк в таблице | до 10 |
| Карточек в наборе | 2–4 |
| Вопросов в FAQ | 4–8 |
| Блоков на странице | 5–12 для лонгрида вроде `data/sites/899ok` |

## Что происходит с ошибками

Файл принимается целиком и никогда не отклоняется — сайт соберётся в любом случае. Всё, что не удалось
вывести, перечисляется в логе сборки: если на сайте чего-то не хватает, причина там.

- страница, которая не является объектом, — **пропускается**;
- блок без `type` или блок, который не является объектом, — **пропускается**;
- блок неизвестного типа — **выводится как обычная секция**;
- у блока есть поля кроме `type` и `content` (блок, написанный по-старому) — поля не используются, в
  логе их имена;
- `content` не список — блок пуст;
- элемент неизвестного типа — **пропускается** с предупреждением; элемент без `type` — молча;
- заголовок без ключа `h1`–`h6` или пустой — **пропускается**; если ключей несколько, берётся первый;
- второй `h1` на странице — **выводится как `h2`**; страница без `h1` — предупреждение;
- картинка, которой нет в `images.json`, у которой нет `src`, чей файл не лежит в `public/` или чей
  `src` недопустим (`data:`, `javascript:`) — **не выводится**; картинка без `alt` выводится, но с
  предупреждением;
- `list.items` одной строкой — становится списком из одного пункта;
- блок, от которого ничего не осталось, — **не выводится вообще**;
- отсутствующий `title` страницы — заменяется названием бренда;
- оставшееся в файле поле `slug` — не используется: адрес берётся из имени файла;
- нет `home.json` — у сайта не будет главной страницы;
- имя файла, которое не может быть адресом (например, `sitemap.xml.json`), — страница получает адрес
  вида `/page-3`, но не пропадает;
- `nav` не в виде списка — меню не выводится.

Сборка падает только в двух случаях: какой-то JSON-файл папки нельзя прочитать или он не является
валидным JSON (это касается и `site.json`, и `images.json`), либо в папке нет ни одной страницы. Оба
случая — ошибка оператора (не туда указали путь или положили битый файл), а не контента.

Пример папки, нарочно собранной из одних ошибок, — `data/sites/broken/`: запустите
`SITE_DIR=data/sites/broken npm run build:site` и посмотрите на её лог.

## Минимальный рабочий сайт

```
mysite/
├── site.json
└── home.json
```

`site.json`:

```json
{ "domain": "example.com", "locale": "en-US", "brand": { "name": "Example" } }
```

`home.json`:

```json
{
  "title": "Example",
  "description": "Short description.",
  "blocks": [{ "type": "hero", "content": [{ "type": "title", "h1": "Заголовок" }] }]
}
```

Скелет страницы со всеми блоками и элементами — `docs/content-template.json`. Полный пример на восемь
страниц — `data/sites/899ok/`.
````

- [ ] **Step 2: Переписать `docs/content-template.json`**

Заменить содержимое файла целиком:

```json
{
  "title": "Заголовок страницы для поисковика, до 60 знаков",
  "description": "Описание страницы для поисковика, 120-160 знаков.",
  "blocks": [
    {
      "type": "hero",
      "content": [
        { "type": "title", "h1": "Главный заголовок, до 60 знаков" },
        { "type": "text", "text": "Один-два абзаца, поясняющих заголовок." }
      ]
    },
    {
      "type": "toc",
      "content": [
        { "type": "title", "h2": "Содержание" },
        { "type": "list", "items": ["Название раздела 1", "Название раздела 2"] }
      ]
    },
    {
      "type": "section",
      "content": [
        { "type": "title", "h2": "Название раздела 1" },
        { "type": "text", "text": "Первый абзац, 200-400 знаков. Можно со [ссылкой](/casino)." },
        { "image": "имя-картинки-из-images-json" },
        { "type": "list", "items": ["Пункт списка", "Пункт списка", "Пункт списка"] }
      ]
    },
    {
      "type": "section",
      "content": [
        { "type": "title", "h2": "Название раздела 2" },
        { "type": "text", "text": "Текст раздела перед таблицей." },
        {
          "type": "table",
          "columns": ["Колонка 1", "Колонка 2"],
          "rows": [
            ["Значение", "Значение"],
            ["Значение", "Значение"]
          ]
        },
        {
          "type": "cards",
          "items": [
            { "title": "Карточка 1", "text": "Одно-два предложения." },
            { "title": "Карточка 2", "text": "Одно-два предложения." }
          ]
        }
      ]
    },
    {
      "type": "links",
      "content": [{ "type": "title", "h2": "Другие страницы" }]
    },
    {
      "type": "faq",
      "content": [
        { "type": "title", "h2": "Частые вопросы" },
        { "type": "toggle", "title": "Вопрос?", "text": "Ответ." },
        { "type": "toggle", "title": "Вопрос?", "text": "Ответ." },
        { "type": "toggle", "title": "Вопрос?", "text": "Ответ." }
      ]
    }
  ]
}
```

- [ ] **Step 3: Документ для заказчика (`docs/spreadsheet-format.md`)**

1. Абзац

```
**Один лист — одна страница сайта.** Название листа — это название страницы
(`Home`, `Casino`, `Bonus`); оно нужно только людям, на сайт не попадает.
```

заменить на

```
**Один лист — одна страница сайта.** Название листа становится адресом страницы:
лист `Casino` — это `/casino`, лист `Live Dealer` — `/live-dealer`. Лист главной
страницы называйте `Home`. Название листа попадает и в меню сайта, так что пишите
его так, как пункт должен выглядеть в меню.
```

2. В разделе «Чего в таблице пока нет» строку

```
- **Картинок.** Передаются отдельно файлами.
```

заменить на

```
- **Картинок.** Файлы картинок передаются отдельно; на страницы они расставляются
  уже после импорта таблицы.
```

- [ ] **Step 4: Раздел «Контент» в `README.md`**

Заменить два абзаца раздела `### Контент` (от `Сайт — это папка` до `только от нечитаемого/не-JSON
файла или от папки вовсе без страниц.`) на:

```
Сайт — это папка `data/sites/<сайт>/`: по одному JSON-файлу на страницу (адрес страницы —
имя файла, `home.json` — главная) и два необязательных служебных файла: `site.json` с общими
настройками (домен, бренд, меню, футер) и `images.json` со списком картинок. Файлы картинок —
в `data/sites/<сайт>/public/`. Подробности формата — в `docs/content-format.md`.

Валидации нет: недостающие поля получают значения по умолчанию, а всё, что не удалось вывести,
перечисляется предупреждением в логе. Сборка не падает из-за контента — падает только от
нечитаемого/не-JSON файла или от папки вовсе без страниц.
```

- [ ] **Step 5: Проверить, что старого формата в документации не осталось**

Run: `grep -nE '"(slug|heading|paragraphs|tag)"|"q":' docs/content-format.md docs/content-template.json docs/spreadsheet-format.md README.md`
Expected: пусто. (Слово `slug` без кавычек в `content-format.md` остаётся — в пункте об игнорируемом поле.)

- [ ] **Step 6: Коммит**

```bash
git add docs/content-format.md docs/content-template.json docs/spreadsheet-format.md README.md
git commit -m "$(cat <<'EOF'
Документация под формат контента v2

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## После всех задач

- [ ] `npm test` — зелёный.
- [ ] `npm run check:matrix` — все комбинации шаблон × схема собираются.
- [ ] Собрать 899ok через фабрику (`npm run dev`, форма, «Сгенерировать») и пройти глазами главную и
  `/casino`: заголовки, оглавление, карточки, таблицы, FAQ — как до переделки.
