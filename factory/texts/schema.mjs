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
  cards: object({
    kind: kind('cards'),
    cards: {
      type: 'array',
      items: object({ title: { type: 'string' }, text: { type: 'string' }, image: { type: ['string', 'null'] } }),
    },
  }),
  toggle: object({ kind: kind('toggle'), title: { type: 'string' }, text: { type: 'string' } }),
  image: object({ kind: kind('image'), name: { type: 'string' } }),
};

export const ELEMENT_KINDS = Object.freeze(Object.keys(ELEMENT_DEFS));

// The counts come from the skeleton, which has already rolled them, so minItems and maxItems are
// the same number: the model cannot return eight sections when the page is meant to have nine.
export function planSchema({ sections, faq }, elements) {
  const known = elements.filter((element) => Object.hasOwn(ELEMENT_DEFS, element));
  return object({
    title: { type: 'string' },
    description: { type: 'string' },
    h1: { type: 'string' },
    heroText: strings,
    heroImage: { type: ['string', 'null'] },
    sections: {
      type: 'array',
      minItems: sections,
      maxItems: sections,
      items: object({
        heading: { type: 'string' },
        brief: { type: 'string' },
        elements: { type: 'array', items: { type: 'string', enum: known } },
        image: { type: ['string', 'null'] },
        links: strings,
      }),
    },
    faq: { type: 'array', minItems: faq, maxItems: faq, items: { type: 'string' } },
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
