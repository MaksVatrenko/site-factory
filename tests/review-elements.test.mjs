import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, readOutput } from './helpers/build.mjs';

// The four content elements added to the review template: a call to action, a row of claims, a
// divider, and a numbered run of instructions. See templates/review/elements/.
//
// A real Astro build takes about a second per page, so this file builds two pages and asks each of
// them every question it can, rather than one page per assertion: one page wired to a partner link
// (the normal case), one with none (the case where a button has nowhere to go).

const PARTNER_URL = 'https://partner.example/go';

// The same fixture shape tests/review-template.test.mjs writes with buildSingleBlockPage — a real
// SITE_DIR folder, one site.json plus one page file, each block's props flattened alongside its
// "type" the way a page file on disk does (see src/lib/site-dir.mjs) — plus the one site setting
// these elements read: partnerUrl.
function buildFixtureSite(blocks, { partnerUrl } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'site-factory-elements-'));
  writeFileSync(
    join(dir, 'site.json'),
    JSON.stringify({
      domain: 'example.com',
      brand: { name: 'Elements Fixture' },
      ...(partnerUrl ? { partnerUrl } : {}),
    }),
  );
  writeFileSync(
    join(dir, 'home.json'),
    JSON.stringify({
      title: 'Fixture',
      blocks: blocks.map(({ type, props }) => ({ type, ...props })),
    }),
  );
  return dir;
}

function buildFixturePage(blocks, { partnerUrl, outName }) {
  const dir = buildFixtureSite(blocks, { partnerUrl });
  try {
    const { outDir } = buildSite({
      outDir: join('output', outName),
      // PARTNER_URL is an operator override that beats site.json (see src/lib/site-context.mjs),
      // so it is pinned empty here: otherwise one exported variable in the shell running the tests
      // would decide what these pages link to.
      env: { SITE_DIR: dir, TEMPLATE: 'review', SCHEME: 'dark', PARTNER_URL: '' },
    });
    return readOutput(outDir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- reading the built page ------------------------------------------------------

// One block's own markup. Blocks are siblings and never nest, so the first closing tag ends it.
function blockHtml(html, className) {
  const found = html.match(new RegExp(`<section class="${className}"[\\s\\S]*?</section>`));
  return found ? found[0] : '';
}

function openingTags(html, tag) {
  return html.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) ?? [];
}

function attributeOf(tag, name) {
  const found = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return found ? found[1] : null;
}

function textOf(html) {
  return html.replace(/<[^>]*>/g, '');
}

// Only what the page actually draws. Every element's CSS is inlined into every page whether or not
// that element is used, so "the page does not contain .rinfo" is never true of the whole file —
// asking the markup is the only way to tell a drawn element from a styled one.
function markupOf(html) {
  const main = html.match(/<main\b[\s\S]*<\/main>/);
  return (main ? main[0] : html).replace(/<style>[\s\S]*?<\/style>/g, '');
}

// Every stylesheet the page carries. The template inlines them all rather than linking one (see
// tests/review-template.test.mjs), so the CSS that actually ships is right here in the HTML.
function stylesheetOf(html) {
  return [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

// The built CSS as { selector, declarations } pairs, with Astro's scoping attribute stripped off:
// a test should not have to know this build's hash, only which element the rule is aimed at.
function rulesOf(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim().replace(/\[data-astro-cid-[^\]]*\]/g, ''),
    declarations: match[2].trim(),
  }));
}

const VOID_TAGS = new Set(['hr', 'img', 'br', 'input', 'meta', 'link', 'source']);

// The direct children of the element carrying `className`, in document order. Sibling combinators
// in CSS are statements about exactly this list, so a rule of the form "whatever follows the line"
// can be checked against the page it is meant to style rather than merely being found in the CSS.
function childrenOf(html, className) {
  const opening = new RegExp(`<[a-z]+[^>]*\\bclass="[^"]*\\b${className}\\b[^"]*"[^>]*>`, 'i');
  const start = opening.exec(html);
  if (!start) return [];

  const tags = /<(\/?)([a-z0-9]+)([^>]*)>/gi;
  tags.lastIndex = start.index + start[0].length;
  const children = [];
  let depth = 0;
  let end = html.length;
  let match;
  while ((match = tags.exec(html)) !== null) {
    const tag = match[2].toLowerCase();
    if (match[1] === '') {
      if (depth === 0) {
        children.push({
          tag,
          classes: (match[3].match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/),
          at: match.index,
        });
      }
      if (!VOID_TAGS.has(tag)) depth += 1;
      continue;
    }
    if (depth === 0) {
      end = match.index; // the container's own closing tag
      break;
    }
    depth -= 1;
  }

  return children.map((child, index) => ({
    ...child,
    text: textOf(html.slice(child.at, children[index + 1]?.at ?? end)).trim(),
  }));
}

describe('review elements: a page wired to the site partner link', () => {
  let html;

  beforeAll(() => {
    html = buildFixturePage(
      [
        {
          type: 'hero',
          props: {
            content: [
              { type: 'title', h1: 'Hero With A Call To Action' },
              {
                type: 'buttons',
                items: [
                  { text: 'Enter 899OK Casino' },
                  { text: 'Download 899OK App', href: '/app' },
                ],
              },
              { type: 'info', items: ['🎲 Live Dealers 24/7', '   ', '⚡ Fast bKash Payouts'] },
            ],
          },
        },
        {
          type: 'section',
          props: {
            content: [
              { type: 'title', h2: 'How It Works' },
              { type: 'text', text: 'Paragraph before the line.' },
              { type: 'line' },
              { type: 'text', text: 'Note after the line.' },
              { type: 'text', text: 'Second note.' },
              {
                type: 'steps',
                items: [
                  { title: 'Tap Register', text: 'top-right button on the [site](/casino) or app' },
                  { title: 'Confirm your number' },
                  { text: 'then pick a bonus' },
                  {},
                ],
              },
              {
                type: 'buttons',
                items: [
                  { text: 'Open the lobby' },
                  { text: 'Free money', href: 'javascript:alert(1)' },
                  { text: '', href: '/silent' },
                  { href: '/unnamed' },
                ],
              },
            ],
          },
        },
      ],
      { partnerUrl: PARTNER_URL, outName: 'test-review-elements' },
    );
  });

  // --- buttons ---------------------------------------------------------------------

  it('sends a button with no href of its own to the site partner link', () => {
    // The partner link is a setting of the build, not content: it travels site.json -> site ->
    // block -> element context (see blocks/section.astro and elements/buttons.astro). If that wire
    // breaks anywhere along the way the button does not turn into a broken link that someone would
    // notice — an empty href is treated as "nowhere to go" and the button is dropped, so the page's
    // whole call to action silently stops existing. Hence: count the buttons AND read the address.
    const hero = blockHtml(html, 'hero section');
    const links = openingTags(hero, 'a');
    expect(links).toHaveLength(2);
    expect(attributeOf(links[0], 'href')).toBe(PARTNER_URL);
    expect(textOf(hero)).toContain('Enter 899OK Casino');
  });

  it('sends a button that names its own href there instead', () => {
    // The fallback must not overwrite a button that really does point elsewhere — an app page, a
    // store — which is the difference between a second choice and a duplicate of the first.
    const links = openingTags(blockHtml(html, 'hero section'), 'a');
    expect(attributeOf(links[1], 'href')).toBe('/app');
  });

  it('accents the first button only', () => {
    // Two equally loud buttons read as rivals rather than as a choice, and the page has one thing
    // it is for. Nothing else in the markup distinguishes them, so the class is the whole signal.
    const links = openingTags(blockHtml(html, 'hero section'), 'a');
    expect(attributeOf(links[0], 'class')).toBe('rbuttons__button rbuttons__button--accent');
    expect(attributeOf(links[1], 'class')).toBe('rbuttons__button');
  });

  it('opens an external button in a new tab, and marks the link paid', () => {
    // The partner link leaves the site, so it gets target=_blank — and with it rel=noopener,
    // without which the opened page can reach back through window.opener. "sponsored" is what
    // search engines read to tell a paid link from an editorial one; a missing one is invisible on
    // the page and only shows up as a penalty much later.
    const links = openingTags(blockHtml(html, 'hero section'), 'a');
    expect(attributeOf(links[0], 'target')).toBe('_blank');
    const rel = attributeOf(links[0], 'rel') ?? '';
    expect(rel.split(/\s+/)).toContain('noopener');
    expect(rel.split(/\s+/)).toContain('sponsored');
  });

  it('keeps an internal button in the same tab, with no rel at all', () => {
    // A page of this same site opened in a new tab is a navigation bug, and calling it "sponsored"
    // would tell a search engine not to follow the site's own page.
    const links = openingTags(blockHtml(html, 'hero section'), 'a');
    expect(attributeOf(links[1], 'target')).toBeNull();
    expect(attributeOf(links[1], 'rel')).toBeNull();
  });

  it('drops a button with no words on it, whatever address it has', () => {
    // A button is its label; one with an href and no text renders as a bare coloured box that
    // still navigates. The section below asks for four buttons and may draw exactly one.
    const section = blockHtml(html, 'rsection section');
    const links = openingTags(section, 'a').filter((tag) => tag.includes('rbuttons__button'));
    expect(links).toHaveLength(1);
    expect(textOf(section)).toContain('Open the lobby');
    expect(section).not.toContain('/silent');
    expect(section).not.toContain('/unnamed');
  });

  it('refuses to build a button out of an href that would run something', () => {
    // The only real hole in this element: the content is written by a third party, so a button's
    // href is attacker-controlled text that goes straight into the page. It is held to the same
    // check every inline link is (isSafeHref in templates/_shared/rich-text.mjs) — no javascript:,
    // no protocol-relative address. A button that fails it is dropped, not drawn.
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('Free money');
  });

  it('wires the partner link through an ordinary section too, not just the hero', () => {
    // hero.astro and section.astro each assemble the element context themselves, so one can keep
    // working while the other passes nothing — and a button in a mid-page section would quietly
    // disappear while the hero's still looked fine.
    const section = blockHtml(html, 'rsection section');
    const button = openingTags(section, 'a').find((tag) => tag.includes('rbuttons__button'));
    expect(attributeOf(button ?? '', 'href')).toBe(PARTNER_URL);
  });

  // --- info ------------------------------------------------------------------------

  it('renders the claims in content order, pictograms and all', () => {
    // The pictogram is part of the claim's own text, not a field with a registry behind it, so the
    // thing to prove is that a non-ASCII character survives JSON -> build -> written file intact.
    const hero = blockHtml(html, 'hero section');
    const claims = childrenOf(hero, 'rinfo');
    expect(claims.map((claim) => claim.text)).toEqual([
      '🎲 Live Dealers 24/7',
      '⚡ Fast bKash Payouts',
    ]);
    expect(claims.every((claim) => claim.tag === 'li')).toBe(true);
  });

  it('drops a blank claim rather than drawing an empty pill', () => {
    // A blank string in the list still has padding, a border and a background: it draws a small
    // empty capsule between two real claims. The fixture above passes "   " as the second item.
    expect(openingTags(blockHtml(html, 'hero section'), 'li')).toHaveLength(2);
  });

  // --- line ------------------------------------------------------------------------

  it('draws the divider as a real rule', () => {
    expect(blockHtml(html, 'rsection section')).toMatch(/<hr[^>]*class="rline"/);
  });

  it('draws every paragraph after the line differently from the ones before it', () => {
    // This is what the element is for: what follows the line is an aside about what came above it.
    // The rule cannot live in line.astro — Astro scopes a component's CSS to its own markup, and a
    // sibling it never rendered is out of reach — so it lives in the block (blocks/section.astro).
    // Nothing in the element's own HTML changes if that rule is deleted: the build still passes,
    // the line is still drawn, and the note just silently reads as ordinary body text. So the rule
    // is read out of the CSS that actually shipped...
    // One rule per block that holds a run of elements, because each block scopes its own CSS and
    // there is nowhere both can reach. So they are found as a set, and the one belonging to the
    // section is picked by its container — taking whichever came first in the stylesheet would
    // check the section's markup against the first screen's rule.
    const rules = rulesOf(stylesheetOf(html)).filter((entry) =>
      /\.rline\s*[~+]\s*p$/.test(entry.selector),
    );
    expect(rules.length, 'no rule in the built CSS styles the paragraphs after .rline')
      .toBeGreaterThan(0);
    // An element allowed in more than one block but styled in only one works in half the places it
    // is allowed, and nothing says so: the line is drawn and the note reads as ordinary text.
    expect(
      rules.map((entry) => entry.selector).join(' '),
      'the first screen holds a run of elements too, and needs the same rule',
    ).toMatch(/hero/);
    const rule = rules.find((entry) => entry.selector.includes('rsection'));
    expect(rule, 'no rule styles the paragraphs after a line inside a section').toBeDefined();
    expect(rule.declarations).toMatch(/font-size:/);
    expect(rule.declarations).toMatch(/color:/);

    // ...and then matched against the page by hand, because a rule that selects nothing is worth
    // exactly as much as no rule: the container it reaches through, its combinator and its target
    // tag are all checked against the real run of elements the section rendered.
    const shape = rule.selector.match(/^\.([\w-]+)\s*>\s*\.rline\s*([~+])\s*p$/);
    expect(shape, `unexpected selector shape: ${rule.selector}`).not.toBeNull();
    const [, container, combinator] = shape;

    const children = childrenOf(blockHtml(html, 'rsection section'), container);
    const lineAt = children.findIndex(
      (child) => child.tag === 'hr' && child.classes.includes('rline'),
    );
    expect(lineAt, 'the line is not a direct child of the element the rule reaches through')
      .toBeGreaterThan(-1);

    const after = children.slice(lineAt + 1);
    const styled = (combinator === '~' ? after : after.slice(0, 1)).filter(
      (child) => child.tag === 'p',
    );
    const plain = children.slice(0, lineAt).filter((child) => child.tag === 'p');

    expect(plain.map((child) => child.text)).toEqual(['Paragraph before the line.']);
    // Both notes, not only the first: a note is often two sentences, and `+` instead of `~` would
    // leave the second one looking like body text again.
    expect(styled.map((child) => child.text)).toEqual([
      'Note after the line.',
      'Second note.',
    ]);
  });

  // --- steps -----------------------------------------------------------------------

  it('renders the steps as a real ordered list', () => {
    // The order is the meaning here. A screen reader announcing "3 of 5" from an <ol> tells a
    // reader following instructions the same thing the numbered circle tells everyone else; a run
    // of divs looks identical on screen and says nothing at all.
    const section = blockHtml(html, 'rsection section');
    expect(section).toMatch(/<ol[^>]*class="rsteps"/);
    const items = childrenOf(section, 'rsteps');
    expect(items.every((item) => item.tag === 'li')).toBe(true);
    expect(items.map((item) => item.text)[0]).toContain('Tap Register');
  });

  it('leaves the numbering to CSS rather than writing numbers into the content', () => {
    // Numbers written into the text would have to be renumbered by hand every time a step is
    // inserted, and the wrong number is not a crash — it is a page that quietly misinstructs.
    const list = blockHtml(html, 'rsection section').match(/<ol[^>]*class="rsteps"[\s\S]*?<\/ol>/);
    expect(list).not.toBeNull();
    expect(textOf(list[0])).not.toMatch(/[0-9]/);
    const counter = rulesOf(stylesheetOf(html)).find(
      (rule) => rule.selector.includes('rsteps') && /counter\(/.test(rule.declarations),
    );
    expect(counter, 'nothing in the built CSS draws the step numbers').toBeDefined();
  });

  it('keeps a step that has only a title, and one that has only an explanation', () => {
    // Both halves are optional in the data. A filter that demanded both would drop a real step on
    // the floor — and a run of instructions missing its third step reads as complete.
    const items = childrenOf(blockHtml(html, 'rsection section'), 'rsteps');
    // Four items in, one of them empty: an empty step is a numbered empty box, so it goes.
    expect(items).toHaveLength(3);
    // Read whole rather than in fragments: the dash belongs between a title and an explanation, so
    // a step that has only one of the two must not be left wearing half a separator.
    expect(items.map((item) => item.text)).toEqual([
      'Tap Register — top-right button on the site or app',
      'Confirm your number',
      'then pick a bonus',
    ]);
  });

  it('turns a link inside a step explanation into a real link', () => {
    // The explanation is a sentence like any other, so it goes through RichText: if it were
    // printed as a plain string instead, the markup would stay on screen as [words](/casino).
    const section = blockHtml(html, 'rsection section');
    expect(section).toMatch(/<a[^>]*href="\/casino"[^>]*>site<\/a>/);
    expect(section).not.toContain('](/casino)');
  });
});

describe('review elements: a site with no partner link', () => {
  let html;

  beforeAll(() => {
    html = buildFixturePage(
      [
        {
          type: 'hero',
          props: {
            content: [
              { type: 'title', h1: 'No Partner Link Here' },
              {
                type: 'buttons',
                items: [{ text: 'Nowhere To Go' }, { text: 'Download the app', href: '/app' }],
              },
              { type: 'info', items: ['', '   '] },
            ],
          },
        },
        {
          type: 'section',
          props: {
            content: [
              { type: 'title', h2: 'Also Nothing' },
              { type: 'buttons', items: [{ text: 'Nowhere To Go Either' }] },
              { type: 'steps', items: [{}, { title: '', text: '' }] },
            ],
          },
        },
      ],
      { outName: 'test-review-elements-no-partner' },
    );
  });

  it('draws no button at all when there is neither an href nor a partner link', () => {
    // partnerUrl is empty on a site whose campaign has not been set up yet. A button falling back
    // to it would get href="" — which reloads the current page — and the reader's one attempt to
    // act on the page does nothing. Not drawing it is the honest outcome; a dead one is not.
    expect(html).not.toContain('Nowhere To Go');
    expect(html).not.toContain('Nowhere To Go Either');
    expect(html).not.toMatch(/href=""/);
  });

  it('still draws the buttons that name their own href', () => {
    // The fallback going missing must not take the rest of the row with it.
    const links = openingTags(html, 'a').filter((tag) => tag.includes('rbuttons__button'));
    expect(links).toHaveLength(1);
    expect(attributeOf(links[0], 'href')).toBe('/app');
  });

  it('draws nothing for a list of claims that is entirely blank', () => {
    // Not an empty <ul>: an empty flex row still occupies its share of the page's grid gap, which
    // shows up as an unexplained hole between the heading and whatever follows.
    expect(markupOf(html)).not.toContain('rinfo');
  });

  it('draws nothing for a run of steps in which every step is empty', () => {
    // Same for an empty <ol>, which would additionally leave a numbered circle with nothing in it.
    expect(markupOf(html)).not.toContain('rsteps');
  });
});

// Two defects found by reviewing the components against their own comments rather than by reading
// the page: both are invisible on screen, and both change what the page promises.
describe('review template: what a button is held to before it is drawn', () => {
  let html;

  beforeAll(() => {
    html = buildFixturePage(
      [
        {
          type: 'section',
          props: {
            content: [
              { type: 'title', h2: 'Buttons' },
              {
                type: 'buttons',
                items: [
                  // Nothing to draw: the first *written* button, and no partner link on this site.
                  { text: 'Primary that cannot be drawn' },
                  { text: 'Padded external', href: ' https://store.example/app ' },
                ],
              },
            ],
          },
        },
      ],
      { outName: 'test-review-buttons-edges' },
    );
  });

  // isSafeHref trims before deciding, so a padded address passes the check and then reaches the
  // page still padded — where startsWith('http') is false, and the link quietly loses both its new
  // tab and its rel="sponsored". An unmarked paid link is indistinguishable from a marked one on
  // screen, and the same path for a link inside prose (parseRichText) trims. The two must agree.
  it('trims a padded target, so an external button keeps its sponsored marking', () => {
    const button = openingTags(blockHtml(html, 'rsection section'), 'a')
      .find((tag) => tag.includes('rbuttons__button'));
    expect(attributeOf(button ?? '', 'href')).toBe('https://store.example/app');
    expect(button).toContain('rel="noopener sponsored"');
    expect(button).toContain('target="_blank"');
  });

  // Which button is the loud one is decided by what was written, not by what survives. Numbered
  // after the filter, the accent falls on whatever is left — so a site with no partner link loses
  // its real call to action and makes "download the app" the loudest thing on the page.
  it('does not promote a secondary button to accent when the first one is dropped', () => {
    const drawn = openingTags(blockHtml(html, 'rsection section'), 'a')
      .filter((tag) => tag.includes('rbuttons__button'));
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).not.toContain('rbuttons__button--accent');
  });
});
