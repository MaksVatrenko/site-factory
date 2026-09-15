import sharp from 'sharp';

// Turns the transparent PNG RemBG returns into the two pictures a site needs. Pure image work — no
// network, no files — so it is tested on pictures the test draws itself.
export const HEADER_LOGO_HEIGHT = 144;
export const SQUARE_SIZE = 512;
// The logo sits inside this share of the square, so it never touches the edges and a wide wordmark
// does not crowd a small favicon.
const SQUARE_LOGO_MAX_WIDTH = 0.8;
const SQUARE_LOGO_MAX_HEIGHT = 0.6;

// RemBG keeps the whole canvas and only makes the background transparent, so the lettering sits in
// a wide empty margin; shown as is, the header would draw it tiny. Trimming leaves the lettering
// itself. 144 px is four times the header's 36 px, so it stays sharp on dense screens, and a mark
// already smaller than that is left at its own size rather than blown up. The trimmed PNG is handed
// back too: the square is drawn from it, at full resolution.
export async function makeHeaderLogo(cutoutPng) {
  const trimmed = await sharp(cutoutPng).trim().png().toBuffer();
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
