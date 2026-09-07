# Ядро рендера (этап 1) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** превратить один валидный `site.json` в готовую папку статического сайта с уникальным, но детерминированным внешним видом.

**Architecture:** три независимых слоя. `src/schema` — Zod-контракт контента и валидатор с человекочитаемыми ошибками. `src/theme` — чистые функции, превращающие имя домена в тему (палитра, шрифты, варианты секций, порядок блоков). `src/` Astro-проект — блоки на Vue, рендерящиеся в HTML без единого килобайта JS. Единственный вход в систему — переменная окружения `SITE_JSON` с путём к файлу конфига; сети, базы и внешних сервисов на этом этапе нет.

**Tech Stack:** Astro 6.3, @astrojs/vue, Vue 3, TypeScript (strict), Zod v4, Vitest, pnpm.

## Global Constraints

- Node.js ≥ 22.12.0 (требование Astro 6.3; чётные версии, v23 не поддерживается). Локально установлен v22.14.0.
- Пакетный менеджер — pnpm (локально 10.32.1).
- Zod импортируется как `import * as z from "zod"` (стиль v4).
- TypeScript в режиме `strict`.
- **Ноль клиентского JS:** ни один компонент не получает директиву `client:*`. Vue используется только как язык описания компонентов, рендер происходит на этапе сборки.
- **Рендер — чистая функция.** Код в `src/` не обращается к сети, БД, хостингам и не читает ничего, кроме файла из `SITE_JSON`.
- **Детерминированность.** Любая вариативность берётся только из `makeRng(hashDomain(domain))`. Прямой вызов `Math.random()` в `src/` запрещён.
- **Шрифты только системные.** Внешние шрифтовые сервисы не подключаются: это лишний внешний запрос, замедление и риск для локалей с нелатинскими алфавитами.
- **Git не используется** (решение пользователя от 2026-09-01), поэтому вместо коммита каждая задача завершается полным прогоном `pnpm test`. Риск: нет истории и точек отката — если решение изменится, шаг «прогнать тесты» дополняется коммитом.
- Код и комментарии — на английском; любые пользовательские тексты приходят только из конфига.
- Рабочая директория: `/Users/maksvatrenko/site-factory`.

## Отклонения от спека (осознанные)

1. **Блок `richtext` хранит `paragraphs: string[]`, а не `html`.** Сырой HTML от генератора пришлось бы либо санитайзить, либо доверять ему; массив абзацев снимает вопрос целиком и проще для генерации. Спек нужно обновить.
2. **OG-изображение и favicon вынесены из этапа 1.** Оба требуют обработки картинок (sharp/satori), которая появляется на этапе 2 вместе с медиа-пайплайном. Остальная SEO-обвязка (meta, canonical, hreflang, JSON-LD, sitemap, robots) делается здесь.
3. **Две оси уникализации из спека перенесены на этап 2:** выключение необязательных блоков зависит от флагов в `global.json`, которого на этом этапе ещё нет, а вариативные хеши CSS-классов требуют постобработки готовой сборки. Реализованные здесь оси (палитра, шрифты, радиусы, плотность, варианты секций, порядок блоков) дают достаточное различие — это проверяется тестом.
4. **Критерий «десять разных JSON» проверяется в два приёма:** различимость тем — юнит-тестом на 50 доменах, полная сборка — на трёх примерах с разными локалями (включая RTL). Гонять десять сборок в тестах дорого и ничего дополнительно не доказывает.

## File Structure

```
package.json                  скрипты: test, build, dev
tsconfig.json                 strict
vitest.config.ts              tests/**/*.test.ts, таймаут 120с для сборочных тестов
astro.config.mjs              vue(), site из SITE_JSON, outDir из OUT_DIR

src/schema/blocks.ts          Zod-схемы пяти блоков + дискриминированное объединение
src/schema/site.ts            SiteSchema, validateSite(), formatPath()
src/schema/index.ts           реэкспорт схем и выведенных типов

src/theme/rng.ts              hashDomain(), makeRng(), pick(), intBetween(), shuffle()
src/theme/color.ts            Hsl, hslToRgb(), relativeLuminance(), contrastRatio(), ensureContrast(), hslCss()
src/theme/palette.ts          Palette, buildPalette()
src/theme/fonts.ts            FONT_STACKS, pickFontStack()
src/theme/variants.ts         Variants, pickVariants(), arrangeBlocks()
src/theme/index.ts            Theme, buildTheme()

src/config/load.ts            loadSiteConfig() — читает SITE_JSON, валидирует, кэширует

src/layouts/Base.astro        html/head, meta, canonical, hreflang, JSON-LD, CSS-переменные темы
src/components/BlockRenderer.astro   реестр блоков, выбор компонента по type
src/components/blocks/Hero.vue       3 варианта раскладки
src/components/blocks/RichText.vue   1 вариант
src/components/blocks/Cards.vue      2 варианта
src/components/blocks/Columns.vue    2 варианта
src/components/blocks/Faq.vue        2 варианта
src/components/blocks/Footer.vue     футер с дисклеймером
src/pages/[...slug].astro     getStaticPaths из pages[], сборка страницы
src/pages/sitemap.xml.ts      статический эндпоинт
src/pages/robots.txt.ts       статический эндпоинт
src/styles/base.css           сброс и базовая типографика на CSS-переменных

examples/4p4p.net.json        id-ID, одна страница (референс)
examples/example-guide.com.json   en-US, две страницы
examples/dalil-ar.net.json    ar-AE, RTL

tests/helpers/build.ts        buildSite(), readOutput()
tests/schema.test.ts
tests/rng.test.ts
tests/color.test.ts
tests/theme.test.ts
tests/render.test.ts          сборочные тесты блоков
tests/seo.test.ts             sitemap, robots, meta, JSON-LD
```

---

### Task 1: Каркас проекта

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `astro.config.mjs`, `src/env.d.ts`, `.gitignore`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: рабочие команды `pnpm test` и `pnpm typecheck`; установленные Astro 6, @astrojs/vue, Vue 3, Zod 4, Vitest, TypeScript. Команда `pnpm build` заработает в задаче 6, когда появятся `src/pages` и загрузчик конфига.

- [ ] **Step 1: Создать package.json**

```json
{
  "name": "site-factory",
  "type": "module",
  "private": true,
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Установить зависимости**

```bash
pnpm add astro @astrojs/vue vue zod
```

```bash
pnpm add -D typescript vitest @types/node
```

Ожидаемо: в `package.json` появились секции `dependencies` и `devDependencies`, создана папка `node_modules`.

- [ ] **Step 3: Проверить установленные версии**

Run: `pnpm list astro zod vue --depth 0`
Ожидаемо: `astro 6.x`, `zod 4.x`, `vue 3.x`. Если astro оказался ниже 6 — установить явно: `pnpm add astro@^6`.

- [ ] **Step 4: Создать tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "allowJs": true,
    "jsx": "preserve",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*", "tests/**/*", "*.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 5: Создать astro.config.mjs**

```js
import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';

export default defineConfig({
  integrations: [vue()],
  devToolbar: { enabled: false },
});
```

- [ ] **Step 6: Создать src/env.d.ts**

```ts
/// <reference types="astro/client" />
```

- [ ] **Step 7: Создать .gitignore**

```
node_modules/
dist/
.astro/
.DS_Store
```

- [ ] **Step 8: Создать vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
```

- [ ] **Step 9: Написать smoke-тест**

```ts
// tests/smoke.test.ts
import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  it('runs typescript tests', () => {
    const value: number = 2 + 2;
    expect(value).toBe(4);
  });
});
```

- [ ] **Step 10: Прогнать тест**

Run: `pnpm test`
Ожидаемо: PASS, 1 тест.

- [ ] **Step 11: Проверить типы**

Run: `pnpm typecheck`
Ожидаемо: завершается без ошибок.

---

### Task 2: Схема контента и валидатор

**Files:**
- Create: `src/schema/blocks.ts`, `src/schema/site.ts`, `src/schema/index.ts`
- Test: `tests/schema.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces:
  - `SiteSchema` (Zod), тип `Site = z.infer<typeof SiteSchema>`
  - `PageSchema`, тип `Page`
  - `BlockSchema` (дискриминированное объединение), тип `Block`
  - `validateSite(input: unknown): { ok: true; data: Site } | { ok: false; errors: string[] }`
  - Тип каждого блока по полю `type`: `"hero" | "richtext" | "cards" | "columns" | "faq"`

- [ ] **Step 1: Написать падающий тест схемы**

```ts
// tests/schema.test.ts
import { describe, expect, it } from 'vitest';
import { validateSite } from '../src/schema';

const validSite = {
  external_id: 'demo-1',
  domain: 'example.com',
  locale: 'en-US',
  brand: { name: 'Example' },
  nav: [{ label: 'Home', href: '/' }],
  footer: { disclaimer: 'This material is provided for informational purposes only and is not advice.' },
  pages: [
    {
      slug: '/',
      meta: {
        title: 'Example Guide 2026: Mobile Access and Safety',
        description:
          'A practical guide to the Example platform: mobile access, promotions, wallet pages and the safety checks worth doing first.',
      },
      blocks: [
        { type: 'hero', props: { title: 'Example homepage guide for readers', subtitle: 'What to verify before you use any platform, explained simply.' } },
        {
          type: 'faq',
          props: {
            items: [
              { q: 'What is the Example platform?', a: 'It is an online brand that users research before deciding whether to interact with it at all.' },
              { q: 'Is it available on mobile?', a: 'Mobile access is the most common entry point, so the pages should load quickly on phones.' },
              { q: 'How are bonuses structured?', a: 'Promotions vary, and the full terms matter more than the headline number shown on the banner.' },
              { q: 'Where should I check the rules?', a: 'Always read the terms and privacy pages before creating an account anywhere online.' },
            ],
          },
        },
      ],
    },
  ],
};

describe('validateSite', () => {
  it('accepts a valid site', () => {
    const result = validateSite(validSite);
    expect(result.ok).toBe(true);
  });

  it('reports the exact path of a missing field', () => {
    const broken = structuredClone(validSite);
    // @ts-expect-error intentionally breaking the fixture
    delete broken.pages[0].blocks[1].props.items[2].a;

    const result = validateSite(broken);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.join('\n')).toContain('pages[0].blocks[1].props.items[2].a');
  });

  it('rejects an unknown block type', () => {
    const broken = structuredClone(validSite);
    // @ts-expect-error intentionally breaking the fixture
    broken.pages[0].blocks[0].type = 'carousel';

    const result = validateSite(broken);
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate page slugs', () => {
    const broken = structuredClone(validSite);
    broken.pages.push(structuredClone(validSite.pages[0]));

    const result = validateSite(broken);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.join('\n')).toContain('duplicate slug');
  });

  it('rejects a title longer than the limit', () => {
    const broken = structuredClone(validSite);
    broken.pages[0].meta.title = 'x'.repeat(80);

    const result = validateSite(broken);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `pnpm vitest run tests/schema.test.ts`
Ожидаемо: FAIL с сообщением о том, что модуль `../src/schema` не найден.

- [ ] **Step 3: Написать схемы блоков**

```ts
// src/schema/blocks.ts
import * as z from 'zod';

const absoluteUrl = z
  .string()
  .regex(/^https?:\/\/\S+$/, 'must be an absolute http(s) URL');

export const HeroBlockSchema = z.object({
  type: z.literal('hero'),
  props: z.object({
    title: z.string().min(10).max(70),
    subtitle: z.string().min(20).max(200),
    image: absoluteUrl.optional(),
  }),
});

export const RichTextBlockSchema = z.object({
  type: z.literal('richtext'),
  props: z.object({
    heading: z.string().min(5).max(90).optional(),
    paragraphs: z.array(z.string().min(40).max(900)).min(1).max(8),
  }),
});

export const CardsBlockSchema = z.object({
  type: z.literal('cards'),
  props: z.object({
    heading: z.string().min(5).max(90).optional(),
    items: z
      .array(
        z.object({
          title: z.string().min(3).max(70),
          text: z.string().min(20).max(320),
        }),
      )
      .min(3)
      .max(8),
  }),
});

export const ColumnsBlockSchema = z.object({
  type: z.literal('columns'),
  props: z.object({
    heading: z.string().min(5).max(90).optional(),
    items: z
      .array(
        z.object({
          title: z.string().min(3).max(50),
          text: z.string().min(20).max(200),
        }),
      )
      .min(2)
      .max(6),
  }),
});

export const FaqBlockSchema = z.object({
  type: z.literal('faq'),
  props: z.object({
    heading: z.string().min(5).max(90).optional(),
    items: z
      .array(
        z.object({
          q: z.string().min(10).max(160),
          a: z.string().min(30).max(700),
        }),
      )
      .min(4)
      .max(10),
  }),
});

export const BlockSchema = z.discriminatedUnion('type', [
  HeroBlockSchema,
  RichTextBlockSchema,
  CardsBlockSchema,
  ColumnsBlockSchema,
  FaqBlockSchema,
]);

export type Block = z.infer<typeof BlockSchema>;
export type BlockType = Block['type'];
export type HeroBlock = z.infer<typeof HeroBlockSchema>;
export type RichTextBlock = z.infer<typeof RichTextBlockSchema>;
export type CardsBlock = z.infer<typeof CardsBlockSchema>;
export type ColumnsBlock = z.infer<typeof ColumnsBlockSchema>;
export type FaqBlock = z.infer<typeof FaqBlockSchema>;
```

- [ ] **Step 4: Написать схему сайта и валидатор**

```ts
// src/schema/site.ts
import * as z from 'zod';
import { BlockSchema } from './blocks';

export const PageSchema = z.object({
  slug: z.string().regex(/^\/[a-z0-9\-/]*$/, 'must start with "/" and contain only lowercase letters, digits, hyphens and slashes'),
  meta: z.object({
    title: z.string().min(20).max(65),
    description: z.string().min(50).max(165),
  }),
  blocks: z.array(BlockSchema).min(2).max(12),
});

export const SiteSchema = z
  .object({
    external_id: z.string().min(1).max(120),
    domain: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, 'must be a bare domain such as example.com'),
    locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'must look like "en" or "en-US"'),
    dir: z.enum(['ltr', 'rtl']).default('ltr'),
    brand: z.object({
      name: z.string().min(1).max(60),
      logo: z.string().regex(/^https?:\/\/\S+$/, 'must be an absolute http(s) URL').optional(),
    }),
    nav: z
      .array(
        z.object({
          label: z.string().min(1).max(40),
          href: z.string().min(1).max(200),
        }),
      )
      .max(8)
      .default([]),
    footer: z.object({
      disclaimer: z.string().min(30).max(600),
      links: z
        .array(
          z.object({
            label: z.string().min(1).max(40),
            href: z.string().min(1).max(200),
          }),
        )
        .max(8)
        .default([]),
    }),
    pages: z.array(PageSchema).min(1).max(50),
  })
  .superRefine((site, ctx) => {
    const seen = new Set<string>();
    site.pages.forEach((page, index) => {
      if (seen.has(page.slug)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate slug "${page.slug}"`,
          path: ['pages', index, 'slug'],
        });
      }
      seen.add(page.slug);
    });

    const hasRoot = site.pages.some((page) => page.slug === '/');
    if (!hasRoot) {
      ctx.addIssue({
        code: 'custom',
        message: 'at least one page must have slug "/"',
        path: ['pages'],
      });
    }
  });

export type Site = z.infer<typeof SiteSchema>;
export type Page = z.infer<typeof PageSchema>;

export function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return acc ? `${acc}.${String(segment)}` : String(segment);
  }, '');
}

export type ValidationResult =
  | { ok: true; data: Site }
  | { ok: false; errors: string[] };

export function validateSite(input: unknown): ValidationResult {
  const parsed = SiteSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  const errors = parsed.error.issues.map((issue) => {
    const path = formatPath(issue.path);
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return { ok: false, errors };
}
```

- [ ] **Step 5: Написать реэкспорт**

```ts
// src/schema/index.ts
export * from './blocks';
export * from './site';
```

- [ ] **Step 6: Запустить тесты**

Run: `pnpm vitest run tests/schema.test.ts`
Ожидаемо: PASS, 5 тестов.

Если тест на путь ошибки падает из-за отличий в формате `issue.path` — вывести реальный путь через `console.log(JSON.stringify(parsed.error.issues, null, 2))` и привести `formatPath` в соответствие. Формат `pages[0].blocks[1].props.items[2].a` обязателен: именно он уходит генерирующей стороне.

- [ ] **Step 7: Прогнать весь набор и типы**

Run: `pnpm test && pnpm typecheck`
Ожидаемо: PASS.

---

### Task 3: Детерминированный генератор случайности

**Files:**
- Create: `src/theme/rng.ts`
- Test: `tests/rng.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces:
  - `hashDomain(domain: string): number` — беззнаковый 32-битный FNV-1a
  - `type Rng = () => number` — значения в диапазоне [0, 1)
  - `makeRng(seed: number): Rng`
  - `pick<T>(rng: Rng, items: readonly T[]): T`
  - `intBetween(rng: Rng, min: number, max: number): number` — включая обе границы
  - `shuffle<T>(rng: Rng, items: readonly T[]): T[]`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/rng.test.ts
import { describe, expect, it } from 'vitest';
import { hashDomain, intBetween, makeRng, pick, shuffle } from '../src/theme/rng';

describe('hashDomain', () => {
  it('is stable for the same domain', () => {
    expect(hashDomain('4p4p.net')).toBe(hashDomain('4p4p.net'));
  });

  it('differs between domains', () => {
    expect(hashDomain('4p4p.net')).not.toBe(hashDomain('4p4q.net'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const value = hashDomain('example.com');
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(2 ** 32);
  });
});

describe('makeRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = makeRng(123);
    const b = makeRng(123);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it('stays within [0, 1)', () => {
    const rng = makeRng(hashDomain('example.com'));
    for (let i = 0; i < 1000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('spreads values across the range', () => {
    const rng = makeRng(42);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 10_000; i++) {
      buckets[Math.floor(rng() * 10)] += 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(700);
    }
  });
});

describe('helpers', () => {
  it('picks an element from the list', () => {
    const rng = makeRng(7);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(pick(rng, items));
    }
  });

  it('returns integers within the inclusive range', () => {
    const rng = makeRng(9);
    for (let i = 0; i < 500; i++) {
      const value = intBetween(rng, 3, 6);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(6);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('shuffles deterministically without losing elements', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const first = shuffle(makeRng(11), items);
    const second = shuffle(makeRng(11), items);
    expect(first).toEqual(second);
    expect([...first].sort((a, b) => a - b)).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
```

- [ ] **Step 2: Запустить и убедиться в падении**

Run: `pnpm vitest run tests/rng.test.ts`
Ожидаемо: FAIL, модуль `../src/theme/rng` не найден.

- [ ] **Step 3: Реализовать**

```ts
// src/theme/rng.ts

/** FNV-1a, 32-bit. Stable across runs and platforms. */
export function hashDomain(domain: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < domain.length; i++) {
    hash ^= domain.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export type Rng = () => number;

/** mulberry32: small, fast, deterministic. */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() requires a non-empty list');
  return items[Math.floor(rng() * items.length)];
}

export function intBetween(rng: Rng, min: number, max: number): number {
  if (max < min) throw new Error(`intBetween() requires min <= max, got ${min}..${max}`);
  return min + Math.floor(rng() * (max - min + 1));
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
```

- [ ] **Step 4: Запустить тесты**

Run: `pnpm vitest run tests/rng.test.ts`
Ожидаемо: PASS, 9 тестов.

- [ ] **Step 5: Прогнать весь набор и типы**

Run: `pnpm test && pnpm typecheck`
Ожидаемо: PASS.

---

### Task 4: Цвет и палитра с гарантированным контрастом

**Files:**
- Create: `src/theme/color.ts`, `src/theme/palette.ts`
- Test: `tests/color.test.ts`

**Interfaces:**
- Consumes: `Rng`, `intBetween`, `pick` из `src/theme/rng`
- Produces:
  - `type Hsl = { h: number; s: number; l: number }`
  - `hslToRgb(color: Hsl): [number, number, number]`
  - `relativeLuminance(rgb: [number, number, number]): number`
  - `contrastRatio(a: Hsl, b: Hsl): number`
  - `ensureContrast(fg: Hsl, bg: Hsl, min?: number): Hsl`
  - `readableTextOn(bg: Hsl): Hsl`, константы `WHITE`, `NEAR_BLACK`
  - `hslCss(color: Hsl): string` — строка вида `hsl(210 40% 96%)`
  - `type Palette = { bg; surface; text; muted; primary; primaryText; border }` (все поля `Hsl`)
  - `buildPalette(rng: Rng): Palette`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/color.test.ts
import { describe, expect, it } from 'vitest';
import { contrastRatio, ensureContrast, hslCss, readableTextOn, relativeLuminance, hslToRgb } from '../src/theme/color';
import { buildPalette } from '../src/theme/palette';
import { hashDomain, makeRng } from '../src/theme/rng';

const WHITE = { h: 0, s: 0, l: 100 };
const BLACK = { h: 0, s: 0, l: 0 };

describe('color maths', () => {
  it('converts pure red', () => {
    expect(hslToRgb({ h: 0, s: 100, l: 50 })).toEqual([255, 0, 0]);
  });

  it('computes luminance of white and black', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
  });

  it('gives the maximum contrast for black on white', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 1);
  });

  it('is symmetric', () => {
    const a = { h: 200, s: 50, l: 30 };
    const b = { h: 40, s: 20, l: 90 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 5);
  });

  it('formats css', () => {
    expect(hslCss({ h: 210, s: 40, l: 96 })).toBe('hsl(210 40% 96%)');
  });

  it('darkens foreground until it is readable on a light background', () => {
    const bg = { h: 210, s: 30, l: 97 };
    const fg = { h: 210, s: 30, l: 85 };
    const fixed = ensureContrast(fg, bg, 4.5);
    expect(contrastRatio(fixed, bg)).toBeGreaterThanOrEqual(4.5);
    expect(fixed.l).toBeLessThan(fg.l);
  });

  it('picks black label on a light accent and white on a dark one', () => {
    expect(readableTextOn({ h: 50, s: 90, l: 70 }).l).toBeLessThan(50);
    expect(readableTextOn({ h: 230, s: 70, l: 25 }).l).toBeGreaterThan(50);
  });

  it('lightens foreground until it is readable on a dark background', () => {
    const bg = { h: 210, s: 30, l: 8 };
    const fg = { h: 210, s: 30, l: 20 };
    const fixed = ensureContrast(fg, bg, 4.5);
    expect(contrastRatio(fixed, bg)).toBeGreaterThanOrEqual(4.5);
    expect(fixed.l).toBeGreaterThan(fg.l);
  });
});

describe('buildPalette', () => {
  const domains = Array.from({ length: 200 }, (_, i) => `site-${i}-example.com`);

  it('always keeps body text readable', () => {
    for (const domain of domains) {
      const palette = buildPalette(makeRng(hashDomain(domain)));
      expect(contrastRatio(palette.text, palette.bg), `text on bg for ${domain}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.text, palette.surface), `text on surface for ${domain}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps secondary text and buttons readable', () => {
    for (const domain of domains) {
      const palette = buildPalette(makeRng(hashDomain(domain)));
      expect(contrastRatio(palette.muted, palette.bg), `muted on bg for ${domain}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.primaryText, palette.primary), `primary text for ${domain}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('is deterministic', () => {
    const first = buildPalette(makeRng(hashDomain('4p4p.net')));
    const second = buildPalette(makeRng(hashDomain('4p4p.net')));
    expect(first).toEqual(second);
  });

  it('produces varied hues across domains', () => {
    const hues = new Set(domains.slice(0, 50).map((d) => Math.floor(buildPalette(makeRng(hashDomain(d))).primary.h / 30)));
    expect(hues.size).toBeGreaterThanOrEqual(6);
  });
});
```

- [ ] **Step 2: Запустить и убедиться в падении**

Run: `pnpm vitest run tests/color.test.ts`
Ожидаемо: FAIL, модули не найдены.

- [ ] **Step 3: Реализовать цветовые функции**

```ts
// src/theme/color.ts
export type Hsl = { h: number; s: number; l: number };

export function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = light - c / 2;

  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return [
    Math.round((rgb[0] + m) * 255),
    Math.round((rgb[1] + m) * 255),
    Math.round((rgb[2] + m) * 255),
  ];
}

export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Hsl, b: Hsl): number {
  const la = relativeLuminance(hslToRgb(a));
  const lb = relativeLuminance(hslToRgb(b));
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Moves lightness away from the background until the ratio is met. */
export function ensureContrast(fg: Hsl, bg: Hsl, min = 4.5): Hsl {
  const backgroundIsLight = relativeLuminance(hslToRgb(bg)) > 0.4;
  const step = backgroundIsLight ? -1 : 1;
  let lightness = fg.l;

  for (let i = 0; i < 120; i++) {
    if (contrastRatio({ ...fg, l: lightness }, bg) >= min) break;
    const next = lightness + step;
    if (next < 0 || next > 100) break;
    lightness = next;
  }

  return { ...fg, l: lightness };
}

export const WHITE: Hsl = { h: 0, s: 0, l: 100 };
export const NEAR_BLACK: Hsl = { h: 0, s: 0, l: 8 };

/**
 * Picks whichever of white/near-black reads better on the given colour.
 * Foreground lightness alone cannot fix a mid-tone background: white is
 * already at 100 and black at 0, so the background has to move instead.
 */
export function readableTextOn(bg: Hsl): Hsl {
  return contrastRatio(WHITE, bg) >= contrastRatio(NEAR_BLACK, bg) ? WHITE : NEAR_BLACK;
}

export function hslCss({ h, s, l }: Hsl): string {
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
}
```

- [ ] **Step 4: Реализовать палитру**

```ts
// src/theme/palette.ts
import { ensureContrast, readableTextOn, type Hsl } from './color';
import { intBetween, pick, type Rng } from './rng';

export type Palette = {
  bg: Hsl;
  surface: Hsl;
  text: Hsl;
  muted: Hsl;
  primary: Hsl;
  primaryText: Hsl;
  border: Hsl;
};

/** Small safety margin so rounding never drops a pair below the 4.5 threshold. */
const TARGET = 4.6;

/** The accent moves until its own label is readable — the label cannot move further. */
function withReadableLabel(primary: Hsl): { primary: Hsl; primaryText: Hsl } {
  const primaryText = readableTextOn(primary);
  return { primary: ensureContrast(primary, primaryText, TARGET), primaryText };
}

export function buildPalette(rng: Rng): Palette {
  const hue = intBetween(rng, 0, 359);
  const accentHue = (hue + pick(rng, [0, 25, 150, 180, 210])) % 360;
  const scheme = pick(rng, ['light', 'light', 'dark'] as const);

  if (scheme === 'dark') {
    const bg: Hsl = { h: hue, s: intBetween(rng, 12, 26), l: intBetween(rng, 8, 14) };
    const surface: Hsl = { ...bg, l: bg.l + 6 };
    const accent = withReadableLabel({ h: accentHue, s: intBetween(rng, 55, 80), l: intBetween(rng, 52, 64) });

    return {
      bg,
      surface,
      text: ensureContrast({ h: hue, s: 12, l: 96 }, bg, TARGET),
      muted: ensureContrast({ h: hue, s: 12, l: 72 }, bg, TARGET),
      primary: accent.primary,
      primaryText: accent.primaryText,
      border: { ...bg, l: bg.l + 14 },
    };
  }

  const bg: Hsl = { h: hue, s: intBetween(rng, 10, 30), l: intBetween(rng, 96, 99) };
  const surface: Hsl = { ...bg, l: Math.max(88, bg.l - 5) };
  const accent = withReadableLabel({ h: accentHue, s: intBetween(rng, 55, 80), l: intBetween(rng, 30, 44) });

  return {
    bg,
    surface,
    text: ensureContrast({ h: hue, s: 22, l: 18 }, bg, TARGET),
    muted: ensureContrast({ h: hue, s: 16, l: 42 }, bg, TARGET),
    primary: accent.primary,
    primaryText: accent.primaryText,
    border: { ...bg, l: Math.max(80, bg.l - 12) },
  };
}
```

- [ ] **Step 5: Запустить тесты**

Run: `pnpm vitest run tests/color.test.ts`
Ожидаемо: PASS, 12 тестов.

Если контрастный тест падает на отдельных доменах — это ошибка палитры, а не теста: правится расширением диапазона в `ensureContrast` или сдвигом стартовой светлоты в `buildPalette`. Ослаблять порог 4.5 нельзя.

- [ ] **Step 6: Прогнать весь набор и типы**

Run: `pnpm test && pnpm typecheck`
Ожидаемо: PASS.

---

### Task 5: Шрифты, варианты секций и сборка темы

**Files:**
- Create: `src/theme/fonts.ts`, `src/theme/variants.ts`, `src/theme/index.ts`
- Test: `tests/theme.test.ts`

**Interfaces:**
- Consumes: `Rng`, `makeRng`, `hashDomain`, `pick`, `shuffle` из `src/theme/rng`; `buildPalette`, `Palette`; `Block`, `BlockType` из `src/schema`
- Produces:
  - `type FontStack = { name: string; heading: string; body: string }`, `FONT_STACKS: readonly FontStack[]`, `pickFontStack(rng: Rng): FontStack`
  - `type Variants = { hero: 1 | 2 | 3; cards: 1 | 2; columns: 1 | 2; faq: 1 | 2 }`, `pickVariants(rng: Rng): Variants`
  - `arrangeBlocks(blocks: readonly Block[], rng: Rng): Block[]`
  - `type Theme = { seed: number; palette: Palette; fonts: FontStack; radius: string; density: 'compact' | 'normal' | 'roomy'; variants: Variants }`
  - `buildTheme(domain: string): Theme`
  - `themeFingerprint(theme: Theme): string`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/theme.test.ts
import { describe, expect, it } from 'vitest';
import type { Block } from '../src/schema';
import { buildTheme, themeFingerprint } from '../src/theme';
import { arrangeBlocks } from '../src/theme/variants';
import { hashDomain, makeRng } from '../src/theme/rng';

const domains = Array.from({ length: 50 }, (_, i) => `network-site-${i}.example`);

describe('buildTheme', () => {
  it('is deterministic for the same domain', () => {
    expect(buildTheme('4p4p.net')).toEqual(buildTheme('4p4p.net'));
  });

  it('differs between domains', () => {
    expect(buildTheme('4p4p.net')).not.toEqual(buildTheme('4p4q.net'));
  });

  it('produces at least 45 distinct looks out of 50 domains', () => {
    const fingerprints = new Set(domains.map((d) => themeFingerprint(buildTheme(d))));
    expect(fingerprints.size).toBeGreaterThanOrEqual(45);
  });

  it('uses every hero variant across a sample of domains', () => {
    const heroVariants = new Set(domains.map((d) => buildTheme(d).variants.hero));
    expect(heroVariants).toEqual(new Set([1, 2, 3]));
  });

  it('only uses system font stacks', () => {
    for (const domain of domains) {
      const { fonts } = buildTheme(domain);
      expect(fonts.heading).not.toContain('http');
      expect(fonts.body).toContain('sans-serif');
    }
  });
});

describe('arrangeBlocks', () => {
  const hero: Block = { type: 'hero', props: { title: 'A title that is long enough', subtitle: 'A subtitle that is definitely long enough to pass validation.' } };
  const cards: Block = { type: 'cards', props: { items: [
    { title: 'One', text: 'Text that is long enough to pass validation checks.' },
    { title: 'Two', text: 'Text that is long enough to pass validation checks.' },
    { title: 'Three', text: 'Text that is long enough to pass validation checks.' },
  ] } };
  const columns: Block = { type: 'columns', props: { items: [
    { title: 'One', text: 'Text that is long enough to pass validation.' },
    { title: 'Two', text: 'Text that is long enough to pass validation.' },
  ] } };
  const rich: Block = { type: 'richtext', props: { paragraphs: ['A paragraph that is comfortably longer than the minimum length.'] } };
  const faq: Block = { type: 'faq', props: { items: [
    { q: 'First question here?', a: 'An answer that is long enough to satisfy the schema constraints.' },
    { q: 'Second question here?', a: 'An answer that is long enough to satisfy the schema constraints.' },
    { q: 'Third question here?', a: 'An answer that is long enough to satisfy the schema constraints.' },
    { q: 'Fourth question here?', a: 'An answer that is long enough to satisfy the schema constraints.' },
  ] } };

  const input = [hero, cards, columns, rich, faq];

  it('keeps hero first and faq last', () => {
    for (const domain of domains) {
      const arranged = arrangeBlocks(input, makeRng(hashDomain(domain)));
      expect(arranged[0]?.type).toBe('hero');
      expect(arranged[arranged.length - 1]?.type).toBe('faq');
    }
  });

  it('keeps every block', () => {
    const arranged = arrangeBlocks(input, makeRng(hashDomain('example.com')));
    expect(arranged).toHaveLength(input.length);
    expect(arranged.map((b) => b.type).sort()).toEqual(input.map((b) => b.type).sort());
  });

  it('actually reorders the middle for some domains', () => {
    const orders = new Set(domains.map((d) => arrangeBlocks(input, makeRng(hashDomain(d))).map((b) => b.type).join(',')));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('is deterministic', () => {
    const a = arrangeBlocks(input, makeRng(hashDomain('4p4p.net')));
    const b = arrangeBlocks(input, makeRng(hashDomain('4p4p.net')));
    expect(a.map((x) => x.type)).toEqual(b.map((x) => x.type));
  });
});
```

- [ ] **Step 2: Запустить и убедиться в падении**

Run: `pnpm vitest run tests/theme.test.ts`
Ожидаемо: FAIL, модули не найдены.

- [ ] **Step 3: Реализовать шрифты**

```ts
// src/theme/fonts.ts
import { pick, type Rng } from './rng';

export type FontStack = { name: string; heading: string; body: string };

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const FONT_STACKS: readonly FontStack[] = [
  { name: 'system', heading: SANS, body: SANS },
  { name: 'grotesque', heading: `"Helvetica Neue", Arial, ${SANS}`, body: SANS },
  { name: 'serif-display', heading: `Georgia, "Times New Roman", serif`, body: SANS },
  { name: 'slab', heading: `Rockwell, "Courier New", Georgia, serif`, body: SANS },
  { name: 'humanist', heading: `"Trebuchet MS", "Lucida Grande", ${SANS}`, body: SANS },
  { name: 'mono-accent', heading: `ui-monospace, "SF Mono", "IBM Plex Mono", Menlo, monospace`, body: SANS },
];

export function pickFontStack(rng: Rng): FontStack {
  return pick(rng, FONT_STACKS);
}
```

- [ ] **Step 4: Реализовать варианты и перестановку блоков**

```ts
// src/theme/variants.ts
import type { Block } from '../schema';
import { pick, shuffle, type Rng } from './rng';

export type Variants = {
  hero: 1 | 2 | 3;
  cards: 1 | 2;
  columns: 1 | 2;
  faq: 1 | 2;
};

export function pickVariants(rng: Rng): Variants {
  return {
    hero: pick(rng, [1, 2, 3] as const),
    cards: pick(rng, [1, 2] as const),
    columns: pick(rng, [1, 2] as const),
    faq: pick(rng, [1, 2] as const),
  };
}

/**
 * Hero stays first and FAQ stays last — moving them would break the page's
 * narrative. Everything between them is shuffled deterministically.
 */
export function arrangeBlocks(blocks: readonly Block[], rng: Rng): Block[] {
  const heroes = blocks.filter((block) => block.type === 'hero');
  const faqs = blocks.filter((block) => block.type === 'faq');
  const middle = blocks.filter((block) => block.type !== 'hero' && block.type !== 'faq');

  return [...heroes, ...shuffle(rng, middle), ...faqs];
}
```

- [ ] **Step 5: Реализовать сборку темы**

```ts
// src/theme/index.ts
import { buildPalette, type Palette } from './palette';
import { pickFontStack, type FontStack } from './fonts';
import { pickVariants, type Variants } from './variants';
import { hashDomain, makeRng, pick } from './rng';

export * from './color';
export * from './palette';
export * from './fonts';
export * from './variants';
export * from './rng';

export type Density = 'compact' | 'normal' | 'roomy';

export type Theme = {
  seed: number;
  palette: Palette;
  fonts: FontStack;
  radius: string;
  density: Density;
  variants: Variants;
};

export function buildTheme(domain: string): Theme {
  const seed = hashDomain(domain);
  const rng = makeRng(seed);

  return {
    seed,
    palette: buildPalette(rng),
    fonts: pickFontStack(rng),
    radius: pick(rng, ['0px', '4px', '10px', '18px'] as const),
    density: pick(rng, ['compact', 'normal', 'roomy'] as const),
    variants: pickVariants(rng),
  };
}

export function themeFingerprint(theme: Theme): string {
  const hueBucket = Math.floor(theme.palette.primary.h / 20);
  const lightness = Math.round(theme.palette.bg.l / 10);
  const { hero, cards, columns, faq } = theme.variants;
  return [hueBucket, lightness, theme.fonts.name, theme.radius, theme.density, hero, cards, columns, faq].join('-');
}
```

- [ ] **Step 6: Запустить тесты**

Run: `pnpm vitest run tests/theme.test.ts`
Ожидаемо: PASS, 9 тестов.

Если тест «45 из 50» падает — добавить ось вариативности (например, ещё один шрифтовой стек или значение радиуса), а не ослаблять порог.

- [ ] **Step 7: Прогнать весь набор и типы**

Run: `pnpm test && pnpm typecheck`
Ожидаемо: PASS.

---

### Task 6: Загрузка конфига, макет и маршрут

**Files:**
- Create: `src/config/load.ts`, `src/styles/base.css`, `src/layouts/Base.astro`, `src/components/BlockRenderer.astro`, `src/pages/[...slug].astro`, `examples/4p4p.net.json`, `tests/helpers/build.ts`, `tests/render.test.ts`
- Modify: `astro.config.mjs`

**Interfaces:**
- Consumes: `validateSite`, типы `Site`, `Page`, `Block` из `src/schema`; `buildTheme`, `arrangeBlocks`, `hslCss`, `makeRng`, `hashDomain` из `src/theme`
- Produces:
  - `loadSiteConfig(): Site`
  - `Base.astro` с props `{ site: Site; page: Page; theme: Theme; jsonLd?: object[] }`
  - `BlockRenderer.astro` с props `{ blocks: Block[]; theme: Theme }`
  - `buildSite(configPath: string): Promise<string>` и `readOutput(outDir: string, file: string): string` в тестовом хелпере

- [ ] **Step 1: Заменить astro.config.mjs**

```js
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';

const configPath = process.env.SITE_JSON;
if (!configPath) {
  throw new Error('SITE_JSON is required. Example: SITE_JSON=./examples/4p4p.net.json pnpm build');
}

const site = JSON.parse(readFileSync(configPath, 'utf8'));

export default defineConfig({
  site: `https://${site.domain}`,
  outDir: process.env.OUT_DIR ?? './dist',
  integrations: [vue()],
  devToolbar: { enabled: false },
  build: { inlineStylesheets: 'always' },
});
```

- [ ] **Step 2: Написать загрузчик конфига**

```ts
// src/config/load.ts
import { readFileSync } from 'node:fs';
import { validateSite, type Site } from '../schema';

let cached: Site | null = null;

export function loadSiteConfig(): Site {
  if (cached) return cached;

  const path = process.env.SITE_JSON;
  if (!path) {
    throw new Error('SITE_JSON is required. Example: SITE_JSON=./examples/4p4p.net.json pnpm build');
  }

  const result = validateSite(JSON.parse(readFileSync(path, 'utf8')));
  if (!result.ok) {
    throw new Error(`Invalid site config at ${path}:\n  ${result.errors.join('\n  ')}`);
  }

  cached = result.data;
  return cached;
}
```

- [ ] **Step 3: Написать базовые стили**

```css
/* src/styles/base.css */
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 17px;
  line-height: 1.65;
}
h1, h2, h3 { font-family: var(--font-heading); line-height: 1.2; margin: 0 0 var(--space-3); }
h1 { font-size: clamp(1.9rem, 1.2rem + 2.6vw, 3rem); }
h2 { font-size: clamp(1.5rem, 1.1rem + 1.4vw, 2.1rem); }
h3 { font-size: 1.15rem; }
p { margin: 0 0 var(--space-3); }
img { max-width: 100%; height: auto; display: block; }
a { color: var(--primary); }
.container { width: min(100% - 2 * var(--space-4), 1080px); margin-inline: auto; }
.section { padding-block: var(--space-6); }
.surface { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.muted { color: var(--muted); }
```

- [ ] **Step 4: Написать макет**

```astro
---
// src/layouts/Base.astro
import type { Page, Site } from '../schema';
import { hslCss, type Theme } from '../theme';
import '../styles/base.css';

type Props = { site: Site; page: Page; theme: Theme; jsonLd?: unknown[] };
const { site, page, theme, jsonLd = [] } = Astro.props;

const spaceScale = { compact: 0.8, normal: 1, roomy: 1.25 }[theme.density];
const canonical = `https://${site.domain}${page.slug}`;

const organization = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: site.brand.name,
  url: `https://${site.domain}`,
  ...(site.brand.logo ? { logo: site.brand.logo } : {}),
};
---
<!doctype html>
<html lang={site.locale} dir={site.dir}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{page.meta.title}</title>
    <meta name="description" content={page.meta.description} />
    <link rel="canonical" href={canonical} />
    <link rel="alternate" hreflang={site.locale} href={canonical} />
    <meta property="og:type" content="website" />
    <meta property="og:title" content={page.meta.title} />
    <meta property="og:description" content={page.meta.description} />
    <meta property="og:url" content={canonical} />
    <meta property="og:locale" content={site.locale.replace('-', '_')} />
    <script type="application/ld+json" set:html={JSON.stringify(organization)} />
    {jsonLd.map((entry) => <script type="application/ld+json" set:html={JSON.stringify(entry)} />)}
    <style is:inline set:html={`:root{--bg:${hslCss(theme.palette.bg)};--surface:${hslCss(theme.palette.surface)};--text:${hslCss(theme.palette.text)};--muted:${hslCss(theme.palette.muted)};--primary:${hslCss(theme.palette.primary)};--primary-text:${hslCss(theme.palette.primaryText)};--border:${hslCss(theme.palette.border)};--radius:${theme.radius};--font-heading:${theme.fonts.heading};--font-body:${theme.fonts.body};--space-1:${0.25 * spaceScale}rem;--space-2:${0.5 * spaceScale}rem;--space-3:${1 * spaceScale}rem;--space-4:${1.5 * spaceScale}rem;--space-5:${2.5 * spaceScale}rem;--space-6:${4 * spaceScale}rem;}`} />
  </head>
  <body data-theme-seed={String(theme.seed)}>
    <slot />
  </body>
</html>
```

Примечание: переменные темы намеренно выводятся строкой в `is:inline`-стиле — это единственный способ, дающий полностью предсказуемый CSS без обработки сборщиком, а сами значения приходят из темы и потому уникальны для каждого домена.

- [ ] **Step 5: Написать пустой BlockRenderer**

```astro
---
// src/components/BlockRenderer.astro
import type { Block } from '../schema';
import type { Theme } from '../theme';

type Props = { blocks: Block[]; theme: Theme };
const { blocks } = Astro.props;
---
{blocks.map((block) => <div data-block={block.type} />)}
```

- [ ] **Step 6: Написать маршрут**

```astro
---
// src/pages/[...slug].astro
import Base from '../layouts/Base.astro';
import BlockRenderer from '../components/BlockRenderer.astro';
import { loadSiteConfig } from '../config/load';
import { arrangeBlocks, buildTheme, hashDomain, makeRng } from '../theme';

export function getStaticPaths() {
  const site = loadSiteConfig();
  return site.pages.map((page) => ({
    params: { slug: page.slug === '/' ? undefined : page.slug.replace(/^\//, '') },
    props: { page },
  }));
}

const site = loadSiteConfig();
const { page } = Astro.props;
const theme = buildTheme(site.domain);
const blocks = arrangeBlocks(page.blocks, makeRng(hashDomain(site.domain) ^ 0x5f5f));
---
<Base site={site} page={page} theme={theme}>
  <main class="container">
    <BlockRenderer blocks={blocks} theme={theme} />
  </main>
</Base>
```

- [ ] **Step 7: Создать пример конфига**

```json
{
  "external_id": "4p4p-reference",
  "domain": "4p4p.net",
  "locale": "id-ID",
  "dir": "ltr",
  "brand": { "name": "4P4P" },
  "nav": [
    { "label": "Beranda", "href": "/" },
    { "label": "Panduan", "href": "/panduan" }
  ],
  "footer": {
    "disclaimer": "Materi ini bersifat informasi umum dan bukan ajakan untuk berpartisipasi dalam aktivitas apa pun. Pengguna wajib memeriksa hukum yang berlaku.",
    "links": [{ "label": "Kebijakan Privasi", "href": "/privasi" }]
  },
  "pages": [
    {
      "slug": "/",
      "meta": {
        "title": "Panduan 4P4P Indonesia 2026: Akses Seluler",
        "description": "Panduan praktis 4P4P untuk pengguna Indonesia: akses seluler, ketentuan promosi, halaman dompet, dan pemeriksaan keamanan sebelum mendaftar."
      },
      "blocks": [
        {
          "type": "hero",
          "props": {
            "title": "Panduan beranda 4P4P untuk riset seluler",
            "subtitle": "Apa yang perlu diverifikasi pengguna sebelum berinteraksi dengan platform mana pun, dijelaskan secara sederhana."
          }
        },
        {
          "type": "richtext",
          "props": {
            "heading": "Ikhtisar untuk pengguna Indonesia",
            "paragraphs": [
              "4P4P umumnya diteliti sebagai merek hiburan digital yang terkait dengan akses akun seluler, lobi permainan, promosi, dan halaman dukungan pengguna.",
              "Beranda yang berguna harus menjelaskan area tersebut dengan jelas sambil menempatkan perlindungan pengguna dan kesadaran hukum di urutan pertama."
            ]
          }
        },
        {
          "type": "cards",
          "props": {
            "heading": "Area utama platform",
            "items": [
              { "title": "Akses Seluler", "text": "Beranda seluler harus dimuat cepat dan menampilkan menu yang mudah dibaca sebelum pendaftaran." },
              { "title": "Lobi Terorganisasi", "text": "Kategori, area unggulan, dan alat akun harus dipisahkan dengan jelas tanpa spanduk membingungkan." },
              { "title": "Halaman Promosi", "text": "Aturan lengkap lebih penting daripada angka utama: ketentuan, kedaluwarsa, dan batas penarikan." },
              { "title": "Kontrol Akun", "text": "Pengaturan profil, catatan transaksi, dan keamanan masuk harus mudah ditemukan pengguna." },
              { "title": "Halaman Dompet", "text": "Informasi pembayaran harus transparan sebelum pengguna mempertimbangkan mengirim dana apa pun." },
              { "title": "Dukungan", "text": "Tautan dukungan yang terlihat menandakan platform yang menangani sengketa secara serius." }
            ]
          }
        },
        {
          "type": "columns",
          "props": {
            "heading": "Cara meninjau sebelum mendaftar",
            "items": [
              { "title": "Titik Akses Resmi", "text": "Gunakan hanya domain terverifikasi dan hindari tautan salinan atau pengalihan." },
              { "title": "Ketentuan dan Privasi", "text": "Kebijakan harus menjelaskan penggunaan data, verifikasi, dan penutupan akun." },
              { "title": "Ketentuan Pembayaran", "text": "Batas, biaya, dan waktu penarikan harus dinyatakan dengan jelas di muka." },
              { "title": "Risiko Pribadi", "text": "Pengguna wajib memverifikasi hukum setempat sebelum melakukan tindakan apa pun." }
            ]
          }
        },
        {
          "type": "faq",
          "props": {
            "heading": "Pertanyaan yang sering diajukan",
            "items": [
              { "q": "Apa itu 4P4P?", "a": "Nama platform terkait hiburan daring yang dibandingkan pengguna berdasarkan kegunaan seluler, alur pendaftaran, dan kejelasan pembayaran." },
              { "q": "Apakah tersedia di seluler?", "a": "Akses seluler adalah titik masuk paling umum, sehingga halaman harus dimuat cepat pada jaringan seluler biasa." },
              { "q": "Bagaimana bonus bekerja?", "a": "Promosi bervariasi, dan ketentuan lengkap jauh lebih penting daripada angka utama yang ditampilkan pada spanduk." },
              { "q": "Di mana memeriksa aturan?", "a": "Selalu baca halaman ketentuan dan privasi sebelum membuat akun di platform mana pun." },
              { "q": "Apakah ada risiko hukum?", "a": "Indonesia menerapkan pembatasan ketat, sehingga pengguna harus memverifikasi hukum terbaru sebelum bertindak." }
            ]
          }
        }
      ]
    }
  ]
}
```

- [ ] **Step 8: Написать тестовый хелпер сборки**

```ts
// tests/helpers/build.ts
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function buildSite(configPath: string): Promise<string> {
  const outDir = mkdtempSync(join(tmpdir(), 'site-factory-'));
  await run('pnpm', ['exec', 'astro', 'build'], {
    cwd: process.cwd(),
    env: { ...process.env, SITE_JSON: configPath, OUT_DIR: outDir },
    maxBuffer: 10 * 1024 * 1024,
  });
  return outDir;
}

export function readOutput(outDir: string, file: string): string {
  return readFileSync(join(outDir, file), 'utf8');
}
```

- [ ] **Step 9: Написать падающий тест рендера**

```ts
// tests/render.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSite, readOutput } from './helpers/build';
import { buildTheme, hslCss } from '../src/theme';

let outDir: string;
let html: string;

beforeAll(async () => {
  outDir = await buildSite('./examples/4p4p.net.json');
  html = readOutput(outDir, 'index.html');
});

describe('page shell', () => {
  it('sets language and direction', () => {
    expect(html).toContain('lang="id-ID"');
    expect(html).toContain('dir="ltr"');
  });

  it('renders the meta title and description', () => {
    expect(html).toContain('<title>Panduan 4P4P Indonesia 2026: Akses Seluler</title>');
    expect(html).toContain('Panduan praktis 4P4P untuk pengguna Indonesia');
  });

  it('inlines the palette of this domain', () => {
    const theme = buildTheme('4p4p.net');
    expect(html).toContain(hslCss(theme.palette.bg));
    expect(html).toContain(hslCss(theme.palette.primary));
  });

  it('emits organization structured data', () => {
    expect(html).toContain('"@type":"Organization"');
    expect(html).toContain('"name":"4P4P"');
  });

  it('ships no client-side javascript bundle', () => {
    expect(html).not.toMatch(/<script[^>]+src="[^"]*\.js"/);
  });

  it('renders one node per block', () => {
    const matches = html.match(/data-block="/g) ?? [];
    expect(matches).toHaveLength(5);
  });
});
```

- [ ] **Step 10: Запустить тест**

Run: `pnpm vitest run tests/render.test.ts`
Ожидаемо: PASS, 6 тестов. Первая сборка занимает 10–30 секунд.

Если сборка падает с ошибкой про `SITE_JSON` — проверить, что хелпер передаёт env и что `astro.config.mjs` читает именно `process.env.SITE_JSON`.

- [ ] **Step 11: Проверить сборку вручную**

Run: `SITE_JSON=./examples/4p4p.net.json pnpm build`
Ожидаемо: `dist/index.html` создан, в выводе Astro значится 1 страница.

- [ ] **Step 12: Прогнать весь набор и типы**

Run: `pnpm test && pnpm typecheck`
Ожидаемо: PASS.

---

### Task 7: Блоки Hero и RichText

**Files:**
- Create: `src/components/blocks/Hero.vue`, `src/components/blocks/RichText.vue`
- Modify: `src/components/BlockRenderer.astro`
- Modify: `tests/render.test.ts`

**Interfaces:**
- Consumes: `Theme` (для `variants`), типы блоков из `src/schema`
- Produces: компоненты с props `Hero { title: string; subtitle: string; image?: string; variant: number }` и `RichText { heading?: string; paragraphs: string[] }`; `BlockRenderer` умеет рендерить типы `hero` и `richtext`

- [ ] **Step 1: Дописать тест в tests/render.test.ts**

Добавить в конец файла:

```ts
describe('hero block', () => {
  it('renders the headline as h1', () => {
    expect(html).toMatch(/<h1[^>]*>\s*Panduan beranda 4P4P untuk riset seluler\s*<\/h1>/);
  });

  it('renders the subtitle', () => {
    expect(html).toContain('Apa yang perlu diverifikasi pengguna');
  });

  it('uses the layout variant of this domain', () => {
    const theme = buildTheme('4p4p.net');
    expect(html).toContain(`hero--v${theme.variants.hero}`);
  });
});

describe('richtext block', () => {
  it('renders each paragraph', () => {
    expect(html).toContain('4P4P umumnya diteliti sebagai merek hiburan digital');
    expect(html).toContain('Beranda yang berguna harus menjelaskan area tersebut');
  });

  it('renders the optional heading', () => {
    expect(html).toContain('Ikhtisar untuk pengguna Indonesia');
  });
});
```

- [ ] **Step 2: Запустить и убедиться в падении**

Run: `pnpm vitest run tests/render.test.ts`
Ожидаемо: FAIL — 5 новых тестов не проходят, старые 6 проходят.

- [ ] **Step 3: Написать Hero.vue**

```vue
<script setup lang="ts">
defineProps<{
  title: string;
  subtitle: string;
  image?: string;
  variant: number;
}>();
</script>

<template>
  <section class="hero section" :class="`hero--v${variant}`">
    <div class="hero__text">
      <h1>{{ title }}</h1>
      <p class="hero__subtitle muted">{{ subtitle }}</p>
    </div>
    <img v-if="image" class="hero__image" :src="image" :alt="title" width="960" height="540" loading="eager" decoding="async" />
  </section>
</template>

<style scoped>
.hero { display: grid; gap: var(--space-4); }
.hero__subtitle { font-size: 1.15rem; margin: 0; }
.hero__image { border-radius: var(--radius); width: 100%; }

/* v1: centred, text only */
.hero--v1 { text-align: center; justify-items: center; }
.hero--v1 .hero__text { max-width: 46rem; }

/* v2: text left, image right */
.hero--v2 { grid-template-columns: 1fr; }
@media (min-width: 860px) {
  .hero--v2 { grid-template-columns: 1.1fr 0.9fr; align-items: center; }
}

/* v3: banner card */
.hero--v3 .hero__text {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-5);
}
</style>
```

- [ ] **Step 4: Написать RichText.vue**

```vue
<script setup lang="ts">
defineProps<{
  heading?: string;
  paragraphs: string[];
}>();
</script>

<template>
  <section class="richtext section">
    <h2 v-if="heading">{{ heading }}</h2>
    <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p>
  </section>
</template>

<style scoped>
.richtext { max-width: 62rem; }
</style>
```

- [ ] **Step 5: Обновить BlockRenderer**

```astro
---
// src/components/BlockRenderer.astro
import type { Block } from '../schema';
import type { Theme } from '../theme';
import Hero from './blocks/Hero.vue';
import RichText from './blocks/RichText.vue';

type Props = { blocks: Block[]; theme: Theme };
const { blocks, theme } = Astro.props;
---
{blocks.map((block) => {
  switch (block.type) {
    case 'hero':
      return <Hero {...block.props} variant={theme.variants.hero} />;
    case 'richtext':
      return <RichText {...block.props} />;
    default:
      return <div data-block={block.type} />;
  }
})}
```

- [ ] **Step 6: Поправить счётчик блоков в старом тесте**

В тесте `renders one node per block` заменить ожидание на количество ещё не реализованных блоков:

```ts
  it('renders a placeholder only for unimplemented blocks', () => {
    const matches = html.match(/data-block="/g) ?? [];
    expect(matches).toHaveLength(3);
  });
```

- [ ] **Step 7: Запустить тесты**

Run: `pnpm vitest run tests/render.test.ts`
Ожидаемо: PASS, 11 тестов.

- [ ] **Step 8: Прогнать весь набор и типы**

Run: `pnpm test && pnpm typecheck`
Ожидаемо: PASS.

---

### Task 8: Блоки Cards и Columns

**Files:**
- Create: `src/components/blocks/Cards.vue`, `src/components/blocks/Columns.vue`
- Modify: `src/components/BlockRenderer.astro`
- Modify: `tests/render.test.ts`

**Interfaces:**
- Consumes: `Theme.variants.cards`, `Theme.variants.columns`
- Produces: `Cards { heading?: string; items: { title: string; text: string }[]; variant: number }`, `Columns { heading?: string; items: { title: string; text: string }[]; variant: number }`

- [ ] **Step 1: Дописать тест**

Добавить в конец `tests/render.test.ts`:

```ts
describe('cards block', () => {
  it('renders every card', () => {
    expect(html).toContain('Akses Seluler');
    expect(html).toContain('Lobi Terorganisasi');
    expect(html).toContain('Dukungan');
  });

  it('uses the card variant of this domain', () => {
    const theme = buildTheme('4p4p.net');
    expect(html).toContain(`cards--v${theme.variants.cards}`);
  });

  it('renders card titles as h3', () => {
    expect(html).toMatch(/<h3[^>]*>\s*Halaman Dompet\s*<\/h3>/);
  });
});

describe('columns block', () => {
  it('renders every column', () => {
    expect(html).toContain('Titik Akses Resmi');
    expect(html).toContain('Risiko Pribadi');
  });

  it('uses the column variant of this domain', () => {
    const theme = buildTheme('4p4p.net');
    expect(html).toContain(`columns--v${theme.variants.columns}`);
  });
});
```

- [ ] **Step 2: Запустить и убедиться в падении**

Run: `pnpm vitest run tests/render.test.ts`
Ожидаемо: FAIL на пяти новых тестах.

- [ ] **Step 3: Написать Cards.vue**

```vue
<script setup lang="ts">
defineProps<{
  heading?: string;
  items: { title: string; text: string }[];
  variant: number;
}>();
</script>

<template>
  <section class="cards section" :class="`cards--v${variant}`">
    <h2 v-if="heading">{{ heading }}</h2>
    <ul class="cards__grid">
      <li v-for="item in items" :key="item.title" class="cards__item surface">
        <h3>{{ item.title }}</h3>
        <p class="muted">{{ item.text }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.cards__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}
.cards__item { padding: var(--space-4); }
.cards__item p { margin: 0; }

/* v1: three per row */
@media (min-width: 720px) {
  .cards--v1 .cards__grid { grid-template-columns: repeat(3, 1fr); }
}

/* v2: two per row, accent bar on top */
@media (min-width: 720px) {
  .cards--v2 .cards__grid { grid-template-columns: repeat(2, 1fr); }
}
.cards--v2 .cards__item { border-top: 3px solid var(--primary); }
</style>
```

- [ ] **Step 4: Написать Columns.vue**

```vue
<script setup lang="ts">
defineProps<{
  heading?: string;
  items: { title: string; text: string }[];
  variant: number;
}>();
</script>

<template>
  <section class="columns section" :class="`columns--v${variant}`">
    <h2 v-if="heading">{{ heading }}</h2>
    <div class="columns__grid">
      <div v-for="item in items" :key="item.title" class="columns__item">
        <h3>{{ item.title }}</h3>
        <p class="muted">{{ item.text }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.columns__grid { display: grid; gap: var(--space-4); }
.columns__item p { margin: 0; }

/* v1: even columns */
@media (min-width: 720px) {
  .columns--v1 .columns__grid { grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
}

/* v2: two columns with dividers */
@media (min-width: 720px) {
  .columns--v2 .columns__grid { grid-template-columns: repeat(2, 1fr); }
  .columns--v2 .columns__item { border-inline-start: 2px solid var(--border); padding-inline-start: var(--space-3); }
}
</style>
```

- [ ] **Step 5: Обновить BlockRenderer**

```astro
---
// src/components/BlockRenderer.astro
import type { Block } from '../schema';
import type { Theme } from '../theme';
import Hero from './blocks/Hero.vue';
import RichText from './blocks/RichText.vue';
import Cards from './blocks/Cards.vue';
import Columns from './blocks/Columns.vue';

type Props = { blocks: Block[]; theme: Theme };
const { blocks, theme } = Astro.props;
---
{blocks.map((block) => {
  switch (block.type) {
    case 'hero':
      return <Hero {...block.props} variant={theme.variants.hero} />;
    case 'richtext':
      return <RichText {...block.props} />;
    case 'cards':
      return <Cards {...block.props} variant={theme.variants.cards} />;
    case 'columns':
      return <Columns {...block.props} variant={theme.variants.columns} />;
    default:
      return <div data-block={block.type} />;
  }
})}
```

- [ ] **Step 6: Обновить счётчик заглушек**

В тесте `renders a placeholder only for unimplemented blocks` заменить ожидание на `1` (остался только `faq`).

- [ ] **Step 7: Запустить тесты**

Run: `pnpm vitest run tests/render.test.ts`
Ожидаемо: PASS, 16 тестов.

- [ ] **Step 8: Прогнать весь набор и типы**

Run: `pnpm test && pnpm typecheck`
Ожидаемо: PASS.

---

### Task 9: Блоки FAQ и Footer

**Files:**
- Create: `src/components/blocks/Faq.vue`, `src/components/blocks/Footer.vue`
- Modify: `src/components/BlockRenderer.astro`, `src/pages/[...slug].astro`
- Modify: `tests/render.test.ts`

**Interfaces:**
- Consumes: `Theme.variants.faq`, `Site.footer`, `Site.nav`, `Site.brand`
- Produces: `Faq { heading?: string; items: { q: string; a: string }[]; variant: number }`, `Footer { brandName: string; disclaimer: string; links: { label: string; href: string }[] }`

- [ ] **Step 1: Дописать тест**

Добавить в конец `tests/render.test.ts`:

```ts
describe('faq block', () => {
  it('renders questions and answers', () => {
    expect(html).toContain('Apa itu 4P4P?');
    expect(html).toContain('Nama platform terkait hiburan daring');
  });

  it('uses the faq variant of this domain', () => {
    const theme = buildTheme('4p4p.net');
    expect(html).toContain(`faq--v${theme.variants.faq}`);
  });

  it('leaves no unimplemented block placeholders', () => {
    expect(html).not.toContain('data-block="');
  });
});

describe('footer', () => {
  it('renders the disclaimer', () => {
    expect(html).toContain('Materi ini bersifat informasi umum');
  });

  it('renders footer links', () => {
    expect(html).toContain('Kebijakan Privasi');
  });

  it('renders the brand name', () => {
    expect(html).toContain('4P4P');
  });
});
```

- [ ] **Step 2: Запустить и убедиться в падении**

Run: `pnpm vitest run tests/render.test.ts`
Ожидаемо: FAIL на шести новых тестах.

- [ ] **Step 3: Написать Faq.vue**

```vue
<script setup lang="ts">
defineProps<{
  heading?: string;
  items: { q: string; a: string }[];
  variant: number;
}>();
</script>

<template>
  <section class="faq section" :class="`faq--v${variant}`">
    <h2 v-if="heading">{{ heading }}</h2>
    <div class="faq__list">
      <div v-for="item in items" :key="item.q" class="faq__item">
        <h3 class="faq__question">{{ item.q }}</h3>
        <p class="faq__answer muted">{{ item.a }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.faq__list { display: grid; gap: var(--space-3); }
.faq__question { margin-bottom: var(--space-1); }
.faq__answer { margin: 0; }

/* v1: single column list with separators */
.faq--v1 .faq__item { border-bottom: 1px solid var(--border); padding-bottom: var(--space-3); }

/* v2: two columns of cards */
@media (min-width: 820px) {
  .faq--v2 .faq__list { grid-template-columns: repeat(2, 1fr); }
}
.faq--v2 .faq__item {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-4);
}
</style>
```

- [ ] **Step 4: Написать Footer.vue**

```vue
<script setup lang="ts">
defineProps<{
  brandName: string;
  disclaimer: string;
  links: { label: string; href: string }[];
}>();
</script>

<template>
  <footer class="footer">
    <div class="container footer__inner">
      <p class="footer__brand">{{ brandName }}</p>
      <nav v-if="links.length" class="footer__links">
        <a v-for="link in links" :key="link.href" :href="link.href">{{ link.label }}</a>
      </nav>
      <p class="footer__disclaimer muted">{{ disclaimer }}</p>
    </div>
  </footer>
</template>

<style scoped>
.footer {
  background: var(--surface);
  border-top: 1px solid var(--border);
  margin-top: var(--space-6);
  padding-block: var(--space-5);
}
.footer__inner { display: grid; gap: var(--space-2); }
.footer__brand { font-family: var(--font-heading); font-weight: 700; margin: 0; }
.footer__links { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.footer__disclaimer { font-size: 0.9rem; margin: 0; }
</style>
```

- [ ] **Step 5: Добавить FAQ в BlockRenderer**

Заменить блок `default` в `src/components/BlockRenderer.astro`:

```astro
---
import type { Block } from '../schema';
import type { Theme } from '../theme';
import Hero from './blocks/Hero.vue';
import RichText from './blocks/RichText.vue';
import Cards from './blocks/Cards.vue';
import Columns from './blocks/Columns.vue';
import Faq from './blocks/Faq.vue';

type Props = { blocks: Block[]; theme: Theme };
const { blocks, theme } = Astro.props;
---
{blocks.map((block) => {
  switch (block.type) {
    case 'hero':
      return <Hero {...block.props} variant={theme.variants.hero} />;
    case 'richtext':
      return <RichText {...block.props} />;
    case 'cards':
      return <Cards {...block.props} variant={theme.variants.cards} />;
    case 'columns':
      return <Columns {...block.props} variant={theme.variants.columns} />;
    case 'faq':
      return <Faq {...block.props} variant={theme.variants.faq} />;
  }
})}
```

- [ ] **Step 6: Подключить футер в маршруте**

```astro
---
// src/pages/[...slug].astro
import Base from '../layouts/Base.astro';
import BlockRenderer from '../components/BlockRenderer.astro';
import Footer from '../components/blocks/Footer.vue';
import { loadSiteConfig } from '../config/load';
import { arrangeBlocks, buildTheme, hashDomain, makeRng } from '../theme';

export function getStaticPaths() {
  const site = loadSiteConfig();
  return site.pages.map((page) => ({
    params: { slug: page.slug === '/' ? undefined : page.slug.replace(/^\//, '') },
    props: { page },
  }));
}

const site = loadSiteConfig();
const { page } = Astro.props;
const theme = buildTheme(site.domain);
const blocks = arrangeBlocks(page.blocks, makeRng(hashDomain(site.domain) ^ 0x5f5f));
---
<Base site={site} page={page} theme={theme}>
  <main class="container">
    <BlockRenderer blocks={blocks} theme={theme} />
  </main>
  <Footer brandName={site.brand.name} disclaimer={site.footer.disclaimer} links={site.footer.links} />
</Base>
```

- [ ] **Step 7: Запустить тесты**

Run: `pnpm vitest run tests/render.test.ts`
Ожидаемо: PASS, 22 теста.

- [ ] **Step 8: Прогнать весь набор и типы**

Run: `pnpm test && pnpm typecheck`
Ожидаемо: PASS.

---

### Task 10: SEO-артефакты

**Files:**
- Create: `src/pages/sitemap.xml.ts`, `src/pages/robots.txt.ts`, `src/pages/404.astro`, `tests/seo.test.ts`
- Modify: `src/pages/[...slug].astro` (передача JSON-LD для FAQ), `src/layouts/Base.astro` (флаг noindex)

**Interfaces:**
- Consumes: `loadSiteConfig`, `Site`, `Page`, `Block`
- Produces: файлы `sitemap.xml`, `robots.txt` и `404.html` в выходной папке; разметка `FAQPage` в HTML страниц, содержащих блок `faq`; проп `noindex?: boolean` у `Base.astro`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/seo.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSite, readOutput } from './helpers/build';

let outDir: string;

beforeAll(async () => {
  outDir = await buildSite('./examples/4p4p.net.json');
});

describe('sitemap.xml', () => {
  it('lists every page with an absolute url', () => {
    const xml = readOutput(outDir, 'sitemap.xml');
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<loc>https://4p4p.net/</loc>');
    expect(xml).toContain('urlset');
  });
});

describe('robots.txt', () => {
  it('allows crawling and points at the sitemap', () => {
    const txt = readOutput(outDir, 'robots.txt');
    expect(txt).toContain('User-agent: *');
    expect(txt).toContain('Allow: /');
    expect(txt).toContain('Sitemap: https://4p4p.net/sitemap.xml');
  });
});

describe('structured data', () => {
  it('emits FAQPage markup when the page has a faq block', () => {
    const html = readOutput(outDir, 'index.html');
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('"@type":"Question"');
    expect(html).toContain('Apa itu 4P4P?');
  });

  it('emits a canonical link', () => {
    const html = readOutput(outDir, 'index.html');
    expect(html).toContain('rel="canonical" href="https://4p4p.net/"');
  });
});

describe('404 page', () => {
  it('is generated and marked noindex', () => {
    const html = readOutput(outDir, '404.html');
    expect(html).toContain('name="robots"');
    expect(html).toContain('noindex');
  });

  it('keeps the brand and the site theme', () => {
    const html = readOutput(outDir, '404.html');
    expect(html).toContain('4P4P');
    expect(html).toContain('lang="id-ID"');
  });
});
```

- [ ] **Step 2: Запустить и убедиться в падении**

Run: `pnpm vitest run tests/seo.test.ts`
Ожидаемо: FAIL — `sitemap.xml` не найден.

- [ ] **Step 3: Написать sitemap**

```ts
// src/pages/sitemap.xml.ts
import type { APIRoute } from 'astro';
import { loadSiteConfig } from '../config/load';

export const GET: APIRoute = () => {
  const site = loadSiteConfig();
  const urls = site.pages
    .map((page) => `  <url>\n    <loc>https://${site.domain}${page.slug}</loc>\n  </url>`)
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
```

- [ ] **Step 4: Написать robots**

```ts
// src/pages/robots.txt.ts
import type { APIRoute } from 'astro';
import { loadSiteConfig } from '../config/load';

export const GET: APIRoute = () => {
  const site = loadSiteConfig();
  const body = `User-agent: *\nAllow: /\n\nSitemap: https://${site.domain}/sitemap.xml\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
```

- [ ] **Step 5: Добавить флаг noindex в Base.astro**

Заменить строку объявления props и добавить мета-тег в `<head>`:

```astro
type Props = { site: Site; page: Page; theme: Theme; jsonLd?: unknown[]; noindex?: boolean };
const { site, page, theme, jsonLd = [], noindex = false } = Astro.props;
```

Сразу после `<meta name="description" ... />` добавить:

```astro
    {noindex && <meta name="robots" content="noindex, follow" />}
```

- [ ] **Step 6: Написать страницу 404**

```astro
---
// src/pages/404.astro
import Base from '../layouts/Base.astro';
import { loadSiteConfig } from '../config/load';
import { buildTheme } from '../theme';
import type { Page } from '../schema';

const site = loadSiteConfig();
const theme = buildTheme(site.domain);

const page: Page = {
  slug: '/404',
  meta: {
    title: `${site.brand.name}: page not found`,
    description: `The requested page was not found on ${site.domain}.`,
  },
  blocks: [],
};
---
<Base site={site} page={page} theme={theme} noindex>
  <main class="container section">
    <h1>404</h1>
    <p class="muted">{page.meta.description}</p>
    <p><a href="/">{site.brand.name}</a></p>
  </main>
</Base>
```

Примечание: `page` здесь собирается вручную и не проходит через `validateSite` — это единственная страница без контента из конфига, поэтому ограничения схемы на длину заголовка к ней не применяются.

- [ ] **Step 7: Добавить FAQPage в маршрут**

Заменить содержимое `src/pages/[...slug].astro`:

```astro
---
import Base from '../layouts/Base.astro';
import BlockRenderer from '../components/BlockRenderer.astro';
import Footer from '../components/blocks/Footer.vue';
import { loadSiteConfig } from '../config/load';
import { arrangeBlocks, buildTheme, hashDomain, makeRng } from '../theme';

export function getStaticPaths() {
  const site = loadSiteConfig();
  return site.pages.map((page) => ({
    params: { slug: page.slug === '/' ? undefined : page.slug.replace(/^\//, '') },
    props: { page },
  }));
}

const site = loadSiteConfig();
const { page } = Astro.props;
const theme = buildTheme(site.domain);
const blocks = arrangeBlocks(page.blocks, makeRng(hashDomain(site.domain) ^ 0x5f5f));

const faqBlock = page.blocks.find((block) => block.type === 'faq');
const jsonLd = faqBlock
  ? [
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqBlock.props.items.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
    ]
  : [];
---
<Base site={site} page={page} theme={theme} jsonLd={jsonLd}>
  <main class="container">
    <BlockRenderer blocks={blocks} theme={theme} />
  </main>
  <Footer brandName={site.brand.name} disclaimer={site.footer.disclaimer} links={site.footer.links} />
</Base>
```

- [ ] **Step 8: Запустить тесты**

Run: `pnpm vitest run tests/seo.test.ts`
Ожидаемо: PASS, 6 тестов.

Если `sitemap.xml` не появился в выходной папке — убедиться, что файл лежит именно в `src/pages/` и экспортирует `GET` (Astro генерирует статические эндпоинты при сборке).

- [ ] **Step 9: Прогнать весь набор и типы**

Run: `pnpm test && pnpm typecheck`
Ожидаемо: PASS.

---

### Task 11: Многостраничность, RTL и приёмка этапа

**Files:**
- Create: `examples/example-guide.com.json`, `examples/dalil-ar.net.json`, `tests/acceptance.test.ts`, `README.md`
- Modify: `package.json` (скрипт `build:example`)

**Interfaces:**
- Consumes: всё, что построено в задачах 1–10
- Produces: подтверждение критериев готовности этапа 1

- [ ] **Step 1: Создать двухстраничный пример**

```json
{
  "external_id": "example-guide",
  "domain": "example-guide.com",
  "locale": "en-US",
  "dir": "ltr",
  "brand": { "name": "Example Guide" },
  "nav": [
    { "label": "Home", "href": "/" },
    { "label": "Safety", "href": "/safety" }
  ],
  "footer": {
    "disclaimer": "This page is informational only and does not encourage participation in any activity. Readers should verify local rules before acting.",
    "links": [{ "label": "Privacy", "href": "/privacy" }]
  },
  "pages": [
    {
      "slug": "/",
      "meta": {
        "title": "Example Guide 2026: Mobile Access Review",
        "description": "A practical review of the Example platform for readers: mobile access, promotion terms, wallet clarity and the checks worth doing before signing up."
      },
      "blocks": [
        {
          "type": "hero",
          "props": {
            "title": "Example homepage guide for careful readers",
            "subtitle": "What to verify before interacting with any online platform, explained without marketing language."
          }
        },
        {
          "type": "cards",
          "props": {
            "heading": "Key areas to review",
            "items": [
              { "title": "Mobile Access", "text": "Pages should load quickly on mobile data and keep menus readable without popups." },
              { "title": "Promotion Terms", "text": "Full conditions matter more than headline numbers shown on rotating banners." },
              { "title": "Wallet Clarity", "text": "Limits, fees and verification steps should be stated before any funds are sent." },
              { "title": "Account Controls", "text": "Profile settings, transaction records and login security should be easy to find." }
            ]
          }
        },
        {
          "type": "faq",
          "props": {
            "heading": "Common questions",
            "items": [
              { "q": "What is this platform?", "a": "An online brand that readers compare on usability, registration flow and payment clarity before deciding anything." },
              { "q": "Does it work on phones?", "a": "Mobile browsers are the most common entry point, so page speed and readable menus matter most." },
              { "q": "How should bonuses be read?", "a": "Read the full terms: wagering conditions, expiry dates, eligible activity and withdrawal limits." },
              { "q": "Where are the rules listed?", "a": "Terms and privacy pages should explain data use, verification, disputes and account closure." }
            ]
          }
        }
      ]
    },
    {
      "slug": "/safety",
      "meta": {
        "title": "Safety Checklist Before You Register Anywhere",
        "description": "A short checklist for readers: verify the official access point, read the terms, review payment conditions and consider personal and legal risk first."
      },
      "blocks": [
        {
          "type": "hero",
          "props": {
            "title": "Safety checklist before registering",
            "subtitle": "Four checks that take five minutes and prevent most avoidable problems later."
          }
        },
        {
          "type": "columns",
          "props": {
            "heading": "The four checks",
            "items": [
              { "title": "Official Access", "text": "Use verified domains only and avoid mirrors, redirects and unofficial groups." },
              { "title": "Terms and Privacy", "text": "Policies should explain data use, verification and how disputes are handled." },
              { "title": "Payment Terms", "text": "Limits, fees, verification and withdrawal timing should be stated clearly." },
              { "title": "Personal Risk", "text": "Verify local rules and your own limits before registering or depositing." }
            ]
          }
        },
        {
          "type": "faq",
          "props": {
            "items": [
              { "q": "Why check the domain first?", "a": "Copycat domains are the most common way readers end up on a page that is not the official one." },
              { "q": "What if terms are missing?", "a": "Absent or vague terms are themselves the answer: there is nothing to hold the platform to later." },
              { "q": "How long should checks take?", "a": "About five minutes, which is far less than the time spent resolving a problem afterwards." },
              { "q": "Is this page advice?", "a": "No. It is general information, and readers remain responsible for verifying local rules themselves." }
            ]
          }
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Создать RTL-пример**

```json
{
  "external_id": "dalil-ar",
  "domain": "dalil-ar.net",
  "locale": "ar-AE",
  "dir": "rtl",
  "brand": { "name": "دليل" },
  "nav": [{ "label": "الرئيسية", "href": "/" }],
  "footer": {
    "disclaimer": "هذه الصفحة لأغراض المعلومات العامة فقط ولا تشجع على المشاركة في أي نشاط، وعلى القارئ التحقق من القوانين المحلية.",
    "links": [{ "label": "الخصوصية", "href": "/privacy" }]
  },
  "pages": [
    {
      "slug": "/",
      "meta": {
        "title": "دليل المراجعة للقراء في 2026 بالتفصيل",
        "description": "مراجعة عملية للمنصة تشمل الوصول عبر الهاتف وشروط العروض ووضوح المدفوعات والفحوصات المهمة قبل إنشاء أي حساب على الإنترنت."
      },
      "blocks": [
        {
          "type": "hero",
          "props": {
            "title": "دليل الصفحة الرئيسية للقراء المهتمين",
            "subtitle": "ما الذي يجب التحقق منه قبل التعامل مع أي منصة على الإنترنت، بلغة واضحة ومباشرة."
          }
        },
        {
          "type": "richtext",
          "props": {
            "heading": "نظرة عامة",
            "paragraphs": [
              "تُراجَع المنصة عادةً من حيث سهولة الاستخدام على الهاتف وخطوات التسجيل ووضوح شروط الدفع قبل اتخاذ أي قرار.",
              "الصفحة المفيدة تشرح هذه الجوانب بوضوح وتضع حماية المستخدم والوعي القانوني في المقام الأول قبل أي شيء آخر."
            ]
          }
        },
        {
          "type": "faq",
          "props": {
            "items": [
              { "q": "ما هي هذه المنصة؟", "a": "علامة تجارية على الإنترنت يقارنها القراء من حيث سهولة الاستخدام وخطوات التسجيل ووضوح المدفوعات." },
              { "q": "هل تعمل على الهاتف؟", "a": "متصفح الهاتف هو نقطة الدخول الأكثر شيوعًا، لذلك تهم سرعة الصفحة ووضوح القوائم أكثر من غيرها." },
              { "q": "كيف تُقرأ العروض؟", "a": "اقرأ الشروط الكاملة: متطلبات المراهنة وتواريخ الانتهاء والأنشطة المؤهلة وحدود السحب المتاحة." },
              { "q": "أين توجد القواعد؟", "a": "يجب أن تشرح صفحات الشروط والخصوصية استخدام البيانات والتحقق والنزاعات وإغلاق الحساب." }
            ]
          }
        }
      ]
    }
  ]
}
```

- [ ] **Step 3: Добавить скрипт сборки примера**

В `package.json` добавить в `scripts`:

```json
    "build:example": "SITE_JSON=./examples/4p4p.net.json astro build"
```

- [ ] **Step 4: Написать приёмочный тест**

```ts
// tests/acceptance.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSite, readOutput } from './helpers/build';
import { buildTheme, hslCss, themeFingerprint } from '../src/theme';

let multiPage: string;
let rtl: string;

beforeAll(async () => {
  multiPage = await buildSite('./examples/example-guide.com.json');
  rtl = await buildSite('./examples/dalil-ar.net.json');
});

describe('multi-page sites', () => {
  it('renders the root page', () => {
    expect(readOutput(multiPage, 'index.html')).toContain('Example homepage guide for careful readers');
  });

  it('renders the nested page at its own path', () => {
    expect(readOutput(multiPage, 'safety/index.html')).toContain('Safety checklist before registering');
  });

  it('lists both pages in the sitemap', () => {
    const xml = readOutput(multiPage, 'sitemap.xml');
    expect(xml).toContain('<loc>https://example-guide.com/</loc>');
    expect(xml).toContain('<loc>https://example-guide.com/safety</loc>');
  });
});

describe('rtl locale', () => {
  it('sets dir and lang', () => {
    const html = readOutput(rtl, 'index.html');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar-AE"');
  });

  it('renders arabic content', () => {
    expect(readOutput(rtl, 'index.html')).toContain('دليل الصفحة الرئيسية للقراء المهتمين');
  });
});

describe('sites look different from each other', () => {
  it('uses different palettes for different domains', () => {
    const a = buildTheme('example-guide.com');
    const b = buildTheme('dalil-ar.net');
    expect(themeFingerprint(a)).not.toBe(themeFingerprint(b));

    expect(readOutput(multiPage, 'index.html')).toContain(hslCss(a.palette.primary));
    expect(readOutput(rtl, 'index.html')).toContain(hslCss(b.palette.primary));
  });
});

describe('rebuilds are stable', () => {
  it('produces identical html on a second build of the same config', async () => {
    const first = readOutput(multiPage, 'index.html');
    const second = readOutput(await buildSite('./examples/example-guide.com.json'), 'index.html');
    expect(second).toBe(first);
  });
});
```

- [ ] **Step 5: Запустить приёмочный тест**

Run: `pnpm vitest run tests/acceptance.test.ts`
Ожидаемо: PASS, 7 тестов. Три сборки, суммарно 30–90 секунд.

Если тест стабильности падает из-за отличающихся хешей в именах файлов — сравнивать не весь HTML, а его содержимое без атрибутов `href`/`src` со ссылками на ассеты:

```ts
    const strip = (input: string) => input.replace(/(href|src)="[^"]*\.(css|js)"/g, '$1="asset"');
    expect(strip(second)).toBe(strip(first));
```

- [ ] **Step 6: Написать README**

```markdown
# site-factory — ядро рендера

Превращает один файл контента в статический сайт.

## Требования

- Node.js >= 22.12.0
- pnpm

## Установка

    pnpm install

## Сборка сайта

    SITE_JSON=./examples/4p4p.net.json pnpm build

Результат — папка `dist/`. Другую папку можно задать через `OUT_DIR`.

## Тесты

    pnpm test        # весь набор
    pnpm typecheck   # проверка типов

## Как это устроено

- `src/schema` — контракт контента (Zod). Он же служит заданием для генератора текста.
- `src/theme` — чистые функции: имя домена -> палитра, шрифты, варианты секций, порядок блоков.
- `src/components/blocks` — блоки на Vue, рендерятся в HTML при сборке, без клиентского JS.
- `src/pages` — маршрут страниц, sitemap.xml, robots.txt.

Вся вариативность выводится из `hashDomain(domain)`, поэтому один и тот же домен всегда
собирается одинаково, а разные домены выглядят по-разному.

## Что дальше

Этап 2 добавляет слой общих настроек (`global.json`), обработку картинок и команду `make-site`.
Спек: `docs/specs/2026-09-01-site-factory-design.md`.
```

- [ ] **Step 7: Прогнать полный набор**

Run: `pnpm test && pnpm typecheck`
Ожидаемо: PASS, все тесты (около 60).

- [ ] **Step 8: Проверить критерии готовности этапа вручную**

Run: `SITE_JSON=./examples/dalil-ar.net.json OUT_DIR=./dist-ar pnpm build && open ./dist-ar/index.html`
Ожидаемо: страница открывается в браузере, читается справа налево, текст контрастный, вёрстка не разъезжается при сужении окна до 375px.

---

## Критерии готовности этапа 1

- `pnpm test` проходит целиком.
- `SITE_JSON=<файл> pnpm build` собирает сайт из любого валидного конфига.
- Битый конфиг отклоняется с указанием точного пути до поля.
- Три примера с разными локалями (включая RTL) собираются и открываются.
- Тема детерминирована по домену; на выборке из 50 доменов не менее 45 различимых обликов.
- Контраст текста к фону не ниже 4.5:1 на выборке из 200 доменов.
- В выходном HTML нет подключённых JS-бандлов.
