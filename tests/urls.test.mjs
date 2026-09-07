import { describe, it, expect } from 'vitest';
import { resolveOrigin } from '../src/lib/urls.mjs';

function usableAsBase(origin) {
  return () => new URL('/x', origin);
}

describe('resolveOrigin', () => {
  it('uses the Astro site origin when present', () => {
    const astroSite = new URL('https://astro-site.example/base/');
    const origin = resolveOrigin(astroSite, 'ignored.example');
    expect(origin).toBe('https://astro-site.example');
    expect(usableAsBase(origin)).not.toThrow();
  });

  it('adds https to a plain hostname', () => {
    const origin = resolveOrigin(undefined, 'example.com');
    expect(origin).toBe('https://example.com');
    expect(usableAsBase(origin)).not.toThrow();
  });

  it('does not double-prefix a hostname that already has a scheme', () => {
    const origin = resolveOrigin(undefined, 'http://foo.com');
    expect(origin).toBe('http://foo.com');
    expect(usableAsBase(origin)).not.toThrow();
  });

  it('strips a trailing slash from a plain hostname', () => {
    const origin = resolveOrigin(undefined, 'example.com/');
    expect(origin).toBe('https://example.com');
    expect(usableAsBase(origin)).not.toThrow();
  });

  it('strips a trailing slash from a hostname that already has a scheme', () => {
    const origin = resolveOrigin(undefined, 'https://example.com/');
    expect(origin).toBe('https://example.com');
    expect(usableAsBase(origin)).not.toThrow();
  });

  it('falls back to a safe default for a scheme with no host (https://)', () => {
    const origin = resolveOrigin(undefined, 'https://');
    expect(usableAsBase(origin)).not.toThrow();
    expect(new URL('/x', origin).href).toBe('https://example.com/x');
  });

  it('falls back to a safe default for a scheme with no host (http://)', () => {
    const origin = resolveOrigin(undefined, 'http://');
    expect(usableAsBase(origin)).not.toThrow();
    expect(new URL('/x', origin).href).toBe('https://example.com/x');
  });

  it('falls back to a safe default for an empty domain', () => {
    const origin = resolveOrigin(undefined, '');
    expect(usableAsBase(origin)).not.toThrow();
    expect(new URL('/x', origin).href).toBe('https://example.com/x');
  });

  it('keeps a hostname with a port usable', () => {
    const origin = resolveOrigin(undefined, 'example.com:8080');
    expect(origin).toBe('https://example.com:8080');
    expect(usableAsBase(origin)).not.toThrow();
  });

  it('does not throw for a domain value containing a path', () => {
    const origin = resolveOrigin(undefined, 'example.com/foo/bar');
    expect(usableAsBase(origin)).not.toThrow();
  });
});
