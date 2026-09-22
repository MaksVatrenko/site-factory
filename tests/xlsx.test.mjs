import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWorkbook, readZip } from '../scripts/xlsx.mjs';

// The books are built here, byte by byte, rather than committed as .xlsx files. The customer's
// spreadsheets live outside the repository, so a test that opened one would be green on this
// machine and red on every other — a mistake this project has already made once.

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

// A zip of `{ name, text, method }` entries. `method` is 0 (stored as-is) or 8 (deflated): a real
// .xlsx mixes both, and the reader has a separate branch for each.
// `localExtra` puts an extra field in the *local* headers only, leaving the central directory's
// extra length at zero — which is legal, common, and the reason the reader must measure the data
// offset with the local header's own lengths.
function zipOf(entries, { comment = '', localExtra = 0 } = {}) {
  const bodies = [];
  const directory = [];
  let offset = 0;

  for (const { name, text, method = 8 } of entries) {
    const source = Buffer.from(text, 'utf8');
    const data = method === 0 ? source : deflateRawSync(source);
    const nameBytes = Buffer.from(name, 'utf8');

    const local = Buffer.alloc(30 + nameBytes.length + localExtra);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(source), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(localExtra, 28);
    nameBytes.copy(local, 30);
    if (localExtra >= 4) {
      local.writeUInt16LE(0xdada, 30 + nameBytes.length); // an id no reader knows, so it is skipped
      local.writeUInt16LE(localExtra - 4, 32 + nameBytes.length);
    }

    const record = Buffer.alloc(46 + nameBytes.length);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(method, 10);
    record.writeUInt32LE(crc32(source), 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(source.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(offset, 42);
    nameBytes.copy(record, 46);

    bodies.push(local, data);
    directory.push(record);
    offset += local.length + data.length;
  }

  const body = Buffer.concat(bodies);
  const central = Buffer.concat(directory);
  const commentBytes = Buffer.from(comment, 'utf8');
  const end = Buffer.alloc(22 + commentBytes.length);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(body.length, 16);
  end.writeUInt16LE(commentBytes.length, 20);
  commentBytes.copy(end, 22);

  return Buffer.concat([body, central, end]);
}

let dirs = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function fileOf(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'site-factory-xlsx-'));
  dirs.push(dir);
  const path = join(dir, 'книга.xlsx');
  writeFileSync(path, bytes);
  return path;
}

const bookFile = (entries, options) => fileOf(zipOf(entries, options));

const workbookXml = (sheets) =>
  `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<sheets>${sheets
    .map(({ name, id }, index) => `<sheet name="${name}" sheetId="${index + 1}" r:id="${id}"/>`)
    .join('')}</sheets></workbook>`;

const relsXml = (links) =>
  `<?xml version="1.0"?><Relationships>${links
    .map(({ id, target }) => `<Relationship Id="${id}" Type="…/worksheet" Target="${target}"/>`)
    .join('')}</Relationships>`;

// A shared string is one `<si>`; an array of pieces becomes several `<t>` inside it, which is what
// Excel writes when the formatting changed partway through the cell.
const sharedXml = (items) =>
  `<?xml version="1.0"?><sst count="${items.length}">${items
    .map((item) => `<si>${[item].flat().map((piece) => `<t>${piece}</t>`).join('')}</si>`)
    .join('')}</sst>`;

// Rows are keyed by their row number, not listed in order: Excel simply leaves out a row nobody
// ever touched, and the number is all the reader has to place the rest.
const sheetXml = (rows) =>
  `<?xml version="1.0"?><worksheet><sheetData>${Object.entries(rows)
    .map(([at, cells]) => `<row r="${at}" spans="1:3">${cells}</row>`)
    .join('')}</sheetData></worksheet>`;

const shared = (ref, index) => `<c r="${ref}" t="s"><v>${index}</v></c>`;
const inline = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
const number = (ref, value) => `<c r="${ref}"><v>${value}</v></c>`;
const blank = (ref) => `<c r="${ref}" s="1"/>`;

// The smallest book readWorkbook accepts, so a test about cells can say only what it is about.
function oneSheet(rows, strings = []) {
  return bookFile([
    { name: 'xl/workbook.xml', text: workbookXml([{ name: 'Казино', id: 'rId1' }]) },
    { name: 'xl/_rels/workbook.xml.rels', text: relsXml([{ id: 'rId1', target: 'worksheets/sheet1.xml' }]) },
    { name: 'xl/sharedStrings.xml', text: sharedXml(strings) },
    { name: 'xl/worksheets/sheet1.xml', text: sheetXml(rows) },
  ]);
}

const rowsOf = (rows, strings) => readWorkbook(oneSheet(rows, strings))[0].rows;

describe('which file a tab is read from', () => {
  it('returns the tabs in the workbook order even when the third one lives in sheet1.xml', () => {
    // The whole point of the file. A sheet's part is named by a relationship id; the numbering in
    // `sheet3.xml` is an accident of how the book was edited and matches the tab order only by
    // luck. A reader that pairs the n-th <sheet> with sheetN.xml still returns three sheets, with
    // the right names, in the right order — only the *contents* are from the wrong tabs, so each
    // sheet here says out loud which file it came from. Nothing else would catch it.
    const path = bookFile([
      // Stored, not deflated: tiny parts are often kept as-is, and this is where that branch runs.
      { name: 'xl/workbook.xml', method: 0, text: workbookXml([
        { name: 'Главная', id: 'rId7' },
        { name: 'Бонусы', id: 'rId4' },
        { name: 'Казино', id: 'rId9' },
      ]) },
      { name: 'xl/_rels/workbook.xml.rels', text: relsXml([
        // The three target spellings a real book uses; all three mean xl/worksheets/….
        { id: 'rId4', target: '/xl/worksheets/sheet3.xml' },
        { id: 'rId7', target: 'worksheets/sheet2.xml' },
        { id: 'rId9', target: './worksheets/sheet1.xml' },
      ]) },
      { name: 'xl/sharedStrings.xml', text: sharedXml(['из sheet1', 'из sheet2', 'из sheet3']) },
      { name: 'xl/worksheets/sheet1.xml', text: sheetXml({ 1: shared('A1', 0) }) },
      { name: 'xl/worksheets/sheet2.xml', text: sheetXml({ 1: shared('A1', 1) }) },
      { name: 'xl/worksheets/sheet3.xml', text: sheetXml({ 1: shared('A1', 2) }) },
    ]);

    const sheets = readWorkbook(path);
    expect(sheets.map((sheet) => sheet.name)).toEqual(['Главная', 'Бонусы', 'Казино']);
    expect(sheets.map((sheet) => sheet.rows[0][0])).toEqual(['из sheet2', 'из sheet3', 'из sheet1']);
  });

  it('skips a sheet whose relationship is missing instead of guessing a file for it', () => {
    // sheet1.xml is sitting right there. Taking it would be a guess, and a guess that reads a
    // leftover part as a page is worse than a book that refuses to open.
    const path = bookFile([
      { name: 'xl/workbook.xml', text: workbookXml([{ name: 'Казино', id: 'rId1' }]) },
      { name: 'xl/_rels/workbook.xml.rels', text: relsXml([]) },
      { name: 'xl/worksheets/sheet1.xml', text: sheetXml({ 1: number('A1', '1') }) },
    ]);
    expect(() => readWorkbook(path)).toThrow(/ни одного листа/);
  });
});

describe('the cells of a sheet', () => {
  it('keeps an empty self-closing cell as an empty column', () => {
    // `<c r="A1" s="1"/>` is a cell that was only ever formatted, and Excel writes it self-closing.
    // Cutting the row into `<c …>…</c>` pairs makes that tag swallow the cell after it, and then
    // the sheet reads one column to the left for good: the label column disappears and every line
    // of the page turns into plain text.
    expect(rowsOf({ 1: blank('A1') + shared('B1', 0) }, ['Живые столы'])).toEqual([['', 'Живые столы']]);
  });

  it('leaves a row nobody touched in place, as an empty row', () => {
    // Excel writes no <row> at all for a row that was never filled. A blank row is not nothing
    // here — it is what ends one section and starts the next (docs/spreadsheet-format.md) — so a
    // reader that closes the gap up glues two sections of the page into one.
    const rows = rowsOf({ 1: shared('A1', 0), 4: shared('A4', 1) }, ['Бонусы', 'Казино']);
    expect(rows).toEqual([['Бонусы'], [], [], ['Казино']]);
  });

  it('reads a shared string, an inline string and a bare number all as text', () => {
    // Three ways of storing the same thing. Only `t="s"` is common; `inlineStr` appears in books
    // exported by other tools, and a number carries no type attribute at all.
    const rows = rowsOf(
      { 1: shared('A1', 0) + inline('B1', 'Живые столы') + number('C1', '2024') },
      ['Бонусы'],
    );
    expect(rows[0]).toEqual(['Бонусы', 'Живые столы', '2024']);
  });

  it('joins a shared string that Excel split where the formatting changed', () => {
    // Bolding one word inside a cell splits its text into several <t> pieces. Taking the first one
    // truncates the sentence, and the loss looks like the author wrote it that way.
    expect(rowsOf({ 1: shared('A1', 0) }, [['Быстрый ', 'вывод']])).toEqual([['Быстрый вывод']]);
  });

  it('turns xml entities back into the characters they stand for', () => {
    // Text goes on to a page, so `&amp;` left unresolved shows up as `&amp;` for a reader. Excel
    // also escapes by code point rather than by name, so `&#39;` has to resolve too.
    const rows = rowsOf(
      { 1: shared('A1', 0) + inline('B1', '&lt;b&gt; &amp; &quot;кавычки&quot;') + number('C1', '1 &#38; 2') },
      ['Ставки &amp; казино: &quot;топ&quot;, &#39;выбор&#39;, &lt;1&gt;'],
    );
    expect(rows[0]).toEqual([
      'Ставки & казино: "топ", \'выбор\', <1>',
      '<b> & "кавычки"',
      '1 & 2',
    ]);
  });

  it('places a cell past column Z by its letters, not by its place in the row', () => {
    // "AA" is column 27, not column 2. Counting cells instead of reading the reference works right
    // up to the first sheet someone widened, which is exactly when nobody is looking.
    const rows = rowsOf({ 1: shared('A1', 0) + shared('AA1', 1) }, ['метка', 'далеко справа']);
    expect(rows[0]).toHaveLength(27);
    expect(rows[0][26]).toBe('далеко справа');
    expect(rows[0].slice(1, 26)).toEqual(Array(25).fill(''));
  });
});

describe('the zip underneath', () => {
  it('reads a stored entry and a deflated one alike', () => {
    // A real .xlsx mixes the two — deflating a short part makes it bigger, so it is stored as-is.
    // Nothing else exercises the stored branch: it does not inflate, so a mistake there stays
    // invisible until a book that happens to store a part turns up.
    const text = 'Ставки и казино — '.repeat(20);
    const files = readZip(zipOf([
      { name: 'stored.xml', text, method: 0 },
      { name: 'deflated.xml', text, method: 8 },
    ]));
    expect(files.get('stored.xml').toString('utf8')).toBe(text);
    expect(files.get('deflated.xml').toString('utf8')).toBe(text);
  });

  it('finds the end record even when a comment sits after it', () => {
    // The end-of-directory record is only usually the last thing in the file; a zip comment may
    // follow. Reading it at a fixed offset from the end fails on exactly those files.
    const files = readZip(zipOf([{ name: 'a.xml', text: 'привет' }], { comment: 'собрано фабрикой' }));
    expect(files.get('a.xml').toString('utf8')).toBe('привет');
  });

  it("measures an entry's data offset from its local header, not from the central directory", () => {
    // Both headers carry their own extra-field lengths and they legitimately differ. Trusting the
    // central directory's here lands twelve bytes into the compressed stream.
    const files = readZip(zipOf([{ name: 'a.xml', text: 'привет' }], { localExtra: 12 }));
    expect(files.get('a.xml').toString('utf8')).toBe('привет');
  });
});

describe('what it refuses to read, and what it says about it', () => {
  it('says a file that is not a zip is not a zip', () => {
    const path = fileOf(Buffer.from('это просто текст, а не книга Excel', 'utf8'));
    expect(() => readWorkbook(path)).toThrow(/не zip-архив/);
  });

  it('names the file when a zip turns out not to be an Excel book', () => {
    // A .zip, a .docx and a Numbers export all open as zips and none of them has xl/workbook.xml.
    // Whoever picked the wrong file needs to read which file it was.
    const path = bookFile([{ name: 'привет.txt', text: 'не книга' }]);
    expect(() => readWorkbook(path)).toThrow(/не книга Excel/);
    expect(() => readWorkbook(path)).toThrow(path);
  });

  it('names the file when the book holds no sheets', () => {
    const path = bookFile([
      { name: 'xl/workbook.xml', text: workbookXml([]) },
      { name: 'xl/_rels/workbook.xml.rels', text: relsXml([]) },
    ]);
    expect(() => readWorkbook(path)).toThrow(/ни одного листа/);
    expect(() => readWorkbook(path)).toThrow(path);
  });
});

// Three defects found by reviewing the reader against its own comments, after the cell-level one
// had already been fixed. Each is invisible in the result: the book reads, the sheet has rows, and
// what is in them is quietly wrong.
describe('reading a book Excel wrote for a styled but empty row', () => {
  // A raw sheet, because sheetXml above always writes a row with a body — and the whole point here
  // is the row Excel writes self-closing: one that carries formatting and holds no cells at all.
  const bookOf = (sheetData) =>
    bookFile([
      { name: 'xl/workbook.xml', text: workbookXml([{ name: 'Казино', id: 'rId1' }]) },
      { name: 'xl/_rels/workbook.xml.rels', text: relsXml([{ id: 'rId1', target: 'worksheets/sheet1.xml' }]) },
      { name: 'xl/sharedStrings.xml', text: sharedXml([]) },
      { name: 'xl/worksheets/sheet1.xml', text: `<?xml version="1.0"?><worksheet><sheetData>${sheetData}</sheetData></worksheet>` },
    ]);

  // The same defect the cells were fixed for, one level up: `[^>]*` eats the closing slash, the row
  // reads as an opening tag, and its body runs to the *next* row's end. The row after it lands
  // inside it and its own place comes back empty.
  //
  // Excel writes a row that way exactly when it is blank but styled — which is what a section
  // separator is in this format (docs/spreadsheet-format.md). So the separator disappears and the
  // heading after it is read as part of the section before it: not a cosmetic slip, a merged section.
  it('keeps a self-closing row empty instead of letting it swallow the next one', () => {
    const [sheet] = readWorkbook(
      bookOf(
        `<row r="1">${inline('A1', 'h2')}${inline('B1', 'Бонусы')}</row>` +
          `<row r="2" s="3" customFormat="1"/>` +
          `<row r="3">${inline('A3', 'h2')}${inline('B3', 'Казино')}</row>`,
      ),
    );
    expect(sheet.rows).toEqual([
      ['h2', 'Бонусы'],
      [],
      ['h2', 'Казино'],
    ]);
  });

  // A row's length should be the width of the sheet, not the position of its last filled cell.
  // Counted only when a cell held something, a trailing blank vanished while a leading one
  // survived — the two ends of one row behaving differently for no reason anyone could see.
  it('counts a trailing empty cell, so both ends of a row behave alike', () => {
    const [sheet] = readWorkbook(
      bookOf(`<row r="1">${inline('A1', 'title')}${blank('B1')}</row><row r="2">${blank('A2')}${inline('B2', 'текст')}</row>`),
    );
    expect(sheet.rows).toEqual([
      ['title', ''],
      ['', 'текст'],
    ]);
  });
});

describe('finding the end of the archive', () => {
  // The end-of-central-directory signature is four ordinary bytes, so it can turn up by chance in
  // the archive comment the record itself points at — the one stretch of the file that sits after
  // the real record and is therefore reached first by a scan that walks backwards from the end.
  // Taking that match would read a piece of the comment as the archive's bookkeeping and fail
  // obscurely. The record states how long the comment is, and a coincidence almost never accounts
  // for everything after it, so the length is what tells the two apart.
  it('walks past a signature that only looks like one', () => {
    const path = fileOf(
      zipOf(
        [
          { name: 'xl/workbook.xml', text: workbookXml([{ name: 'Казино', id: 'rId1' }]) },
          { name: 'xl/_rels/workbook.xml.rels', text: relsXml([{ id: 'rId1', target: 'worksheets/sheet1.xml' }]) },
          { name: 'xl/sharedStrings.xml', text: sharedXml([]) },
          { name: 'xl/worksheets/sheet1.xml', text: sheetXml({ 1: inline('A1', 'цел') }) },
        ],
        { comment: 'PK\u0005\u0006' + 'x'.repeat(40) },
      ),
    );
    expect(readWorkbook(path)[0].rows).toEqual([['цел']]);
  });
});

// Emphasis, which Excel keeps as formatting rather than as characters. A cell whose text is partly
// bold is written as a run of <r> pieces, each with its own <rPr>, and joining them back plainly —
// which is what this reader did — loses the one thing the formatting said. The content format has
// no way to carry formatting either, but it does carry **markup** (templates/_shared/rich-text.mjs),
// so the two meet there.
describe('xlsx: жирные слова в ячейке', () => {
  // A shared string written the way Excel writes a partly-formatted cell.
  const runs = (...pieces) =>
    `<?xml version="1.0"?><sst count="1"><si>${pieces
      .map(([text, bold]) => `<r><rPr>${bold ? '<b/>' : ''}<sz val="11"/></rPr><t>${text}</t></r>`)
      .join('')}</si></sst>`;

  const read = (xml) =>
    readWorkbook(
      bookFile([
        { name: 'xl/workbook.xml', text: workbookXml([{ name: 'Казино', id: 'rId1' }]) },
        { name: 'xl/_rels/workbook.xml.rels', text: relsXml([{ id: 'rId1', target: 'worksheets/sheet1.xml' }]) },
        { name: 'xl/sharedStrings.xml', text: xml },
        { name: 'xl/worksheets/sheet1.xml', text: sheetXml({ 1: shared('A1', 0) }) },
      ]),
    )[0].rows[0][0];

  it('turns a bold run into markup the content format carries', () => {
    expect(read(runs(['Blackjack', true], [' is where I play.', false]))).toBe(
      '**Blackjack** is where I play.',
    );
  });

  it('marks every bold run of a cell, not only the first', () => {
    expect(read(runs(['From ', false], ['৳50', true], [' to ', false], ['৳15,000', true]))).toBe(
      'From **৳50** to **৳15,000**',
    );
  });

  // Excel splits a run wherever anything changed — a font size, a colour — so two neighbouring
  // bold pieces are ordinary. Written out naively they come back as "**a****b**", which is not
  // emphasis at all but four literal asterisks between two words.
  it('joins neighbouring bold runs into one, instead of four asterisks in the middle', () => {
    expect(read(runs(['Black', true], ['jack', true], [' tables', false]))).toBe('**Blackjack** tables');
  });

  it('leaves a cell that is bold all through without markup, since nothing in it stands out', () => {
    expect(read(runs(['Every word of it', true]))).toBe('Every word of it');
  });

  it('leaves a plain cell exactly as it was', () => {
    expect(read('<?xml version="1.0"?><sst count="1"><si><t>Ничего особенного</t></si></sst>')).toBe(
      'Ничего особенного',
    );
  });

  // Trailing spaces belong outside the markers: "**слово **далее" renders the asterisks instead of
  // the emphasis, because a run may not open or close on a space.
  it('keeps a space that fell inside a bold run outside the markers', () => {
    expect(read(runs(['Blackjack ', true], ['is where I play.', false]))).toBe(
      '**Blackjack** is where I play.',
    );
  });
});
