import sharp from 'sharp';

// Turns the transparent PNG the background remover returns into the two pictures a site needs. Pure image work — no
// network, no files — so it is tested on pictures the test draws itself.
export const HEADER_LOGO_HEIGHT = 144;
export const SQUARE_SIZE = 512;
// The logo sits inside this share of the square, so it never touches the edges and a wide wordmark
// does not crowd a small favicon.
const SQUARE_LOGO_MAX_WIDTH = 0.8;
const SQUARE_LOGO_MAX_HEIGHT = 0.6;
// A pixel this faint is background noise, not a mark the remover actually kept — real lettering
// behind is fully opaque (alpha 255) well before it is anywhere near this dim.
const VISIBLE_ALPHA_THRESHOLD = 16;

// The remover keeps the whole canvas and only makes the background transparent, so the lettering sits in
// a wide empty margin; shown as is, the header would draw it tiny. Trimming leaves the lettering
// itself. 144 px is four times the header's 36 px, so it stays sharp on dense screens, and a mark
// already smaller than that is left at its own size rather than blown up. The trimmed PNG is handed
// back too: the square is drawn from it, at full resolution.
export async function makeHeaderLogo(cutoutPng) {
  const trimmed = await sharp(cutoutPng).trim().png().toBuffer();
  // The remover can erase everything — a wordmark it could not tell from its own plain background — and
  // still answer with a normal-looking, fully transparent PNG. trim() has nothing to crop then, so
  // it keeps the whole blank canvas instead of throwing (verified directly against this project's
  // sharp 0.35.4). Left unchecked, that blank canvas would be saved as a real header logo and a
  // bare gradient square, and images.json would then hold both entries, so no later build would
  // ever retry (see generateLogo in logo.mjs). Caught here, before either file is ever written.
  //
  // stats() always measures the ORIGINAL input, not the result of any operation chained onto the
  // same pipeline (ensureAlpha/extractChannel included — see the stats() docs in this project's
  // node_modules/sharp/dist/input.cjs, "Statistics are derived from the original input image").
  // Calling it straight after extractChannel('alpha') silently reads channels[0] of `trimmed`
  // itself, i.e. its RED channel, not alpha — so the extracted alpha band is written out to its own
  // buffer first, and stats() is called on THAT.
  const alphaBand = await sharp(trimmed).ensureAlpha().extractChannel('alpha').png().toBuffer();
  const { channels: [alpha] } = await sharp(alphaBand).stats();
  if (alpha.max < VISIBLE_ALPHA_THRESHOLD) {
    throw new Error('после удаления фона на картинке ничего не осталось');
  }
  const { data, info } = await sharp(trimmed)
    .resize({ height: HEADER_LOGO_HEIGHT, withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height, trimmed };
}

// The gradient is drawn as SVG and rasterised by sharp. The two colours come from logo.json, which
// only lets through #rrggbb, so nothing but a colour ever lands inside the SVG.
export async function makeSquareLogo(logoBytes, [from, to]) {
  const gradient = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SQUARE_SIZE}" height="${SQUARE_SIZE}">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
      `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );
  const fitted = await sharp(logoBytes)
    .resize({
      width: Math.round(SQUARE_SIZE * SQUARE_LOGO_MAX_WIDTH),
      height: Math.round(SQUARE_SIZE * SQUARE_LOGO_MAX_HEIGHT),
      fit: 'inside',
    })
    .toBuffer();
  return sharp(gradient).composite([{ input: fitted, gravity: 'centre' }]).png().toBuffer();
}
