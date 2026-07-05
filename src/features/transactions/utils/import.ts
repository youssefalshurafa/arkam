import { normalizeDecimalInput } from '@/shared/utils/decimal';
import type {
 Currency,
 ImportMappingState,
 ImportedTransactionRow,
 ImportRowOverride,
} from '@/shared/types';

export const DEFAULT_IMPORT_ROW_OVERRIDE: ImportRowOverride = { mode: 'expense', direction: 'debit', swap: false };
export function normalizeImportHeader(value: string) {
 return value
  .trim()
  .toLowerCase()
  .replace(/[\u064B-\u065F]/g, '')
  .replace(/[\s_\-]/g, '');
}

export function toImportString(value: unknown) {
 return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

export function toImportAmount(value: unknown) {
 const normalized = normalizeDecimalInput(toImportString(value));
 const parsed = Number.parseFloat(normalized);
 return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function pad2(value: number) {
 return String(value).padStart(2, '0');
}

export function toSqlDateTimeFromParts(year: number, month: number, day: number) {
 if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
  return null;
 }
 if (month < 1 || month > 12 || day < 1 || day > 31) {
  return null;
 }
 return `${year}-${pad2(month)}-${pad2(day)} 00:00:00`;
}

export function parseImportedDate(value: unknown) {
 if (value instanceof Date && !Number.isNaN(value.getTime())) {
  return toSqlDateTimeFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
 }

 const raw = toImportString(value);
 if (!raw) {
  return null;
 }

 const normalized = raw
  .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
  .replace(/\u066C/g, '')
  .trim();

 const yyyymmdd = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
 if (yyyymmdd) {
  return toSqlDateTimeFromParts(Number.parseInt(yyyymmdd[1], 10), Number.parseInt(yyyymmdd[2], 10), Number.parseInt(yyyymmdd[3], 10));
 }

 const dayMonthYear = normalized.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
 if (dayMonthYear) {
  const first = Number.parseInt(dayMonthYear[1], 10);
  const second = Number.parseInt(dayMonthYear[2], 10);
  const maybeYear = dayMonthYear[3] ? Number.parseInt(dayMonthYear[3], 10) : new Date().getFullYear();
  const year = maybeYear < 100 ? 2000 + maybeYear : maybeYear;

  // Prefer day/month, but if impossible (e.g. 07/28/2024), treat as month/day.
  const dayFirst = toSqlDateTimeFromParts(year, second, first);
  if (dayFirst) {
   return dayFirst;
  }

  const monthFirst = toSqlDateTimeFromParts(year, first, second);
  if (monthFirst) {
   return monthFirst;
  }
 }

 const yearMonthDay = normalized.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
 if (yearMonthDay) {
  return toSqlDateTimeFromParts(Number.parseInt(yearMonthDay[1], 10), Number.parseInt(yearMonthDay[2], 10), Number.parseInt(yearMonthDay[3], 10));
 }

 if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
  const serial = Number.parseFloat(normalized);
  if (Number.isFinite(serial) && serial >= 1 && serial <= 100000) {
   const wholeDays = Math.floor(serial);
   const excelEpochUtc = Date.UTC(1899, 11, 30);
   const date = new Date(excelEpochUtc + wholeDays * 24 * 60 * 60 * 1000);
   if (!Number.isNaN(date.getTime())) {
    return toSqlDateTimeFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
   }
  }
 }

 const parsedMillis = Date.parse(raw);
 if (!Number.isNaN(parsedMillis)) {
  const parsedDate = new Date(parsedMillis);
  return toSqlDateTimeFromParts(parsedDate.getFullYear(), parsedDate.getMonth() + 1, parsedDate.getDate());
 }

 return null;
}

export function getExcelLikeColumnName(index: number) {
 let value = index;
 let result = '';

 do {
  result = String.fromCharCode(65 + (value % 26)) + result;
  value = Math.floor(value / 26) - 1;
 } while (value >= 0);

 return result;
}

export function buildImportColumnOptions(rows: unknown[][]) {
 const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);

 return Array.from({ length: maxColumns }, (_, index) => {
  const sample = rows
   .slice(0, 8)
   .map((row) => toImportString(row[index]))
   .find((value) => value.length > 0);

  return {
   index,
   label: `${getExcelLikeColumnName(index)} - ${sample || `Column ${index + 1}`}`,
  };
 });
}

export function escapeRegex(value: string) {
 return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeClientNameForCurrencySuffix(name: string, currency: Currency) {
 const compactName = name.trim().replace(/\s+/g, ' ');
 if (!compactName) {
  return compactName;
 }

 const currencyAliasesByCode: Record<string, string[]> = {
  EUR: ['euro', 'euros', 'يورو'],
  USD: ['dollar', 'dollars', 'usd', 'دولار'],
  TRY: ['turk', 'turkish', 'lira', 'try', 'ليرة', 'تركي'],
  GBP: ['pound', 'sterling', 'gbp', 'جنيه'],
  AED: ['aed', 'dirham', 'درهم'],
  SAR: ['sar', 'riyal', 'ريال'],
 };

 const aliases = [currency.code, currency.name, currency.symbol, ...(currencyAliasesByCode[currency.code] || [])]
  .map((alias) => toImportString(alias).toLowerCase())
  .filter((alias, index, list) => alias.length > 0 && list.indexOf(alias) === index)
  .sort((left, right) => right.length - left.length);

 let normalized = compactName;

 for (const alias of aliases) {
  const aliasPattern = new RegExp(`(?:\\s|[-_/()])${escapeRegex(alias)}$`, 'i');
  const exactAliasPattern = new RegExp(`^${escapeRegex(alias)}$`, 'i');

  if (exactAliasPattern.test(normalized)) {
   continue;
  }

  if (aliasPattern.test(normalized)) {
   normalized = normalized.replace(aliasPattern, '').trim().replace(/\s+/g, ' ');
  }
 }

 return normalized || compactName;
}

// Normalizes a sheet name to the same key used for ImportClientReview.key, so
// parsed rows can be matched back to their review entry.
export function importNameKey(value: string) {
 return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

// `allowOneSided` (used by the archive import) accepts rows that name only a sender or only a
// receiver, and requires just one of the two columns to be mapped. The normal import still
// requires both a sender and a receiver on every row.
export function parseTransactionRowsFromMappedSheet(
 rows: unknown[][],
 mapping: ImportMappingState,
 currency: Currency | null,
 options: { allowOneSided?: boolean } = {},
) {
 const allowOneSided = options.allowOneSided === true;
 if (mapping.amountColumn == null) {
  throw new Error('Please choose a column for Amount.');
 }
 if (allowOneSided ? mapping.fromColumn == null && mapping.toColumn == null : mapping.fromColumn == null || mapping.toColumn == null) {
  throw new Error(allowOneSided ? 'Please choose a column for Sender or Receiver, and Amount.' : 'Please choose columns for Sender, Receiver, and Amount.');
 }

 const parsedRows: ImportedTransactionRow[] = [];

 for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
  const row = rows[rowIndex];
  const fromRaw = mapping.fromColumn == null ? '' : toImportString(row[mapping.fromColumn]);
  const toRaw = mapping.toColumn == null ? '' : toImportString(row[mapping.toColumn]);
  const amountRaw = toImportString(row[mapping.amountColumn]);
  const amount = toImportAmount(amountRaw);
  const description = mapping.descriptionColumn == null ? '' : toImportString(row[mapping.descriptionColumn]);
  const moreInfo = mapping.moreInfoColumn == null ? '' : toImportString(row[mapping.moreInfoColumn]);
  const createdAt = mapping.dateColumn == null ? null : parseImportedDate(row[mapping.dateColumn]);

  const isCompletelyEmpty = !fromRaw && !toRaw && !amountRaw;
  if (isCompletelyEmpty) {
   continue;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
   continue;
  }

  const fromName = currency ? normalizeClientNameForCurrencySuffix(fromRaw, currency) : fromRaw.trim().replace(/\s+/g, ' ');
  const toName = currency ? normalizeClientNameForCurrencySuffix(toRaw, currency) : toRaw.trim().replace(/\s+/g, ' ');

  // Normal import needs both parties; one-sided import needs at least one.
  if (allowOneSided ? !fromName && !toName : !fromName || !toName) {
   continue;
  }

  parsedRows.push({
   fromName,
   toName,
   amount,
   createdAt,
   description,
   moreInfo,
  });
 }

 if (!parsedRows.length) {
  throw new Error('No valid transaction rows were found for the selected columns.');
 }

 return parsedRows;
}
