import { describe, it, expect } from 'vitest';
import { ELEMENT_KINDS, faqSchema, planSchema, sectionSchema } from '../factory/texts/schema.mjs';

const ELEMENTS = ['title', 'text', 'list', 'table', 'cards', 'toggle', 'image', 'buttons', 'info', 'line', 'steps'];

// Strict mode is only strict if every object in the schema obeys it: additionalProperties must be
// false and every declared property must be listed as required. Checked over the whole tree rather
// than spot-checked, so a schema grown later cannot quietly break the guarantee.
function everyObjectIsStrict(node, path = 'schema') {
  const problems = [];
  if (Array.isArray(node)) {
    node.forEach((item, index) => problems.push(...everyObjectIsStrict(item, `${path}[${index}]`)));
    return problems;
  }
  if (node === null || typeof node !== 'object') return problems;
  if (node.type === 'object') {
    if (node.additionalProperties !== false) problems.push(`${path}: additionalProperties не false`);
    const declared = Object.keys(node.properties ?? {}).sort();
    const required = [...(node.required ?? [])].sort();
    if (JSON.stringify(declared) !== JSON.stringify(required)) {
      problems.push(`${path}: required ≠ properties (${required} против ${declared})`);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    problems.push(...everyObjectIsStrict(value, `${path}.${key}`));
  }
  return problems;
}

const SHAPE = { byType: { section: 9 }, faq: [5, 8], heroText: [1, 2], images: 1 };
// What each kind of block may hold, which is what the schema builds its enums from.
const SECTION = { title: [0, 1], text: [2, 6], list: [0, 1], table: [0, 1], cards: [0, 1] };
const HALF = { title: [0, 1], text: [1, 3], buttons: [0, 1] };

describe('planSchema', () => {
  const blocksOf = (schema) => schema.properties.blocks.properties;

  it('pins the count of each kind of block to exactly what the layout said', () => {
    const schema = planSchema(SHAPE, { section: SECTION });
    expect(blocksOf(schema).section.minItems).toBe(9);
    expect(blocksOf(schema).section.maxItems).toBe(9);
  });

  // The whole reason the plan is keyed by kind. Two kinds of content block are two different
  // questions: a half-and-half block holds a heading, a paragraph and a call to action; a section
  // holds tables and card sets besides. One shared list would offer the half-block a table it
  // cannot hold, and trimPlan would take every copy back off on arrival — the model paying for
  // output that is thrown away, which is the defect this whole argument exists to prevent.
  it('gives each kind of block its own list of what may go inside it', () => {
    const schema = planSchema(
      { ...SHAPE, byType: { section: 9, split: 2 } },
      { section: SECTION, split: HALF },
    );
    expect(blocksOf(schema).section.items.properties.elements.items.enum).toEqual([
      'title', 'text', 'list', 'table', 'cards',
    ]);
    expect(blocksOf(schema).split.items.properties.elements.items.enum).toEqual([
      'title', 'text', 'buttons',
    ]);
    expect(blocksOf(schema).split.minItems).toBe(2);
  });

  // The type is the theme's word, and a theme may call a block anything — including "title", which
  // at the top level would collide with the page's own title and quietly overwrite it.
  it('keeps the block kinds out of the page fields, so a block may be called anything', () => {
    const schema = planSchema({ ...SHAPE, byType: { title: 1 } }, { title: HALF });
    expect(schema.properties.title.type).toBe('string');
    expect(blocksOf(schema).title.minItems).toBe(1);
  });

  // What the layout did not pin down stays a range, and the model chooses inside it by the subject
  // of the page. A schema that collapsed every range to one number would take that choice away.
  it('leaves a range a range, so the model still chooses inside it', () => {
    const schema = planSchema(SHAPE, { section: SECTION });
    expect(schema.properties.faq.minItems).toBe(5);
    expect(schema.properties.faq.maxItems).toBe(8);
    expect(schema.properties.heroText.minItems).toBe(1);
    expect(schema.properties.heroText.maxItems).toBe(2);
  });

  // A picture exists because a block carries one. The plan names each, and cannot name more or
  // fewer: no budget to overshoot, no optional field to leave null, no name for a block with none.
  it('asks for exactly one name per picture the layout has', () => {
    const schema = planSchema({ ...SHAPE, images: 3 }, { section: SECTION });
    expect(schema.properties.images.minItems).toBe(3);
    expect(schema.properties.images.maxItems).toBe(3);
    expect(schema.properties.images.items.type).toBe('string');
  });

  it('asks for no names at all when the layout has no pictures', () => {
    const schema = planSchema({ ...SHAPE, images: 0 }, { section: SECTION });
    expect(schema.properties.images.maxItems).toBe(0);
  });

  // An element the layout pinned to zero is not on offer: the model would spend output on it and
  // trimPlan would take every copy back off, leaving a shorter block and a log full of removals.
  it('never offers an element the layout pinned to zero', () => {
    const schema = planSchema(SHAPE, { section: { ...SECTION, table: [0, 0] } });
    expect(blocksOf(schema).section.items.properties.elements.items.enum).not.toContain('table');
  });

  // The model used to choose where a picture belonged, section by section. It no longer can: the
  // field it chose with is gone, and with it the whole class of pictures placed where no block of
  // the theme was ever meant to hold one.
  it('no longer lets a block ask for a picture of its own', () => {
    const schema = planSchema(SHAPE, { section: SECTION });
    expect(blocksOf(schema).section.items.properties).not.toHaveProperty('image');
    expect(schema.properties).not.toHaveProperty('heroImage');
  });

  it('is strict everywhere', () => {
    expect(everyObjectIsStrict(planSchema(SHAPE, { section: SECTION }))).toEqual([]);
  });

  // An empty enum is a schema nothing can ever satisfy — a request that gets paid for and can only
  // ever fail. The kind that has nothing usable is named, since a page can hold several.
  it('refuses to build a schema for a kind with nothing usable in it, naming it', () => {
    expect(() => planSchema(SHAPE, { section: { video: [0, 1] } })).toThrow(/section/);
  });

  it('refuses a layout with no block the model writes at all', () => {
    expect(() => planSchema({ ...SHAPE, byType: {} }, {})).toThrow(/раскладке/);
  });
});

describe('sectionSchema', () => {
  it('describes every element kind the template declares, and no others', () => {
    const schema = sectionSchema(['text', 'list']);
    expect(Object.keys(schema.$defs).sort()).toEqual(['list', 'text']);
    expect(schema.properties.items.items.anyOf.map((ref) => ref.$ref)).toEqual([
      '#/$defs/text',
      '#/$defs/list',
    ]);
  });

  // The list is the contract between this module and docs/content-format.md: an element a theme
  // may declare but this module has no shape for is silently unwritable, and one described here but
  // absent from the format is a shape nothing can draw. Spelled out rather than counted, so adding
  // a kind is a deliberate edit here too.
  it('knows every kind of our content format, and only those', () => {
    expect([...ELEMENT_KINDS].sort()).toEqual([
      'buttons', 'cards', 'image', 'info', 'line', 'list', 'steps', 'table', 'text', 'title', 'toggle',
    ]);
    expect([...ELEMENT_KINDS].sort()).toEqual([...ELEMENTS].sort());
  });

  it('drops an element name it has no shape for instead of making one up', () => {
    const schema = sectionSchema(['text', 'video']);
    expect(Object.keys(schema.$defs)).toEqual(['text']);
  });

  it('refuses to build a schema with nothing in it', () => {
    expect(() => sectionSchema(['video'])).toThrow(/элемент/);
  });

  it('offers only h3, because the factory writes every section heading itself', () => {
    expect(sectionSchema(ELEMENTS).$defs.title.properties.level.enum).toEqual(['h3']);
  });

  it('is strict everywhere', () => {
    expect(everyObjectIsStrict(sectionSchema(ELEMENTS))).toEqual([]);
  });
});

describe('faqSchema', () => {
  it('pins the answer count and stays strict', () => {
    const schema = faqSchema(6);
    expect(schema.properties.answers.minItems).toBe(6);
    expect(schema.properties.answers.maxItems).toBe(6);
    expect(everyObjectIsStrict(schema)).toEqual([]);
  });
});
