import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { listSchemes, readScheme } from '../src/lib/schemes.mjs';

function variablesOf(css) {
  return [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]).sort();
}

// Walks styles/schemes/ directly instead of calling listSchemes() to build the expectation —
// otherwise this would just be checking the function against itself. Reading the directory
// independently means it still catches a scheme the module fails to report, or one it invents,
// while surviving a scheme being added or removed.
function schemeIdsOnDisk() {
  return readdirSync(join('styles', 'schemes'))
    .filter((name) => name.endsWith('.css'))
    .map((name) => name.slice(0, -'.css'.length))
    .sort();
}

describe('colour schemes', () => {
  it('lists every scheme file in the folder', () => {
    expect(listSchemes()).toEqual(schemeIdsOnDisk());
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
