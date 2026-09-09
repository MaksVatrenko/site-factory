// Turns a whole content spreadsheet into a ready site folder.
//
// The spreadsheet holds one sheet per page. Doing this by hand means looking up each sheet's
// numeric id, downloading it, running the converter, inventing a filename and typing a slug —
// eight times per site, every time. That is also where a real mistake came from: two pages ending
// up with the same slug, which silently pushes the second one to /page-1.
//
// Usage: node scripts/import-sheet.mjs <spreadsheet url or id> <site folder name>
//
// A bare id is the easier thing to paste: a full sheet url carries a `?`, which zsh takes
// for a filename pattern and refuses to run the command at all.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sheetToPage } from './sheet-to-json.mjs';

// Sheet names that mean "this is the front page" rather than a page called "home".
const HOME_SHEET_NAMES = new Set(['home', 'index', 'main', 'главная', 'домашняя']);

export function spreadsheetId(input) {
  const text = String(input ?? '').trim();
  const fromUrl = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return fromUrl ? fromUrl[1] : text;
}

// Google's htmlview page carries the sheet list as `{name: "...", ... gid: "..."}` literals. It is
// the only place the two are stated together — the CSV export endpoint takes a gid and gives no
// hint what the sheet was called.
export function parseSheetList(html) {
  const pairs = [...String(html ?? '').matchAll(/\{name:\s*"([^"]+)",[^}]*?gid:\s*"?(\d+)/g)];
  const seen = new Set();
  return pairs
    .map(([, name, gid]) => ({ name, gid }))
    .filter(({ gid }) => {
      if (seen.has(gid)) return false;
      seen.add(gid);
      return true;
    });
}

export function fileNameFor(sheetName) {
  const base = String(sheetName ?? '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return base === '' ? 'page' : base;
}

export function slugFor(sheetName) {
  const base = fileNameFor(sheetName);
  return HOME_SHEET_NAMES.has(String(sheetName ?? '').trim().toLowerCase()) ? '/' : `/${base}`;
}

// Two sheets can reduce to the same name ("Bonus" and "bonus!"), and two pages sharing a slug is
// exactly the failure this script exists to prevent — so collisions are resolved here, loudly,
// rather than discovered later as a page that quietly became /page-1.
export function assignTargets(sheets) {
  const takenFiles = new Set();
  const takenSlugs = new Set();
  const notes = [];

  return {
    targets: sheets.map((sheet) => {
      let file = fileNameFor(sheet.name);
      let slug = slugFor(sheet.name);
      if (takenSlugs.has(slug)) {
        let n = 2;
        while (takenSlugs.has(`${slug}-${n}`)) n += 1;
        notes.push(`Лист «${sheet.name}» даёт тот же адрес, что и предыдущий — использован «${slug}-${n}»`);
        slug = `${slug}-${n}`;
        file = `${file}-${n}`;
      }
      while (takenFiles.has(file)) file = `${file}-x`;
      takenFiles.add(file);
      takenSlugs.add(slug);
      return { ...sheet, file: `${file}.json`, slug };
    }),
    notes,
  };
}

async function fetchText(url, what) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Не удалось получить ${what}: сервер ответил ${response.status}`);
  }
  return response.text();
}

async function main() {
  const [input, siteName] = process.argv.slice(2);
  if (!input || !siteName) {
    console.error('Использование: node scripts/import-sheet.mjs <ссылка или id таблицы> <папка сайта>');
    console.error('Ссылку нужно взять в кавычки — id таблицы можно передать как есть.');
    process.exit(1);
  }

  const id = spreadsheetId(input);
  const dir = join('data', 'sites', siteName);

  const html = await fetchText(`https://docs.google.com/spreadsheets/d/${id}/htmlview`, 'таблицу');
  const sheets = parseSheetList(html);
  if (sheets.length === 0) {
    throw new Error(
      'В таблице не найдено ни одного листа. Проверьте ссылку и что доступ открыт по ссылке.',
    );
  }

  const { targets, notes } = assignTargets(sheets);
  mkdirSync(dir, { recursive: true });
  console.log(`Таблица: ${sheets.length} листов → ${dir}\n`);

  for (const target of targets) {
    const csv = await fetchText(
      `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${target.gid}`,
      `лист «${target.name}»`,
    );
    const page = sheetToPage(csv, target.slug);
    writeFileSync(join(dir, target.file), `${JSON.stringify(page, null, 2)}\n`);
    console.log(`  ${target.file.padEnd(18)} ${target.slug.padEnd(12)} ${page.blocks.length} блоков`);
  }

  for (const note of notes) console.log(`\n  ${note}`);

  const siteFile = join(dir, 'site.json');
  if (existsSync(siteFile)) {
    console.log(`\nsite.json на месте — не тронут.`);
  } else {
    // Written as a starting point rather than left out: without it the site builds with no header
    // and no footer at all, which looks like a bug rather than a setting nobody filled in yet.
    // Only `nav` and `footer` truly have to live here — the form overrides brand, domain, locale,
    // geo and partnerUrl at build time. They are still written so a build straight from the
    // command line, with no form involved, has sane values instead of falling back to example.com.
    const nav = targets
      .filter((target) => target.slug !== '/')
      .map((target) => ({ label: target.name, href: target.slug }));
    writeFileSync(
      siteFile,
      `${JSON.stringify({ domain: `${siteName}.com`, locale: 'en-US', brand: { name: siteName }, nav, partnerUrl: '' }, null, 2)}\n`,
    );
    console.log(
      '\nsite.json создан. Меню собрано из листов; впишите футер, а при желании слоган и логотип.' +
        '\nБренд, домен, язык, гео и партнёрскую ссылку можно оставить как есть — форма их перекрывает.',
    );
  }

  console.log(`\nСобрать: SITE_DIR=${dir} TEMPLATE=review SCHEME=night OUT_DIR=output/${siteName} npm run build:site`);
}

if (process.argv[1] && process.argv[1].endsWith('import-sheet.mjs')) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exit(1);
  });
}
