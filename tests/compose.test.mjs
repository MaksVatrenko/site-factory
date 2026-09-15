import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { HEADER_LOGO_HEIGHT, SQUARE_SIZE, makeHeaderLogo, makeSquareLogo } from '../factory/images/compose.mjs';

// What RemBG hands back: an opaque mark in the middle of a transparent canvas.
// Real lettering leaves transparent pixels inside its bounding box (between and around letters).
// A fully opaque rectangle would leave no transparent pixels after trim, causing WebP to drop the alpha channel.
// So the fixture adds rounded corners, keeping transparent corner pixels like real lettering does.
async function cutout({ canvas = [1536, 768], mark = [900, 300], colour = '#ffb800' } = {}) {
  const [markWidth, markHeight] = mark;
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${markWidth}" height="${markHeight}"><rect width="100%" height="100%" rx="24" fill="${colour}"/></svg>`,
  );
  return sharp({ create: { width: canvas[0], height: canvas[1], channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: svg, gravity: 'centre' }])
    .png()
    .toBuffer();
}

async function pixel(bytes, left, top) {
  const raw = await sharp(bytes).extract({ left, top, width: 1, height: 1 }).raw().toBuffer();
  return [...raw].slice(0, 3);
}

describe('makeHeaderLogo', () => {
  it('cuts away the transparent margin and shrinks the mark to the header height', async () => {
    const logo = await makeHeaderLogo(await cutout());
    const meta = await sharp(logo.bytes).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.hasAlpha).toBe(true);
    expect([logo.width, logo.height]).toEqual([432, HEADER_LOGO_HEIGHT]);
    expect([meta.width, meta.height]).toEqual([432, HEADER_LOGO_HEIGHT]);
    expect(await sharp(logo.trimmed).metadata().then((m) => [m.width, m.height])).toEqual([900, 300]);
  });

  it('never enlarges a mark smaller than the header height', async () => {
    const logo = await makeHeaderLogo(await cutout({ mark: [300, 100] }));
    expect([logo.width, logo.height]).toEqual([300, 100]);
  });
});

describe('makeSquareLogo', () => {
  it('centres the logo on a diagonal gradient', async () => {
    const { trimmed } = await makeHeaderLogo(await cutout());
    const square = await makeSquareLogo(trimmed, ['#3b1a8c', '#7b3fe4']);
    const meta = await sharp(square).metadata();
    expect(meta.format).toBe('png');
    expect([meta.width, meta.height]).toEqual([SQUARE_SIZE, SQUARE_SIZE]);
    expect(await pixel(square, 0, 0)).toEqual([59, 26, 140]);
    expect(await pixel(square, 256, 256)).toEqual([255, 184, 0]);
  });

  it('keeps the logo within 80% of the width', async () => {
    const { trimmed } = await makeHeaderLogo(await cutout({ mark: [1400, 100] }));
    const square = await makeSquareLogo(trimmed, ['#000000', '#000000']);
    // 80% of 512 is 410, so the mark ends at column 461 at the latest; column 470 is background.
    expect(await pixel(square, 470, 256)).toEqual([0, 0, 0]);
    expect(await pixel(square, 60, 256)).toEqual([255, 184, 0]);
  });
});
