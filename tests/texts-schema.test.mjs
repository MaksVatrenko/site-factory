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

const SHAPE = { byType: { section: 9 }, faq: 7, images: 1 };

describe('planSchema', () => {
  const blocksOf = (schema) => schema.properties.blocks.properties;

  it('pins the count of each kind of block to exactly what the example had', () => {
    const schema = planSchema(SHAPE);
    expect(blocksOf(schema).section.minItems).toBe(9);
    expect(blocksOf(schema).section.maxItems).toBe(9);
  });

  // The whole reason the plan is keyed by kind. Two kinds of content block are two different
  // questions — a half-and-half block and a section are not interchangeable — and one shared list
  // would describe them as though they were.
  it('gives each kind of block its own list', () => {
    const schema = planSchema({ ...SHAPE, byType: { section: 9, split: 2 } });
    expect(blocksOf(schema).section.minItems).toBe(9);
    expect(blocksOf(schema).split.minItems).toBe(2);
  });

  // The type is the theme's word, and a theme may call a block anything — including "title", which
  // at the top level would collide with the page's own title and quietly overwrite it.
  it('keeps the block kinds out of the page fields, so a block may be called anything', () => {
    const schema = planSchema({ ...SHAPE, byType: { title: 1 } });
    expect(schema.properties.title.type).toBe('string');
    expect(blocksOf(schema).title.minItems).toBe(1);
  });

  // Exactly as many questions as the example's own FAQ holds. In v1 this was a range the model
  // chose inside; the page being matched has a number, so the schema has one too.
  it('pins the FAQ to exactly as many questions as the example had', () => {
    const schema = planSchema(SHAPE);
    expect(schema.properties.faq.minItems).toBe(7);
    expect(schema.properties.faq.maxItems).toBe(7);
  });

  // A picture exists because the theme puts one in that block. The plan names each, and cannot name
  // more or fewer: no budget to overshoot, no optional field to leave null, no name for a block
  // with none.
  it('asks for exactly one name per picture the theme places', () => {
    const schema = planSchema({ ...SHAPE, images: 3 });
    expect(schema.properties.images.minItems).toBe(3);
    expect(schema.properties.images.maxItems).toBe(3);
    expect(schema.properties.images.items.type).toBe('string');
  });

  it('asks for no names at all when the page has no pictures', () => {
    expect(planSchema({ ...SHAPE, images: 0 }).properties.images.maxItems).toBe(0);
  });

  // The model used to choose where a picture belonged, section by section. It no longer can: the
  // field it chose with is gone, and with it the whole class of pictures placed where no block of
  // the theme was ever meant to hold one.
  it('no longer lets a block ask for a picture of its own', () => {
    const schema = planSchema(SHAPE);
    expect(blocksOf(schema).section.items.properties).not.toHaveProperty('image');
    expect(schema.properties).not.toHaveProperty('heroImage');
  });

  // The change v2 is for. The example says what goes inside a block, element by element and in
  // order, so the question is not asked at all: an answer nobody reads is output paid for, and one
  // that disagreed with the page about to be built from it would be worse than useless.
  it('never asks what goes inside a block: the example already said', () => {
    const item = blocksOf(planSchema(SHAPE)).section.items;
    expect(item.properties).not.toHaveProperty('elements');
    expect(item.required).not.toContain('elements');
    // The rest of the question stands: what the block is about is still the model's to write.
    expect(item.properties).toHaveProperty('heading');
    expect(item.properties).toHaveProperty('brief');
    expect(item.properties).toHaveProperty('links');
  });

  it('is strict everywhere', () => {
    expect(everyObjectIsStrict(planSchema(SHAPE))).toEqual([]);
  });

  it('refuses an example with no block the model writes at all', () => {
    expect(() => planSchema({ ...SHAPE, byType: {} })).toThrow(/примере/);
  });
});

describe('sectionSchema', () => {
  // The count is decoded against, not asked for in prose. By the time a block is filled its list of
  // elements is concrete — the layout spelled it out, or the plan chose it — so "three paragraphs,
  // a list and a line" is six items, and a model that would rather write four cannot. Which kinds
  // stand where the brief still has to ask: strict mode cannot pin a kind to a position.
  it('pins the number of items to the number of elements asked for', () => {
    const schema = sectionSchema(['text', 'text', 'text', 'list']);
    expect(schema.properties.items.minItems).toBe(4);
    expect(schema.properties.items.maxItems).toBe(4);
  });

  it('describes a repeated kind once, however many times it was asked for', () => {
    const schema = sectionSchema(['text', 'text', 'text']);
    expect(Object.keys(schema.$defs)).toEqual(['text']);
    expect(schema.properties.items.items.anyOf).toHaveLength(1);
  });

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
