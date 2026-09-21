import { describe, it, expect, afterEach } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSite } from '../factory/texts/generate-site.mjs';
import { truncated } from './helpers/openai.mjs';

const SENTINEL = 'sentinel-openai-key-site-run-6e12';
const CONFIG = {
  apiKey: SENTINEL,
  apiKeyInvalid: false,
  apiUrl: 'https://openai.test/v1/responses',
  model: 'gpt-5.6-luna',
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

// The folder's own name is the seed every page's example is drawn with, so a test that cares which
// one gets drawn says which folder it is building into.
function siteDir(name = 'newsite') {
  const dir = mkdtempSync(join(tmpdir(), 'site-factory-generate-site-'));
  dirs.push(dir);
  return join(dir, name);
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
function fakeOpenAi({
  failPlanFor = '',
  failFaq = false,
  failFirstSection = false,
  emptyFirstSection = false,
  heroImageName = '',
} = {}) {
  const asked = [];
  let sectionCalls = 0;
  const fetchFn = async (_url, init) => {
    const body = JSON.parse(init.body);
    const name = body.text.format.name;
    asked.push(name);
    if (name === 'faq_answers' && failFaq) return truncated();
    // Once per run, not once per page: the tests that count what a run cost assume exactly one
    // spoiled call, and the one that reads a written page reads the first page generated.
    const forSection1 =
      name === 'section_content' &&
      /Section heading: Section 1$/m.test(String(body.input[0].content)) &&
      sectionCalls === 0;
    if (forSection1 && (failFirstSection || emptyFirstSection)) {
      sectionCalls += 1;
      return failFirstSection ? truncated() : reply({ items: [] });
    }
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
      // One array per kind of content block, each with its own list of what may go inside it —
      // read off the schema the way a real model would, so a fake cannot know more than it is told.
      const byType = body.text.format.schema.properties.blocks.properties;
      const faq = body.text.format.schema.properties.faq.minItems;
      return reply({
        title: 'T', description: 'D', h1: 'H', heroText: ['Hero.'],
        // One name per picture the layout has, read off the schema the way a real model would —
        // not off what this fake happens to know. A regression that stops the layout's pictures
        // from reaching the schema then shows up as a missing picture, not as a suspiciously
        // well-informed fake that names one anyway.
        images: Array.from(
          { length: body.text.format.schema.properties.images.minItems },
          (_, index) => (heroImageName && index === 0 ? heroImageName : `picture-${index + 1}`),
        ),
        blocks: Object.fromEntries(
          Object.entries(byType).map(([type, list]) => [
            type,
            Array.from({ length: list.minItems }, (_, index) => ({
              heading: type === 'section' ? `Section ${index + 1}` : `${type} ${index + 1}`,
              brief: 'b',
              links: [],
            })),
          ]),
        ),
        faq: Array.from({ length: faq }, (_, index) => `Question ${index + 1}?`),
      });
    }
    if (name === 'faq_answers') {
      const count = body.text.format.schema.properties.answers.minItems;
      return reply({ answers: Array.from({ length: count }, () => 'An answer.') });
    }
    // section_content, the generic case. One item per element the brief asked for, in that order —
    // the way a model given "write these elements, in this order" behaves. Answering with one
    // paragraph whatever was asked would make every test about composition test this fake instead.
    const wanted = (String(body.input[0].content).match(/Write these elements, in this order: (.*)$/m)?.[1] ?? '')
      .split(', ')
      .filter(Boolean);
    const CANNED = {
      text: { kind: 'text', text: 'Body text of the section.' },
      title: { kind: 'title', level: 'h3', text: 'A subheading.' },
      list: { kind: 'list', items: ['One', 'Two', 'Three'] },
      table: { kind: 'table', columns: ['A', 'B'], rows: [['1', '2']] },
      cards: { kind: 'cards', cards: [{ title: 'Card', text: 'Card text.' }] },
      steps: { kind: 'steps', items: [{ title: 'Step', text: 'how to' }] },
      line: { kind: 'line' },
      buttons: { kind: 'buttons', items: [{ text: 'Open', href: null }] },
      info: { kind: 'info', items: ['Claim one', 'Claim two', 'Claim three'] },
    };
    const items = wanted.map((kind) => CANNED[kind]).filter(Boolean);
    return reply({ items: items.length > 0 ? items : [CANNED.text] });
  };
  return { fetchFn, asked };
}

// The pieces an example page is written out of, in the content format rowsToPage produces.
const h1 = (words = 'Заголовок страницы') => ({ type: 'title', h1: words });
const h2 = (words) => ({ type: 'title', h2: words });
const para = (words = 'Абзац примера, достаточно длинный чтобы быть похожим на правду.') => ({ type: 'text', text: words });
const PIECE = {
  text: para(),
  list: { type: 'list', items: ['Раз', 'Два', 'Три'] },
  table: { type: 'table', columns: ['A', 'B'], rows: [['1', '2'], ['3', '4']] },
  cards: { type: 'cards', items: [{ title: 'Карточка', text: 'Текст' }, { title: 'Ещё', text: 'Текст' }] },
  steps: { type: 'steps', items: [{ title: 'Шаг', text: 'как' }] },
  line: { type: 'line' },
  buttons: { type: 'buttons', items: [{ text: 'Открыть' }] },
  info: { type: 'info', items: ['Раз', 'Два', 'Три'] },
};
const section = (n, kinds = ['text']) => ({
  type: 'section',
  content: [h2(`Раздел ${n}`), ...kinds.map((kind) => PIECE[kind])],
});
const half = (type, n) => ({ type, content: [h2(`Половина ${n}`), para(), PIECE.buttons] });
const examplePage = (blocks) => ({ title: 'Заголовок примера', description: 'Описание примера.', blocks });

// Close enough to the supplied examples to be worth testing against — a first screen, a contents,
// a run of sections, the service blocks — and short enough not to pay for nine fills per page.
const DEFAULT_EXAMPLE = examplePage([
  { type: 'hero', content: [h1(), para()] },
  { type: 'toc', content: [h2('Содержание'), PIECE.list] },
  ...Array.from({ length: 9 }, (_, index) => section(index + 1)),
  { type: 'links', content: [h2('Другие страницы')] },
  {
    type: 'faq',
    content: [h2('Вопросы'), ...Array.from({ length: 5 }, (_, i) => ({ type: 'toggle', title: `Вопрос ${i + 1}?`, text: 'Ответ.' }))],
  },
]);

// A templates root of this file's own. Every run here uses one, because templates/review/examples
// belongs to the owner: they add an example and every seeded choice in this file moves, so a suite
// that read it would go red on a change that broke nothing. It happened once already, with layouts.
// The manifest is copied from the real theme rather than invented: what the theme can draw is the
// theme's own fact, and a test that made it up could pass against a vocabulary nothing supports.
function templateRootWith(pages = {}, pictures = { hero: 'after-text' }) {
  const root = mkdtempSync(join(tmpdir(), 'site-factory-template-'));
  dirs.push(root);
  const dir = join(root, 'templates', 'review');
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(process.cwd(), 'templates', 'review', 'manifest.json'), join(dir, 'manifest.json'));
  writeFileSync(
    join(dir, 'pictures.json'),
    JSON.stringify({ pictures, links: { perBlock: [0, 2], perPage: [0, 8] } }),
  );
  for (const page of PAGES) {
    const address = join(dir, 'examples', page);
    mkdirSync(address, { recursive: true });
    // One page may have several examples — that is the ordinary case, four source sites per page —
    // so a value here is either the one example or a { имя: пример } map of them.
    const one = pages[page] ?? DEFAULT_EXAMPLE;
    const many = Array.isArray(one.blocks) ? { 1: one } : one;
    for (const [name, example] of Object.entries(many)) {
      writeFileSync(join(address, `${name}.json`), JSON.stringify(example));
    }
  }
  return root;
}

// Every page of the site built from the same example, so a test that writes one shape gets it.
const everyPage = (page, pictures) => ({ root: templateRootWith({ home: page, casino: page }, pictures) });

const run = (dir, overrides = {}) => {
  const lines = [];
  return generateSite({
    siteDir: dir, templateId: 'review', brand: 'Acme', geo: 'Bangladesh', locale: '',
    pages: PAGES, config: CONFIG, root: templateRootWith(),
    promptFile: join('factory', 'prompts', 'texts.json'),
    geosFile: join('factory', 'geos.json'),
    sleep: async () => {}, log: (line) => lines.push(line),
    ...overrides,
  }).then((summary) => ({ summary, lines }));
};

describe('generateSite', () => {
  it('writes a page file per page, plus site.json', async () => {
    const dir = siteDir();
    const { summary, lines } = await run(dir, fakeOpenAi());
    expect(summary.written.sort()).toEqual(['casino.json', 'home.json', 'site.json']);
    expect(existsSync(join(dir, 'home.json'))).toBe(true);
    const page = JSON.parse(readFileSync(join(dir, 'casino.json'), 'utf8'));
    expect(page.blocks[0].type).toBe('hero');
    expect(page.blocks.at(-1).type).toBe('faq');
    const site = JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8'));
    expect(site.nav).toEqual([{ label: 'Page 1', href: '/casino' }]);
    // Two pages were written (home, casino) — site.json is the frame, not a third page.
    expect(lines.join('\n')).toContain('страниц 2');
  });

  it('takes the language from the geo when the form left it empty', async () => {
    const dir = siteDir();
    await run(dir, fakeOpenAi());
    expect(JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8')).locale).toBe('en-US');
  });

  // The geo table itself now comes from factory/geos.mjs/geos.json (see tests/geos.test.mjs) —
  // this is the end-to-end proof that the texts stage still resolves a language through it, and
  // that a geo the table does not know still degrades to English instead of stopping the run.
  it('falls back to English and logs it when the geo is unknown', async () => {
    const dir = siteDir();
    const { lines } = await run(dir, { ...fakeOpenAi(), geo: 'Atlantis' });
    expect(JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8')).locale).toBe('en-US');
    expect(lines.join('\n')).toContain('незнакомое');
  });

  it('reports what the run cost', async () => {
    const dir = siteDir();
    const { summary, lines } = await run(dir, fakeOpenAi());
    expect(summary.cost).toBeGreaterThan(0);
    expect(lines.join('\n')).toMatch(/\$\d+\.\d{4}/);
  });

  // End to end: a picture the plan named reaches the written page, in the block whose nature
  // carries one and in no other. The name is still the model's to choose — it is the only thing
  // about a picture that carries meaning further down the pipeline — but where it goes, and how
  // many there are, stopped being anybody's choice the moment layouts existed.
  it('carries the picture the plan named all the way into the written page', async () => {
    const dir = siteDir();
    const IMAGE_NAME = 'roulette-table-close-up';
    await run(dir, fakeOpenAi({ heroImageName: IMAGE_NAME }));
    // Every page, not one lucky one: the picture is there because the block carries it by nature,
    // so there is no budget left to roll and nothing to lose it to.
    for (const name of PAGES) {
      const page = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
      expect(page.blocks[0].content).toContainEqual({ image: IMAGE_NAME });
      const elsewhere = page.blocks.slice(1);
      expect(JSON.stringify(elsewhere)).not.toContain(IMAGE_NAME);
    }
  });

  // Пример назван в строке готовности страницы, чтобы по логу было видно, с какого он сайта.
  it('names the example each page was built from', async () => {
    const dir = siteDir();
    const { lines } = await run(dir, fakeOpenAi());
    expect(lines.find((line) => line.includes('home.json готова'))).toMatch(/пример «1»/);
  });

  // A section that comes back truncated still ran the model and still cost money — that attempt's
  // price must land in the run's total even though the section itself contributed nothing.
  it("adds a truncated section's cost to the run's total, not just the sections that succeeded", async () => {
    const dir = siteDir();
    const fake = fakeOpenAi({ failFirstSection: true });
    const { summary } = await run(dir, fake);
    // Every call in this fake's fetchFn answers through reply(), with the same fixed usage, except
    // the one section_content call that failFirstSection turns into a bare truncated() — so the
    // total is exactly "every other call, priced as usual" plus "one truncated call, priced from
    // its own usage counters". If the fix regressed to dropping the failed attempt's cost, this
    // would come up short by exactly that second term.
    const costPerReply = (100 * 0.2 + 900 * 0.02 + 100 * 1.2) / 1e6;
    const costPerTruncated = (1000 * 0.2 + 100 * 1.2) / 1e6;
    const successfulCalls = fake.asked.length - 1;
    expect(summary.cost).toBeCloseTo(successfulCalls * costPerReply + costPerTruncated, 10);
  });

  // Same reasoning one level up: the site-frame catch used to log and return without adding what
  // a failed attempt cost to summary.cost, unlike the page-level catch below it in
  // generate-site.mjs, which already does. A truncated frame still ran the model and still cost
  // money — and since the frame is the very first request of the run, nothing else is ever asked
  // for, so the whole total should be exactly this one call's cost, not zero.
  it("adds a truncated site frame's cost to the run's total, instead of a silent zero", async () => {
    const dir = siteDir();
    const { summary, lines } = await run(dir, { fetchFn: async () => truncated() });
    const costPerTruncated = (1000 * 0.2 + 100 * 1.2) / 1e6;
    expect(summary.written).toEqual([]);
    expect(summary.cost).toBeCloseTo(costPerTruncated, 10);
    expect(lines.join('\n')).toContain('кадр сайта не получился');
  });

  // siteDir() always ends in the same leaf name ("newsite"), and the skeleton is seeded from that
  // leaf name alone — so two independent runs below roll the exact same section counts, and the
  // only difference between them is the one section this test makes fail.
  it('drops a section that never came out, so the contents list and the body agree', async () => {
    const baseDir = siteDir();
    await run(baseDir, fakeOpenAi());
    const basePage = JSON.parse(readFileSync(join(baseDir, 'home.json'), 'utf8'));
    const baseSectionCount = basePage.blocks.filter((block) => block.type === 'section').length;
    // Measured against the same page built without the failure, not against a count of what the
    // shipped layout happens to hold: the contents lists every headed block, and which other kinds
    // a layout carries beside its sections is the owner's to change.
    const baseTocCount = basePage.blocks
      .find((block) => block.type === 'toc')
      .content.find((item) => item.type === 'list').items.length;

    const dir = siteDir();
    await run(dir, fakeOpenAi({ failFirstSection: true }));
    const page = JSON.parse(readFileSync(join(dir, 'home.json'), 'utf8'));
    const sectionBlocks = page.blocks.filter((block) => block.type === 'section');
    const tocList = page.blocks.find((block) => block.type === 'toc').content.find((item) => item.type === 'list');

    // One fewer section, and the contents list shrank with it — never one without the other.
    expect(sectionBlocks).toHaveLength(baseSectionCount - 1);
    expect(tocList.items).toHaveLength(baseTocCount - 1);
    // The FAQ is a headed block too, so it closes the list: the contents is a map of the page, not
    // a list of its sections.
    expect(tocList.items.at(-1)).toBe('Questions');
    // The failed section was "Section 1" (the plan's first) — its heading must be gone entirely,
    // not left behind as a contents entry with nothing under it.
    expect(tocList.items).not.toContain('Section 1');
    for (const block of sectionBlocks) {
      expect(block.content.length).toBeGreaterThan(1); // heading plus at least one real item
    }
  });

  // Finding 5: sectionSchema sets no minItems on `items`, so `{"items": []}` is a valid, successful
  // answer — not a failure — yet it used to be dropped exactly like a failed section, with no log
  // line at all, as if nothing had happened. It must be logged the same way a failed section is.
  it('logs a section that came back empty even though the request itself succeeded', async () => {
    const dir = siteDir();
    const { summary, lines } = await run(dir, fakeOpenAi({ emptyFirstSection: true }));
    expect(summary.written).toContain('home.json');
    const page = JSON.parse(readFileSync(join(dir, 'home.json'), 'utf8'));
    const tocList = page.blocks.find((block) => block.type === 'toc').content.find((item) => item.type === 'list');
    // Empty, so dropped from the contents just like a failed section — but this path must say why.
    expect(tocList.items).not.toContain('Section 1');
    expect(lines.join('\n')).toMatch(/раздел.*Section 1.*пуст/i);
  });

  // A run that stopped halfway must carry on, not start over and pay twice.
  it('skips pages that are already on disk', async () => {
    const dir = siteDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'home.json'), JSON.stringify({ title: 'Mine', blocks: [] }));
    const fake = fakeOpenAi();
    const { summary } = await run(dir, fake);
    expect(summary.skipped).toContain('home.json');
    expect(JSON.parse(readFileSync(join(dir, 'home.json'), 'utf8')).title).toBe('Mine');
    expect(summary.written).toContain('casino.json');
    // Not paying twice means never asking: only casino, the page genuinely missing, should ever
    // reach a page_plan request. Without the existsSync guard, home would be re-planned too.
    expect(fake.asked.filter((name) => name === 'page_plan')).toEqual(['page_plan']);
  });

  // One page failing is one page missing, not a lost run.
  it('keeps the other pages when one of them fails', async () => {
    const dir = siteDir();
    const { summary, lines } = await run(dir, fakeOpenAi({ failPlanFor: 'casino' }));
    expect(summary.written).toContain('home.json');
    expect(summary.written).not.toContain('casino.json');
    expect(lines.join('\n')).toContain('casino');
    // A failed request costs nothing — OpenAiError carries no cost — so this only shows that the
    // frame and the home page that did succeed were billed, not that the failed casino plan was.
    expect(summary.cost).toBeGreaterThan(0);
  });

  // The FAQ request sits inside the same page-level try as every section above it. Unlike the
  // per-section loop, it used to have no catch of its own, so its failure escaped to the page-level
  // catch and threw away every section that had already been filled and paid for.
  it('keeps the page and its paid-for sections when only the FAQ fails', async () => {
    const dir = siteDir();
    const { summary, lines } = await run(dir, fakeOpenAi({ failFaq: true }));
    expect(summary.written).toEqual(expect.arrayContaining(['home.json', 'casino.json', 'site.json']));
    const page = JSON.parse(readFileSync(join(dir, 'home.json'), 'utf8'));
    // The sections' prose is the money already spent — proof it was not thrown away with the FAQ.
    expect(JSON.stringify(page)).toContain('Body text of the section.');
    // No FAQ block at all rather than a heading with nothing under it: a block with nothing to
    // show is dropped, and its contents entry goes with it, the same as a section that never came.
    expect(page.blocks.find((block) => block.type === 'faq')).toBeUndefined();
    const tocList = page.blocks.find((block) => block.type === 'toc').content.find((item) => item.type === 'list');
    expect(tocList.items).not.toContain('Questions');
    expect(lines.join('\n')).toMatch(/home\.json: FAQ не вышел/);
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
    // Only the frame was written, zero pages — the summary line must say so, not count site.json
    // as if it were a page.
    expect(lines.join('\n')).toContain('страниц 0');
    expect(lines.join('\n')).toContain('остановлен');
    // The frame, then one page that failed — never a second attempt at the same wall.
    expect(calls).toBe(2);
  });

  // Finding 4: site.json is written first, from the full requested page list, so its menu links to
  // every page the owner asked for — including ones a stopped run never got to. The menu is never
  // pruned (a re-run fills the gap), but the log must say, once, which pages it is leaving dangling.
  it('logs which requested pages still have no file when the run stops early', async () => {
    const dir = siteDir();
    const { summary, lines } = await run(dir, {
      fetchFn: async (_url, init) => {
        const body = JSON.parse(init.body);
        if (body.text.format.name === 'site_frame') {
          return reply({
            tagline: 't', navLabels: ['Casino'],
            footer: { ageWarning: '18+', ageText: 'a', quickLinksTitle: 'L', paymentsTitle: 'P', copyright: 'c' },
            blockLabels: { toc: 'C', links: 'O', faq: 'Q' },
          });
        }
        return new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'no funds' } }), { status: 429 });
      },
    });
    // Neither requested page ever got a file — site.json's menu still points at both.
    expect(summary.written).toEqual(['site.json']);
    const log = lines.join('\n');
    expect(log).toContain('home');
    expect(log).toContain('casino');
    // Naming the pages is not enough on its own: the line has to actually say the menu is the thing
    // pointing at them, not just list two page names that could be mistaken for something else.
    expect(log).toMatch(/меню/i);
  });

  // The balance test above only ever fails at the plan stage; this is the same wall hit one level
  // down, inside the per-section loop, which needs its own rethrow to stop the run just as promptly.
  it('stops the run when the balance runs out during a section, not just during planning', async () => {
    const dir = siteDir();
    const fake = fakeOpenAi();
    let calls = 0;
    let sectionCalls = 0;
    const { summary, lines } = await run(dir, {
      fetchFn: async (url, init) => {
        calls += 1;
        const name = JSON.parse(init.body).text.format.name;
        if (name === 'section_content') {
          sectionCalls += 1;
          // Only the first section-fill request hits the wall; if the rethrow were missing, later
          // sections (and later pages) would each try and fail again instead of the run stopping.
          if (sectionCalls === 1) {
            return new Response(
              JSON.stringify({ error: { code: 'insufficient_quota', message: 'no funds' } }),
              { status: 429 },
            );
          }
        }
        return fake.fetchFn(url, init);
      },
    });
    expect(summary.written).toEqual(['site.json']);
    expect(lines.join('\n')).toContain('остановлен');
    // Frame, plan, first section — never a second section or a second page.
    expect(calls).toBe(3);
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

  // Same free-check treatment as the template above: a geos.json that cannot be read is caught
  // before the first paid request, not partway through the run.
  it('refuses when the geos file cannot be read, without spending anything', async () => {
    const dir = siteDir();
    const fake = fakeOpenAi();
    const missingGeosFile = join(dir, 'no-such-geos.json');
    const { summary, lines } = await run(dir, { ...fake, geosFile: missingGeosFile });
    expect(fake.asked).toEqual([]);
    expect(summary.cost).toBe(0);
    expect(lines.join('\n')).toContain('гео');
    expect(existsSync(dir)).toBe(false);
  });
});

describe('the example decides what goes inside a block', () => {
  // The change v2 is for. The model used to be asked which elements a section should hold, and
  // could answer anything the theme allowed. Now the example says, element by element, and the
  // question is not in the request at all — checked through the request the model actually
  // receives, because an answer nobody reads is output paid for.
  it('never asks the model what goes inside a block', async () => {
    const dir = siteDir();
    const fake = fakeOpenAi();
    const asked = [];
    const fetchFn = async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.text.format.name === 'page_plan') asked.push(body.text.format.schema.properties.blocks.properties);
      return fake.fetchFn(url, init);
    };
    await run(dir, { fetchFn, ...everyPage(examplePage([
      { type: 'hero', content: [h1(), para()] },
      section(1, ['text', 'list', 'cards']),
      { type: 'faq', content: [h2('Вопросы'), { type: 'toggle', title: 'В?', text: 'О.' }] },
    ])) });

    expect(asked.length).toBeGreaterThan(0);
    for (const byType of asked) {
      expect(byType.section.items.properties).not.toHaveProperty('elements');
      // The rest of the question stands: what the block is about is still the model's to write.
      expect(byType.section.items.properties).toHaveProperty('heading');
    }
  });

  // The end the whole mechanism exists for: SEO hands over a page, and the page comes out in that
  // shape. Checked through the written file rather than through the request, because "the shape of
  // the example" is a fact about the page, not about what was asked.
  it('builds each block in the order the example had, element for element', async () => {
    const dir = siteDir();
    await run(dir, { ...fakeOpenAi(), ...everyPage(examplePage([
      { type: 'hero', content: [h1(), para()] },
      { type: 'toc', content: [h2('Содержание'), PIECE.list] },
      section(1, ['text', 'list', 'cards']),
      section(2, ['text', 'text', 'text', 'list', 'line', 'buttons']),
      { type: 'links', content: [h2('Другие страницы')] },
      { type: 'faq', content: [h2('Вопросы'), { type: 'toggle', title: 'В?', text: 'О.' }] },
    ])) });

    const page = JSON.parse(readFileSync(join(dir, 'home.json'), 'utf8'));
    const sections = page.blocks.filter((block) => block.type === 'section');
    expect(sections).toHaveLength(2);
    // The h2 the factory writes, then exactly what the example held, in that order.
    expect(sections[0].content.map((item) => item.type)).toEqual(['title', 'text', 'list', 'cards']);
    expect(sections[1].content.map((item) => item.type)).toEqual([
      'title', 'text', 'text', 'text', 'list', 'line', 'buttons',
    ]);
  });

  // The example's own item counts reach the page, section by section: this is the whole of what a
  // block's counts are for, and they are not the theme's and not the page's but the block's.
  it("cuts a list back to what the example's own block held", async () => {
    const dir = siteDir();
    const fake = fakeOpenAi();
    const fetchFn = async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.text.format.name !== 'section_content') return fake.fetchFn(url, init);
      return reply({ items: [{ kind: 'list', items: ['1', '2', '3', '4', '5', '6', '7', '8'] }] });
    };
    await run(dir, { fetchFn, ...everyPage(examplePage([
      { type: 'hero', content: [h1(), para()] },
      { type: 'section', content: [h2('Раздел'), { type: 'list', items: ['Раз', 'Два'] }] },
      { type: 'faq', content: [h2('Вопросы'), { type: 'toggle', title: 'В?', text: 'О.' }] },
    ])) });

    const page = JSON.parse(readFileSync(join(dir, 'home.json'), 'utf8'));
    const list = page.blocks.find((block) => block.type === 'section').content[1];
    expect(list.items).toEqual(['1', '2']);
  });

  it('refuses an example holding an element the theme cannot draw, before paying for anything', async () => {
    const dir = siteDir();
    const { lines } = await run(dir, { ...fakeOpenAi(), ...everyPage(examplePage([
      { type: 'hero', content: [h1(), para()] },
      { type: 'section', content: [h2('Раздел'), { type: 'video', src: 'х' }] },
      { type: 'faq', content: [h2('Вопросы'), { type: 'toggle', title: 'В?', text: 'О.' }] },
    ])) });
    expect(lines.join('\n')).toContain('video');
    expect(existsSync(join(dir, 'home.json'))).toBe(false);
  });
});

describe('every page is built from its own example', () => {
  // The seeded choice has to reach the frame, not just the log line. With one example per page the
  // two cannot disagree; with two, taking the first instead of the chosen one builds a page of the
  // wrong shape while still reporting the right name.
  it('builds the page from the example it says it built it from', async () => {
    // "site2" rather than the usual name because its seed draws neither page's first example —
    // with the first one drawn, taking the first instead of the chosen one is invisible, which is
    // exactly how this test passed against the mutation it was written to catch.
    const dir = siteDir('site2');
    // Four examples per page, as the supplied ones are, each a different length, so which one was
    // used is readable off the built page.
    const sized = (howMany) => examplePage([
      { type: 'hero', content: [h1(), para()] },
      ...Array.from({ length: howMany }, (_, index) => section(index + 1)),
      { type: 'faq', content: [h2('Вопросы'), { type: 'toggle', title: 'В?', text: 'О.' }] },
    ]);
    const four = { 1: sized(1), 2: sized(2), 3: sized(3), 4: sized(4) };
    await run(dir, { ...fakeOpenAi(), root: templateRootWith({ home: four, casino: four }) });

    for (const address of PAGES) {
      const page = JSON.parse(readFileSync(join(dir, `${address}.json`), 'utf8'));
      const sections = page.blocks.filter((block) => block.type === 'section').length;
      // The example's name is how many sections it has, so the page and its record must agree.
      expect(`${address}/${sections}`).toBe(page.example);
    }
  });

  // The instructions are the expensive part of every request, and they are this page's examples.
  // One set for the whole run would describe casino's page with home's examples — the v1 behaviour,
  // correct then and wrong now.
  it("sends each page its own examples, not the first page's", async () => {
    const dir = siteDir();
    const fake = fakeOpenAi();
    const seen = new Map();
    const fetchFn = async (url, init) => {
      const body = JSON.parse(init.body);
      const page = /^Page: (.+)$/m.exec(String(body.input[0].content))?.[1];
      if (page) seen.set(page, String(body.instructions));
      return fake.fetchFn(url, init);
    };
    const mark = (word) => examplePage([
      { type: 'hero', content: [h1(word), para()] },
      section(1),
      { type: 'faq', content: [h2('Вопросы'), { type: 'toggle', title: 'В?', text: 'О.' }] },
    ]);
    await run(dir, { fetchFn, root: templateRootWith({ home: mark('ГЛАВНАЯ'), casino: mark('КАЗИНО') }) });

    expect(seen.get('home')).toContain('ГЛАВНАЯ');
    expect(seen.get('home')).not.toContain('КАЗИНО');
    expect(seen.get('casino')).toContain('КАЗИНО');
  });

  // The cache is keyed per page for the same reason: two pages sharing a key would evict each
  // other's entry on every request, and every request of the run would pay full price.
  it('gives every page its own cache key', async () => {
    const dir = siteDir();
    const fake = fakeOpenAi();
    const byPage = new Map();
    const fetchFn = async (url, init) => {
      const body = JSON.parse(init.body);
      const page = /^Page: (.+)$/m.exec(String(body.input[0].content))?.[1];
      if (page && body.prompt_cache_key) {
        if (!byPage.has(page)) byPage.set(page, new Set());
        byPage.get(page).add(body.prompt_cache_key);
      }
      return fake.fetchFn(url, init);
    };
    await run(dir, { fetchFn });

    const home = byPage.get('home');
    expect(home.size).toBeGreaterThan(0);
    for (const key of home) expect(key).toContain('home');
    // Not one key shared by both: that is the whole point.
    for (const key of byPage.get('casino') ?? []) expect(home.has(key)).toBe(false);
  });

  // How many items a collection holds cannot be pinned by the schema — strict mode counts elements,
  // not what is inside the third of them — so it is asked for in words, from the example's own block.
  it("tells each section how long the example's own lists were", async () => {
    const dir = siteDir();
    const fake = fakeOpenAi();
    const briefs = [];
    const fetchFn = async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.text.format.name === 'section_content') briefs.push(String(body.input[0].content));
      return fake.fetchFn(url, init);
    };
    await run(dir, { fetchFn, ...everyPage(examplePage([
      { type: 'hero', content: [h1(), para()] },
      { type: 'section', content: [h2('Раздел'), { type: 'list', items: ['Раз', 'Два', 'Три', 'Четыре', 'Пять'] }] },
      { type: 'faq', content: [h2('Вопросы'), { type: 'toggle', title: 'В?', text: 'О.' }] },
    ])) });

    expect(briefs.length).toBeGreaterThan(0);
    expect(briefs.some((brief) => /How many items each holds: list 5/.test(brief))).toBe(true);
  });

  // Lengths are measured off the example too, and they are only ever reported — but a report that
  // never fires is the same as none, so it is checked where it must fire: an example of very short
  // paragraphs and an answer that is not.
  it("measures a paragraph against the example's own paragraphs", async () => {
    const dir = siteDir();
    const terse = { type: 'text', text: 'Коротко.' };
    const { lines } = await run(dir, { ...fakeOpenAi(), ...everyPage(examplePage([
      { type: 'hero', content: [h1(), terse] },
      { type: 'section', content: [h2('Раздел'), terse] },
      { type: 'faq', content: [h2('Вопросы'), { type: 'toggle', title: 'В?', text: 'О.' }] },
    ])) });

    expect(lines.join('\n')).toMatch(/text абзаца: \d+ знаков вместо 8/);
  });
});

describe('a page made of more than one kind of block', () => {
  // The whole reason the plan is keyed by kind rather than holding one list of "sections". Two
  // kinds are two different questions, and a page that holds both must plan for both — a shared
  // list would describe eleven interchangeable blocks where there are nine of one and two of another.
  it('asks for each kind separately, counting each', async () => {
    const dir = siteDir();
    const fake = fakeOpenAi();
    let byType;
    const fetchFn = async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.text.format.name === 'page_plan') byType = body.text.format.schema.properties.blocks.properties;
      return fake.fetchFn(url, init);
    };
    await run(dir, { fetchFn, ...everyPage(examplePage([
      { type: 'hero', content: [h1(), para()] },
      { type: 'toc', content: [h2('Содержание'), PIECE.list] },
      section(1), section(2),
      half('split', 1), half('split-left', 2),
      { type: 'links', content: [h2('Другие страницы')] },
      { type: 'faq', content: [h2('Вопросы'), { type: 'toggle', title: 'В?', text: 'О.' }] },
    ])) });

    // The first screen is among them: it is a block the model writes, like the rest.
    expect(Object.keys(byType).sort()).toEqual(['hero', 'section', 'split', 'split-left']);
    expect(byType.section.minItems).toBe(2);
    expect(byType.split.minItems).toBe(1);
  });

  it('builds every kind the example had, in the order the example gave', async () => {
    const dir = siteDir();
    await run(dir, { ...fakeOpenAi(), ...everyPage(examplePage([
      { type: 'hero', content: [h1(), para()] },
      { type: 'toc', content: [h2('Содержание'), PIECE.list] },
      section(1),
      half('split', 1), half('split-left', 2),
      { type: 'links', content: [h2('Другие страницы')] },
      { type: 'faq', content: [h2('Вопросы'), { type: 'toggle', title: 'В?', text: 'О.' }] },
    ]), { hero: 'after-text', split: true, 'split-left': true }) });
    const page = JSON.parse(readFileSync(join(dir, 'home.json'), 'utf8'));
    expect(page.blocks.map((block) => block.type)).toEqual([
      'hero', 'toc', 'section', 'split', 'split-left', 'links', 'faq',
    ]);
    // One picture per block the theme puts one in: the first screen and both halves.
    expect((JSON.stringify(page).match(/"image":/g) ?? [])).toHaveLength(3);
  });
});

describe('a generated folder builds', () => {
  it('passes a real Astro build', async () => {
    const dir = siteDir();
    const IMAGE_NAME = 'lobby-shot';
    await run(dir, fakeOpenAi({ heroImageName: IMAGE_NAME }));

    // The picture stage runs after this one and is what normally writes these; standing in for it
    // here is what makes the <img> tags below reachable at all. Without them normalisation drops
    // every picture as undeclared, and "one picture, in the first screen" could only ever be checked
    // against the JSON — never against the page a reader actually gets.
    const publicDir = join(dir, 'public');
    mkdirSync(join(publicDir, 'images'), { recursive: true });
    writeFileSync(join(publicDir, 'images', `${IMAGE_NAME}.webp`), '');
    writeFileSync(
      join(dir, 'images.json'),
      JSON.stringify({ [IMAGE_NAME]: { src: `/images/${IMAGE_NAME}.webp`, alt: 'Лобби', width: 1200, height: 675 } }),
    );

    const { execFileSync } = await import('node:child_process');
    const out = join(dir, '..', 'out');
    execFileSync(join('node_modules', '.bin', 'astro'), ['build'], {
      env: { ...process.env, SITE_DIR: dir, PUBLIC_DIR: publicDir, TEMPLATE: 'review', SCHEME: 'dark', OUT_DIR: out, SITE_URL: 'https://example.com' },
      stdio: 'pipe',
    });
    expect(existsSync(join(out, 'index.html'))).toBe(true);
    const html = readFileSync(join(out, 'casino', 'index.html'), 'utf8');
    // 'Section 1' is a heading from the plan, kept only because this fake never fails a section —
    // a section whose fill fails is dropped entirely (see "drops a section that never came out"
    // above), heading and all. The body text only lands here if the fill actually delivered prose,
    // which is the real proof that this build holds a site, not merely a page of empty headings.
    expect(html).toContain('Section 1');
    expect(html).toContain('Body text of the section.');

    // The example is recorded in every page file, and must stay there: src/lib/site-dir.mjs reads a
    // page by title, description and blocks, so the field is inert by construction. Inert by
    // construction is still worth holding to account — a leak into a built page would be silent,
    // and this is the one test in the suite that runs the engine end to end against real output.
    expect(JSON.parse(readFileSync(join(dir, 'casino.json'), 'utf8')).example).toBe('casino/1');
    expect(html).not.toContain('"example"');
    expect(readFileSync(join(out, 'index.html'), 'utf8')).not.toContain('"example"');

    // The picture belongs to the first screen and to nothing else — checked in the delivered HTML,
    // not in the JSON, because "one picture" is a promise about the page a reader gets. A card that
    // repeated an already-declared name used to make this ten (see schema.mjs on cards).
    const imgTags = html.match(/<img\b/g) ?? [];
    expect(imgTags).toHaveLength(1);
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('<h2'));

    // Every contents entry reaches a heading that really is on the page. This is the coupling the
    // whole anchors module exists for, and the one the FAQ's arrival in the contents broke — worth
    // holding to account against real ids rather than against a shape in memory.
    const anchors = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const hrefs = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(1);
    for (const href of hrefs) expect(anchors.has(href)).toBe(true);
    // The FAQ is one of them now, and it is last: the contents is a map of the page, not a list of
    // its sections.
    expect(hrefs.at(-1)).toBe('questions');
  }, 120_000);
});
