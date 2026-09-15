import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  altFor,
  collectImageNames,
  fileBaseFor,
  generateMissingImages,
} from '../factory/images/generate.mjs';

const CONFIG = {
  apiKey: 'sentinel-runware-key-generate-3c7d',
  apiUrl: 'https://runware.test/v1',
  model: 'runware:400@6',
  guidance: 2,
  steps: 4,
  concurrency: 1,
};

let dirs = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

// A site folder on disk, the same shape the factory reads: page files plus optional site.json,
// images.json and files under public/images.
function writeSite({ blocks, site, images, imageFiles = [] }) {
  const dir = tempDir('site-factory-gen-site-');
  writeFileSync(join(dir, 'home.json'), JSON.stringify({ title: 'Home', blocks }));
  if (site) writeFileSync(join(dir, 'site.json'), JSON.stringify(site));
  if (images !== undefined) {
    writeFileSync(join(dir, 'images.json'), typeof images === 'string' ? images : JSON.stringify(images));
  }
  for (const file of imageFiles) {
    mkdirSync(join(dir, 'public', 'images'), { recursive: true });
    writeFileSync(join(dir, 'public', 'images', file), 'already here');
  }
  return dir;
}

function writePrompts(prompts = ['a casino hall for {brand}', 'a cricket stadium']) {
  const dir = tempDir('site-factory-gen-prompts-');
  const file = join(dir, 'images.json');
  writeFileSync(file, JSON.stringify({ width: 1024, height: 576, negativePrompt: 'text', prompts }));
  return file;
}

function heroWith(...content) {
  return [{ type: 'hero', content: [{ type: 'title', h1: 'Hero' }, ...content] }];
}

// Answers like Runware; `failures` maps a call number (1-based) to the HTTP status to fail it with.
function fakeRunware({ failures = {} } = {}) {
  const tasks = [];
  const fetchFn = async (_url, init) => {
    const [task] = JSON.parse(init.body);
    tasks.push(task);
    const status = failures[tasks.length];
    if (status) {
      return new Response(JSON.stringify({ errors: [{ message: `failed with ${status}` }] }), { status });
    }
    const bytes = Buffer.from(`webp-${tasks.length}`).toString('base64');
    return new Response(
      JSON.stringify({ data: [{ taskUUID: task.taskUUID, imageBase64Data: bytes, cost: 0.0017 }] }),
      { status: 200 },
    );
  };
  return { fetchFn, tasks };
}

function readRegistry(siteDir) {
  return JSON.parse(readFileSync(join(siteDir, 'images.json'), 'utf8'));
}

async function run(siteDir, overrides = {}) {
  const lines = [];
  const summary = await generateMissingImages({
    siteDir,
    config: CONFIG,
    promptFile: writePrompts(),
    sleep: async () => {},
    log: (line) => lines.push(line),
    ...overrides,
  });
  return { summary, lines };
}

describe('collectImageNames', () => {
  it('finds a picture wherever an image key sits, and names each one once', () => {
    const pages = [
      {
        blocks: [
          {
            type: 'hero',
            props: {
              content: [
                { image: 'hero' },
                { type: 'image', image: 'hero' },
                { type: 'cards', items: [{ title: 'A', image: 'card-a' }, { title: 'B' }] },
              ],
            },
          },
        ],
      },
      { blocks: [{ type: 'section', props: { content: [{ image: 'card-a' }, { image: 42 }, { image: '' }] } }] },
    ];
    expect(collectImageNames(pages)).toEqual(['hero', 'card-a']);
  });
});

describe('fileBaseFor and altFor', () => {
  it('turns a picture name into a safe file name', () => {
    expect(fileBaseFor('Casino Hero')).toBe('casino-hero');
    expect(fileBaseFor('slots_banner-2')).toBe('slots-banner-2');
    expect(fileBaseFor('Казино')).toBe('image');
  });

  it('builds alt text from the brand and the words of the name', () => {
    expect(altFor('casino-hero', '899OK')).toBe('899OK casino hero');
    expect(altFor('app_screen', '')).toBe('app screen');
  });
});

describe('generateMissingImages', () => {
  it('generates only the pictures images.json does not have yet', async () => {
    const siteDir = writeSite({
      blocks: heroWith({ image: 'casino-hero' }, { image: 'kept' }),
      site: { brand: { name: '899OK' } },
      images: { kept: { src: '/images/kept.png', alt: 'Mine' } },
    });
    const { fetchFn, tasks } = fakeRunware();
    const { summary, lines } = await run(siteDir, { fetchFn });

    expect(tasks).toHaveLength(1);
    expect(summary).toEqual({ generated: ['casino-hero'], skipped: [], cost: 0.0017 });
    expect(readRegistry(siteDir)).toEqual({
      kept: { src: '/images/kept.png', alt: 'Mine' },
      'casino-hero': { src: '/images/casino-hero.webp', alt: '899OK casino hero', width: 1024, height: 576 },
    });
    expect(readFileSync(join(siteDir, 'public', 'images', 'casino-hero.webp'), 'utf8')).toBe('webp-1');
    expect(lines[0]).toBe('Картинки: нужно сгенерировать 1 — casino-hero');
    expect(lines[1]).toMatch(/^Картинка casino-hero готова — \d+\.\d с, \$0\.0017$/);
    expect(lines.at(-1)).toBe('Картинки: готово 1 из 1, потрачено $0.0017');
  });

  it('creates images.json when the site has none', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }) });
    const { fetchFn } = fakeRunware();
    await run(siteDir, { fetchFn });
    expect(Object.keys(readRegistry(siteDir))).toEqual(['hero']);
  });

  it('prefers the brand from the form over the one in site.json', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }), site: { brand: { name: 'Site Brand' } } });
    const { fetchFn, tasks } = fakeRunware();
    await run(siteDir, { fetchFn, brand: 'Form Brand', random: () => 0 });
    expect(readRegistry(siteDir).hero.alt).toBe('Form Brand hero');
    expect(tasks[0].positivePrompt).toBe('a casino hall for Form Brand');
  });

  it('draws a different prompt for each picture while unused ones remain', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'one' }, { image: 'two' }) });
    const { fetchFn, tasks } = fakeRunware();
    await run(siteDir, { fetchFn, random: () => 0 });
    expect(new Set(tasks.map((task) => task.positivePrompt)).size).toBe(2);
  });

  it('never overwrites a file already in public/images', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }), imageFiles: ['hero.webp'] });
    const { fetchFn } = fakeRunware();
    await run(siteDir, { fetchFn });
    expect(readFileSync(join(siteDir, 'public', 'images', 'hero.webp'), 'utf8')).toBe('already here');
    expect(readRegistry(siteDir).hero.src).toBe('/images/hero-2.webp');
    expect(existsSync(join(siteDir, 'public', 'images', 'hero-2.webp'))).toBe(true);
  });

  it('leaves a broken images.json alone and asks Runware for nothing', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }), images: '{ not json' });
    const { fetchFn, tasks } = fakeRunware();
    const { lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(0);
    expect(readFileSync(join(siteDir, 'images.json'), 'utf8')).toBe('{ not json');
    expect(lines[0]).toMatch(/^Картинки: не удалось прочитать сайт.*images\.json/);
  });

  it('refuses valid JSON that is not an object', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }), images: '[]' });
    const { fetchFn, tasks } = fakeRunware();
    const { lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(0);
    expect(readFileSync(join(siteDir, 'images.json'), 'utf8')).toBe('[]');
    expect(lines.join('\n')).toContain('images.json сайта должен быть объектом');
  });

  it('handles images.json broken during the run', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }) });
    const fetchFn = async (_url, init) => {
      const [task] = JSON.parse(init.body);
      // Break the images.json while answering the request
      writeFileSync(join(siteDir, 'images.json'), '{ broken mid-run');
      return new Response(
        JSON.stringify({ data: [{ taskUUID: task.taskUUID, imageBase64Data: Buffer.from('webp-1').toString('base64'), cost: 0.0017 }] }),
        { status: 200 },
      );
    };
    const { summary, lines } = await run(siteDir, { fetchFn });
    expect(summary.generated).toEqual([]);
    expect(summary.skipped).toEqual(['hero']);
    expect(readFileSync(join(siteDir, 'images.json'), 'utf8')).toBe('{ broken mid-run');
    expect(lines.some((line) => line.startsWith('Картинка hero: images.json сайта не читается как JSON'))).toBe(true);
  });

  it('respects concurrency limit with multiple images', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'a' }, { image: 'b' }, { image: 'c' }) });
    let inFlight = 0;
    let peak = 0;
    const fetchFn = async (_url, init) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const [task] = JSON.parse(init.body);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return new Response(
        JSON.stringify({ data: [{ taskUUID: task.taskUUID, imageBase64Data: Buffer.from('webp-x').toString('base64'), cost: 0.0017 }] }),
        { status: 200 },
      );
    };
    const { summary, lines } = await run(siteDir, { fetchFn, config: { ...CONFIG, concurrency: 2 } });
    expect(peak).toBe(2);
    expect(summary.generated.sort()).toEqual(['a', 'b', 'c']);
    const registry = readRegistry(siteDir);
    expect(['a', 'b', 'c'].every((name) => Object.hasOwn(registry, name))).toBe(true);
  });

  it('skips generation with a message when there is no key', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }) });
    const { fetchFn, tasks } = fakeRunware();
    const { summary, lines } = await run(siteDir, { fetchFn, config: { ...CONFIG, apiKey: '' } });
    expect(tasks).toHaveLength(0);
    expect(summary.skipped).toEqual(['hero']);
    expect(lines).toEqual(['Картинки: ключ Runware не задан в .env — пропущено 1: hero']);
    expect(existsSync(join(siteDir, 'images.json'))).toBe(false);
  });

  it('does nothing at all when every picture is already there', async () => {
    const siteDir = writeSite({
      blocks: heroWith({ image: 'hero' }),
      images: { hero: { src: '/images/hero.webp', alt: 'Hero' } },
    });
    const { fetchFn, tasks } = fakeRunware();
    const { summary, lines } = await run(siteDir, { fetchFn, config: { ...CONFIG, apiKey: '' } });
    expect(tasks).toHaveLength(0);
    expect(lines).toEqual([]);
    expect(summary).toEqual({ generated: [], skipped: [], cost: 0 });
  });

  it('stops after a refused key instead of failing every remaining picture the same way', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'a' }, { image: 'b' }, { image: 'c' }) });
    const { fetchFn, tasks } = fakeRunware({ failures: { 1: 401 } });
    const { summary, lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(1);
    expect(summary.generated).toEqual([]);
    expect([...summary.skipped].sort()).toEqual(['a', 'b', 'c']);
    expect(lines).toContain('Картинки: Runware не принял ключ — генерация остановлена');
  });

  it('skips one refused picture and carries on with the rest', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'a' }, { image: 'b' }, { image: 'c' }) });
    const { fetchFn, tasks } = fakeRunware({ failures: { 1: 400 } });
    const { summary, lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(3);
    expect(summary.generated).toEqual(['b', 'c']);
    expect(summary.skipped).toEqual(['a']);
    expect(lines.some((line) => line.startsWith('Картинка a: Runware отклонил запрос (400'))).toBe(true);
    expect(lines.at(-1)).toBe('Картинки: готово 2 из 3, потрачено $0.0034');
  });

  it('skips generation when the prompt file is wrong', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }) });
    const promptDir = tempDir('site-factory-gen-bad-prompts-');
    const promptFile = join(promptDir, 'images.json');
    writeFileSync(promptFile, JSON.stringify({ width: 1000, height: 576, prompts: ['x'] }));
    const { fetchFn, tasks } = fakeRunware();
    const { lines } = await run(siteDir, { fetchFn, promptFile });
    expect(tasks).toHaveLength(0);
    expect(lines.join('\n')).toContain('делиться на 16');
  });

  it('reports a site folder it cannot read instead of throwing', async () => {
    const siteDir = tempDir('site-factory-gen-empty-');
    const { fetchFn, tasks } = fakeRunware();
    const { summary, lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(0);
    expect(summary).toEqual({ generated: [], skipped: [], cost: 0 });
    expect(lines[0]).toMatch(/^Картинки: не удалось прочитать сайт/);
  });
});
