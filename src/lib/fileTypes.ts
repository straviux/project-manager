/**
 * File-type badges for the Files view.
 *
 * The badge shows the file's extension (DOCX, PPTX, PDF, …) so the
 * type is readable at a glance, instead of only via the category icon
 * (Documents, Images, …) which groups many types together. Colours are
 * per family, not per extension, so a new extension still gets a
 * sensible colour from its family. Badge backgrounds are solid
 * (opaque) in both modes, so the badge stays readable over thumbnails
 * in grid view and never lets the backdrop show through.
 */

/** Extension without the dot, lowercased; "" when there is none. */
export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  // ".tar.gz" reads as a single type, not just "gz".
  if (base.toLowerCase().endsWith(".tar.gz")) return "tar.gz";
  if (base.toLowerCase().endsWith(".tar.bz2")) return "tar.bz2";
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return "";
  return base.slice(i + 1).toLowerCase();
}

/** Badge text: the extension uppercased, or "FILE" when there is none. */
export function fileTypeLabel(name: string): string {
  const ext = fileExtension(name);
  return ext ? ext.toUpperCase() : "FILE";
}

/** Human-readable tooltip for the badge. */
export function fileTypeTitle(name: string): string {
  const ext = fileExtension(name);
  return ext ? `${ext.toUpperCase()} file` : "File with no extension";
}

const FAMILY_CLASSES: Record<string, string> = {
  // Word-style documents
  doc: "bg-blue-100 text-blue-800 ring-blue-300 dark:bg-blue-900 dark:text-blue-200 dark:ring-blue-700",
  docx: "bg-blue-100 text-blue-800 ring-blue-300 dark:bg-blue-900 dark:text-blue-200 dark:ring-blue-700",
  odt: "bg-blue-100 text-blue-800 ring-blue-300 dark:bg-blue-900 dark:text-blue-200 dark:ring-blue-700",
  rtf: "bg-blue-100 text-blue-800 ring-blue-300 dark:bg-blue-900 dark:text-blue-200 dark:ring-blue-700",
  // PDF gets its own colour — it is the most common document type.
  pdf: "bg-red-100 text-red-800 ring-red-300 dark:bg-red-900 dark:text-red-200 dark:ring-red-700",
  // Spreadsheets
  xls: "bg-green-100 text-green-800 ring-green-300 dark:bg-green-900 dark:text-green-200 dark:ring-green-700",
  xlsx: "bg-green-100 text-green-800 ring-green-300 dark:bg-green-900 dark:text-green-200 dark:ring-green-700",
  csv: "bg-green-100 text-green-800 ring-green-300 dark:bg-green-900 dark:text-green-200 dark:ring-green-700",
  ods: "bg-green-100 text-green-800 ring-green-300 dark:bg-green-900 dark:text-green-200 dark:ring-green-700",
  // Presentations
  ppt: "bg-orange-100 text-orange-800 ring-orange-300 dark:bg-orange-900 dark:text-orange-200 dark:ring-orange-700",
  pptx: "bg-orange-100 text-orange-800 ring-orange-300 dark:bg-orange-900 dark:text-orange-200 dark:ring-orange-700",
  odp: "bg-orange-100 text-orange-800 ring-orange-300 dark:bg-orange-900 dark:text-orange-200 dark:ring-orange-700",
  key: "bg-orange-100 text-orange-800 ring-orange-300 dark:bg-orange-900 dark:text-orange-200 dark:ring-orange-700",
  // Plain text / notes
  txt: "bg-neutral-200 text-neutral-700 ring-neutral-300 dark:bg-neutral-700 dark:text-neutral-200 dark:ring-neutral-600",
  md: "bg-neutral-200 text-neutral-700 ring-neutral-300 dark:bg-neutral-700 dark:text-neutral-200 dark:ring-neutral-600",
  // Images
  jpg: "bg-purple-100 text-purple-800 ring-purple-300 dark:bg-purple-900 dark:text-purple-200 dark:ring-purple-700",
  jpeg: "bg-purple-100 text-purple-800 ring-purple-300 dark:bg-purple-900 dark:text-purple-200 dark:ring-purple-700",
  png: "bg-purple-100 text-purple-800 ring-purple-300 dark:bg-purple-900 dark:text-purple-200 dark:ring-purple-700",
  gif: "bg-purple-100 text-purple-800 ring-purple-300 dark:bg-purple-900 dark:text-purple-200 dark:ring-purple-700",
  webp: "bg-purple-100 text-purple-800 ring-purple-300 dark:bg-purple-900 dark:text-purple-200 dark:ring-purple-700",
  svg: "bg-purple-100 text-purple-800 ring-purple-300 dark:bg-purple-900 dark:text-purple-200 dark:ring-purple-700",
  bmp: "bg-purple-100 text-purple-800 ring-purple-300 dark:bg-purple-900 dark:text-purple-200 dark:ring-purple-700",
  heic: "bg-purple-100 text-purple-800 ring-purple-300 dark:bg-purple-900 dark:text-purple-200 dark:ring-purple-700",
  avif: "bg-purple-100 text-purple-800 ring-purple-300 dark:bg-purple-900 dark:text-purple-200 dark:ring-purple-700",
  // Videos
  mp4: "bg-rose-100 text-rose-800 ring-rose-300 dark:bg-rose-900 dark:text-rose-200 dark:ring-rose-700",
  mov: "bg-rose-100 text-rose-800 ring-rose-300 dark:bg-rose-900 dark:text-rose-200 dark:ring-rose-700",
  mkv: "bg-rose-100 text-rose-800 ring-rose-300 dark:bg-rose-900 dark:text-rose-200 dark:ring-rose-700",
  webm: "bg-rose-100 text-rose-800 ring-rose-300 dark:bg-rose-900 dark:text-rose-200 dark:ring-rose-700",
  avi: "bg-rose-100 text-rose-800 ring-rose-300 dark:bg-rose-900 dark:text-rose-200 dark:ring-rose-700",
  // Audio
  mp3: "bg-teal-100 text-teal-800 ring-teal-300 dark:bg-teal-900 dark:text-teal-200 dark:ring-teal-700",
  wav: "bg-teal-100 text-teal-800 ring-teal-300 dark:bg-teal-900 dark:text-teal-200 dark:ring-teal-700",
  flac: "bg-teal-100 text-teal-800 ring-teal-300 dark:bg-teal-900 dark:text-teal-200 dark:ring-teal-700",
  ogg: "bg-teal-100 text-teal-800 ring-teal-300 dark:bg-teal-900 dark:text-teal-200 dark:ring-teal-700",
  m4a: "bg-teal-100 text-teal-800 ring-teal-300 dark:bg-teal-900 dark:text-teal-200 dark:ring-teal-700",
  // Archives
  zip: "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-900 dark:text-amber-200 dark:ring-amber-700",
  rar: "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-900 dark:text-amber-200 dark:ring-amber-700",
  "7z": "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-900 dark:text-amber-200 dark:ring-amber-700",
  tar: "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-900 dark:text-amber-200 dark:ring-amber-700",
  gz: "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-900 dark:text-amber-200 dark:ring-amber-700",
  "tar.gz": "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-900 dark:text-amber-200 dark:ring-amber-700",
  "tar.bz2": "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-900 dark:text-amber-200 dark:ring-amber-700",
  // Code
  js: "bg-indigo-100 text-indigo-800 ring-indigo-300 dark:bg-indigo-900 dark:text-indigo-200 dark:ring-indigo-700",
  ts: "bg-indigo-100 text-indigo-800 ring-indigo-300 dark:bg-indigo-900 dark:text-indigo-200 dark:ring-indigo-700",
  py: "bg-indigo-100 text-indigo-800 ring-indigo-300 dark:bg-indigo-900 dark:text-indigo-200 dark:ring-indigo-700",
  html: "bg-indigo-100 text-indigo-800 ring-indigo-300 dark:bg-indigo-900 dark:text-indigo-200 dark:ring-indigo-700",
  css: "bg-indigo-100 text-indigo-800 ring-indigo-300 dark:bg-indigo-900 dark:text-indigo-200 dark:ring-indigo-700",
  json: "bg-indigo-100 text-indigo-800 ring-indigo-300 dark:bg-indigo-900 dark:text-indigo-200 dark:ring-indigo-700",
  xml: "bg-indigo-100 text-indigo-800 ring-indigo-300 dark:bg-indigo-900 dark:text-indigo-200 dark:ring-indigo-700",
  java: "bg-indigo-100 text-indigo-800 ring-indigo-300 dark:bg-indigo-900 dark:text-indigo-200 dark:ring-indigo-700",
  cpp: "bg-indigo-100 text-indigo-800 ring-indigo-300 dark:bg-indigo-900 dark:text-indigo-200 dark:ring-indigo-700",
  c: "bg-indigo-100 text-indigo-800 ring-indigo-300 dark:bg-indigo-900 dark:text-indigo-200 dark:ring-indigo-700",
  rs: "bg-indigo-100 text-indigo-800 ring-indigo-300 dark:bg-indigo-900 dark:text-indigo-200 dark:ring-indigo-700",
  go: "bg-indigo-100 text-indigo-800 ring-indigo-300 dark:bg-indigo-900 dark:text-indigo-200 dark:ring-indigo-700",
};

const DEFAULT_CLASSES =
  "bg-neutral-200 text-neutral-700 ring-neutral-300 dark:bg-neutral-700 dark:text-neutral-200 dark:ring-neutral-600";

/** Full class list for the badge, given a file name. */
export function fileTypeBadgeClasses(name: string): string {
  return FAMILY_CLASSES[fileExtension(name)] ?? DEFAULT_CLASSES;
}

/** Base badge shape, shared by rows and tiles. */
export const FILE_TYPE_BADGE_BASE =
  "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset";
