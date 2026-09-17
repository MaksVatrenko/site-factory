import { describe, it, expect } from 'vitest';
import { buildInstructions, planPage, trimPlan } from '../factory/texts/plan.mjs';
import { answer } from './helpers/openai.mjs';

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

  // The hero image is first in line, but it is not exempt: if the budget is already zero it must be
  // dropped and reported like any other picture, not silently kept or silently removed.
  it('drops the hero image itself when the budget is already spent', () => {
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: 'hero-shot',
      sections: [plannedSection()], faq: ['q1', 'q2'],
    };
    const result = trimPlan(plan, {
      budgets: { ...budgets, images: 0 },
      pages: PAGES,
      sectionContent: SECTION_CONTENT,
    });
    expect(result.plan.heroImage).toBeNull();
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
