import { describe, it, expect } from 'vitest';
import { pageAddress, resolveLink } from '../factory/texts/links.mjs';

const PAGES = ['home', 'casino', 'slots', 'games'];

describe('pageAddress', () => {
  it('gives home the site root and every other page its own name', () => {
    expect(pageAddress('home')).toBe('/');
    expect(pageAddress('casino')).toBe('/casino');
  });
});

describe('resolveLink', () => {
  // The bug this module exists to fix: plan.mjs's brief used to hand the model file names ("home",
  // "casino"), while trimPlan only ever accepted a written address back — home's above all, since it
  // is never spelled "/home". Every spelling below named a real page and must resolve to the one
  // address that page actually has.
  it.each([
    ['/', '/'],
    ['/home', '/'],
    ['home', '/'],
    ['/casino', '/casino'],
    ['casino', '/casino'],
  ])('accepts %j as the page at %j', (spelling, address) => {
    expect(resolveLink(spelling, PAGES)).toBe(address);
  });

  it('accepts a trailing slash', () => {
    expect(resolveLink('/casino/', PAGES)).toBe('/casino');
  });

  it('accepts surrounding whitespace', () => {
    expect(resolveLink('  /casino  ', PAGES)).toBe('/casino');
    expect(resolveLink('  casino  ', PAGES)).toBe('/casino');
  });

  // Anchors are a link within the current page, never a page of their own — left exactly as given,
  // the same behaviour this replaces already had.
  it('passes an anchor through untouched', () => {
    expect(resolveLink('#faq', PAGES)).toBe('#faq');
  });

  it('refuses a page this site does not have, spelled either way', () => {
    expect(resolveLink('/nope', PAGES)).toBeNull();
    expect(resolveLink('nope', PAGES)).toBeNull();
  });

  it('refuses an invented external address', () => {
    expect(resolveLink('https://example.com', PAGES)).toBeNull();
  });
});
