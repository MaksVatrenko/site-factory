import { askJson } from './openai.mjs';
import { planSchema } from './schema.mjs';

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

// The schema already pins the number of sections and questions. What it cannot express is a budget
// spread across the page (pictures) or a per-kind limit inside one list (at most one table), so
// those are enforced here, by trimming rather than by refusing: a plan that is slightly too rich is
// still a good plan once the extras are taken off. Trimming only ever removes — it cannot manufacture
// a missing element out of nothing — so there is no matching check for too few; every removal is
// still written to `warnings` so the run's log says what happened.
export function trimPlan(plan, { budgets, pages, sectionContent }) {
  const warnings = [];
  const allowed = new Set(pages.map((page) => (page === 'home' ? '/' : `/${page}`)));

  let imagesLeft = budgets.images;
  let heroImage = plan.heroImage ?? null;
  if (heroImage && imagesLeft > 0) {
    imagesLeft -= 1;
  } else if (heroImage) {
    warnings.push(`картинка «${heroImage}» в шапке сверх бюджета — убрана`);
    heroImage = null;
  }

  const sections = plan.sections.map((section) => {
    let image = section.image ?? null;
    if (image && imagesLeft > 0) imagesLeft -= 1;
    else if (image) {
      warnings.push(`картинка «${image}» в разделе «${section.heading}» сверх бюджета — убрана`);
      image = null;
    }

    const links = section.links.filter((href) => {
      const ok = allowed.has(href) || href.startsWith('#');
      if (!ok) warnings.push(`ссылка ${href} в разделе «${section.heading}» ведёт в никуда — убрана`);
      return ok;
    });

    const used = new Map();
    const elements = section.elements.filter((element) => {
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
  { page, pages, brand, geo, locale, budgets, elements, sectionContent, instructions },
  options,
) {
  const brief = [
    `Brand: ${brand}`,
    `Geo: ${geo}`,
    `Language: ${locale}`,
    `Page: ${page}`,
    `Pages on this site: ${pages.join(', ')}`,
    `This page has ${budgets.sections} sections, ${budgets.faq} FAQ questions and at most ${budgets.images} pictures.`,
    'Plan the page: a heading and a one-line brief for each section, which elements suit it, where a',
    'picture belongs and which other pages are worth linking to. Do not write the body text yet.',
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
