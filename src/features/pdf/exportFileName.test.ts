import { describe, expect, it } from 'vitest';
import { defaultPdfSettings } from '@/shared/lib/localStorage';
import { buildExportFileName, normalizeFileNameParts } from './exportFileName';

const t = (key: string, vars?: Record<string, string>) => (key === 'export_file_range' ? `${vars?.from} to ${vars?.to}` : key);
const values = { type: 'Statement', client: 'Ahmed', currency: 'USD', fromDate: '2026-10-01', toDate: '2026-10-29' };

describe('buildExportFileName', () => {
 it('keeps the original naming with default settings', () => {
  expect(buildExportFileName(t, defaultPdfSettings, values, 'pdf')).toBe('Statement - Ahmed - USD - 2026-10-01 to 2026-10-29.pdf');
 });

 it('follows the part order, switches, separator and date style', () => {
  const settings = {
   ...defaultPdfSettings,
   companyName: 'Arkam',
   fileNameParts: [
    { key: 'client' as const, enabled: true },
    { key: 'range' as const, enabled: true },
    { key: 'company' as const, enabled: true },
    { key: 'type' as const, enabled: false },
    { key: 'currency' as const, enabled: false },
   ],
   fileNameSeparator: '_' as const,
   fileNameDateStyle: 'dmy' as const,
  };
  expect(buildExportFileName(t, settings, values, 'xlsx')).toBe('Ahmed_01-10-2026 to 29-10-2026_Arkam.xlsx');
 });

 it('skips parts an export does not have', () => {
  expect(buildExportFileName(t, defaultPdfSettings, { type: 'Archive', fromDate: '2026-10-05', toDate: '2026-10-05' }, 'pdf')).toBe('Archive - 2026-10-05.pdf');
 });

 it('falls back to "export" when every part is off', () => {
  const settings = { ...defaultPdfSettings, fileNameParts: defaultPdfSettings.fileNameParts.map((p) => ({ ...p, enabled: false })) };
  expect(buildExportFileName(t, settings, values, 'pdf')).toBe('export.pdf');
 });
});

describe('normalizeFileNameParts', () => {
 it('keeps saved order, drops junk and duplicates, appends missing parts', () => {
  expect(normalizeFileNameParts([{ key: 'range', enabled: true }, { key: 'bogus', enabled: true }, { key: 'range', enabled: false }, null])).toEqual([
   { key: 'range', enabled: true },
   { key: 'type', enabled: true },
   { key: 'company', enabled: false },
   { key: 'client', enabled: true },
   { key: 'currency', enabled: true },
  ]);
  expect(normalizeFileNameParts(undefined)).toEqual(defaultPdfSettings.fileNameParts);
 });
});
