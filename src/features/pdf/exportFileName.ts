import { defaultPdfSettings } from '@/shared/lib/localStorage';
import type { ExportFileNamePart, PdfSettings } from '@/shared/types';

type Translate = (key: string, vars?: Record<string, string>) => string;

export type ExportFileNameSettings = Pick<PdfSettings, 'fileNameParts' | 'fileNameSeparator' | 'fileNameDateStyle' | 'companyName'>;

// What an export knows about itself; the user's file-name settings decide which of these appear
// and in what order. `type` is the localized document label ("Statement", "Archive", ...).
export type ExportFileNameValues = {
 type: string;
 client?: string | null;
 currency?: string | null;
 fromDate?: string | null;
 toDate?: string | null;
};

const FILE_NAME_PART_KEYS: ExportFileNamePart[] = ['type', 'company', 'client', 'currency', 'range'];
const FILE_NAME_SEPARATORS: PdfSettings['fileNameSeparator'][] = [' - ', '_', ' '];

// Stored settings come from localStorage / the per-user server sync, so they may predate a part
// or be malformed: keep the valid parts in their saved order, drop duplicates, and append any
// missing part with its default switch.
export function normalizeFileNameParts(value: unknown): PdfSettings['fileNameParts'] {
 const parts: PdfSettings['fileNameParts'] = [];
 if (Array.isArray(value)) {
  for (const item of value) {
   const key = (item as { key?: unknown })?.key as ExportFileNamePart;
   if (FILE_NAME_PART_KEYS.includes(key) && !parts.some((p) => p.key === key)) {
    parts.push({ key, enabled: Boolean((item as { enabled?: unknown }).enabled) });
   }
  }
 }
 for (const fallback of defaultPdfSettings.fileNameParts) {
  if (!parts.some((p) => p.key === fallback.key)) parts.push({ ...fallback });
 }
 return parts;
}

// Builds the suggested file name for an export in the user's UI language, e.g.
// "كشف حساب - أحمد - USD - 2026-10-01 إلى 2026-10-29.pdf". Enabled parts are joined with the
// chosen separator; empty parts are dropped. For PDFs this becomes the print popup's
// document.title, which the browser's "Save as PDF" uses as the file name.
export function buildExportFileName(
 t: Translate,
 settings: ExportFileNameSettings,
 values: ExportFileNameValues,
 extension: 'pdf' | 'xlsx',
): string {
 const separator = FILE_NAME_SEPARATORS.includes(settings.fileNameSeparator) ? settings.fileNameSeparator : defaultPdfSettings.fileNameSeparator;
 const byKey: Record<ExportFileNamePart, string | null | undefined> = {
  type: values.type,
  company: settings.companyName,
  client: values.client,
  currency: values.currency,
  range: exportDateRangeLabel(t, settings.fileNameDateStyle, values.fromDate, values.toDate),
 };
 const base = normalizeFileNameParts(settings.fileNameParts)
  .filter((part) => part.enabled)
  .map((part) => sanitizeFileNamePart(byKey[part.key] ?? ''))
  .filter(Boolean)
  .join(separator);
 return `${base || 'export'}.${extension}`;
}

// "2026-10-01 to 2026-10-29", collapsed to one date when both ends match; falls back to today's
// date when no range is set. Dates use "-" (never "/", which is illegal in file names); ISO also
// sorts by name.
function exportDateRangeLabel(t: Translate, style: PdfSettings['fileNameDateStyle'], fromDate?: string | null, toDate?: string | null): string {
 const from = formatFileNameDate(fromDate?.slice(0, 10) ?? '', style);
 const to = formatFileNameDate(toDate?.slice(0, 10) ?? '', style);
 if (from && to) return from === to ? from : t('export_file_range', { from, to });
 return from || to || formatFileNameDate(new Date().toISOString().slice(0, 10), style);
}

function formatFileNameDate(isoDate: string, style: PdfSettings['fileNameDateStyle']): string {
 const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
 if (!match || style !== 'dmy') return isoDate;
 return `${match[3]}-${match[2]}-${match[1]}`;
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
