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
    const [first] = schemeIdsOnDisk();
    const scheme = readScheme(first);
    expect(scheme.id).toBe(first);
    expect(scheme.fellBack).toBe(false);
    expect(scheme.css).toContain('--c-primary');
  });

  it('falls back to the first scheme when the id is unknown', () => {
    const scheme = readScheme('chartreuse');
    expect(scheme.id).toBe(schemeIdsOnDisk()[0]);
    expect(scheme.fellBack).toBe(true);
  });

  it('falls back when no id is given at all', () => {
    const [first] = schemeIdsOnDisk();
    expect(readScheme('').id).toBe(first);
    expect(readScheme(undefined).id).toBe(first);
  });

  // Only one scheme ships right now, so this has nothing to compare against today. It is kept
  // because the moment a second scheme file appears it is what catches the one token whoever
  // wrote it forgot — a missing --accent-glow does not fail a build, it silently renders a
  // shadow of `none`.
  it('defines the same variables in every scheme', () => {
    const [first, ...rest] = listSchemes();
    const expected = variablesOf(readScheme(first).css);
    expect(expected.length).toBeGreaterThan(5);
    for (const id of rest) {
      expect(variablesOf(readScheme(id).css)).toEqual(expected);
    }
  });
});
