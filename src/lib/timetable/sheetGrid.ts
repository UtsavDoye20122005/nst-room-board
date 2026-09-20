// ============================================================
//  Reading a Google Sheet as a GRID, merges and all.
//
//  WHY THIS FILE EXISTS AT ALL
//
//  The obvious way to read a Google Sheet from code is the CSV
//  export. It is useless for a timetable. A timetable cell says
//  WHEN a class runs by how far the merged cell stretches across
//  the time columns - "AP LEC" sitting in one cell that spans
//  9:30-10:00, 10:00-10:30 and 10:30-11:00 IS the fact that AP
//  runs 9:30 to 11:00. CSV throws every merge away and reports
//  only the top-left cell, so every class arrives with a start
//  time and no end time. The same merges running DOWNWARDS are
//  what say a lecture is shared by Batch A1 and A2 rather than
//  taught to one of them.
//
//  So we ask Google for  export?format=zip  instead, which is a
//  zip of real static HTML: merges survive as colspan/rowspan.
//  (`export?format=html` is rejected with a 400, and `/htmlview`
//  and `/pubhtml` are no use - the first is now a JavaScript
//  shell with no table in it, the second 401s unless the sheet
//  has been explicitly "published to the web". The zip needs no
//  credentials and no setting changed on the sheet: link-viewable
//  is enough, which is what these two already are.)
//
//  Nothing here knows anything about classes, rooms or batches.
//  It turns a zip into a rectangular grid of cells. Giving that
//  grid meaning is sheetTimetable.ts's job.
// ============================================================

import { inflateRawSync } from "node:zlib";

/** One cell, placed at the row and column it actually occupies. */
export interface GridCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  text: string;
}

// ------------------------------------------------------------
//  The zip
// ------------------------------------------------------------

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/**
 * Pulls the single .html file out of Google's export zip.
 *
 * Read through the CENTRAL DIRECTORY at the end of the archive
 * rather than walking local headers from the front: when a zip is
 * written as a stream the local header is allowed to leave the
 * compressed size as zero and put the real figure in a trailing
 * data descriptor, so local headers alone cannot be trusted to say
 * how long an entry is. The central directory always can.
 */
export function htmlFromZip(zip: Buffer): string {
  const eocd = findEocd(zip);
  const entryCount = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(p) !== CENTRAL_SIG) {
      throw new Error("Timetable sheet download is not a readable zip (bad central directory).");
    }
    const method = zip.readUInt16LE(p + 10);
    const compressedSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");

    if (name.toLowerCase().endsWith(".html")) {
      return readEntry(zip, localOffset, method, compressedSize);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("Timetable sheet download contained no HTML sheet.");
}

function findEocd(zip: Buffer): number {
  // The end-of-central-directory record is last, but a zip comment can
  // follow it, so scan backwards for the signature.
  const earliest = Math.max(0, zip.length - 22 - 0xffff);
  for (let i = zip.length - 22; i >= earliest; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error("Timetable sheet download is not a zip file.");
}

function readEntry(zip: Buffer, localOffset: number, method: number, compressedSize: number): string {
  if (zip.readUInt32LE(localOffset) !== LOCAL_SIG) {
    throw new Error("Timetable sheet download is not a readable zip (bad entry header).");
  }
  const nameLen = zip.readUInt16LE(localOffset + 26);
  const extraLen = zip.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLen + extraLen;
  const body = zip.subarray(start, start + compressedSize);

  if (method === 0) return body.toString("utf8");
  if (method === 8) return inflateRawSync(body).toString("utf8");
  throw new Error("Timetable sheet download uses an unsupported zip compression method (" + method + ").");
}

// ------------------------------------------------------------
//  The HTML table
// ------------------------------------------------------------

/**
 * Lays the table out the way a browser would.
 *
 * This is the part that is easy to get wrong and quietly wrong when
 * you do. A cell with rowspan=4 (the LUNCH block, say) appears in the
 * HTML ONCE, in the first of the four rows it covers. The three rows
 * below it simply have one fewer <td> than there are columns. Counting
 * <td>s left to right in those rows therefore puts every cell after
 * lunch two columns early - which silently moves a 2 o'clock lab to
 * half twelve. So we carry spans forward and skip the columns they
 * already occupy, exactly as table layout does.
 *
 * Row-header cells (the grey 1, 2, 3... down the left, which Google
 * emits as <th>) are dropped, so column 0 of the returned grid is the
 * sheet's own first column - the one holding "MONDAY" or "BATCH A1".
 */
export function parseTable(html: string): GridCell[] {
  const table = firstTable(html);
  const cells: GridCell[] = [];
  /** column -> a cell from an earlier row still covering it. */
  const carried = new Map<number, { rowsLeft: number }>();

  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);

  let row = 0;
  for (const rowHtml of rows) {
    const raw = [...rowHtml.matchAll(/<(t[dh])\b([^>]*)>([\s\S]*?)<\/\1>/gi)];

    // Google writes the column-letter strip (A, B, C...) and the row
    // numbers down the side as <th>. Neither is sheet content.
    const tds = raw.filter((m) => m[1].toLowerCase() === "td");
    if (!tds.length && !carried.size) {
      // A row of nothing but headers: the A/B/C strip. Not a sheet row.
      if (raw.length) continue;
    }

    let col = 0;
    for (const m of tds) {
      while (spanAt(carried, col)) col++;
      const attrs = m[2];
      const colSpan = intAttr(attrs, "colspan");
      const rowSpan = intAttr(attrs, "rowspan");
      const text = cellText(m[3]);

      if (text) cells.push({ row, col, rowSpan, colSpan, text });

      // rowsLeft counts THIS row too, because every carried span is
      // decremented once at the end of every row including this one.
      // Setting it to rowSpan - 1 here instead would have the entry
      // wiped out by that same decrement before it ever got the chance
      // to block the row below - which is the one row it exists for.
      if (rowSpan > 1) {
        for (let c = col; c < col + colSpan; c++) carried.set(c, { rowsLeft: rowSpan });
      }
      col += colSpan;
    }

    for (const [c, s] of [...carried]) {
      s.rowsLeft--;
      if (s.rowsLeft <= 0) carried.delete(c);
    }
    row++;
  }
  return cells;
}

function spanAt(carried: Map<number, { rowsLeft: number }>, col: number): boolean {
  return carried.has(col);
}

function firstTable(html: string): string {
  const m = /<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(html);
  if (!m) throw new Error("Timetable sheet has no table in it.");
  return m[1];
}

function intAttr(attrs: string, name: string): number {
  const m = new RegExp(name + '\\s*=\\s*"?(\\d+)', "i").exec(attrs);
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#34": '"',
};

function cellText(inner: string): string {
  return inner
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#?\w+);/g, (whole, name: string) => {
      const key = name.toLowerCase();
      if (key in ENTITIES) return ENTITIES[key];
      if (/^#\d+$/.test(name)) return String.fromCharCode(Number(name.slice(1)));
      return whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}
