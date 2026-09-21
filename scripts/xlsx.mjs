// Reads a .xlsx workbook into rows of text, without a dependency.
//
// A .xlsx is a zip of XML parts, and the two things needed here — the sheet names and the cells —
// live in three of them. Node ships the hard half already: `zlib.inflateRawSync` is exactly the
// decompression a zip entry uses. What is left is the zip's own bookkeeping, about sixty lines,
// which is why this is written out rather than pulled in: the project carries no dependency it can
// do without, and a spreadsheet reader would be a large one for one task run once per template.
//
// Only what is needed is parsed. Formatting, formulas, merged cells, dates — all ignored: the
// content spreadsheet this reads is two columns of text (see docs/spreadsheet-format.md), and a
// reader that understood more would have more to get wrong.

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

// The end-of-central-directory record is last in the file, but a zip comment may follow it, so it
// is found by scanning backwards for its signature rather than assumed to be at a fixed offset.
function findEndRecord(buffer) {
  const earliest = Math.max(0, buffer.length - 0xffff - 22);
  for (let at = buffer.length - 22; at >= earliest; at -= 1) {
    if (buffer.readUInt32LE(at) !== EOCD_SIGNATURE) continue;
    // The signature is four ordinary bytes, and compressed data is very nearly random, so it can
    // occur inside an entry by chance. The record also states how long the archive comment is, and
    // that has to account for everything after it — a coincidence almost never does.
    if (buffer.readUInt16LE(at + 20) === buffer.length - at - 22) return at;
  }
  throw new Error('это не zip-архив: не найдена запись конца каталога');
}

// name -> decompressed bytes, for every entry of the archive.
export function readZip(buffer) {
  const end = findEndRecord(buffer);
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);

  const files = new Map();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw new Error(`повреждённый zip: запись ${index + 1} не на месте`);
    }
    const method = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localAt = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);

    // The local header repeats the name and extra field, and its own lengths are the ones that say
    // where the data starts — the central directory's may differ, and following the wrong one lands
    // a few bytes into the compressed stream.
    if (buffer.readUInt32LE(localAt) !== LOCAL_SIGNATURE) {
      throw new Error(`повреждённый zip: заголовок «${name}» не на месте`);
    }
    const dataAt = localAt + 30 + buffer.readUInt16LE(localAt + 26) + buffer.readUInt16LE(localAt + 28);
    const raw = buffer.subarray(dataAt, dataAt + compressedSize);
    if (method === STORED) files.set(name, Buffer.from(raw));
    else if (method === DEFLATED) files.set(name, inflateRawSync(raw));
    else throw new Error(`в архиве «${name}» сжат способом ${method}, который здесь не читается`);

    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body) => {
    if (body[0] !== '#') return ENTITIES[body] ?? whole;
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  });
}

// A shared string is a run of <t> pieces: Excel splits one cell's text wherever its formatting
// changed, so joining them back is what makes a bolded word part of its own sentence again.
function readSharedStrings(files) {
  const xml = files.get('xl/sharedStrings.xml');
  if (!xml) return [];
  return [...xml.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, item]) =>
    unescapeXml([...item.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(([, piece]) => piece).join('')),
  );
}

// "A" -> 0, "Z" -> 25, "AA" -> 26. A cell carries its own column letter, and a row leaves out the
// cells that were never filled, so this is the only thing that keeps a two-column sheet with a gap
// in column A from reading as one column.
function columnIndex(letters) {
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

// The cells of one row, as text, indexed by column. `body` is what stood between a row's own tags.
function readCells(body, shared) {
  const cells = [];
  let width = 0;
  // Split on the tag rather than matching a pair: an empty cell is written self-closing
  // (`<c r="A5" s="1"/>`), and a pattern expecting `</c>` swallows it together with the next
  // cell — which silently shifts every value in the row one column to the left.
  for (const piece of body.split('<c ').slice(1)) {
    const reference = /^r="([A-Z]+)\d+"/.exec(piece);
    if (!reference) continue;
    const column = columnIndex(reference[1]);
    // Counted even when it holds nothing, so a row's length is the width of the sheet rather than
    // the position of its last filled cell — otherwise a trailing empty cell vanishes while a
    // leading one survives, and the two ends of a row behave differently for no reason.
    width = Math.max(width, column + 1);
    const closes = piece.indexOf('>');
    if (closes === -1 || piece[closes - 1] === '/') continue;
    const head = piece.slice(0, closes);
    const inner = piece.slice(closes + 1, piece.indexOf('</c>'));
    const type = /t="([^"]+)"/.exec(head)?.[1] ?? 'n';
    let value = '';
    if (type === 's') value = shared[Number(/<v>(\d+)<\/v>/.exec(inner)?.[1])] ?? '';
    else if (type === 'inlineStr') {
      value = unescapeXml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(([, p]) => p).join(''));
    } else value = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
    cells[column] = value;
  }
  return Array.from({ length: width }, (_, column) => cells[column] ?? '');
}

function readSheet(xml, shared) {
  const rows = [];
  // Split on the tag, for the same reason the cells above are: a row that carries formatting but no
  // cells at all is written self-closing (`<row r="2" s="3" customFormat="1"/>`), and a pattern
  // expecting `</row>` reads it as the opening of a row whose body is everything up to the *next*
  // row's end. The next row's content then lands in this one and its own place comes back empty.
  //
  // That is not a cosmetic slip here: Excel writes a row that way exactly when it is blank but
  // styled — which is what a section separator looks like in this format (docs/spreadsheet-format.md).
  // The separator disappears and the heading after it is read as part of the section before it.
  for (const piece of xml.split('<row').slice(1)) {
    const at = Number(/^[^>]*\br="(\d+)"/.exec(piece)?.[1]);
    if (!Number.isInteger(at) || at < 1) continue;
    const closes = piece.indexOf('>');
    const empty = closes === -1 || piece[closes - 1] === '/';
    const body = empty ? '' : piece.slice(closes + 1, piece.indexOf('</row>'));
    rows[at - 1] = readCells(body, shared);
  }
  // Excel leaves out a row that was never touched at all, and a missing row is not nothing either:
  // the gap is filled in rather than closed up, for the same reason.
  return Array.from({ length: rows.length }, (_, index) => rows[index] ?? []);
}

// The sheets of a workbook, in the order the workbook lists them — which is the order of the tabs,
// and the order pages are meant to be read in.
export function readWorkbook(path) {
  const files = readZip(readFileSync(path));
  const workbook = files.get('xl/workbook.xml');
  if (!workbook) throw new Error(`в файле ${path} нет xl/workbook.xml — это не книга Excel`);

  // A sheet's XML part is named by a relationship id, not by its position: the third tab is not
  // necessarily sheet3.xml, and trusting the number is how a reader silently reads the wrong tab.
  const targets = new Map(
    [...(files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '').matchAll(
      /<Relationship[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g,
    )].map(([, id, target]) => [id, target.replace(/^\/?xl\//, '').replace(/^\.\//, '')]),
  );

  const shared = readSharedStrings(files);
  const sheets = [];
  for (const [, attrs] of workbook.toString('utf8').matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = unescapeXml(/\bname="([^"]*)"/.exec(attrs)?.[1] ?? '');
    const id = /\br:id="([^"]+)"/.exec(attrs)?.[1];
    const part = id ? targets.get(id) : undefined;
    const xml = part ? files.get(`xl/${part}`) : undefined;
    if (!name || !xml) continue;
    sheets.push({ name, rows: readSheet(xml.toString('utf8'), shared) });
  }
  if (sheets.length === 0) throw new Error(`в файле ${path} не нашлось ни одного листа`);
  return sheets;
}
