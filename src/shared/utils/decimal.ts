export function normalizeDecimalInput(value: string) {
 return value
  .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
  .replace(/\u066B/g, '.')
  .replace(/[\u066C,\s]/g, '')
  .replace(/[^0-9.\-]/g, '');
}

// For plain decimal fields that never grow a live thousands-grouping comma of their own
// (exchange rate, commission): unlike normalizeDecimalInput, a comma here is unambiguously
// the user's own decimal separator (e.g. "10,80"), so it's converted to a dot instead of
// being stripped, letting a comma-locale user type rates/percentages naturally.
export function normalizePlainDecimalInput(value: string) {
 return value
  .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
  .replace(/[\u066B,]/g, '.')
  .replace(/[\u066C\s]/g, '')
  .replace(/[^0-9.\-]/g, '');
}

// Like normalizeDecimalInput, but adds thousand separators to the integer part for live display.
// Use normalizeDecimalInput(value) before parsing to strip the commas back out.
export function formatAmountInput(value: string) {
 const normalized = normalizeDecimalInput(value); // digits, optional single '.', optional leading '-'
 if (!normalized) return '';
 const negative = normalized.startsWith('-');
 const unsigned = negative ? normalized.slice(1) : normalized;
 const dotIndex = unsigned.indexOf('.');
 const hasDot = dotIndex !== -1;
 let intPart = (hasDot ? unsigned.slice(0, dotIndex) : unsigned).replace(/^0+(?=\d)/, '');
 const decPart = hasDot ? unsigned.slice(dotIndex + 1).replace(/\./g, '') : '';
 if (intPart === '') intPart = hasDot ? '0' : '';
 const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
 return `${negative ? '-' : ''}${groupedInt}${hasDot ? `.${decPart}` : ''}`;
}
