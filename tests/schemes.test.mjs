import { describe, it, expect } from 'vitest';
import { listSchemes, readScheme } from '../src/lib/schemes.mjs';

function variablesOf(css) {
  return [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]).sort();
}

describe('colour schemes', () => {
  it('lists every scheme file in the folder', () => {
    expect(listSchemes()).toEqual(['blue', 'dark', 'green']);
  });

  it('reads the requested scheme', () => {
    const scheme = readScheme('green');
    expect(scheme.id).toBe('green');
    expect(scheme.fellBack).toBe(false);
    expect(scheme.css).toContain('--c-primary');
  });

  it('falls back to the first scheme when the id is unknown', () => {
    const scheme = readScheme('chartreuse');
    expect(scheme.id).toBe('blue');
    expect(scheme.fellBack).toBe(true);
  });

  it('falls back when no id is given at all', () => {
    expect(readScheme('').id).toBe('blue');
    expect(readScheme(undefined).id).toBe('blue');
  });

  it('defines the same variables in every scheme', () => {
    const [first, ...rest] = listSchemes();
    const expected = variablesOf(readScheme(first).css);
    expect(expected.length).toBeGreaterThan(5);
    for (const id of rest) {
      expect(variablesOf(readScheme(id).css)).toEqual(expected);
    }
  });
});
