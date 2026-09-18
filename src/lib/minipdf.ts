// ============================================================
//  A very small PDF writer: rectangles and text, nothing else.
//
//  Why not a library? A PDF is a plain text file with a table of
//  byte offsets at the end. That is all this does, and it keeps
//  the app free of a 300 KB dependency for one printable sheet.
//
//  Units are millimetres, measured from the top-left corner, the
//  way a person thinks about a page. The flip to PDF's bottom-left
//  origin happens inside rect() and text().
// ============================================================

// Character widths for the two built-in fonts, taken from the Adobe
// metrics (1000 units = one character height). Needed so text can be
// centred and shrunk to fit a box.
const W_HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

const MM_TO_PT = 72 / 25.4;
const BASE: Record<string, string> = { H: "Helvetica", HB: "Helvetica-Bold" };

export type PdfFont = "H" | "HB";
export type Rgb = [number, number, number];

// The core fonts only carry Latin-1. Typographic punctuation is far
// too common in ordinary text to print as "?", so it is folded down to
// the nearest ASCII first - an en dash becomes a hyphen, curly quotes
// become straight ones.
const FOLD: Record<string, string> = {
  "\u2013": "-",
  "\u2014": "-",
  "\u2212": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u2026": "...",
  "\u00a0": " ",
  "\u2022": "\u00b7",
};

const clean = (s: string) =>
  // Accents first: the width tables here only cover ASCII, so "Zoë"
  // has to become "Zoe" rather than "Zo?".
  Array.from(String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    .map((ch) => {
      const folded = FOLD[ch];
      if (folded) return folded;
      // Array.from walks whole code points, so an emoji or a rare CJK
      // character arrives here as a two-unit string. Writing it out
      // raw would put a stray byte - often "(" from a low surrogate -
      // inside a PDF string and swallow the rest of the page.
      if (ch.length > 1 || ch.codePointAt(0)! > 0xff) return "?";
      const c = ch.charCodeAt(0);
      return (c >= 32 && c <= 126) || ch === "\u00b7" ? ch : "?";
    })
    .join("");

const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const colour = (rgb: Rgb) => rgb.map((v) => (v / 255).toFixed(3)).join(" ");
const n2 = (v: number) => v.toFixed(2);

function charWidth(font: PdfFont, ch: string): number {
  if (ch === "·") return 278;
  const c = ch.charCodeAt(0);
  const table = font === "HB" ? W_HELVETICA_BOLD : W_HELVETICA;
  return c >= 32 && c <= 126 ? table[c - 32] : 556;
}

export class MiniPdf {
  private pages: string[][] = [];
  private cur: string[] = [];
  private font: PdfFont = "H";
  private size = 10;
  private fill: Rgb = [0, 0, 0];
  private ink: Rgb = [0, 0, 0];

  constructor(public readonly width = 297, public readonly height = 210) {
    this.addPage();
  }

  addPage(): void {
    this.cur = [];
    this.pages.push(this.cur);
  }

  setFont(f: PdfFont, size?: number): void {
    this.font = f;
    if (size != null) this.size = size;
  }

  setSize(size: number): void {
    this.size = size;
  }

  setFill(rgb: Rgb): void {
    this.fill = rgb;
  }

  setInk(rgb: Rgb): void {
    this.ink = rgb;
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.cur.push(
      `${colour(this.fill)} rg ${n2(x * MM_TO_PT)} ${n2((this.height - y - h) * MM_TO_PT)} ${n2(w * MM_TO_PT)} ${n2(h * MM_TO_PT)} re f`
    );
  }

  /**
   * A stroked line, for anything the fonts cannot draw. Coordinates
   * are millimetres from the top-left, like everything else here.
   */
  line(x1: number, y1: number, x2: number, y2: number, w = 0.4): void {
    this.cur.push(
      `${colour(this.ink)} RG ${n2(w * MM_TO_PT)} w 1 J 1 j ` +
        `${n2(x1 * MM_TO_PT)} ${n2((this.height - y1) * MM_TO_PT)} m ` +
        `${n2(x2 * MM_TO_PT)} ${n2((this.height - y2) * MM_TO_PT)} l S`
    );
  }

  /**
   * A real tick, drawn with two strokes. The check character is not in
   * the core fonts, and a printed "X" in a box marked PRESENT reads as
   * the opposite of what it means.
   */
  tick(x: number, y: number, size = 4, w = 0.6): void {
    this.line(x + size * 0.14, y + size * 0.52, x + size * 0.4, y + size * 0.8, w);
    this.line(x + size * 0.4, y + size * 0.8, x + size * 0.88, y + size * 0.16, w);
  }

  /** Width of a string in millimetres, at the current font and size. */
  width_(text: string): number {
    let w = 0;
    for (const ch of clean(text)) w += charWidth(this.font, ch);
    return ((w / 1000) * this.size) / MM_TO_PT;
  }

  /** Shrinks the size until the text fits `maxW` millimetres. */
  fit(text: string, maxW: number, start: number, min = 4): number {
    this.size = start;
    while (this.size > min && this.width_(text) > maxW) this.size -= 0.25;
    return this.size;
  }

  text(t: string, x: number, y: number, align: "left" | "center" | "right" = "left"): void {
    const s = clean(t);
    const w = this.width_(s);
    let left = x;
    if (align === "center") left = x - w / 2;
    else if (align === "right") left = x - w;
    this.cur.push(
      `BT /${this.font} ${n2(this.size)} Tf ${colour(this.ink)} rg ${n2(left * MM_TO_PT)} ${n2((this.height - y) * MM_TO_PT)} Td (${escape(s)}) Tj ET`
    );
  }

  blob(): Blob {
    const objs: string[] = [];
    const add = (body: string) => {
      objs.push(body);
      return objs.length;
    };
    const catalog = add("");
    const pagesId = add("");
    const fontIds: Record<string, number> = {};
    for (const f of Object.keys(BASE)) {
      fontIds[f] = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${BASE[f]} /Encoding /WinAnsiEncoding >>`);
    }
    const fontRes = Object.keys(BASE)
      .map((f) => `/${f} ${fontIds[f]} 0 R`)
      .join(" ");

    const kids: number[] = [];
    for (const ops of this.pages) {
      const stream = ops.join("\n");
      const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      kids.push(
        add(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n2(this.width * MM_TO_PT)} ${n2(this.height * MM_TO_PT)}] /Resources << /Font << ${fontRes} >> >> /Contents ${contentId} 0 R >>`
        )
      );
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;

    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    objs.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out +=
      `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
      offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return new Blob([bytes], { type: "application/pdf" });
  }
}

/** Hands the finished file to the browser. */
export function downloadPdf(pdf: MiniPdf, filename: string): void {
  const url = URL.createObjectURL(pdf.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}
