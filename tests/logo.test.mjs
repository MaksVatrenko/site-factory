import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { generateLogo } from '../factory/images/logo.mjs';

const SENTINEL = 'sentinel-runware-key-logo-6a2f';
const CONFIG = {
  apiKey: SENTINEL,
  apiKeyInvalid: false,
  apiUrl: 'https://runware.test/v1',
  model: 'runware:400@6',
  logoModel: 'ideogram:4@0',
  bgModel: 'ideogram:remove-background@0',
  guidance: 2,
  steps: 4,
  concurrency: 1,
};
const PROMPT_FILE = join('factory', 'prompts', 'logo.json');

let dirs = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function writeSite({ site, images, files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'site-factory-logo-site-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'home.json'), JSON.stringify({ title: 'Home', blocks: [] }));
  if (site) writeFileSync(join(dir, 'site.json'), JSON.stringify(site));
  if (images !== undefined) {
    writeFileSync(join(dir, 'images.json'), typeof images === 'string' ? images : JSON.stringify(images));
  }
  for (const [name, bytes] of Object.entries(files)) {
    mkdirSync(join(dir, 'public', 'images'), { recursive: true });
    writeFileSync(join(dir, 'public', 'images', name), bytes);
  }
  return dir;
}

async function cutoutPng() {
  const mark = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="100%" height="100%" rx="24" fill="#ffb800"/></svg>');
  return sharp({ create: { width: 1536, height: 768, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toBuffer();
}

// Answers like Runware: the wordmark task with an imageUUID, the removal task with the cut-out PNG.
// `fail` maps a taskType to an HTTP status to fail that task with.
function fakeRunware({ cutout, fail = {} } = {}) {
  const tasks = [];
  const fetchFn = async (_url, init) => {
    const [task] = JSON.parse(init.body);
    tasks.push(task);
    const status = fail[task.taskType];
    if (status) return new Response(JSON.stringify({ errors: [{ message: `failed with ${status}` }] }), { status });
    if (task.taskType === 'imageInference') {
      return new Response(JSON.stringify({ data: [{ taskUUID: task.taskUUID, imageUUID: 'art-1', cost: 0.09 }] }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ data: [{ taskType: 'imageBackgroundRemoval', taskUUID: task.taskUUID, imageBase64Data: cutout.toString('base64'), cost: 0.001 }] }),
      { status: 200 },
    );
  };
  return { fetchFn, tasks };
}

function registryOf(siteDir) {
  return JSON.parse(readFileSync(join(siteDir, 'images.json'), 'utf8'));
}

async function run(siteDir, overrides = {}) {
  const lines = [];
  const summary = await generateLogo({
    siteDir,
    config: CONFIG,
    promptFile: PROMPT_FILE,
    sleep: async () => {},
    random: () => 0,
    log: (line) => lines.push(line),
    ...overrides,
  });
  return { summary, lines };
}

describe('generateLogo', () => {
  it('makes the header logo and the square in one go, and records both', async () => {
    const siteDir = writeSite({ site: { brand: { name: '899OK' } }, images: { hero: { src: '/images/hero.webp', alt: 'Hero' } } });
    const { fetchFn, tasks } = fakeRunware({ cutout: await cutoutPng() });
    const { summary, lines } = await run(siteDir, { fetchFn });

    expect(tasks.map((task) => task.taskType)).toEqual(['imageInference', 'removeBackground']);
    expect(tasks[0].positivePrompt).toContain('reads "899OK"');
    expect(tasks[1].inputs).toEqual({ image: 'art-1' });
    // 0.09 + 0.001 is not exactly 0.091 in floating point, so the sum is compared, not matched.
    expect(summary.generated).toBe(true);
    expect(summary.cost).toBeCloseTo(0.091, 10);

    const registry = registryOf(siteDir);
    expect(registry.hero).toEqual({ src: '/images/hero.webp', alt: 'Hero' });
    expect(registry.logo).toEqual({ src: '/images/logo.webp', alt: '899OK', width: 432, height: 144 });
    expect(registry['logo-square']).toEqual({ src: '/images/logo-square.png', alt: '899OK logo', width: 512, height: 512 });
    expect(await sharp(join(siteDir, 'public', 'images', 'logo.webp')).metadata().then((m) => m.hasAlpha)).toBe(true);
    expect(await sharp(join(siteDir, 'public', 'images', 'logo-square.png')).metadata().then((m) => [m.width, m.height])).toEqual([512, 512]);
    expect(lines[0]).toBe('Логотип: делаю для «899OK»');
    expect(lines.at(-1)).toMatch(/^Логотип готов — \d+\.\d с, \$0\.0910$/);
  });

  it('takes the brand from the form over site.json', async () => {
    const siteDir = writeSite({ site: { brand: { name: 'Site Brand' } } });
    const { fetchFn, tasks } = fakeRunware({ cutout: await cutoutPng() });
    await run(siteDir, { fetchFn, brand: 'Form Brand' });
    expect(tasks[0].positivePrompt).toContain('reads "Form Brand"');
    expect(registryOf(siteDir).logo.alt).toBe('Form Brand');
  });

  it('leaves a site with its own logo in site.json alone', async () => {
    const siteDir = writeSite({ site: { brand: { name: 'Own', logo: 'mine' } } });
    const { fetchFn, tasks } = fakeRunware({ cutout: await cutoutPng() });
    const { lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(0);
    expect(lines).toEqual([]);
  });

  it('does nothing when both pictures are already recorded', async () => {
    const siteDir = writeSite({
      site: { brand: { name: 'Done' } },
      images: { logo: { src: '/images/logo.webp', alt: 'Done' }, 'logo-square': { src: '/images/logo-square.png', alt: 'Done logo' } },
    });
    const { fetchFn, tasks } = fakeRunware({ cutout: await cutoutPng() });
    const { lines } = await run(siteDir, { fetchFn, config: { ...CONFIG, apiKey: '' } });
    expect(tasks).toHaveLength(0);
    expect(lines).toEqual([]);
  });

  it('rebuilds a missing square from the existing logo for free, even without a key', async () => {
    const logo = await sharp(await cutoutPng()).trim().webp().toBuffer();
    const siteDir = writeSite({
      site: { brand: { name: 'Keep' } },
      images: { logo: { src: '/images/logo.webp', alt: 'Keep' } },
      files: { 'logo.webp': logo },
    });
    const { fetchFn, tasks } = fakeRunware({ cutout: await cutoutPng() });
    const { lines } = await run(siteDir, { fetchFn, config: { ...CONFIG, apiKey: '' } });
    expect(tasks).toHaveLength(0);
    expect(registryOf(siteDir)['logo-square']).toEqual({ src: '/images/logo-square.png', alt: 'Keep logo', width: 512, height: 512 });
    expect(registryOf(siteDir).logo).toEqual({ src: '/images/logo.webp', alt: 'Keep' });
    expect(lines).toEqual(['Логотип: квадрат собран из готового логотипа']);
  });

  it('cannot rebuild the square from a logo that is not a local file', async () => {
    const siteDir = writeSite({
      site: { brand: { name: 'Remote' } },
      images: { logo: { src: 'https://cdn.example.com/logo.png', alt: 'Remote' } },
    });
    const { lines } = await run(siteDir, { fetchFn: fakeRunware({ cutout: await cutoutPng() }).fetchFn });
    expect(existsSync(join(siteDir, 'public'))).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Логотип: квадрат не собран — /);
  });

  it('never overwrites a file already sitting under the logo\'s name', async () => {
    const siteDir = writeSite({ site: { brand: { name: 'Taken' } }, files: { 'logo.webp': 'not mine to touch' } });
    const { fetchFn } = fakeRunware({ cutout: await cutoutPng() });
    await run(siteDir, { fetchFn });
    expect(readFileSync(join(siteDir, 'public', 'images', 'logo.webp'), 'utf8')).toBe('not mine to touch');
    expect(registryOf(siteDir).logo.src).toBe('/images/logo-2.webp');
  });

  it('skips a site with no brand name anywhere, asking nothing', async () => {
    const siteDir = writeSite();
    const { fetchFn, tasks } = fakeRunware({ cutout: await cutoutPng() });
    const { lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(0);
    expect(lines).toEqual(['Логотип: нет названия бренда — пропущен']);
  });

  it.each([
    [{ apiKey: '' }, 'Логотип: ключ Runware не задан в .env — пропущен'],
    [{ apiKey: '', apiKeyInvalid: true }, 'Логотип: ключ Runware в .env записан неверно (недопустимые символы (пробелы, переносы строк, не-ASCII)) — пропущен'],
  ])('skips without a usable key: %j', async (keyFields, line) => {
    const siteDir = writeSite({ site: { brand: { name: 'NoKey' } } });
    const { fetchFn, tasks } = fakeRunware({ cutout: await cutoutPng() });
    const { lines } = await run(siteDir, { fetchFn, config: { ...CONFIG, ...keyFields } });
    expect(tasks).toHaveLength(0);
    expect(lines).toEqual([line]);
  });

  it('writes nothing when background removal fails, but still reports what the wordmark cost', async () => {
    const siteDir = writeSite({ site: { brand: { name: 'Half' } } });
    const { fetchFn } = fakeRunware({ cutout: await cutoutPng(), fail: { removeBackground: 400 } });
    const { summary, lines } = await run(siteDir, { fetchFn });
    expect(summary).toEqual({ generated: false, cost: 0.09 });
    expect(existsSync(join(siteDir, 'images.json'))).toBe(false);
    expect(existsSync(join(siteDir, 'public', 'images', 'logo.webp'))).toBe(false);
    expect(lines.at(-1)).toMatch(/^Логотип: Runware отклонил запрос \(400: failed with 400\) — пропущен, потрачено \$0\.0900$/);
  });

  // I2: the remover can answer 200 with a normal-looking, fully transparent PNG — a wordmark it could
  // not tell apart from its own plain background — instead of failing outright. Both requests are
  // paid for either way, so the cost is still reported, but nothing usable came out of them: no
  // header logo, no square, and no images.json entries for either, so the next build still tries
  // to make the logo (a half-written pair of entries would stop that from ever happening again).
  it('writes nothing when background removal erases the whole wordmark, but still reports what was spent', async () => {
    const siteDir = writeSite({ site: { brand: { name: 'Blank' } } });
    const blank = await sharp({
      create: { width: 1536, height: 768, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const { fetchFn } = fakeRunware({ cutout: blank });
    const { summary, lines } = await run(siteDir, { fetchFn });
    expect(summary.generated).toBe(false);
    // 0.09 + 0.001 is not exactly 0.091 in floating point, so the sum is compared, not matched.
    expect(summary.cost).toBeCloseTo(0.091, 10);
    expect(existsSync(join(siteDir, 'images.json'))).toBe(false);
    expect(existsSync(join(siteDir, 'public', 'images', 'logo.webp'))).toBe(false);
    expect(existsSync(join(siteDir, 'public', 'images', 'logo-square.png'))).toBe(false);
    expect(lines.at(-1)).toMatch(
      /^Логотип: после удаления фона на картинке ничего не осталось — пропущен, потрачено \$0\.0910$/,
    );
  });

  it('never puts the key into a log line', async () => {
    const siteDir = writeSite({ site: { brand: { name: 'Leak' } } });
    const { fetchFn } = fakeRunware({ cutout: await cutoutPng(), fail: { imageInference: 401 } });
    const { lines } = await run(siteDir, { fetchFn });
    expect(lines.join('\n')).not.toContain(SENTINEL);
    expect(lines.at(-1)).toBe('Логотип: Runware не принял ключ — пропущен');
  });

  it('leaves a broken images.json alone', async () => {
    const siteDir = writeSite({ site: { brand: { name: 'Broken' } }, images: '[]' });
    const { fetchFn, tasks } = fakeRunware({ cutout: await cutoutPng() });
    const { lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(0);
    expect(readFileSync(join(siteDir, 'images.json'), 'utf8')).toBe('[]');
    expect(lines[0]).toMatch(/^Логотип: images\.json сайта должен быть объектом/);
  });
});
