import { describe, it, expect } from 'vitest';
import { asList, asText } from '../templates/_shared/props.mjs';

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
