// ============================================================
//  The paper that goes to the exam desk: who is invigilating
//  where, with a box to tick and a line to sign.
// ============================================================

import { MiniPdf, type Rgb } from "./minipdf";
import { prettyDate } from "./dates";
import { slotRange } from "./slots";
import type { Duty, ExamDay } from "./types";
import type { Tally } from "./invigilation";

const INK: Rgb = [23, 32, 42];
const MUTED: Rgb = [95, 108, 121];
const LINE: Rgb = [205, 213, 222];
const HEAD: Rgb = [39, 49, 60];
const ZEBRA: Rgb = [244, 246, 249];
const WHITE: Rgb = [255, 255, 255];

export function attendanceSheet(day: ExamDay, duties: Duty[], names?: Map<string, string>): MiniPdf {
  const pdf = new MiniPdf(210, 297); // A4 portrait
  const M = 15;
  const W = 210;
  let y = M + 6;

  pdf.setInk(INK);
  pdf.setFont("HB", 17);
  pdf.text(day.title || "Invigilation", M, y);
  y += 7;
  pdf.setFont("H", 10);
  pdf.setInk(MUTED);
  pdf.text(prettyDate(day.date) + "   ·   " + slotRange(day.startSlot, day.endSlot), M, y);
  y += 10;

  const rooms = [...new Set(duties.map((d) => d.roomId))].sort((a, b) => {
    const an = duties.find((d) => d.roomId === a)?.roomName || a;
    const bn = duties.find((d) => d.roomId === b)?.roomName || b;
    return an.localeCompare(bn);
  });

  const colPresent = W - M - 30;
  const rowH = 9;

  for (const roomId of rooms) {
    const inRoom = duties
      .filter((d) => d.roomId === roomId && d.status !== "skipped")
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!inRoom.length) continue;

    if (y > 297 - M - 30) {
      pdf.addPage();
      y = M + 6;
    }

    // Room header bar
    pdf.setFill(HEAD);
    pdf.rect(M, y - 5, W - 2 * M, 8);
    pdf.setInk([236, 241, 246]);
    pdf.setFont("HB", 9.5);
    pdf.text(inRoom[0].roomName, M + 3, y + 0.5);
    pdf.setFont("H", 8.5);
    pdf.text(inRoom.length + (inRoom.length === 1 ? " invigilator" : " invigilators"), W - M - 3, y + 0.5, "right");
    y += 7;

    pdf.setInk(MUTED);
    pdf.setFont("H", 7.5);
    pdf.text("NAME", M + 3, y + 3);
    pdf.text("PRESENT", colPresent, y + 3);
    y += 5;

    inRoom.forEach((d, i) => {
      if (y > 297 - M - 14) {
        pdf.addPage();
        y = M + 6;
      }
      pdf.setFill(i % 2 === 0 ? ZEBRA : WHITE);
      pdf.rect(M, y - 1.5, W - 2 * M, rowH);

      pdf.setInk(INK);
      pdf.setFont("H", 10);
      pdf.fit(d.name, colPresent - M - 8, 10);
      pdf.text(d.name, M + 3, y + 4.5);

      // Tick box, filled in if attendance was already marked in the app
      pdf.setFill(LINE);
      pdf.rect(colPresent + 2, y + 0.8, 5, 5);
      pdf.setFill(WHITE);
      pdf.rect(colPresent + 2.4, y + 1.2, 4.2, 4.2);
      if (d.present === true) {
        pdf.setInk([26, 122, 78]);
        pdf.tick(colPresent + 2.4, y + 1.2, 4.2, 0.7);
      }
      if (d.present === false) {
        pdf.setInk([180, 60, 45]);
        pdf.setFont("HB", 8);
        pdf.text("absent", colPresent + 10, y + 4.6);
      }

      y += rowH;
    });

    y += 6;
  }

  const standbyLeft = (day.reserves || []).filter(
    (e) => !duties.some((d) => d.email === e && d.status !== "skipped")
  );
  if (standbyLeft.length) {
    if (y > 297 - M - 24) {
      pdf.addPage();
      y = M + 6;
    }
    pdf.setInk(MUTED);
    pdf.setFont("HB", 9);
    pdf.text("ON STANDBY", M, y);
    y += 5;
    pdf.setFont("H", 9.5);
    pdf.setInk(INK);
    // Names, not email addresses - this sheet goes on a desk.
    pdf.text(standbyLeft.map((e) => names?.get(e) || e).join("   ·   "), M, y);
    y += 8;
  }

  return pdf;
}


/**
 * The admin's record: how many invigilations each teacher has done,
 * then every duty listed under their name.
 */
export function dutyLogSheet(
  rows: { name: string; email: string; tally: Tally }[],
  duties: Duty[]
): MiniPdf {
  const pdf = new MiniPdf(210, 297); // A4 portrait
  const M = 15;
  const W = 210;
  const today = new Date();
  let y = M + 6;

  pdf.setInk(INK);
  pdf.setFont("HB", 17);
  pdf.text("Invigilation record", M, y);
  y += 7;
  pdf.setFont("H", 10);
  pdf.setInk(MUTED);
  pdf.text(
    "As of " + today.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }),
    M,
    y
  );
  y += 10;

  const total = rows.reduce((n, r) => n + r.tally.duties, 0);
  const average = rows.length ? total / rows.length : 0;
  pdf.setInk(INK);
  pdf.setFont("H", 9.5);
  pdf.text(
    rows.length + " teachers · " + total + " duties done · " + average.toFixed(1) + " each on average",
    M,
    y
  );
  y += 8;

  // ---- summary table
  const colDuties = W - M - 58;
  const colSkips = W - M - 36;
  const colLast = W - M - 22;

  pdf.setFill(HEAD);
  pdf.rect(M, y - 5, W - 2 * M, 8);
  pdf.setInk([236, 241, 246]);
  pdf.setFont("HB", 8);
  pdf.text("TEACHER", M + 3, y + 0.5);
  pdf.text("DUTIES", colDuties, y + 0.5);
  pdf.text("SKIPS", colSkips, y + 0.5);
  pdf.text("LAST", colLast, y + 0.5);
  y += 7;

  const rowH = 7;
  rows.forEach((r, i) => {
    if (y > 297 - M - 12) {
      pdf.addPage();
      y = M + 6;
    }
    pdf.setFill(i % 2 === 0 ? ZEBRA : WHITE);
    pdf.rect(M, y - 1, W - 2 * M, rowH);
    pdf.setInk(INK);
    pdf.setFont("H", 9.5);
    pdf.fit(r.name, colDuties - M - 8, 9.5);
    pdf.text(r.name, M + 3, y + 4);
    pdf.setFont("HB", 9.5);
    pdf.text(String(r.tally.duties), colDuties + 6, y + 4, "right");
    pdf.setFont("H", 9.5);
    pdf.setInk(MUTED);
    pdf.text(String(r.tally.skips), colSkips + 4, y + 4, "right");
    pdf.setFont("H", 8.5);
    pdf.text(r.tally.last ? prettyDate(r.tally.last) : "—", colLast, y + 4);
    y += rowH;
  });

  // ---- every duty, teacher by teacher
  y += 8;
  for (const r of rows) {
    const mine = duties
      .filter((d) => d.email === r.email)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!mine.length) continue;
    if (y > 297 - M - 20) {
      pdf.addPage();
      y = M + 6;
    }
    pdf.setInk(INK);
    pdf.setFont("HB", 10);
    pdf.text(r.name, M, y);
    pdf.setFont("H", 8.5);
    pdf.setInk(MUTED);
    pdf.text(r.tally.duties + (r.tally.duties === 1 ? " duty" : " duties"), W - M, y, "right");
    y += 5;

    for (const d of mine) {
      if (y > 297 - M - 8) {
        pdf.addPage();
        y = M + 6;
      }
      pdf.setFont("H", 9);
      pdf.setInk(d.status === "skipped" ? MUTED : INK);
      const marks =
        (d.status === "skipped" ? "dropped" : d.present === true ? "present" : d.present === false ? "absent" : "");
      pdf.text(prettyDate(d.date) + "   " + d.roomName + (marks ? "   " + marks : ""), M + 4, y);
      y += 4.6;
    }
    y += 4;
  }

  return pdf;
}
