import { describe, it, expect } from 'vitest';
import { asList, asText, asRecords } from '../templates/_shared/props.mjs';

describe('block prop helpers', () => {
  it('keeps arrays as they are', () => {
    expect(asList([1, 2])).toEqual([1, 2]);
  });

  it('wraps a single value', () => {
    expect(asList('one')).toEqual(['one']);
  });

  it('turns empty values into an empty list', () => {
    expect(asList(undefined)).toEqual([]);
    expect(asList(null)).toEqual([]);
    expect(asList('')).toEqual([]);
  });

  it('drops empty entries', () => {
    expect(asList(['a', null, '', 'b'])).toEqual(['a', 'b']);
  });

  it('returns the fallback for non-strings', () => {
    expect(asText(42, 'fallback')).toBe('fallback');
    expect(asText('  ', 'fallback')).toBe('fallback');
    expect(asText('text', 'fallback')).toBe('text');
  });
});

describe('asRecords', () => {
  it('keeps plain objects from a list', () => {
    expect(asRecords([{ title: 'a' }, { title: 'b' }])).toEqual([{ title: 'a' }, { title: 'b' }]);
  });

  it('rejects array entries even though arrays are objects', () => {
    expect(asRecords([['nested', 'array'], { title: 'kept' }])).toEqual([{ title: 'kept' }]);
  });

  it('accepts an entry containing a nested object', () => {
    expect(asRecords([{ title: 'a', meta: { deep: true } }])).toEqual([
      { title: 'a', meta: { deep: true } },
    ]);
  });

  it('drops primitives and empty values', () => {
    expect(asRecords(['text', 42, true, null, undefined, ''])).toEqual([]);
  });

  it('wraps a single object value', () => {
    expect(asRecords({ solo: true })).toEqual([{ solo: true }]);
  });
});
