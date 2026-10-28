import { convertFileSrc } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";

// The document libraries (mammoth, exceljs, docx, pdf-lib) are large —
// together they more than double the app bundle — so they are loaded
// lazily with dynamic import() only when a preview or create actually
// runs, instead of on every app launch. The main bundle stays lean and
// the document chunks are fetched on first use.

/** Document types this app can preview inside its own window.
 * "office" is .doc/.ppt/.pptx/.xls: they are not rendered natively,
 * but converted to PDF with Microsoft Office (assumed installed, per
 * the design decision) and then shown in the PDF preview. */
export type DocumentKind = "pdf" | "docx" | "xlsx" | "office";

export function documentKind(name: string): DocumentKind | null {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "xlsx") return "xlsx";
  if (ext === "doc" || ext === "ppt" || ext === "pptx" || ext === "xls")
    return "office";
  return null;
}

export function isPreviewable(name: string): boolean {
  return documentKind(name) !== null;
}

/** File extension for a document kind, with the leading dot. */
export function documentExtension(kind: DocumentKind): string {
  // "office" is only ever a preview kind (create offers docx/xlsx/pdf);
  // its converted preview is a PDF, so that is the extension here.
  return kind === "pdf" || kind === "office"
    ? ".pdf"
    : kind === "docx"
      ? ".docx"
      : ".xlsx";
}

export function documentLabel(kind: DocumentKind): string {
  return kind === "pdf"
    ? "PDF"
    : kind === "docx"
      ? "Word"
      : kind === "xlsx"
        ? "Excel"
        : "Office";
}

/* ------------------------------ preview ------------------------------ */

/**
 * Read a library file through the asset protocol (the library folder is
 * already allowlisted by FilesView's refresh, the same way image/video
 * thumbnails are served). This keeps preview read-only: nothing is
 * copied out of the library, and the file itself is never modified.
 */
export async function fetchLibraryFile(path: string): Promise<ArrayBuffer> {
  const res = await fetch(convertFileSrc(path));
  if (!res.ok) throw new Error(`Could not read the file (${res.status}).`);
  return res.arrayBuffer();
}

/** Word preview: docx -> HTML, sanitized like the README renderer. */
export async function previewDocx(buffer: ArrayBuffer): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
  // mammoth output is document content, not arbitrary web content, but
  // a docx can still carry hostile HTML (e.g. in a hyperlink), so it
  // goes through the same sanitizer as READMEs.
  return DOMPurify.sanitize(result.value);
}

export interface XlsxSheet {
  name: string;
  rows: string[][];
  truncated: boolean;
}

/** Excel preview: every sheet as plain text rows (values, not formulas). */
export async function previewXlsx(
  buffer: ArrayBuffer,
): Promise<XlsxSheet[]> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer);
  const sheets: XlsxSheet[] = [];
  const MAX_ROWS = 500;
  const MAX_COLS = 50;
  workbook.eachSheet((worksheet) => {
    const rows: string[][] = [];
    let truncated = false;
    worksheet.eachRow((row) => {
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        return;
      }
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        if (values.length >= MAX_COLS) return;
        const v = cell.value;
        if (v === null || v === undefined) values.push("");
        else if (typeof v === "object")
          // Rich text, hyperlinks, errors and formulas land here.
          values.push(
            "text" in v && typeof v.text === "string"
              ? v.text
              : "result" in v && v.result !== undefined
                ? String(v.result)
                : "",
          );
        else values.push(String(v));
      });
      // Drop trailing empty cells so ragged rows don't stretch the table.
      while (values.length && values[values.length - 1] === "")
        values.pop();
      rows.push(values);
    });
    if (worksheet.rowCount > MAX_ROWS) truncated = true;
    sheets.push({ name: worksheet.name, rows, truncated });
  });
  return sheets;
}

/* ------------------------------ create ------------------------------- */

/** A new, empty Word document: a title heading and one blank line. */
export async function createDocxBytes(title: string): Promise<Uint8Array> {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } =
    await import("docx");
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: title,
            heading: HeadingLevel.TITLE,
          }),
          new Paragraph({
            children: [new TextRun("")],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** A new, empty Excel workbook with a single blank sheet. */
export async function createXlsxBytes(): Promise<Uint8Array> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.addWorksheet("Sheet1");
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

/** A new, one-page PDF with the title on it. */
export async function createPdfBytes(title: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const body = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(title, {
    x: 50,
    y: 780,
    size: 24,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText(`Created with Project Manager — ${new Date().toLocaleDateString()}`, {
    x: 50,
    y: 750,
    size: 11,
    font: body,
    color: rgb(0.4, 0.4, 0.4),
  });
  return doc.save();
}

export async function createDocumentBytes(
  kind: DocumentKind,
  title: string,
): Promise<Uint8Array> {
  if (kind === "docx") return createDocxBytes(title);
  if (kind === "xlsx") return createXlsxBytes();
  return createPdfBytes(title);
}

/** Bytes -> base64 for the Rust save command (chunked, so large files
 *  don't blow the call stack in btoa). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
