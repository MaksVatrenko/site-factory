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
const PAGES = ['home', 'casino', 'bonus'];

function plannedSection(overrides = {}) {
  return { heading: 'Payments', brief: 'how to pay', elements: ['text', 'text'], links: [], ...overrides };
}

describe('buildInstructions', () => {
  it('puts the rules and this page\'s examples in one block', () => {
    const text = buildInstructions({
      rules: ['Be clear.'],
      examples: [{ title: 'Casino', blocks: [] }, { title: 'Slots', blocks: [] }],
    });
    expect(text).toContain('Be clear.');
    expect(text).toContain('"title": "Casino"');
    // Every example of the page, not one of them: the chosen one gives the shape, the rest give
    // the tone and the depth.
    expect(text).toContain('"title": "Slots"');
  });

  // The prompt cache only hits on an unchanged prefix. This no longer carries across pages — the
  // examples differ — but within one page it is what the other eleven requests read back.
  it('does not change between two requests about one page', () => {
    const args = { rules: ['Be clear.'], examples: [{ title: 'Casino', blocks: [] }] };
    expect(buildInstructions(args)).toBe(buildInstructions(args));
  });
});

describe('trimPlan', () => {
  // The two link budgets, in the spelling pictures.json uses. Everything else a plan used to be
  // trimmed against — how many pictures a page may hold, what goes inside a block — is gone: the
  // example settled it and the schema pinned it, so there is nothing left here to ration.
  const links = { perBlock: [0, 5], perPage: [0, 10] };
  const base = { title: 'T', description: 'D', h1: 'H', images: [], faq: ['q1', 'q2'] };
  const args = {
    links,
    pages: PAGES,
    imageLabels: ['hero'],
  };

  it('keeps a plan that is already inside its limits, with nothing to say', () => {
    const plan = { ...base, blocks: { section: [plannedSection(), plannedSection()] } };
    const result = trimPlan(plan, args);
    expect(result.warnings).toEqual([]);
    expect(result.plan.blocks.section).toHaveLength(2);
  });

  it('drops a link to a page this site does not have', () => {
    const plan = { ...base, blocks: { section: [plannedSection({ links: ['/casino', '/nope'] }), plannedSection()] } };
    const result = trimPlan(plan, args);
    expect(result.plan.blocks.section[0].links).toEqual(['/casino']);
    expect(result.warnings.join(' ')).toContain('/nope');
  });

  // The live-run bug this check exists for: slots.json spent five of its eight links pointing back
  // at /slots. A page's own address, offered back as a link target, must be dropped — not kept as
  // if it named some other page, and not reported with either of the two existing warnings, since
  // it is neither unresolvable (links.mjs resolves it fine) nor merely late for the budget.
  it('drops a link to the page itself, with its own warning', () => {
    const plan = {
      ...base,
      blocks: { section: [plannedSection({ links: ['/casino', '/bonus'] }), plannedSection()] },
    };
    const result = trimPlan(plan, { ...args, page: 'casino' });
    expect(result.plan.blocks.section[0].links).toEqual(['/bonus']);
    expect(result.warnings.join(' ')).toContain('саму страницу');
    expect(result.warnings.join(' ')).not.toContain('никуда');
    expect(result.warnings.join(' ')).not.toContain('бюджета');
  });

  // A self-link must not spend the very budget it exists to protect on its way out — if it did, it
  // would still be displacing a link to a different page, just silently instead of by name, which
  // is the same harm the live run had, one step removed.
  it('does not spend the link budget on a link to the page itself', () => {
    const plan = {
      ...base,
      blocks: { section: [plannedSection({ links: ['/casino', '/casino', '/bonus', 'home'] })] },
    };
    const result = trimPlan(plan, {
      ...args,
      links: { perBlock: [0, 2], perPage: [0, 2] },
      page: 'casino',
    });
    expect(result.plan.blocks.section[0].links).toEqual(['/bonus', '/']);
  });

  // resolveLink already collapses "home" and "/home" onto the one address "/" before this ever runs
  // — proving that collapse happens before the self-link check, so a page planning itself as `home`
  // is caught under either spelling, not just the one the model happened to write this time.
  it('drops both spellings of home linking to itself, when the page being planned is home', () => {
    const plan = {
      ...base,
      blocks: { section: [plannedSection({ links: ['home', '/home', '/casino'] }), plannedSection()] },
    };
    const result = trimPlan(plan, { ...args, page: 'home' });
    expect(result.plan.blocks.section[0].links).toEqual(['/casino']);
    expect(result.warnings.filter((warning) => warning.includes('саму страницу'))).toHaveLength(2);
  });

  // Finding: the brief hands the model file names ("home", "casino"), not addresses, so it echoes
  // them back, or the obvious slash-prefixed guess — neither of which used to be in the `allowed`
  // set this filter checked against. A recognisable spelling must be repaired to its canonical
  // address, not thrown away like a link to a page that genuinely does not exist.
  it('repairs a link spelled as a bare page name or a near-miss address, instead of dropping it', () => {
    const plan = {
      ...base,
      blocks: { section: [plannedSection({ links: ['home', '/home', 'casino', '/casino/'] }), plannedSection()] },
    };
    const result = trimPlan(plan, args);
    expect(result.plan.blocks.section[0].links).toEqual(['/', '/', '/casino', '/casino']);
    expect(result.warnings).toEqual([]);
  });

  it('trims links past the per-block budget, keeping the earliest', () => {
    const plan = {
      ...base,
      blocks: { section: [plannedSection({ links: ['/casino', '/bonus', 'home'] }), plannedSection()] },
    };
    const result = trimPlan(plan, { ...args, links: { perBlock: [0, 2], perPage: [0, 10] } });
    expect(result.plan.blocks.section[0].links).toEqual(['/casino', '/bonus']);
    expect(result.warnings.join(' ')).toContain('сверх бюджета ссылок на раздел');
  });

  // Same budget, spread across the whole page rather than one section: the second section's own
  // per-block allowance is nowhere near spent, but the page as a whole is, so it is the later
  // section that gives way — a link near the top of the page is worth more than one near the bottom.
  it('trims links past the per-page budget, spending it on the earliest sections first', () => {
    const plan = {
      ...base,
      blocks: { section: [
        plannedSection({ heading: 'First', links: ['/casino', '/bonus'] }),
        plannedSection({ heading: 'Second', links: ['/casino', '/bonus'] }),
      ] },
    };
    const result = trimPlan(plan, { ...args, links: { perBlock: [0, 5], perPage: [0, 3] } });
    expect(result.plan.blocks.section[0].links).toEqual(['/casino', '/bonus']);
    expect(result.plan.blocks.section[1].links).toEqual(['/casino']);
    expect(result.warnings.join(' ')).toContain('сверх бюджета ссылок на страницу');
  });

  // Finding: games.json's picture came back named with a whole sentence, which becomes both a key
  // in images.json and the file name the picture stage writes. Every name is slugged: lower case,
  // spaces/underscores to hyphens, anything else dropped, repeated hyphens collapsed, capped.
  it('turns a sentence-shaped picture name into a short slug', () => {
    const plan = {
      ...base,
      images: [
        'A clean illustration of a game lobby with category tabs and card-style game tiles.',
        'Cozy_Live Dealer   Table!!',
      ],
      blocks: { section: [plannedSection()] },
    };
    const result = trimPlan(plan, { ...args, imageLabels: ['hero', 'split 1'] });
    expect(result.plan.images[0]).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(result.plan.images[0].length).toBeLessThanOrEqual(60);
    expect(result.plan.images[1]).toBe('cozy-live-dealer-table');
    // Normalising successfully is not itself something to warn about.
    expect(result.warnings).toEqual([]);
  });

  // Found by generating a page with a fake model that answered in the language of the site, which
  // is what every other instruction asks the model to do. A name written in Cyrillic, Bengali or
  // Arabic loses every one of its letters to the slug, and what is left is not a name: "рулетка
  // 2024" comes out as "2024". That passes every other check, becomes a key in images.json and a
  // file name, and tells the picture stage nothing whatever about what to draw — a wrong picture on
  // every page of the site, with nothing anywhere saying so.
  it('drops a picture name that kept nothing but digits after stripping', () => {
    const plan = { ...base, images: ['рулетка 2024'], blocks: { section: [plannedSection()] } };
    const result = trimPlan(plan, args);
    expect(result.plan.images).toEqual([null]);
    expect(result.warnings.join(' ')).toContain('рулетка 2024');
  });

  // The other side of it: a name that did keep a word is usable, so it is kept — but it lost
  // something on the way, and the owner reading the log should be told which pictures to look at.
  it('keeps a half-stripped name but says it was not written in latin', () => {
    const plan = { ...base, images: ['899ok лобби'], blocks: { section: [plannedSection()] } };
    const result = trimPlan(plan, args);
    expect(result.plan.images).toEqual(['899ok']);
    expect(result.warnings.join(' ')).toContain('не латиницей');
  });

  it('says nothing about latin when the name was written in it all along', () => {
    const plan = { ...base, images: ['live-dealer-table'], blocks: { section: [plannedSection()] } };
    expect(trimPlan(plan, args).warnings).toEqual([]);
  });

  // The block still exists; it simply has no picture. Nothing may invent a name to fill the hole —
  // an invented name reaches images.json and gets drawn, which is worse than a block without one.
  it('leaves a hole rather than a made-up name when nothing usable came back', () => {
    const plan = { ...base, images: ['!!! ??? ---'], blocks: { section: [plannedSection()] } };
    const result = trimPlan(plan, args);
    expect(result.plan.images).toEqual([null]);
    expect(result.warnings.join(' ')).toContain('!!! ??? ---');
  });

  // 'logo' and 'logo-square' are factory/images/logo.mjs's reserved names (see plan.mjs's own
  // comment on RESERVED_IMAGE_NAMES for why they are duplicated here rather than imported). A slug
  // landing on either would otherwise either be dropped downstream with a confusing "reserved for
  // the logo" log line, or — on a site that already has its logo — silently reuse that actual logo
  // image inside a content block. Guarded here, the same way an unusable name is.
  it("drops a picture name that collides with the logo's reserved names, and warns", () => {
    const plan = { ...base, images: ['Logo', 'Logo Square'], blocks: { section: [plannedSection()] } };
    const result = trimPlan(plan, { ...args, imageLabels: ['hero', 'split 1'] });
    expect(result.plan.images).toEqual([null, null]);
    expect(result.warnings.join(' ')).toContain('логотип');
  });

  // Two blocks of one page showing one and the same picture reads as a fault of the factory, not
  // as a choice: the same image drawn twice on the way down the page. The first keeps the name, the
  // later block goes without, and the log names which block lost it.
  it('drops a repeated picture name, keeping the first, and warns by block', () => {
    const plan = { ...base, images: ['lobby', 'Lobby'], blocks: { section: [plannedSection()] } };
    const result = trimPlan(plan, { ...args, imageLabels: ['hero', 'split 1'] });
    expect(result.plan.images).toEqual(['lobby', null]);
    expect(result.warnings.join(' ')).toContain('split 1');
  });

  // A name is normalised before anything else looks at it, so a picture that is only unusable after
  // slugging never occupies the name a later, real picture would have taken.
  it('names the block a picture was meant for, not its number in the list', () => {
    const plan = { ...base, images: ['!!!'], blocks: { section: [plannedSection()] } };
    const result = trimPlan(plan, { ...args, imageLabels: ['hero'] });
    expect(result.warnings.join(' ')).toContain('hero');
  });
});

describe('planPage', () => {
  it('asks with the page brief and gives back a trimmed plan and what it cost', async () => {
    let body;
    const fetchFn = async (_url, init) => {
      body = JSON.parse(init.body);
      return answer({
        title: 'T', description: 'D', h1: 'H', images: ['lobby'],
        blocks: { section: [plannedSection()], faq: ['q1'] },
      });
    };
    const result = await planPage(
      {
        page: 'casino', pages: PAGES, brand: 'Acme', geo: 'Bangladesh', locale: 'en-US',
        shape: { byType: { section: 1 }, order: ['section'], faq: 1, images: 1, imageLabels: ['hero'] },
        instructions: 'RULES',
      },
      { config: CONFIG, fetchFn, sleep: async () => {} },
    );

    expect(body.instructions).toBe('RULES');
    expect(String(body.input[0].content)).toContain('casino');
    expect(String(body.input[0].content)).toContain('Acme');
    expect(body.text.format.schema.properties.blocks.properties.section.minItems).toBe(1);
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
        title: 'T', description: 'D', h1: 'H', images: ['lobby'],
        blocks: { section: [plannedSection()], faq: ['q1'] },
      });
    };
    await planPage(
      {
        page: 'casino', pages: PAGES, brand: 'Acme', geo: 'Bangladesh', locale: 'en-US',
        shape: { byType: { section: 1 }, order: ['section'], faq: 1, images: 1, imageLabels: ['hero'] },
        links: { perBlock: [0, 2], perPage: [0, 8] },
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
        title: 'T', description: 'D', h1: 'H', images: ['lobby'],
        blocks: { section: [plannedSection()], faq: ['q1'] },
      });
    };
    await planPage(
      {
        page: 'casino', pages: PAGES, brand: 'Acme', geo: 'Bangladesh', locale: 'en-US',
        shape: { byType: { section: 1 }, order: ['section'], faq: 1, images: 1, imageLabels: ['hero'] },
        links: { perBlock: [0, 2], perPage: [0, 8] },
        instructions: 'RULES',
      },
      { config: CONFIG, fetchFn, sleep: async () => {} },
    );

    const content = String(body.input[0].content);
    expect(content).toContain('Pages on this site: /, /bonus');
    expect(content).not.toMatch(/Pages on this site:.*\/casino/);
  });


  // Fix for games.json naming its picture a whole sentence: corrected after the fact in trimPlan,
  // but also asked for up front, so the model has less to be corrected on. The brief also has to
  // say which block each name is for — that is the only thing that lets a name mean anything, and
  // it is what stops two pictures of one page from being briefed identically.
  it('asks the model to name every picture with a short slug, and says which block each is for', async () => {
    let body;
    const fetchFn = async (_url, init) => {
      body = JSON.parse(init.body);
      return answer({
        title: 'T', description: 'D', h1: 'H', images: ['lobby'],
        blocks: { section: [plannedSection()], faq: ['q1'] },
      });
    };
    await planPage(
      {
        page: 'casino', pages: PAGES, brand: 'Acme', geo: 'Bangladesh', locale: 'en-US',
        shape: { byType: { section: 1 }, order: ['section'], faq: 1, images: 1, imageLabels: ['hero'] },
        instructions: 'RULES',
      },
      { config: CONFIG, fetchFn, sleep: async () => {} },
    );
    const content = String(body.input[0].content);
    expect(content).toMatch(/short.*slug/i);
    expect(content).toMatch(/never a sentence/i);
    expect(content).toMatch(/latin/i);
    expect(content).toMatch(/1\. hero/);
  });

  // A layout that has no picture-bearing block at all must not leave the brief asking for names
  // that the schema then refuses to accept.
  it('says nothing about pictures when the layout has none', async () => {
    let body;
    const fetchFn = async (_url, init) => {
      body = JSON.parse(init.body);
      return answer({
        title: 'T', description: 'D', h1: 'H', images: [],
        blocks: { section: [plannedSection()], faq: ['q1'] },
      });
    };
    await planPage(
      {
        page: 'casino', pages: PAGES, brand: 'Acme', geo: 'Bangladesh', locale: 'en-US',
        shape: { byType: { section: 1 }, order: ['section'], faq: 1, images: 0, imageLabels: [] },
        instructions: 'RULES',
      },
      { config: CONFIG, fetchFn, sleep: async () => {} },
    );
    expect(String(body.input[0].content)).not.toMatch(/picture/i);
  });
});
