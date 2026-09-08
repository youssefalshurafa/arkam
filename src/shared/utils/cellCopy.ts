/**
 * Click-to-copy for a table cell, shared by the Transactions table and the client ledger.
 *
 * A cell often renders more than the value it is "about": a client-name cell is the name plus a
 * small currency badge for the account, so copying the cell handed back "جعيدان dhs" when the
 * user wanted the name. The badge is marked with `data-copy-exclude` at the point it is rendered
 * and removed here, which is exact — the alternative, pattern-matching a currency off the end of
 * the string, cannot tell an account's currency from a client legitimately named "USD Trading".
 */
export const COPY_EXCLUDE_ATTR = 'data-copy-exclude';

/** Spread onto any element whose text should never be part of its cell's copied value. */
export const copyExcludeProps = { [COPY_EXCLUDE_ATTR]: 'true' } as const;

// Kept for cells that carry no marked-up exclusions, so their long-standing behaviour is
// unchanged: a trailing currency code or symbol is still trimmed off by pattern.
const TRAILING_CURRENCY = /\s+([A-Z]{2,5}|[$€£¥₹₩₪₺₽฿₫])$/;

/**
 * The copyable value of a cell whose rendered text is `cellText`, given the text of any fragments
 * marked for exclusion. Split out from the DOM lookup below so the awkward part is testable:
 * jsdom does not implement `innerText`, so a DOM-level test of this would prove nothing.
 *
 * Each fragment is removed at its LAST occurrence, because an excluded badge is rendered after the
 * value it annotates — so a client named "dhs shop" holding a dhs account keeps its name and loses
 * only the badge.
 */
export function copyTextFrom(cellText: string, excludedTexts: string[]): string {
 let text = cellText;
 let removedAny = false;
 for (const raw of excludedTexts) {
  const fragment = raw.trim();
  if (!fragment) continue;
  const at = text.lastIndexOf(fragment);
  if (at === -1) continue;
  text = text.slice(0, at) + text.slice(at + fragment.length);
  removedAny = true;
 }
 const cleaned = text.replace(/\s+/g, ' ').trim();
 if (removedAny) return cleaned;
 // Nothing was marked up to exclude: fall back to trimming a trailing currency by pattern, which
 // is how every cell behaved before badges were marked. Keep the raw text if that would leave
 // nothing, so a cell holding only a currency still copies something.
 return cleaned.replace(TRAILING_CURRENCY, '').trim() || cleaned;
}

/**
 * The text a click on `cell` should put on the clipboard, or '' if there is nothing to copy.
 * Reads `innerText` (not `textContent`) so the copied value matches what the user actually sees,
 * which requires the elements to be live in the document — hence no cloning.
 */
export function cellCopyText(cell: HTMLElement): string {
 const excluded = Array.from(cell.querySelectorAll<HTMLElement>(`[${COPY_EXCLUDE_ATTR}]`));
 return copyTextFrom(cell.innerText, excluded.map((element) => element.innerText));
}
