// Darkens a '#rrggbb' hex color by the given fraction (0-1), for deriving a cap/nib/outline
// shade from the user's chosen highlight color. Falls back to the input unchanged for any
// non-6-digit-hex value (defensive — every caller today passes a validated hex from the color
// picker, but a cursor is cheap to leave un-colorized rather than throw over a bad value).
function darkenHex(hex: string, amount: number): string {
 const clean = hex.replace('#', '');
 if (!/^[0-9a-fA-F]{6}$/.test(clean)) return hex;
 const channel = (start: number) => Math.round(parseInt(clean.slice(start, start + 2), 16) * (1 - amount))
  .toString(16)
  .padStart(2, '0');
 return `#${channel(0)}${channel(2)}${channel(4)}`;
}

// Custom cursor for the row-highlight mode — a marker/highlighter pen pointing bottom-left,
// with the hotspot at the nib tip (1, 19 in the 20×20 canvas). Colored to match whichever
// highlight color is currently selected, so the cursor previews the color a click will apply.
export function highlightPenCursor(color: string): string {
 const enc = (hex: string) => `%23${hex.replace('#', '')}`;
 const body = enc(color);
 const accent = enc(darkenHex(color, 0.25));
 const outline = enc(darkenHex(color, 0.55));
 return [
  "url(\"data:image/svg+xml,",
  "%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3E",
  // Body of the marker
  `%3Cpath d='M2 19L2 14L13 3L16 6Z' fill='${body}' stroke='${outline}' stroke-width='1.3' stroke-linejoin='round'/%3E`,
  // Cap (top-right)
  `%3Cpath d='M13 3L16 6L18 4L15 1Z' fill='${accent}' stroke='${outline}' stroke-width='1.3' stroke-linejoin='round'/%3E`,
  // Nib/tip triangle at bottom-left
  `%3Cpath d='M2 14L2 19L7 19Z' fill='${accent}' stroke='${outline}' stroke-width='1.3' stroke-linejoin='round'/%3E`,
  // Shine stripe on the body
  "%3Cpath d='M5 16L14 7' stroke='white' stroke-width='1.2' stroke-opacity='0.5' stroke-linecap='round'/%3E",
  "%3C/svg%3E",
  "\") 2 19, crosshair",
 ].join('');
}
// Width (in ch) for an auto-sizing ledger edit-mode text input: small when empty,
// growing with the visible text so long values (big numbers, long names) stay readable.
export function ledgerFieldWidth(text: string, floor: number, pad = 2) {
 return `${Math.max(floor, [...text].length + pad)}ch`;
}

// Like ledgerFieldWidth but for <select>: adds a fixed allowance for the dropdown
// arrow (a pixel-sized widget the ch-based text width can't account for).
export function ledgerSelectWidth(text: string, floor: number, pad = 2) {
 return `calc(${Math.max(floor, [...text].length + pad)}ch + 1.5rem)`;
}

// Wraps a left-to-right expression in Unicode LTR-isolate marks (U+2066 … U+2069) so it
// renders in the correct order inside an RTL (Arabic) layout instead of being visually
// reordered — e.g. an exchange-rate relation like "1 USD = 3.60 AED" would otherwise show
// as "USD = 3.60 AED 1". The isolate is self-contained, so it doesn't disturb any
// surrounding text (a label prefix, etc.).
export function ltrIsolate(text: string): string {
 return `⁦${text}⁩`;
}

// Formats an exchange-rate number with at least 2 decimals (up to 6), no trailing noise.
export function formatRateValue(value: number): string {
 if (!Number.isFinite(value)) {
  return '1.00';
 }
 const trimmed = parseFloat(value.toFixed(6));
 // Always show at least 2 decimal places
 const str = trimmed.toString();
 const dotIdx = str.indexOf('.');
 if (dotIdx === -1) return str + '.00';
 const decimals = str.length - dotIdx - 1;
 if (decimals < 2) return str + '0'.repeat(2 - decimals);
 return str;
}
