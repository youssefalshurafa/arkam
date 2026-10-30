type Translate = (key: string, vars?: Record<string, string>) => string;

// Builds the suggested file name for an export in the user's UI language, e.g.
// "كشف حساب - أحمد - USD - 2026-10-01 إلى 2026-10-29.pdf". Parts are joined with " - "; empty
// parts are dropped. For PDFs this becomes the print popup's document.title, which the browser's
// "Save as PDF" uses as the file name.
export function buildExportFileName(parts: Array<string | null | undefined>, extension: 'pdf' | 'xlsx'): string {
 const base = parts
  .map((part) => sanitizeFileNamePart(part ?? ''))
  .filter(Boolean)
  .join(' - ');
 return `${base || 'export'}.${extension}`;
}

// "2026-10-01 to 2026-10-29", collapsed to one date when both ends match; falls back to today's
// date when no range is set. Dates stay ISO (no "/" — illegal in file names — and they sort).
export function exportDateRangeLabel(t: Translate, fromDate?: string | null, toDate?: string | null): string {
 const from = fromDate?.slice(0, 10) ?? '';
 const to = toDate?.slice(0, 10) ?? '';
 if (from && to) return from === to ? from : t('export_file_range', { from, to });
 return from || to || new Date().toISOString().slice(0, 10);
}

// Strips characters Windows/macOS reject in file names (\ / : * ? " < > | and control chars) and
// collapses whitespace. Unicode letters (Arabic, accented French) are kept as-is.
function sanitizeFileNamePart(value: string): string {
 return value
  .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^[.\s]+|[.\s]+$/g, '');
}
