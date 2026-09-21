import { askJson } from './openai.mjs';
import { planSchema } from './schema.mjs';
import { pageAddress, resolveLink, isSelfLink } from './links.mjs';

// Stage one: what the page is about, before a word of it is written. The answer is small and cheap,
// which is the point — it buys coherence (sections that do not repeat one another, links spread
// sensibly) without paying for prose until the shape is agreed.

// Everything the model is told that does not change from request to request, which is what the
// prompt cache actually caches (see docs/prompts.md). In v1 this was the same for a whole run, so
// the cache carried across pages. It cannot be any more: the examples belong to a page, and they
// are the largest thing here by far. So the cache carries within a page instead — the first of a
// page's twelve requests pays for its examples in full and the other eleven read them back — and
// every cache key below names the page, or the entries would evict each other for no gain.
//
// Nothing page-specific beyond the examples may be added: one changed byte and every later request
// of the page pays full price.
export function buildInstructions({ rules, examples }) {
  const parts = [
    'You are writing content for a website. Return only what the schema asks for.',
    rules.join('\n'),
    // The structure is not described in words at all. It is pinned by the schema, element by
    // element, from the example itself — a sentence about it could only repeat that or contradict it.
    'Finished pages of this kind, taken from other sites. Follow their structure, their depth and',
    'the subjects they cover. Never follow their wording, and never mention their brands:',
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

// A slug with no latin letter left in it is not a name, it is what survived the stripping. The
// model writes in the site's language, and a picture named in Cyrillic, Bengali or Arabic loses
// every one of its letters here — "рулетка 2024" comes out as "2024", which passes every check,
// becomes a key in images.json and a file name, and tells the picture stage nothing at all about
// what to draw. Dropping it turns a silent wrong picture into a line in the log. A name that keeps
// a word ("899ok лобби" → "899ok") is kept, but reported: it did lose something.
const hasLatinLetter = (slug) => /[a-z]/.test(slug);
const hasForeignLetter = (raw) => /\p{Letter}/u.test(raw.replace(/[a-zA-Z]/g, ''));

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

// The schema already pins the number of sections, questions and pictures. What it cannot express is
// a per-kind limit inside one list (at most one table), a picture name that has to look like a file
// name, or a link that has to name a real page — so those are enforced here, by trimming rather
// than by refusing: a plan that is slightly too rich is still a good plan once the extras are taken
// off. Trimming only ever removes — it cannot manufacture a missing element out of nothing — so
// there is no matching check for too few; every removal is written to `warnings` so the run's log
// says what happened.
export function trimPlan(plan, { links, pages, page, order = [], imageLabels = [] }) {
  const warnings = [];

  // No budget left to spend: a picture exists because a block carries one by its nature, and the
  // schema already pinned how many names come back. All that is left is whether a name is usable.
  // A name that is not leaves its block without a picture — inventing one instead would put a made-
  // up name into images.json and get it drawn, which is worse than a block with no picture.
  const taken = new Set();
  const claimImage = (raw, where) => {
    if (!raw) return null;
    const slug = slugifyImageName(raw);
    if (!slug || !hasLatinLetter(slug)) {
      warnings.push(`картинка «${raw}» ${where} — от имени не осталось ярлыка — убрана`);
      return null;
    }
    if (hasForeignLetter(raw)) {
      warnings.push(`картинка «${raw}» ${where} названа не латиницей — осталось «${slug}», стоит проверить`);
    }
    if (RESERVED_IMAGE_NAMES.has(slug)) {
      warnings.push(`картинка «${raw}» ${where} — имя «${slug}» занято логотипом — убрана`);
      return null;
    }
    // Two blocks of one page naming one picture reads as a fault of the factory, not as a choice:
    // the same image drawn twice on the way down the page. The first keeps the name.
    if (taken.has(slug)) {
      warnings.push(`картинка «${slug}» ${where} уже есть выше на странице — убрана`);
      return null;
    }
    taken.add(slug);
    return slug;
  };

  const images = (plan.images ?? []).map((raw, index) =>
    claimImage(raw, `для блока «${imageLabels[index] ?? index + 1}»`),
  );

  // Two budgets, which do survive: they exist to stop link spam, not to ration anything the example
  // decides. `links` is optional here because trimPlan is also called directly by its own tests —
  // through generateSite it always arrives, since loadTemplatePictures fills both budgets in, with a
  // default of no links at all for a theme that says nothing about them. So this `?? Infinity` is
  // a fallback for a caller that leaves the argument out, not the "theme said nothing" case: that
  // one already arrives as zero.
  const maxLinksPerSection = links?.perBlock?.[1] ?? Infinity;
  let pageLinksLeft = links?.perPage?.[1] ?? Infinity;

  // Walked in the order the blocks stand on the page, not in the order the plan lists them. The
  // plan holds one array per kind of block, because each kind is asked for with its own list of
  // elements — but the per-page link budget is spent top to bottom, so a block near the top is
  // worth more than a repeat further down, whatever kind either of them is.
  // With no order given — a caller that has no layout in hand, which is every direct caller outside
  // generateSite — each kind is walked in turn. That is the right answer whenever a page holds one
  // kind, and the only sensible one when nothing says what follows what.
  const pageOrder = order.length > 0
    ? order
    : Object.entries(plan.blocks ?? {}).flatMap(([type, list]) => list.map(() => type));

  const next = new Map();
  const blocks = {};
  for (const type of pageOrder) {
    const at = next.get(type) ?? 0;
    next.set(type, at + 1);
    const section = plan.blocks?.[type]?.[at];
    if (!section) continue;
    (blocks[type] ??= []).push(trimOne(section));
  }

  function trimOne(section) {
    // A link that recognisably names a page of this site is repaired to that page's canonical
    // address rather than discarded — the brief hands the model page names, not a spelling rule
    // (see planPage below), so a bare name or an obvious near-miss is the model doing the expected
    // thing, not a mistake. Only a target that names no page of this site is still reported and
    // dropped. Budgets are spent in the order links arrive, section by section: the earliest link on
    // the page is worth more than a repeat further down, so it is the later ones that give way.
    //
    // A link back to this same page is checked before either budget: planPage's brief already
    // leaves this page's own address out of what it offers, so a self-link only ever reaches here
    // when the model writes one anyway, and it must not be allowed to spend a budget slot on its way
    // out — doing so would still displace a link to a different page, just silently instead of by
    // name, which is exactly the harm this whole budget exists to prevent (see links.mjs).
    let sectionLinksLeft = maxLinksPerSection;
    const links = section.links
      .map((href) => {
        const canonical = resolveLink(href, pages);
        if (canonical === null) {
          warnings.push(`ссылка ${href} в разделе «${section.heading}» ведёт в никуда — убрана`);
          return null;
        }
        if (isSelfLink(canonical, page)) {
          warnings.push(`ссылка ${canonical} в разделе «${section.heading}» ведёт на саму страницу — убрана`);
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

    // What goes inside a block is the example's, not the plan's: the schema never asked, so
    // there is nothing here to cap. In v1 this was where a section that came back with two tables
    // lost one of them.
    return { ...section, links };
  }

  return { plan: { ...plan, images, blocks }, warnings };
}

export async function planPage({ page, pages, brand, geo, locale, shape, links, instructions }, options) {
  // What we hand the model here used to be the bare file names ("home", "casino"), while trimPlan
  // accepted only written addresses ("/", "/casino") — home's above all, since it is never "/home".
  // The model then echoed back exactly what it was given, or the obvious slash-prefixed guess, and
  // trimPlan threw both away. Telling it the real addresses, and saying plainly that a link must
  // spell one of them, fixes the instruction rather than the symptom; resolveLink in trimPlan below
  // still repairs a near-miss, for whatever the model does anyway.
  //
  // This page's own address is left out of the list: offering a page a link to itself as something
  // "worth linking to" is exactly how the live run spent five of slots.json's eight links pointing
  // back at /slots. trimPlan's own isSelfLink check below still catches one the model writes anyway.
  const addresses = pages
    .filter((candidate) => pageAddress(candidate) !== pageAddress(page))
    .map(pageAddress);
  const maxPageLinks = links?.perPage?.[1];
  // The example decided the composition, so the brief states it rather than asking for it. Nothing
  // here is a range any more: the page being matched already has one of everything.
  //
  // Named by kind, because a page can hold more than one: nine sections and two half-and-half
  // blocks are nine plus two different things to plan, and calling them all "sections" would tell
  // the model that eleven interchangeable blocks are what it is writing.
  const composition = Object.entries(shape.byType)
    .map(([type, howMany]) => `${howMany} ${type}`)
    .join(', ');
  const shapeLine = Number.isFinite(maxPageLinks)
    ? `This page is made of: ${composition}. It has ${shape.faq} FAQ questions and at most ${maxPageLinks} internal links.`
    : `This page is made of: ${composition}. It has ${shape.faq} FAQ questions.`;
  // Where the pictures go is settled: each one belongs to a block that carries one by nature. The
  // model is asked only to name them, and told which block each name is for, so a name can mean
  // something — "hero" says nothing about a picture, "slot-reels" says what to draw.
  const pictureLines = shape.imageLabels.length > 0
    ? [
        // Latin letters, said outright: the name becomes a file name, and everything outside
        // [a-z0-9-] is stripped from it. A name written in the language of the site — which is what
        // every other instruction asks for — survives that as nothing, or as the one digit that
        // happened to be in it.
        'Pictures on this page, in this order. Name each with a short hyphenated slug in latin',
        'letters, such as "live-dealer-table" — never a sentence, and never in the page language,',
        'because the name becomes a file name:',
        ...shape.imageLabels.map((label, index) => `${index + 1}. ${label}`),
      ]
    : [];
  const brief = [
    `Brand: ${brand}`,
    `Geo: ${geo}`,
    `Language: ${locale}`,
    `Page: ${page}`,
    `Pages on this site: ${addresses.join(', ')}`,
    'A link to another page of this site must use one of those exact addresses.',
    shapeLine,
    ...pictureLines,
    // What goes inside a section is not asked: the example already said, element by element and
    // in order, and the schema leaves the model no field to answer in.
    'Plan the page: a heading and a one-line brief for each section, and which other pages are',
    'worth linking to from it. Do not write the body text yet.',
  ].join('\n');

  const { data, cost, usage } = await askJson(
    {
      instructions,
      input: brief,
      schemaName: 'page_plan',
      schema: planSchema(shape),
      // One cache per call type: the schema is part of the cached prefix, and plan and fill have
      // different schemas, so they cannot share an entry anyway.
      // Named by page: the instructions above hold this page's own examples, so a key shared with
      // another page would have the two evicting each other's cache entry on every request.
      cacheKey: `site-factory-plan:${page}`,
    },
    options,
  );

  const { plan, warnings } = trimPlan(data, {
    links,
    pages,
    page,
    order: shape.order,
    imageLabels: shape.imageLabels,
  });
  return { plan, warnings, cost, usage };
}
