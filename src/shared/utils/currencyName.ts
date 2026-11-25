// A currency's name in the given UI language ("US Dollar", "دولار أمريكي", "dollar des États-Unis"),
// from the browser's own currency data. Falls back to the stored name, then the code, for codes
// Intl doesn't know (e.g. USDT) or runtimes without Intl.DisplayNames.
export function localizedCurrencyName(currencyCode: string, fallbackName: string, language: string): string {
 try {
  if (typeof Intl.DisplayNames === 'function') {
   return new Intl.DisplayNames([language], { type: 'currency' }).of(currencyCode) || fallbackName || currencyCode;
  }
 } catch {
  // ignore and fall back to the stored name
 }
 return fallbackName || currencyCode;
}
