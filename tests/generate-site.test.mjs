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
