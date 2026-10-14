import { getStoredNumberGrouping } from '@/shared/lib/localStorage';

type Grouping = Record<string, number>;

// Splits a run of digits into thousands groups whose rightmost group holds `firstGroup` digits
// and every group left of it holds 3: firstGroup 4 turns 1600540 into 160,0540 and 12000000 into
// 1,200,0000. Works on any single-code-unit digit set (Latin or Arabic-Indic).
export function groupDigits(digits: string, firstGroup: number, separator: string): string {
 if (digits.length <= firstGroup) return digits;
 const groups = [digits.slice(-firstGroup)];
 let end = digits.length - firstGroup;
 while (end > 0) {
  groups.unshift(digits.slice(Math.max(0, end - 3), end));
  end -= 3;
 }
 return groups.join(separator);
}

export function firstGroupSizeFor(currencyCode: string | null | undefined, grouping: Grouping): number {
 return (currencyCode && grouping[currencyCode]) || 3;
}

const formatterCache = new Map<string, Intl.NumberFormat>();
function formatterFor(locale: string | undefined, options: Intl.NumberFormatOptions | undefined): Intl.NumberFormat {
 const key = `${locale ?? ''}|${JSON.stringify(options ?? {})}`;
 let formatter = formatterCache.get(key);
 if (!formatter) {
  formatter = new Intl.NumberFormat(locale, options);
  formatterCache.set(key, formatter);
 }
 return formatter;
}

function groupSeparatorFor(locale: string | undefined): string {
 return formatterFor(locale, undefined).formatToParts(1000000).find((part) => part.type === 'group')?.value ?? ',';
}

/**
 * PDF exports only: `value.toLocaleString(locale, options)`, but grouped the way the user chose for
 * `currencyCode` in the export dialog (defaults to the saved choices, see getStoredNumberGrouping).
 * With no currency, or a currency on the normal 3-digit grouping, the output is exactly
 * toLocaleString's. On-screen amounts deliberately keep plain toLocaleString.
 */
export function formatAmount(
 value: number,
 locale: string | undefined,
 currencyCode: string | null | undefined,
 options?: Intl.NumberFormatOptions,
 grouping: Grouping = getStoredNumberGrouping(),
): string {
 const firstGroup = firstGroupSizeFor(currencyCode, grouping);
 if (firstGroup === 3 || !Number.isFinite(value) || options?.useGrouping === false) return value.toLocaleString(locale, options);
 const separator = groupSeparatorFor(locale);
 let out = '';
 let integerDigits = '';
 for (const part of formatterFor(locale, options).formatToParts(value)) {
  if (part.type === 'integer') {
   integerDigits += part.value;
  } else if (part.type !== 'group') {
   if (integerDigits) out += groupDigits(integerDigits, firstGroup, separator);
   integerDigits = '';
   out += part.value;
  }
 }
 if (integerDigits) out += groupDigits(integerDigits, firstGroup, separator);
 return out;
}

