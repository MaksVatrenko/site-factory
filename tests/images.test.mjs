import { describe, it, expect, vi } from 'vitest';
import { createImageResolver } from '../src/lib/images.mjs';

describe('createImageResolver: turning a name into a picture', () => {
  it('resolves a local picture with its alt text and dimensions', () => {
    const { resolve, warnings } = createImageResolver(
      { main: { src: '/images/main.webp', alt: 'Main banner', width: 800, height: 450 } },
      { fileExists: () => true },
    );
    expect(resolve('main')).toEqual({
      image: { src: '/images/main.webp', alt: 'Main banner', width: 800, height: 450 },
      problem: null,
      missingAlt: false,
    });
    expect(warnings).toEqual([]);
  });

  it("ignores fields it does not know, such as a generator's own prompt", () => {
    const { resolve } = createImageResolver({
      main: { src: '/images/main.webp', alt: 'A', prompt: 'a casino at night', seed: 42 },
    });
    expect(resolve('main').image).toEqual({ src: '/images/main.webp', alt: 'A' });
  });

  it('adds the leading slash a path left out', () => {
    const { resolve } = createImageResolver({ main: { src: 'images/main.webp', alt: 'A' } });
    expect(resolve('main').image.src).toBe('/images/main.webp');
  });

  it('checks a local file through the function it was given, with the site-rooted path', () => {
    const fileExists = vi.fn(() => true);
    const { resolve } = createImageResolver(
      { main: { src: '/images/main.webp', alt: 'A' } },
      { fileExists },
    );
    resolve('main');
    expect(fileExists).toHaveBeenCalledWith('/images/main.webp');
  });

  it('uses a web address as it stands, without asking the disk', () => {
    const fileExists = vi.fn(() => false);
    const { resolve } = createImageResolver(
      { remote: { src: 'https://cdn.example.com/a.webp', alt: 'A' } },
      { fileExists },
    );
    expect(resolve('remote').image.src).toBe('https://cdn.example.com/a.webp');
    expect(fileExists).not.toHaveBeenCalled();
  });

  it('refuses a src that is neither a path inside the site nor a web address', () => {
    const { resolve } = createImageResolver({
      data: { src: 'data:image/png;base64,AAAA', alt: 'A' },
      script: { src: 'javascript:alert(1)', alt: 'A' },
      other: { src: '//other.example.com/a.webp', alt: 'A' },
      up: { src: '/images/../../secret.webp', alt: 'A' },
      back: { src: '/images\\a.webp', alt: 'A' },
    });
    for (const name of ['data', 'script', 'other', 'up', 'back']) {
      const result = resolve(name);
      expect(result.image, name).toBeNull();
      expect(result.problem, name).toContain('недопустимый src');
    }
  });

  it('says so when the name is not in the registry, or there is no registry at all', () => {
    expect(createImageResolver({}).resolve('main').problem).toBe('картинки «main» нет в images.json');
    expect(createImageResolver(undefined).resolve('main').problem).toBe(
      'картинки «main» нет в images.json',
    );
  });

  it('says so when a record has no usable src', () => {
    const { resolve } = createImageResolver({
      none: { alt: 'A' },
      number: { src: 42, alt: 'A' },
      blank: { src: '   ', alt: 'A' },
    });
    for (const name of ['none', 'number', 'blank']) {
      expect(resolve(name).problem, name).toBe(`у картинки «${name}» в images.json нет src`);
    }
  });

  it('says which file is missing from the public folder', () => {
    const { resolve } = createImageResolver(
      { main: { src: '/images/main.webp', alt: 'A' } },
      { fileExists: () => false },
    );
    expect(resolve('main')).toEqual({
      image: null,
      problem: 'файл картинки «main» не найден: public/images/main.webp',
      missingAlt: false,
    });
  });

  it('still returns a picture with no alt text, and flags it', () => {
    const { resolve } = createImageResolver({
      main: { src: '/images/main.webp' },
      blank: { src: '/images/b.webp', alt: '  ' },
    });
    expect(resolve('main')).toEqual({
      image: { src: '/images/main.webp', alt: '' },
      problem: null,
      missingAlt: true,
    });
    expect(resolve('blank').missingAlt).toBe(true);
  });

  it('keeps only real pixel dimensions, accepting a number written as a string', () => {
    const { resolve } = createImageResolver({
      good: { src: '/a.webp', alt: 'A', width: '800', height: ' 450 ' },
      bad: { src: '/b.webp', alt: 'B', width: 0, height: -5 },
      worse: { src: '/c.webp', alt: 'C', width: 1.5, height: '12px' },
    });
    expect(resolve('good').image).toEqual({ src: '/a.webp', alt: 'A', width: 800, height: 450 });
    expect(resolve('bad').image).toEqual({ src: '/b.webp', alt: 'B' });
    expect(resolve('worse').image).toEqual({ src: '/c.webp', alt: 'C' });
  });

  it('never throws on a name that is not a usable string', () => {
    const { resolve } = createImageResolver({ main: { src: '/a.webp', alt: 'A' } });
    for (const name of [undefined, null, 42, {}, [], '']) {
      expect(resolve(name)).toEqual({
        image: null,
        problem: 'у картинки не указано имя',
        missingAlt: false,
      });
    }
  });
});

describe('createImageResolver: a registry in the wrong shape', () => {
  it('warns once and resolves nothing when images.json is not an object', () => {
    for (const raw of ['nope', 42, [], null]) {
      const { resolve, warnings } = createImageResolver(raw);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('images.json');
      expect(resolve('main').image).toBeNull();
    }
  });

  it('skips a record that is not an object, naming it, and keeps the rest', () => {
    const { resolve, warnings } = createImageResolver({
      good: { src: '/a.webp', alt: 'A' },
      broken: 'just a string',
    });
    expect(warnings).toEqual(['images.json: запись «broken» не объект — пропущена']);
    expect(resolve('good').image).not.toBeNull();
    expect(resolve('broken').problem).toBe('картинки «broken» нет в images.json');
  });
});
