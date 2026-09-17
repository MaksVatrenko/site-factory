import { describe, it, expect } from 'vitest';
import { rollSkeleton } from '../factory/texts/skeleton.mjs';

const CONTENT = {
  blocks: [
    { type: 'hero', auto: false, count: [1, 1], content: { title: [1, 1], text: [1, 2] } },
    { type: 'toc', auto: true, count: [1, 1], content: {} },
    { type: 'section', auto: false, count: [8, 10], content: { title: [1, 1], text: [2, 6] } },
    { type: 'links', auto: true, count: [1, 1], content: {} },
    { type: 'faq', auto: false, count: [1, 1], content: { title: [1, 1], toggle: [5, 8] } },
  ],
  images: [0, 3],
  lengths: {},
  home: { sectionsBonus: 2 },
};
const PAGES = ['home', 'casino', 'slots', 'bonus'];

describe('rollSkeleton', () => {
  it('gives every page a section, faq and image count inside the template ranges', () => {
    const skeleton = rollSkeleton({ content: CONTENT, pages: PAGES, seed: '520bdapp' });
    expect(Object.keys(skeleton).sort()).toEqual([...PAGES].sort());
    for (const page of ['casino', 'slots', 'bonus']) {
      expect(skeleton[page].sections).toBeGreaterThanOrEqual(8);
      expect(skeleton[page].sections).toBeLessThanOrEqual(10);
      expect(skeleton[page].faq).toBeGreaterThanOrEqual(5);
      expect(skeleton[page].faq).toBeLessThanOrEqual(8);
      expect(skeleton[page].images).toBeGreaterThanOrEqual(0);
      expect(skeleton[page].images).toBeLessThanOrEqual(3);
    }
  });

  // Re-running a stopped generation must not reshuffle the pages that already exist.
  it('gives the same answer for the same seed', () => {
    const first = rollSkeleton({ content: CONTENT, pages: PAGES, seed: '520bdapp' });
    const second = rollSkeleton({ content: CONTENT, pages: PAGES, seed: '520bdapp' });
    expect(second).toEqual(first);
  });

  // This is the whole point of rolling at all: two sites in one network must not share a skeleton.
  it('gives different answers for different seeds', () => {
    const a = rollSkeleton({ content: CONTENT, pages: PAGES, seed: 'site-one' });
    const b = rollSkeleton({ content: CONTENT, pages: PAGES, seed: 'site-two' });
    expect(a).not.toEqual(b);
  });

  it('makes the home page longer than the range alone allows', () => {
    const skeleton = rollSkeleton({ content: CONTENT, pages: PAGES, seed: '520bdapp' });
    expect(skeleton.home.sections).toBeGreaterThanOrEqual(8 + 2);
    expect(skeleton.home.sections).toBeLessThanOrEqual(10 + 2);
  });

  it('does not care in which order the pages are given', () => {
    const forwards = rollSkeleton({ content: CONTENT, pages: PAGES, seed: 'x' });
    const backwards = rollSkeleton({ content: CONTENT, pages: [...PAGES].reverse(), seed: 'x' });
    expect(backwards).toEqual(forwards);
  });

  it('survives a template with no faq block and no image budget', () => {
    const content = {
      ...CONTENT,
      blocks: CONTENT.blocks.filter((block) => block.type !== 'faq'),
      images: [0, 0],
    };
    const skeleton = rollSkeleton({ content, pages: ['home'], seed: 'x' });
    expect(skeleton.home.faq).toBe(0);
    expect(skeleton.home.images).toBe(0);
  });
});
