// The JSON schemas the model answers against. Strict mode constrains decoding itself, so these are
// not documentation — they are the thing that makes a malformed answer impossible.
//
// Two rules of strict mode shape everything below: every object must set additionalProperties to
// false, and every property it declares must be listed in `required`. A field that is genuinely
// optional is therefore expressed as "this type or null", not left out.
//
// The model answers in an intermediate shape keyed by `kind`, which assemble.mjs then turns into
// our real content format. That indirection exists because our format puts the heading level in the
// key itself ({ "type": "title", "h2": "…" }), and a schema cannot describe a key that varies.

// `enum` with a single value, not `const`: enum is on the documented list of keywords strict mode
// supports, and const is not. One less thing to be surprised by.
const kind = (name) => ({ type: 'string', enum: [name] });

// Exported: site-json.mjs builds a schema of its own and must obey the same two rules of strict
// mode. Two copies would be two places to get them wrong.
export const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const string = { type: 'string' };

// Declared after `string`, which it is built from: both are top-level `const`, so this cannot come
// first without tripping the temporal dead zone.
const strings = { type: 'array', items: string };

const ELEMENT_DEFS = {
  // Only h3. A page has exactly one h1, and every section's own h2 is written by the factory from
  // the plan, so the only heading left for the model is a subheading inside a section. Offering h2
  // here would let a section heading drift away from the table of contents built from those same
  // plan headings — the one mismatch this whole design exists to make impossible.
  title: object({ kind: kind('title'), level: { type: 'string', enum: ['h3'] }, text: { type: 'string' } }),
  text: object({ kind: kind('text'), text: { type: 'string' } }),
  list: object({ kind: kind('list'), items: strings }),
  table: object({ kind: kind('table'), columns: strings, rows: { type: 'array', items: strings } }),
  // A card has no picture here, though our content format allows one (see docs/content-format.md)
  // and a hand-written site may use it. This is generation: a picture belongs to a block that
  // carries one by its nature, and the factory places it. Left in, `image` was the one field the
  // model could still name a picture with — and naming one the plan had already declared reproduced
  // it, legitimately as far as every check was concerned, once per card. Nine card sets on one page
  // and the first screen's picture came out ten times, with no warning anywhere.
  cards: object({
    kind: kind('cards'),
    cards: {
      type: 'array',
      items: object({ title: { type: 'string' }, text: { type: 'string' } }),
    },
  }),
  toggle: object({ kind: kind('toggle'), title: { type: 'string' }, text: { type: 'string' } }),
  image: object({ kind: kind('image'), name: { type: 'string' } }),
  // A call to action. `href` is null far more often than not: a button with none goes to the site's
  // partner link, which is a setting of the build and not something the model could know or should
  // guess (see templates/review/elements/buttons.astro). It is offered at all so a button can point
  // at another page of this site — "see the full bonus terms" — rather than at the operator.
  buttons: object({
    kind: kind('buttons'),
    items: {
      type: 'array',
      items: object({ text: { type: 'string' }, href: { type: ['string', 'null'] } }),
    },
  }),
  // Short claims in a row under the first screen: "Live Dealers 24/7". Whatever pictogram one opens
  // with is part of its text — an emoji is a character, and a field of its own would make choosing
  // one the factory's job rather than the writer's.
  info: object({ kind: kind('info'), items: strings }),
  // A seam inside a block: what follows it is an aside about what came above. It carries nothing of
  // its own, but it is an element like any other so that its place in the run can be chosen.
  line: object({ kind: kind('line') }),
  // Numbered instructions: a short imperative and the explanation of it. Two fields rather than one
  // string with markup in it, because the two are drawn differently and our content format has no
  // way to say "bold" inside a sentence.
  steps: object({
    kind: kind('steps'),
    items: {
      type: 'array',
      items: object({ title: { type: 'string' }, text: { type: 'string' } }),
    },
  }),
};

export const ELEMENT_KINDS = Object.freeze(Object.keys(ELEMENT_DEFS));

// The counts come from the layout (see layouts.mjs's planShape), so the model cannot return eight
// sections when the page is meant to have nine. Where the layout left a range — what it did not
// pin down — the range reaches the schema as minItems/maxItems and the model chooses inside it, by
// the subject of the page. `sections` is always exact: a layout says how many blocks it has.
export function planSchema({ sections, faq, heroText, images }, elements) {
  // Same guard as sectionSchema, for the same reason: an empty `known` would leave every section's
  // `elements` field an `enum: []` — a schema nothing can ever satisfy, so the request would be
  // paid for and fail every single time.
  const known = elements.filter((element) => Object.hasOwn(ELEMENT_DEFS, element));
  if (known.length === 0) {
    throw new Error('ни один элемент шаблона не описан схемой — генерировать нечего');
  }
  return object({
    title: { type: 'string' },
    description: { type: 'string' },
    h1: { type: 'string' },
    heroText: { type: 'array', minItems: heroText[0], maxItems: heroText[1], items: string },
    // One name per picture the layout has, in the layout's own order — a plain list rather than a
    // field on each block, because a picture belongs to a place and places are what a layout lists.
    // Nothing here is nullable: a block with a picture has one. There is no budget to overshoot, no
    // optional field to leave null, and no way to name a picture for a block that has none.
    images: { type: 'array', minItems: images, maxItems: images, items: string },
    sections: {
      type: 'array',
      minItems: sections,
      maxItems: sections,
      items: object({
        heading: { type: 'string' },
        brief: { type: 'string' },
        elements: { type: 'array', items: { type: 'string', enum: known } },
        links: strings,
      }),
    },
    faq: { type: 'array', minItems: faq[0], maxItems: faq[1], items: { type: 'string' } },
  });
}

export function sectionSchema(elements) {
  // An element the template declares but this module has no shape for is dropped rather than
  // guessed at: inventing a shape would produce content the renderer cannot draw.
  const kinds = elements.filter((element) => Object.hasOwn(ELEMENT_DEFS, element));
  if (kinds.length === 0) {
    throw new Error('ни один элемент шаблона не описан схемой — генерировать нечего');
  }
  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: { anyOf: kinds.map((name) => ({ $ref: `#/$defs/${name}` })) },
      },
    },
    required: ['items'],
    additionalProperties: false,
    $defs: Object.fromEntries(kinds.map((name) => [name, ELEMENT_DEFS[name]])),
  };
}

// The FAQ is filled in one request: the questions are already in the plan, so only the answers come
// back, in the same order.
export function faqSchema(count) {
  return object({
    answers: { type: 'array', minItems: count, maxItems: count, items: { type: 'string' } },
  });
}
