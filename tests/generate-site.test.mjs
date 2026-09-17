import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
function fakeOpenAi({ failPlanFor = '', failFaq = false } = {}) {
  const asked = [];
  const fetchFn = async (_url, init) => {
    const body = JSON.parse(init.body);
    const name = body.text.format.name;
    asked.push(name);
    if (name === 'faq_answers' && failFaq) return truncated();
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
    const faqBlock = page.blocks.find((block) => block.type === 'faq');
    expect(faqBlock.content).toHaveLength(1); // just the heading — no question made it in
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
    const html = readFileSync(join(out, 'casino', 'index.html'), 'utf8');
    // 'Section 1' is a heading from the plan alone — assemblePage writes it (and the section's
    // contents entry) even when fillSection fails and contributes { heading, items: [] }. The body
    // text only lands here if a section's fill actually delivered prose, which is the real proof
    // that this build holds a site and not merely a page whose sections all silently came up empty.
    expect(html).toContain('Section 1');
    expect(html).toContain('Body text of the section.');
  }, 120_000);
});
