// Custom cursor for the row-highlight mode — a yellow marker/highlighter pen pointing
// bottom-left, with the hotspot at the nib tip (1, 19 in the 20×20 canvas).
export const HIGHLIGHT_PEN_CURSOR = [
 "url(\"data:image/svg+xml,",
 "%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3E",
 // Body of the marker (yellow, diagonal)
 "%3Cpath d='M2 19L2 14L13 3L16 6Z' fill='%23FDE68A' stroke='%2392400E' stroke-width='1.3' stroke-linejoin='round'/%3E",
 // Cap (amber, top-right)
 "%3Cpath d='M13 3L16 6L18 4L15 1Z' fill='%23F59E0B' stroke='%2392400E' stroke-width='1.3' stroke-linejoin='round'/%3E",
 // Nib/tip triangle at bottom-left
 "%3Cpath d='M2 14L2 19L7 19Z' fill='%23F59E0B' stroke='%2392400E' stroke-width='1.3' stroke-linejoin='round'/%3E",
 // Shine stripe on the body
 "%3Cpath d='M5 16L14 7' stroke='white' stroke-width='1.2' stroke-opacity='0.5' stroke-linecap='round'/%3E",
 "%3C/svg%3E",
 "\") 2 19, crosshair",
].join('');
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
