import { describe, it, expect } from 'vitest';
import { ELEMENT_KINDS, faqSchema, planSchema, sectionSchema } from '../factory/texts/schema.mjs';

const ELEMENTS = ['title', 'text', 'list', 'table', 'cards', 'toggle', 'image'];

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

describe('planSchema', () => {
  it('pins the section and faq counts to exactly what the skeleton rolled', () => {
    const schema = planSchema({ sections: 9, faq: 6 }, ELEMENTS);
    expect(schema.properties.sections.minItems).toBe(9);
    expect(schema.properties.sections.maxItems).toBe(9);
    expect(schema.properties.faq.minItems).toBe(6);
    expect(schema.properties.faq.maxItems).toBe(6);
  });

  it('offers only the elements this template can render', () => {
    const schema = planSchema({ sections: 2, faq: 2 }, ['text', 'list']);
    expect(schema.properties.sections.items.properties.elements.items.enum).toEqual(['text', 'list']);
  });

  // Optional fields cannot be left out in strict mode; they are expressed as "or null" instead.
  it('lets the hero and a section have no picture, without dropping the field', () => {
    const schema = planSchema({ sections: 2, faq: 2 }, ELEMENTS);
    expect(schema.properties.heroImage.type).toEqual(['string', 'null']);
    expect(schema.properties.sections.items.properties.image.type).toEqual(['string', 'null']);
    expect(schema.required).toContain('heroImage');
  });

  it('is strict everywhere', () => {
    expect(everyObjectIsStrict(planSchema({ sections: 9, faq: 6 }, ELEMENTS))).toEqual([]);
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

  it('knows all seven kinds of our content format', () => {
    expect([...ELEMENT_KINDS].sort()).toEqual([...ELEMENTS].sort());
    expect(Object.keys(sectionSchema(ELEMENTS).$defs)).toHaveLength(7);
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
