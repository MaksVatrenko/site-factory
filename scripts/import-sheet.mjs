// Turns a whole content spreadsheet into a ready site folder.
//
// The spreadsheet holds one sheet per page. Doing this by hand means looking up each sheet's
// numeric id, downloading it, running the converter and inventing a file name — eight times per
// site, every time. The file name is not a detail: it is the page's address (src/lib/site-dir.mjs),
// so two sheets landing on one file name would silently lose a page.
//
// Usage: node scripts/import-sheet.mjs <spreadsheet url, id or .xlsx path> <site folder name>
//
// A downloaded .xlsx is read straight off disk (scripts/xlsx.mjs) and takes the same path from
// there on: the sheets of a workbook and the sheets of a Google spreadsheet are the same thing, and
// the converter never learns which it was given. That matters because a spreadsheet shared by
// someone else is usually a file in a folder, not a link anyone outside can open.
//
// A bare id is the easier thing to paste: a full sheet url carries a `?`, which zsh takes
// for a filename pattern and refuses to run the command at all.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SERVICE_FILE_NAMES, slugFromFileName } from '../src/lib/site-dir.mjs';
import { rowsToPage, sheetToPage } from './sheet-to-json.mjs';
import { readWorkbook } from './xlsx.mjs';

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

export function isHomeSheet(sheetName) {
  return HOME_SHEET_NAMES.has(String(sheetName ?? '').trim().toLowerCase());
}

const HOME_FILE = 'home.json';

// Every sheet becomes one file, and the file name is the page's address. home.json — the site root —
// is reserved from the start for the first front-page sheet: a sheet that only reduces to "home"
// ("Home!", "🏠 Home") is not a front-page sheet, and must not take the root from the real one just
// by coming first. Any other name already taken — by an earlier sheet ("Bonus" and "bonus!") or by
// one of the folder's service files (a sheet called "Site" or "Images") — gets a numbered name here,
// loudly, instead of overwriting what is already there.
export function assignTargets(sheets) {
  const taken = new Set([...SERVICE_FILE_NAMES, HOME_FILE]);
  const notes = [];
  let homeAssigned = false;

  return {
    targets: sheets.map((sheet) => {
      const isHome = isHomeSheet(sheet.name);
      if (isHome && !homeAssigned) {
        homeAssigned = true;
        return { ...sheet, file: HOME_FILE };
      }

      const base = isHome ? 'home' : fileNameFor(sheet.name);
      let file = `${base}.json`;
      if (taken.has(file)) {
        let n = 2;
        while (taken.has(`${base}-${n}.json`)) n += 1;
        const renamed = `${base}-${n}.json`;
        notes.push(collisionNote(sheet.name, file, isHome, renamed));
        file = renamed;
      }
      taken.add(file);
      return { ...sheet, file };
    }),
    notes,
  };
}

// Says why a sheet did not get the file name it asked for — the three causes are fixed in three
// different places, so the note names which one it was.
function collisionNote(sheetName, file, isHome, renamed) {
  if (SERVICE_FILE_NAMES.includes(file)) {
    return `Лист «${sheetName}» совпадает со служебным файлом ${file} — использован «${renamed}»`;
  }
  if (file === HOME_FILE) {
    return isHome
      ? `Лист «${sheetName}» — ещё одна главная страница, главной остаётся первая — использован «${renamed}»`
      : `Лист «${sheetName}» не главная страница, но даёт имя ${HOME_FILE} — использован «${renamed}»`;
  }
  return `Лист «${sheetName}» даёт то же имя файла, что и предыдущий — использован «${renamed}»`;
}

async function fetchText(url, what) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Не удалось получить ${what}: сервер ответил ${response.status}`);
  }
  return response.text();
}

// A path to a workbook on disk, as opposed to a link or an id to fetch.
export const isWorkbookPath = (input) => /\.xlsx$/i.test(String(input ?? '').trim());

async function main() {
  const [input, siteName] = process.argv.slice(2);
  if (!input || !siteName) {
    console.error('Использование: node scripts/import-sheet.mjs <ссылка, id таблицы или файл .xlsx> <папка сайта>');
    console.error('Ссылку нужно взять в кавычки — id таблицы и путь к файлу можно передать как есть.');
    process.exit(1);
  }

  const dir = join('data', 'sites', siteName);
  const local = isWorkbookPath(input);

  // Both sources end up as the same thing: a list of sheets with a name each, and a way to get one
  // sheet's rows. What differs is only where the bytes come from.
  let sheets;
  let rowsOf;
  if (local) {
    const workbook = readWorkbook(input);
    sheets = workbook.map(({ name }, index) => ({ name, gid: String(index) }));
    rowsOf = async (target) => workbook[Number(target.gid)].rows;
  } else {
    const id = spreadsheetId(input);
    const html = await fetchText(`https://docs.google.com/spreadsheets/d/${id}/htmlview`, 'таблицу');
    sheets = parseSheetList(html);
    if (sheets.length === 0) {
      throw new Error(
        'В таблице не найдено ни одного листа. Проверьте ссылку и что доступ открыт по ссылке.',
      );
    }
    rowsOf = async (target) =>
      sheetToPage(
        await fetchText(
          `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${target.gid}`,
          `лист «${target.name}»`,
        ),
      );
  }

  const { targets, notes } = assignTargets(sheets);
  mkdirSync(dir, { recursive: true });
  console.log(`${local ? 'Книга' : 'Таблица'}: ${sheets.length} листов → ${dir}\n`);

  for (const target of targets) {
    const got = await rowsOf(target);
    const page = Array.isArray(got) ? rowsToPage(got) : got;
    writeFileSync(join(dir, target.file), `${JSON.stringify(page, null, 2)}\n`);
    const route = slugFromFileName(target.file);
    console.log(`  ${target.file.padEnd(18)} ${route.padEnd(12)} ${page.blocks.length} блоков`);
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
      .map((target) => ({ label: target.name, href: slugFromFileName(target.file) }))
      .filter((item) => item.href !== '/');
    writeFileSync(
      siteFile,
      `${JSON.stringify({ domain: `${siteName}.com`, locale: 'en-US', brand: { name: siteName }, nav, partnerUrl: '' }, null, 2)}\n`,
    );
    console.log(
      '\nsite.json создан. Меню собрано из листов; впишите футер, а при желании слоган и логотип.' +
        '\nБренд, домен, язык, гео и партнёрскую ссылку можно оставить как есть — форма их перекрывает.',
    );
  }

  console.log(`\nСобрать: SITE_DIR=${dir} TEMPLATE=template1 SCHEME=dark OUT_DIR=output/${siteName} npm run build:site`);
}

if (process.argv[1] && process.argv[1].endsWith('import-sheet.mjs')) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exit(1);
  });
}
