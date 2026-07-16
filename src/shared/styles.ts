// Shared panel surface classes used across every section. Extracted from the
// page component so feature components can reuse them without prop-drilling.
export const panelClassName = 'border border-border bg-surface p-5 shadow-sm';
export const mutedPanelClassName = 'border border-border bg-surface-2 p-4';
export const tableWrapClassName = 'mt-3 overflow-x-auto border border-border bg-surface';

// "Seamless" inline-edit controls: no visible box, just a dashed underline — used by
// click-to-edit popup fields (TransactionDetailsModal) and table row edit mode
// (TransactionsSection, LedgerSection) so editing a cell doesn't look like a form dropped
// into the table. Callers append their own font-size (text-xs/text-sm), width
// (min-w-*/w-*), and text color (most want text-fg, but e.g. the ledger's signed
// commission field overrides it conditionally) — deliberately no color baked in here so
// a caller's own color class never has to fight this one for the same CSS property.
// field-sizing-content keeps the input snug to its content since there's no border box
// to visually constrain it.
export const seamlessInputClassName = 'field-sizing-content border-0 border-b border-dashed border-accent bg-transparent font-medium outline-none';
export const seamlessSelectClassName = 'cursor-pointer appearance-none border-0 bg-transparent p-0 font-medium outline-none';
// Applied to a row/entry wrapper (<tr>) while it's in edit mode, so the row itself signals
// "editing" now that its individual fields no longer look like boxed form controls.
export const editingRowRingClassName = 'ring-2 ring-inset ring-accent';
