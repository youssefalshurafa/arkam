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
