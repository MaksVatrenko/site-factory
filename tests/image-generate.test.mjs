import { describe, it, expect, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

  // M6: the engine (normalizePageContent in src/lib/content.mjs) only ever resolves an `image`
  // key inside a block's props.content entries — never a field sitting directly on the block
  // itself, next to `props`. A marker there is never shown, so it must not be paid for.
  it('does not collect a marker sitting on the block itself, only inside its content', () => {
    const pages = [
      {
        blocks: [
          {
            type: 'hero',
            image: 'block-level-marker',
            props: { content: [{ image: 'inside-content' }] },
          },
        ],
      },
    ];
    expect(collectImageNames(pages)).toEqual(['inside-content']);
  });

  // M6: normalizePageContent handles a `content` entry of type 'title' with normalizeTitle,
  // which only ever reads the entry's h1–h6 key — it never looks at `image` at all, so a title
  // entry's `image` field is never resolved (and never shown), and must not be collected either.
  it('does not collect a marker on a title entry — the engine never resolves it there', () => {
    const pages = [
      {
        blocks: [
          {
            type: 'hero',
            props: {
              content: [
                { type: 'title', h1: 'Heading', image: 'title-marker' },
                { image: 'kept' },
              ],
            },
          },
        ],
      },
    ];
    expect(collectImageNames(pages)).toEqual(['kept']);
  });

  // normalizeSite (src/lib/normalize.mjs) drops every block whose `type` is missing or blank
  // before the engine ever renders it, the same test as here (`typeof … === 'string' && …trim()
  // !== ''`). A block without a usable `type` never reaches the page the visitor builds, so its
  // markers must not be paid for.
  it('does not collect a marker on a block with no usable type', () => {
    const pages = [
      {
        blocks: [
          { props: { content: [{ image: 'typeless' }] } },
          { type: '   ', props: { content: [{ image: 'blank-type' }] } },
          { type: 'hero', props: { content: [{ image: 'kept' }] } },
        ],
      },
    ];
    expect(collectImageNames(pages)).toEqual(['kept']);
  });

  // content.mjs's own entries loop (line ~120) skips any `content` entry that is not a plain
  // object before it ever looks at it — an array entry is never resolved, so it must not be
  // collected either, even though the walk does recurse into arrays nested deeper (e.g. a card's
  // `items`).
  it('does not collect a marker inside a content entry that is itself an array', () => {
    const pages = [
      {
        blocks: [
          {
            type: 'hero',
            props: { content: [[{ image: 'in-array' }], { image: 'kept' }] },
          },
        ],
      },
    ];
    expect(collectImageNames(pages)).toEqual(['kept']);
  });
});

describe('fileBaseFor and altFor', () => {
  it('turns a picture name into a safe file name', () => {
    expect(fileBaseFor('Casino Hero')).toBe('casino-hero');
    expect(fileBaseFor('slots_banner-2')).toBe('slots-banner-2');
    expect(fileBaseFor('Казино')).toBe('image');
  });

  // M5: a file name this long would still work on most filesystems, but there is no reason to
  // let one picture's marker balloon into an unbounded file name either.
  it('caps a very long name at 100 characters', () => {
    const base = fileBaseFor('a'.repeat(150));
    expect(base.length).toBeLessThanOrEqual(100);
    expect(base).toBe('a'.repeat(100));
  });

  it('trims a trailing hyphen left by the 100-character cut', () => {
    // 99 letters + a separator (becomes '-') land exactly on the cut, so trimming after the cut
    // is what keeps the result from ending in a bare hyphen.
    const name = `${'a'.repeat(99)} ${'b'.repeat(50)}`;
    const base = fileBaseFor(name);
    expect(base.length).toBeLessThanOrEqual(100);
    expect(base.endsWith('-')).toBe(false);
    expect(base).toBe('a'.repeat(99));
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

  // I2: env.mjs flags a key with an inner space or line break as unusable rather than handing it
  // to runware.mjs (which would otherwise send it and risk leaking it through a fetch failure
  // message). This is a different situation from "no key at all", so it gets its own log line.
  it('skips generation with a different message when the key in .env is unusable', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }) });
    const { fetchFn, tasks } = fakeRunware();
    const { summary, lines } = await run(siteDir, {
      fetchFn,
      config: { ...CONFIG, apiKey: '', apiKeyInvalid: true },
    });
    expect(tasks).toHaveLength(0);
    expect(summary.skipped).toEqual(['hero']);
    expect(lines).toEqual([
      'Картинки: ключ Runware в .env записан неверно (недопустимые символы (пробелы, переносы строк, не-ASCII)) — пропущено 1: hero',
    ]);
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

  // M5: `registry[name] = entry` on a plain object literal cannot make `__proto__` an own
  // property — it sets the object's prototype instead, so the entry would never actually land in
  // images.json and this name would be paid for again on every future build. It must never even
  // reach Runware.
  it('skips a marker named __proto__ without any request', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: '__proto__' }, { image: 'hero' }) });
    const { fetchFn, tasks } = fakeRunware();
    const { summary, lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toBeTruthy();
    expect(summary.generated).toEqual(['hero']);
    expect(summary.skipped).toEqual(['__proto__']);
    expect(lines).toContain(
      'Картинка __proto__: такое имя нельзя записать в images.json — пропущена',
    );
    const registry = readRegistry(siteDir);
    expect(Object.hasOwn(registry, 'hero')).toBe(true);
    expect(Object.hasOwn(registry, '__proto__')).toBe(false);
  });

  // M5: creating public/images can fail for reasons that have nothing to do with Runware — e.g.
  // `public` already exists as a plain file. Money must not be spent on a picture that was never
  // going to be savable in the first place.
  it('skips a picture without any request when public exists as a file', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }) });
    writeFileSync(join(siteDir, 'public'), 'not a directory');
    const { fetchFn, tasks } = fakeRunware();
    const { summary, lines } = await run(siteDir, { fetchFn });
    expect(tasks).toHaveLength(0);
    expect(summary.generated).toEqual([]);
    expect(summary.skipped).toEqual(['hero']);
    expect(lines.some((line) => line.startsWith('Картинка hero:'))).toBe(true);
  });

  // M5: a picture already generated — and billed — must not become free to lose. If saving it
  // fails afterwards, the cost still counts.
  //
  // Round 2 fix 2: a chmod-based read-only directory does not fail this for every user — root
  // ignores write permissions, and chmod is a no-op on Windows. Reserving the target path itself
  // as a directory fails the write with EISDIR for anyone, and — unlike EEXIST (fix 4 below) —
  // must not be retried under a different name, since a directory is not a name clash to route
  // around.
  it('still counts the cost when saving the picture fails after a paid generation', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }) });
    const imagesDir = join(siteDir, 'public', 'images');
    const fetchFn = async (_url, init) => {
      const [task] = JSON.parse(init.body);
      // The worker has already created imagesDir and reserved 'hero.webp' by the time Runware is
      // asked — reserving that exact path as a directory here simulates the reserved name being
      // impossible to write to, without touching filesystem permissions.
      mkdirSync(join(imagesDir, 'hero.webp'), { recursive: true });
      return new Response(
        JSON.stringify({
          data: [
            {
              taskUUID: task.taskUUID,
              imageBase64Data: Buffer.from('webp-1').toString('base64'),
              cost: 0.0017,
            },
          ],
        }),
        { status: 200 },
      );
    };
    const { summary, lines } = await run(siteDir, { fetchFn });
    expect(summary.generated).toEqual([]);
    expect(summary.skipped).toEqual(['hero']);
    expect(summary.cost).toBe(0.0017);
    expect(lines.some((line) => line.startsWith('Картинка hero:'))).toBe(true);
  });

  // Round 2 fix 4: the reserved file name lives only in this run's memory (`takenFiles`), so a
  // second run of the factory for the same site — a second build under a different domain, or
  // the CLI alongside the form — can grab the same name while this run's Runware request is
  // still in flight. Simulating that by having the fake Runware itself write the reserved file
  // mid-request: the write must notice, keep that file untouched, and save under the next free
  // name instead of overwriting it (spec §4.5, "Существующие файлы не перезаписываются").
  it('retries under a new name when a concurrent run claims the reserved file first', async () => {
    const siteDir = writeSite({ blocks: heroWith({ image: 'hero' }) });
    const imagesDir = join(siteDir, 'public', 'images');
    const fetchFn = async (_url, init) => {
      const [task] = JSON.parse(init.body);
      mkdirSync(imagesDir, { recursive: true });
      writeFileSync(join(imagesDir, 'hero.webp'), 'written by the other run');
      return new Response(
        JSON.stringify({
          data: [
            {
              taskUUID: task.taskUUID,
              imageBase64Data: Buffer.from('webp-1').toString('base64'),
              cost: 0.0017,
            },
          ],
        }),
        { status: 200 },
      );
    };
    const { summary } = await run(siteDir, { fetchFn });
    expect(summary.generated).toEqual(['hero']);
    expect(summary.skipped).toEqual([]);
    expect(readFileSync(join(imagesDir, 'hero.webp'), 'utf8')).toBe('written by the other run');
    expect(readFileSync(join(imagesDir, 'hero-2.webp'), 'utf8')).toBe('webp-1');
    expect(readRegistry(siteDir).hero.src).toBe('/images/hero-2.webp');
  });
});
