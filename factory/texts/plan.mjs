import { askJson } from './openai.mjs';
import { planSchema } from './schema.mjs';
import { pageAddress, resolveLink } from './links.mjs';

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

// A picture "name" the model answers with becomes both a key in images.json and, later, a file
// name (factory/images/generate.mjs's own fileBaseFor) — so it has to already look like one, not
// like a sentence. Cut down to a short slug: lower-cased, its spaces and underscores turned to
// hyphens, everything else that is not a letter, digit or hyphen dropped outright (not replaced —
// "R&D" becomes "rd", not "r-d"), repeated hyphens collapsed, trimmed, and capped at a sensible
// length. Unlike fileBaseFor, this never falls back to a placeholder name: a name with nothing
// usable in it must be dropped by the caller, the same as one that is simply over budget.
const MAX_IMAGE_NAME_LENGTH = 60;

function slugifyImageName(raw) {
  return raw
    .toLowerCase()
    .replace(/[ _]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_IMAGE_NAME_LENGTH)
    // A cut can land mid-hyphen-run, same reason fileBaseFor re-trims after its own slice.
    .replace(/-+$/g, '');
}

// 'logo' and 'logo-square' are factory/images/logo.mjs's LOGO_NAME and SQUARE_NAME — the two keys
// only the logo step is ever allowed to write into images.json (factory/images/generate.mjs's own
// RESERVED_FOR_LOGO skips them for exactly this reason). Duplicated here as plain strings rather
// than imported: this stage is meant to produce nothing but a folder of JSON and never reach into a
// later stage's module (see docs/specs/2026-09-17-text-generation-design.md — logo, images and the
// build "работают дальше как есть и об этом этапе не знают"), and importing logo.mjs would drag its
// own dependencies (compose.mjs's `sharp`) into text generation for the sake of two string literals
// that every downstream consumer already treats as fixed. If a plan's slug lands on either name
// anyway it is dropped like any other unusable one: on a brand-new site the images step would drop
// it too, but log it as "reserved for the logo" — confusing for a picture that was never meant to be
// one; on a site that already has its logo, the images step would instead silently reuse that
// actual logo image in the middle of a section, with no warning anywhere. Guarding here avoids both.
const RESERVED_IMAGE_NAMES = new Set(['logo', 'logo-square']);

// The schema already pins the number of sections and questions. What it cannot express is a budget
// spread across the page (pictures) or a per-kind limit inside one list (at most one table), so
// those are enforced here, by trimming rather than by refusing: a plan that is slightly too rich is
// still a good plan once the extras are taken off. Trimming only ever removes — it cannot manufacture
// a missing element out of nothing — so there is no matching check for too few; every removal is
// still written to `warnings` so the run's log says what happened.
export function trimPlan(plan, { budgets, pages, sectionContent }) {
  const warnings = [];

  let imagesLeft = budgets.images;

  // Normalises a picture name and only then spends the page's picture budget — in that order, so a
  // name that turns out to be unusable or reserved for the logo never eats a slot that a later,
  // real picture on the same page could have used instead.
  const claimImage = (raw, where) => {
    if (!raw) return null;
    const slug = slugifyImageName(raw);
    if (!slug) {
      warnings.push(`картинка «${raw}» ${where} — от имени не осталось ярлыка — убрана`);
      return null;
    }
    if (RESERVED_IMAGE_NAMES.has(slug)) {
      warnings.push(`картинка «${raw}» ${where} — имя «${slug}» занято логотипом — убрана`);
      return null;
    }
    if (imagesLeft <= 0) {
      warnings.push(`картинка «${slug}» ${where} сверх бюджета — убрана`);
      return null;
    }
    imagesLeft -= 1;
    return slug;
  };

  const heroImage = claimImage(plan.heroImage ?? null, 'в шапке');

  // Two budgets, same reasoning as pictures above: a page that came back too rich in links is still
  // a good page once the excess is gone. `links` is optional on `budgets` — a caller that does not
  // pass it (any template with no `links` entry in its content.json) gets no cap at all, rather than
  // the harshest possible one.
  const maxLinksPerSection = budgets.links?.section?.[1] ?? Infinity;
  let pageLinksLeft = budgets.links?.page?.[1] ?? Infinity;

  const sections = plan.sections.map((section) => {
    const image = claimImage(section.image ?? null, `в разделе «${section.heading}»`);

    // A link that recognisably names a page of this site is repaired to that page's canonical
    // address rather than discarded — the brief hands the model page names, not a spelling rule
    // (see planPage below), so a bare name or an obvious near-miss is the model doing the expected
    // thing, not a mistake. Only a target that names no page of this site is still reported and
    // dropped. Budgets are spent in the order links arrive, section by section: the earliest link on
    // the page is worth more than a repeat further down, so it is the later ones that give way.
    let sectionLinksLeft = maxLinksPerSection;
    const links = section.links
      .map((href) => {
        const canonical = resolveLink(href, pages);
        if (canonical === null) {
          warnings.push(`ссылка ${href} в разделе «${section.heading}» ведёт в никуда — убрана`);
          return null;
        }
        if (sectionLinksLeft <= 0) {
          warnings.push(`ссылка ${canonical} в разделе «${section.heading}» сверх бюджета ссылок на раздел — убрана`);
          return null;
        }
        if (pageLinksLeft <= 0) {
          warnings.push(`ссылка ${canonical} в разделе «${section.heading}» сверх бюджета ссылок на страницу — убрана`);
          return null;
        }
        sectionLinksLeft -= 1;
        pageLinksLeft -= 1;
        return canonical;
      })
      .filter(Boolean);

    // An `image` element left over once its picture is gone — trimmed above for the budget, or
    // simply never named one to begin with — has nothing left to point at. Left in, fillSection
    // still asks the model to write it, the model invents a name, and assemble.mjs accepts that
    // name whenever it happens to match some other picture the plan did declare (the hero's, most
    // often — it is rarely trimmed, being first in line for the budget). That is the budget being
    // satisfied on paper and exceeded in the file, so this element is dropped in the same pass that
    // already knows whether `image` above is null, before the per-kind cap below ever sees it.
    const used = new Map();
    const elements = section.elements.filter((element) => {
      if (element === 'image' && !image) {
        warnings.push(`элемент image в разделе «${section.heading}» без картинки — убран`);
        return false;
      }
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
  { page, pages, brand, geo, locale, budgets, sectionContent, instructions },
  options,
) {
  // The elements a plan may offer for a section come from sectionContent itself, never from the
  // template's whole vocabulary (manifest.json's `elements`) — a template can genuinely support an
  // element only inside some other block (this template's `toggle`, real for its `faq` block), and
  // trimPlan below measures a section only against sectionContent. Manifest and sectionContent used
  // to be handed in separately, and the two disagreeing is exactly how a plan got offered `toggle`
  // for an ordinary section, had all six copies stripped by trimPlan for being over the template's
  // (zero) allowance, and lost the section entirely. One source here leaves nothing to disagree with.
  const elements = Object.keys(sectionContent);

  // What we hand the model here used to be the bare file names ("home", "casino"), while trimPlan
  // accepted only written addresses ("/", "/casino") — home's above all, since it is never "/home".
  // The model then echoed back exactly what it was given, or the obvious slash-prefixed guess, and
  // trimPlan threw both away. Telling it the real addresses, and saying plainly that a link must
  // spell one of them, fixes the instruction rather than the symptom; resolveLink in trimPlan below
  // still repairs a near-miss, for whatever the model does anyway.
  const addresses = pages.map(pageAddress);
  const maxPageLinks = budgets.links?.page?.[1];
  const budgetLine = Number.isFinite(maxPageLinks)
    ? `This page has ${budgets.sections} sections, ${budgets.faq} FAQ questions, at most ${budgets.images} pictures and at most ${maxPageLinks} internal links.`
    : `This page has ${budgets.sections} sections, ${budgets.faq} FAQ questions and at most ${budgets.images} pictures.`;
  const brief = [
    `Brand: ${brand}`,
    `Geo: ${geo}`,
    `Language: ${locale}`,
    `Page: ${page}`,
    `Pages on this site: ${addresses.join(', ')}`,
    'A link to another page of this site must use one of those exact addresses.',
    budgetLine,
    'Plan the page: a heading and a one-line brief for each section, which elements suit it, where a',
    'picture belongs and which other pages are worth linking to. Do not write the body text yet.',
    'Name every picture with a short hyphenated slug, such as "live-dealer-table" — never a sentence.',
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
