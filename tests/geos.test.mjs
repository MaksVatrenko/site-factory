import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGeos } from '../factory/geos.mjs';

let dirs = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function geosFile(body) {
  const dir = mkdtempSync(join(tmpdir(), 'site-factory-geos-'));
  dirs.push(dir);
  const file = join(dir, 'geos.json');
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
}

describe('loadGeos', () => {
  it('loads the geos file the factory ships with', () => {
    // Read independently of loadGeos, the same principle tests/server.test.mjs's
    // templateIdsOnDisk/schemeIdsOnDisk helpers use: building the expectation by calling the
    // function under test would only check it against itself.
    const raw = JSON.parse(readFileSync(join('factory', 'geos.json'), 'utf8'));
    const loaded = loadGeos(join('factory', 'geos.json'));
    expect(loaded.languageByGeo).toEqual(raw);
    expect(loaded.countries).toEqual(Object.keys(raw));
    expect(loaded.locales).toEqual([...new Set(Object.values(raw))]);
  });

  // The owner puts the countries they use most at the top on purpose, meaning to see that same
  // order in the dropdown — a table keyed by country name has no natural order of its own to fall
  // back on, so this is the one thing loadGeos must never silently "fix" with a sort.
  it("preserves the file's own order in countries, and locales in the order they first appear", () => {
    const file = geosFile({ Brazil: 'pt-BR', Algeria: 'ar-DZ', Mexico: 'es-MX', Pakistan: 'ar-DZ' });
    const loaded = loadGeos(file);
    expect(loaded.countries).toEqual(['Brazil', 'Algeria', 'Mexico', 'Pakistan']);
    // Algeria and Pakistan share a locale — it must appear once, where it was first seen (Algeria).
    expect(loaded.locales).toEqual(['pt-BR', 'ar-DZ', 'es-MX']);
  });

  it('trims each locale', () => {
    const loaded = loadGeos(geosFile({ Mexico: '  es-MX  ' }));
    expect(loaded.languageByGeo.Mexico).toBe('es-MX');
  });

  it('refuses a file that is not an object', () => {
    const file = geosFile(['Bangladesh']);
    expect(() => loadGeos(file)).toThrow(/страна.*язык/);
  });

  it('refuses a table whose value is not a non-empty string', () => {
    expect(() => loadGeos(geosFile({ Mexico: 5 }))).toThrow(/страна.*язык/);
    expect(() => loadGeos(geosFile({ Mexico: '  ' }))).toThrow(/страна.*язык/);
  });

  it('refuses a file that is not JSON, naming the file', () => {
    const file = geosFile('{ not json');
    expect(() => loadGeos(file)).toThrow(/не удалось прочитать файл гео/);
    expect(() => loadGeos(file)).toThrow(new RegExp(file.replace(/[/\\]/g, '.')));
  });

  it('refuses a missing file, naming it', () => {
    const file = join(tmpdir(), 'site-factory-geos-does-not-exist', 'geos.json');
    expect(() => loadGeos(file)).toThrow(new RegExp(file.replace(/[/\\]/g, '.')));
  });
});
