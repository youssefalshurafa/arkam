import type { PdfSettings } from '@/shared/types';

export function formatDateValue(value: string, dateFormat: PdfSettings['dateFormat']) {
 const iso = value.slice(0, 10);
 const [y = '', m = '', d = ''] = iso.split('-');
 switch (dateFormat) {
  case 'day-month':
   return `${d}/${m}`;
  case 'month-year':
   return `${m}/${y}`;
  case 'day-month-year-2':
   return `${d}/${m}/${y.slice(2)}`;
  case 'month-day':
   return `${m}/${d}`;
  default:
   return iso;
 }
}

// Extracts "HH:mm" from a raw local-time createdAt string ("YYYY-MM-DD HH:mm:ss" or
// "YYYY-MM-DDTHH:mm:ss") without going through Date/timezone conversion.
export function formatTimeValue(value: string): string {
 const sep = value.includes('T') ? 'T' : ' ';
 const timePart = value.split(sep)[1] ?? '';
 return timePart.slice(0, 5);
}
