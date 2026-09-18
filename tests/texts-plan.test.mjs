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

  // The live-run bug this task exists to fix: slots.json spent five of its eight links pointing
  // back at /slots. A page's own address, offered back as a link target, must be dropped — not kept
  // as if it named some other page, and not reported with either of the two existing warnings,
  // since it is neither unresolvable (links.mjs resolves it fine) nor merely late for the budget.
  it('drops a link to the page itself, with its own warning', () => {
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: null,
      sections: [plannedSection({ links: ['/casino', '/bonus'] }), plannedSection()],
      faq: ['q1', 'q2'],
    };
    const result = trimPlan(plan, { budgets, pages: PAGES, page: 'casino', sectionContent: SECTION_CONTENT });
    expect(result.plan.sections[0].links).toEqual(['/bonus']);
    expect(result.warnings.join(' ')).toContain('саму страницу');
    expect(result.warnings.join(' ')).not.toContain('никуда');
    expect(result.warnings.join(' ')).not.toContain('бюджета');
  });

  // A self-link must not spend the very budget it exists to protect on its way out — if it did, it
  // would still be displacing a link to a different page, just silently instead of by name, which is
  // the same harm the live run had, one step removed.
  it('does not spend the link budget on a link to the page itself', () => {
    const withLinks = { ...budgets, links: { section: [0, 2], page: [0, 2] } };
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: null,
      sections: [plannedSection({ links: ['/casino', '/casino', '/bonus', 'home'] })],
      faq: ['q1', 'q2'],
    };
    const result = trimPlan(plan, {
      budgets: withLinks, pages: PAGES, page: 'casino', sectionContent: SECTION_CONTENT,
    });
    expect(result.plan.sections[0].links).toEqual(['/bonus', '/']);
  });

  // resolveLink already collapses "home" and "/home" onto the one address "/" before this ever runs
  // — proving that collapse happens before the self-link check, so a page planning itself as `home`
  // is caught under either spelling, not just the one the model happened to write this time.
  it('drops both spellings of home linking to itself, when the page being planned is home', () => {
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: null,
      sections: [plannedSection({ links: ['home', '/home', '/casino'] }), plannedSection()],
      faq: ['q1', 'q2'],
    };
    const result = trimPlan(plan, { budgets, pages: PAGES, page: 'home', sectionContent: SECTION_CONTENT });
    expect(result.plan.sections[0].links).toEqual(['/casino']);
    expect(result.warnings.filter((warning) => warning.includes('саму страницу'))).toHaveLength(2);
  });

  // Finding: the brief hands the model file names ("home", "casino"), not addresses, so it echoes
  // them back, or the obvious slash-prefixed guess — neither of which used to be in the `allowed`
  // set this filter checked against. A recognisable spelling must be repaired to its canonical
  // address, not thrown away like a link to a page that genuinely does not exist.
  it('repairs a link spelled as a bare page name or a near-miss address, instead of dropping it', () => {
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: null,
      sections: [plannedSection({ links: ['home', '/home', 'casino', '/casino/'] }), plannedSection()],
      faq: ['q1', 'q2'],
    };
    const result = trimPlan(plan, { budgets, pages: PAGES, sectionContent: SECTION_CONTENT });
    expect(result.plan.sections[0].links).toEqual(['/', '/', '/casino', '/casino']);
    expect(result.warnings).toEqual([]);
  });

  it('trims links past the per-section budget, keeping the earliest', () => {
    const withLinks = { ...budgets, links: { section: [0, 2], page: [0, 10] } };
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: null,
      sections: [plannedSection({ links: ['/casino', '/bonus', 'home'] }), plannedSection()],
      faq: ['q1', 'q2'],
    };
    const result = trimPlan(plan, { budgets: withLinks, pages: PAGES, sectionContent: SECTION_CONTENT });
    expect(result.plan.sections[0].links).toEqual(['/casino', '/bonus']);
    expect(result.warnings.join(' ')).toContain('сверх бюджета ссылок на раздел');
  });

  // Same budget, spread across the whole page rather than one section: the second section's own
  // per-section allowance is nowhere near spent, but the page as a whole is, so it is the later
  // section that gives way — a link near the top of the page is worth more than one near the bottom.
  it('trims links past the per-page budget, spending it on the earliest sections first', () => {
    const withLinks = { ...budgets, links: { section: [0, 5], page: [0, 3] } };
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: null,
      sections: [
        plannedSection({ heading: 'First', links: ['/casino', '/bonus'] }),
        plannedSection({ heading: 'Second', links: ['/casino', '/bonus'] }),
      ],
      faq: ['q1', 'q2'],
    };
    const result = trimPlan(plan, { budgets: withLinks, pages: PAGES, sectionContent: SECTION_CONTENT });
    expect(result.plan.sections[0].links).toEqual(['/casino', '/bonus']);
    expect(result.plan.sections[1].links).toEqual(['/casino']);
    expect(result.warnings.join(' ')).toContain('сверх бюджета ссылок на страницу');
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

  // Finding: trimPlan nulled a section's picture when the page's budget ran out, but left `image`
  // sitting in that section's own `elements` list. fillSection (factory/texts/fill.mjs) builds its
  // request straight from `elements`, so it still asked the model to write an `image` element — with
  // no name to give it, since fill.mjs's brief only ever names a picture when trimPlan left one in
  // place. The model then had to invent a name, and assemble.mjs accepts any invented name that
  // happens to match some other picture the plan did declare (the hero's, typically) — the budget
  // satisfied on paper, exceeded in the file. Mutation-proven: see live-fixes-report.md.
  it("drops a trimmed section picture's own image element along with it", () => {
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: 'hero-shot',
      sections: [plannedSection({ image: 'over-budget-pic', elements: ['text', 'image'] })],
      faq: ['q1', 'q2'],
    };
    // The page's one picture slot is spent by the hero, so the section's own image is over budget.
    const result = trimPlan(plan, { budgets: { ...budgets, images: 1 }, pages: PAGES, sectionContent: SECTION_CONTENT });
    expect(result.plan.sections[0].image).toBeNull();
    expect(result.plan.sections[0].elements).not.toContain('image');
    expect(result.warnings.join(' ')).toContain('без картинки');
  });

  // The other half: a section that never had a picture name at all, but still asked for the
  // `image` element — there is nothing for fillSection to name it after, so it must go too, even
  // though nothing here was ever trimmed for budget (no "сверх бюджета" warning fires).
  it('drops an image element the plan never gave a picture name to', () => {
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: null,
      sections: [plannedSection({ image: null, elements: ['text', 'image'] })],
      faq: ['q1', 'q2'],
    };
    const result = trimPlan(plan, { budgets, pages: PAGES, sectionContent: SECTION_CONTENT });
    expect(result.plan.sections[0].image).toBeNull();
    expect(result.plan.sections[0].elements).not.toContain('image');
    expect(result.warnings.join(' ')).toContain('без картинки');
    expect(result.warnings.join(' ')).not.toContain('сверх бюджета');
  });

  // Keeps the two drops above honest: a section that really does have a picture must keep its
  // image element exactly as the model wrote it.
  it('keeps the image element when the section really does have a picture', () => {
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: null,
      sections: [plannedSection({ image: 'a-real-picture', elements: ['text', 'image'] })],
      faq: ['q1', 'q2'],
    };
    const result = trimPlan(plan, { budgets, pages: PAGES, sectionContent: SECTION_CONTENT });
    expect(result.plan.sections[0].image).toBe('a-real-picture');
    expect(result.plan.sections[0].elements).toContain('image');
  });

  // Finding: games.json's picture came back named with a whole sentence, which becomes both a key
  // in images.json and the file name the picture stage writes. Both the hero's name and a section's
  // are slugged: lower case, spaces/underscores to hyphens, anything else dropped, repeated hyphens
  // collapsed, trimmed, capped.
  it('turns a sentence-shaped picture name into a short slug, for both the hero and a section', () => {
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'],
      heroImage: 'A clean illustration of a game lobby with category tabs and card-style game tiles.',
      sections: [plannedSection({ image: 'Cozy_Live Dealer   Table!!' })],
      faq: ['q1', 'q2'],
    };
    const result = trimPlan(plan, { budgets: { ...budgets, images: 2 }, pages: PAGES, sectionContent: SECTION_CONTENT });
    expect(result.plan.heroImage).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(result.plan.heroImage.length).toBeLessThanOrEqual(60);
    expect(result.plan.sections[0].image).toBe('cozy-live-dealer-table');
    // Normalising successfully is not itself something to warn about.
    expect(result.warnings).toEqual([]);
  });

  it('drops a picture name with nothing usable left after stripping, and warns', () => {
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: '!!! ??? ---',
      sections: [plannedSection()], faq: ['q1', 'q2'],
    };
    const result = trimPlan(plan, { budgets, pages: PAGES, sectionContent: SECTION_CONTENT });
    expect(result.plan.heroImage).toBeNull();
    expect(result.warnings.join(' ')).toContain('!!! ??? ---');
  });

  // 'logo' and 'logo-square' are factory/images/logo.mjs's reserved names (see plan.mjs's own
  // comment on RESERVED_IMAGE_NAMES for why they are duplicated here rather than imported). A slug
  // landing on either would otherwise either be dropped downstream with a confusing "reserved for
  // the logo" log line, or — on a site that already has its logo — silently reuse that actual logo
  // image inside a content section. Guarded here, the same way an unusable or over-budget name is.
  it("drops a picture name that collides with the logo's reserved names, and warns", () => {
    const plan = {
      title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: 'Logo',
      sections: [plannedSection({ image: 'Logo Square' })],
      faq: ['q1', 'q2'],
    };
    const result = trimPlan(plan, { budgets: { ...budgets, images: 5 }, pages: PAGES, sectionContent: SECTION_CONTENT });
    expect(result.plan.heroImage).toBeNull();
    expect(result.plan.sections[0].image).toBeNull();
    expect(result.warnings.join(' ')).toContain('логотип');
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

  // Finding: the brief used to list PAGES verbatim — file names such as "home" — which is exactly
  // what trimPlan then refused to accept back as a link target. The brief must speak in the
  // addresses a link is actually allowed to use, and say so plainly, and it must carry the per-page
  // link budget alongside the sections/questions/pictures line it already had.
  it("lists the site's pages as addresses, not file names, and states the link budget", async () => {
    let body;
    const fetchFn = async (_url, init) => {
      body = JSON.parse(init.body);
      return answer({
        title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: null,
        sections: [plannedSection()], faq: ['q1'],
      });
    };
    await planPage(
      {
        page: 'casino', pages: PAGES, brand: 'Acme', geo: 'Bangladesh', locale: 'en-US',
        budgets: { sections: 1, faq: 1, images: 1, links: { section: [0, 2], page: [0, 8] } },
        sectionContent: SECTION_CONTENT,
        instructions: 'RULES',
      },
      { config: CONFIG, fetchFn, sleep: async () => {} },
    );

    const content = String(body.input[0].content);
    // "casino" is the page being planned, so it is left out of its own list of link targets (see
    // the dedicated test below) — this test is about the other two things the brief must say:
    // addresses, not file names, and the per-page link budget.
    expect(content).toContain('Pages on this site: /, /bonus');
    // "home" the file name must be gone from that line entirely — only its address, "/", remains.
    expect(content).not.toMatch(/Pages on this site:.*\bhome\b/);
    expect(content).toMatch(/link.*must use one of those exact addresses/i);
    expect(content).toContain('at most 8 internal links');
  });

  // The live-run bug, caught before the model ever sees the brief: offering a page's own address
  // back to it as something "worth linking to" invites exactly the self-link this task removes.
  // Leaving it out of the list is cheaper than asking the model to notice and decline it every time.
  it('leaves the page being planned out of its own list of addresses', async () => {
    let body;
    const fetchFn = async (_url, init) => {
      body = JSON.parse(init.body);
      return answer({
        title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: null,
        sections: [plannedSection()], faq: ['q1'],
      });
    };
    await planPage(
      {
        page: 'casino', pages: PAGES, brand: 'Acme', geo: 'Bangladesh', locale: 'en-US',
        budgets: { sections: 1, faq: 1, images: 1, links: { section: [0, 2], page: [0, 8] } },
        sectionContent: SECTION_CONTENT,
        instructions: 'RULES',
      },
      { config: CONFIG, fetchFn, sleep: async () => {} },
    );

    const content = String(body.input[0].content);
    expect(content).toContain('Pages on this site: /, /bonus');
    expect(content).not.toMatch(/Pages on this site:.*\/casino/);
  });

  // Finding: planPage used to take a manifest-wide `elements` list as well as `sectionContent`, and
  // schema.mjs's planSchema offered the model whichever list the caller passed — the template's
  // whole vocabulary, not the "section" block's own. This template's `toggle` is real (the `faq`
  // block supports it) but section content does not have it at all, so a plan describing an
  // ordinary section made of toggles was always going to lose every one of them to trimPlan, and the
  // section along with it. There is no `elements` parameter left to disagree with sectionContent —
  // proving the model is never even offered something trimPlan can only strip back out.
  // Mutation-proven: see live-fixes-report.md.
  it("never offers a section an element sectionContent does not list, even one the template supports elsewhere (toggle, real only for the faq block)", async () => {
    let body;
    const fetchFn = async (_url, init) => {
      body = JSON.parse(init.body);
      return answer({
        title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: null,
        sections: [plannedSection()], faq: ['q1'],
      });
    };
    await planPage(
      {
        page: 'casino', pages: PAGES, brand: 'Acme', geo: 'Bangladesh', locale: 'en-US',
        budgets: { sections: 1, faq: 1, images: 1 },
        sectionContent: SECTION_CONTENT,
        instructions: 'RULES',
      },
      { config: CONFIG, fetchFn, sleep: async () => {} },
    );
    const offered = body.text.format.schema.properties.sections.items.properties.elements.items.enum;
    expect(offered).toEqual(Object.keys(SECTION_CONTENT));
    expect(offered).not.toContain('toggle');
  });

  // planSchema itself already refuses to build a schema with nothing usable in it (see
  // texts-schema.test.mjs) — this is the same guard, reached the new way, through sectionContent
  // alone rather than through a separate `elements` argument.
  it("still refuses to plan when sectionContent has nothing usable in it", async () => {
    const fetchFn = async () => {
      throw new Error('сеть не должна была понадобиться — схема обязана отказать раньше');
    };
    await expect(
      planPage(
        {
          page: 'casino', pages: PAGES, brand: 'Acme', geo: 'Bangladesh', locale: 'en-US',
          budgets: { sections: 1, faq: 1, images: 1 },
          sectionContent: {},
          instructions: 'RULES',
        },
        { config: CONFIG, fetchFn, sleep: async () => {} },
      ),
    ).rejects.toThrow(/элемент/);
  });

  // Fix for games.json naming its picture a whole sentence: corrected after the fact in trimPlan,
  // but also asked for up front, so the model has less to be corrected on.
  it('asks the model to name every picture with a short slug, not a sentence', async () => {
    let body;
    const fetchFn = async (_url, init) => {
      body = JSON.parse(init.body);
      return answer({
        title: 'T', description: 'D', h1: 'H', heroText: ['a'], heroImage: null,
        sections: [plannedSection()], faq: ['q1'],
      });
    };
    await planPage(
      {
        page: 'casino', pages: PAGES, brand: 'Acme', geo: 'Bangladesh', locale: 'en-US',
        budgets: { sections: 1, faq: 1, images: 1 },
        sectionContent: SECTION_CONTENT,
        instructions: 'RULES',
      },
      { config: CONFIG, fetchFn, sleep: async () => {} },
    );
    const content = String(body.input[0].content);
    expect(content).toMatch(/short.*slug/i);
    expect(content).toMatch(/never a sentence/i);
  });
});
