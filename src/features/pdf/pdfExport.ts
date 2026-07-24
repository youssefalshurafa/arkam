import { formatDateValue } from '@/shared/utils/date';
import { formatRateValue } from '@/shared/utils/format';
import { ledgerEntryKey } from '@/features/ledger/utils/ledgerEntries';
import type { Client, ClientAccountLedger, ClientLedgerEntry, LedgerColumnKey, PdfColVisibility, PdfSettings, Section, Transaction, TransactionColumnVisibility } from '@/shared/types';

/** Shared rendering context for the PDF/print HTML builders. */
export type PdfContext = {
 t: (key: string, params?: Record<string, string | number>) => string;
 numLocale: string;
 isRTL: boolean;
 language: string;
 pdfSettings: PdfSettings;
};

/** Standalone HTML document for the Archive PDF export. Ported verbatim. */
export function generateArchiveHtml(ctx: PdfContext, archivedRows: Transaction[], columns: TransactionColumnVisibility): string {
 const { t, numLocale, isRTL, language, pdfSettings } = ctx;
  const esc = (value: string) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

  // `archivedRows` is expected to already be filtered/sorted exactly like the on-screen archive
  // table (displayedTransactionRows: honours manual drag order, the sort-direction toggle, and
  // any active filters), so the export order/contents match what the user sees pixel-for-pixel.
  const archived = archivedRows;

  // Column set/order mirrors the on-screen archive table (TransactionsSection): visibility is
  // driven by the shared transaction table settings, in the same left-to-right order, with the
  // archive-only "more info" column always appended at the end.
  type ArchiveCol = { key: keyof TransactionColumnVisibility | 'archiveNote'; header: string; isNum?: boolean; cell: (tx: Transaction) => string };
  const allCols: ArchiveCol[] = [
   { key: 'created', header: t('date'), cell: (tx) => formatDateValue(tx.createdAt, pdfSettings.dateFormat) },
   { key: 'description', header: t('transaction_description'), cell: (tx) => esc(tx.description) },
   {
    key: 'accountFrom',
    header: t('transaction_account_from'),
    cell: (tx) =>
     tx.accountFromId
      ? `${esc(tx.clientFromName)} <span style="color:#64748b">${esc(tx.accountFromCurrencyCode)}</span>`
      : `<span class="muted">-</span>`,
   },
   {
    key: 'accountTo',
    header: t('transaction_account_to'),
    cell: (tx) =>
     tx.accountToId
      ? `${esc(tx.clientToName)} <span style="color:#64748b">${esc(tx.accountToCurrencyCode)}</span>`
      : `<span class="muted">-</span>`,
   },
   {
    key: 'amount',
    header: t('transaction_amount'),
    isNum: true,
    cell: (tx) =>
     tx.amount
      ? `${tx.amount.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals })}${pdfSettings.showCurrencySymbol ? ` ${esc(tx.currencySymbol || tx.currencyCode)}` : ''}`
      : '-',
   },
   {
    key: 'charges',
    header: t('charges'),
    isNum: true,
    cell: (tx) => {
     if (!tx.charges) return '-';
     const parts = [`${tx.charges.toLocaleString(numLocale)}${tx.chargesCurrencyCode ? ` ${tx.chargesCurrencyCode}` : ''}`];
     if (tx.chargesPayer) parts.push(tx.chargesPayer === 'from' ? tx.clientFromName : tx.chargesPayer === 'to' ? tx.clientToName : '');
     if (tx.chargesDescription) parts.push(tx.chargesDescription);
     return esc(parts.filter(Boolean).join(' — '));
    },
   },
   {
    key: 'commission',
    header: t('commission'),
    isNum: true,
    cell: (tx) => {
     const parts: string[] = [];
     if (tx.commissionFrom) parts.push(`${tx.clientFromName}: ${tx.commissionFrom.toFixed(2)}%`);
     if (tx.commissionTo) parts.push(`${tx.clientToName}: ${tx.commissionTo.toFixed(2)}%`);
     return esc(parts.length ? parts.join(' — ') : '-');
    },
   },
   { key: 'archiveNote', header: t('archive_more_info'), cell: (tx) => esc(tx.archiveNote) },
  ];
  // archiveNote is the archive-only column and is always shown; the rest follow table visibility.
  const visibleCols = allCols.filter((col) => col.key === 'archiveNote' || columns[col.key]);

  const headerCells = visibleCols.map((col) => `<th${col.isNum ? ' class="num"' : ''}>${esc(col.header)}</th>`).join('');

  const rows = archived
   .map((tx) => `<tr>${visibleCols.map((col) => `<td${col.isNum ? ' class="num"' : ''}>${col.cell(tx)}</td>`).join('')}</tr>`)
   .join('');

  const totals = new Map<string, { code: string; symbol: string; total: number }>();
  for (const tx of archived) {
   if (!tx.amount) continue;
   const key = tx.currencyCode || String(tx.currencyId);
   const existing = totals.get(key);
   if (existing) existing.total += tx.amount;
   else totals.set(key, { code: tx.currencyCode, symbol: tx.currencySymbol, total: tx.amount });
  }
  const totalsHtml = [...totals.values()]
   .map(
    (total) =>
     `<span class="total-item">${total.total.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals })}${pdfSettings.showCurrencySymbol ? ` <span style="color:#64748b">${esc(total.symbol || total.code)}</span>` : ''}</span>`,
   )
   .join('');

  const dir = isRTL ? 'rtl' : 'ltr';
  const logoUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/logo/arkam-logo.png`;
  const exportDate = new Date().toLocaleDateString(language);
  const companyNameHtml = pdfSettings.showCompanyName && pdfSettings.companyName.trim() ? `<p class="company-name">${esc(pdfSettings.companyName)}</p>` : '';

  return `<!DOCTYPE html>
<html lang="${language}" dir="${dir}">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap">
<style>
 /* Without this, Chromium's print/PDF pipeline silently drops all background colors
    (row striping, highlighted cells, meta cards) unless the user manually checks
    "Background graphics" in the print dialog — this forces them to always render. */
 * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
 body { font-family: ${pdfSettings.fontFamily}; font-size: ${pdfSettings.fontSize}px; color: #1e293b; padding: 32px; }
 .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e293b; padding-bottom: 12px; margin-bottom: 20px; }
 .header-left { display: flex; align-items: center; gap: 14px; }
 .brand-logo { height: 54px; width: auto; }
 .header-left h1 { font-size: calc(${pdfSettings.fontSize}px + 8px); font-weight: bold; }
 .header-left .company-name { font-size: calc(${pdfSettings.fontSize}px + 6px); font-weight: bold; color: #1e293b; margin-bottom: 2px; }
 .header-left p { font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; margin-top: 2px; }
 .header-right { text-align: ${isRTL ? 'left' : 'right'}; font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; }
 table { width: 100%; border-collapse: collapse; margin-top: 8px; }
 thead tr { background: #e2e8f0; }
 th { padding: 8px 10px; font-size: ${pdfSettings.headFontSize}px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #1e293b; text-align: center; border-bottom: 2px solid #94a3b8; }
 td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; text-align: center; }
 tbody tr:nth-child(odd) { background: #f1f5f9; }
 tbody tr:nth-child(even) { background: #ffffff; }
 td.num { font-variant-numeric: tabular-nums; }
 .muted { color: #94a3b8; font-style: italic; }
 .totals { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; margin-top: 16px; padding: 12px 16px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; }
 .totals .totals-label { font-size: calc(${pdfSettings.fontSize}px - 2px); text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; }
 .totals .total-item { font-weight: 700; font-variant-numeric: tabular-nums; }
 .footer { margin-top: 24px; font-size: calc(${pdfSettings.fontSize}px - 2px); color: #94a3b8; text-align: center; }
 .empty { margin-top: 24px; text-align: center; color: #94a3b8; }
</style>
</head>
<body>
<div class="header">
 <div class="header-left">
  <img class="brand-logo" src="${logoUrl}" alt="Arkam" />
  <div>
   ${companyNameHtml}
   <p>${esc(t('archive_title'))}</p>
  </div>
 </div>
 ${pdfSettings.showGeneratedOn ? `<div class="header-right"><div>${t('export_generated_on')}: ${exportDate}</div></div>` : ''}
</div>
${
 archived.length > 0
  ? `<table>
 <thead>
  <tr>${headerCells}</tr>
 </thead>
 <tbody>
  ${rows}
 </tbody>
</table>
${totalsHtml ? `<div class="totals"><span class="totals-label">${esc(t('archive_totals'))}</span>${totalsHtml}</div>` : ''}`
  : `<div class="empty">${esc(t('archive_empty'))}</div>`
}
${pdfSettings.showFooter ? `<div class="footer">www.arkam.app &middot; ${t('export_generated_on')} ${exportDate}</div>` : ''}
</body>
</html>`;
}

/** Standalone HTML document for the Transactions/Archive table PDF export. Ported verbatim. */
export function generateTransactionsExportHtml(
 ctx: PdfContext,
 params: { section: Section; transactionExportFrom: string; transactionExportTo: string; headers: string[]; rows: string[][] },
): string {
 const { t, isRTL, language, pdfSettings } = ctx;
 const { section, transactionExportFrom, transactionExportTo, headers, rows } = params;
  const esc = (value: string) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);
  const dir = isRTL ? 'rtl' : 'ltr';
  const logoUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/logo/arkam-logo.png`;
  const exportDate = new Date().toLocaleDateString(language);
  const companyNameHtml = pdfSettings.showCompanyName && pdfSettings.companyName.trim() ? `<p class="company-name">${esc(pdfSettings.companyName)}</p>` : '';
  const rangeLabel = [transactionExportFrom, transactionExportTo].filter(Boolean).join(' → ');
  const headerCells = headers.map((header) => `<th>${esc(header)}</th>`).join('');
  const bodyRows = rows.map((cells) => `<tr>${cells.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('');

  return `<!DOCTYPE html>
<html lang="${language}" dir="${dir}">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap">
<style>
 /* Without this, Chromium's print/PDF pipeline silently drops all background colors
    (row striping, highlighted cells, meta cards) unless the user manually checks
    "Background graphics" in the print dialog — this forces them to always render. */
 * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
 body { font-family: ${pdfSettings.fontFamily}; font-size: ${pdfSettings.fontSize}px; color: #1e293b; padding: 32px; }
 .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e293b; padding-bottom: 12px; margin-bottom: 20px; }
 .header-left { display: flex; align-items: center; gap: 14px; }
 .brand-logo { height: 54px; width: auto; }
 .header-left h1 { font-size: calc(${pdfSettings.fontSize}px + 8px); font-weight: bold; }
 .header-left .company-name { font-size: calc(${pdfSettings.fontSize}px + 6px); font-weight: bold; color: #1e293b; margin-bottom: 2px; }
 .header-left p { font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; margin-top: 2px; }
 .header-right { text-align: ${isRTL ? 'left' : 'right'}; font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; }
 table { width: 100%; border-collapse: collapse; margin-top: 8px; }
 thead tr { background: #e2e8f0; }
 th { padding: 8px 10px; font-size: ${pdfSettings.headFontSize}px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #1e293b; text-align: center; border-bottom: 2px solid #94a3b8; }
 td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; text-align: center; }
 tbody tr:nth-child(odd) { background: #f1f5f9; }
 tbody tr:nth-child(even) { background: #ffffff; }
 .footer { margin-top: 24px; font-size: calc(${pdfSettings.fontSize}px - 2px); color: #94a3b8; text-align: center; }
 .empty { margin-top: 24px; text-align: center; color: #94a3b8; }
</style>
</head>
<body>
<div class="header">
 <div class="header-left">
  <img class="brand-logo" src="${logoUrl}" alt="Arkam" />
  <div>
   ${companyNameHtml}
   <p>${esc(section === 'archive' ? t('archive_title') : t('transactions_title'))}${rangeLabel ? ` — ${esc(rangeLabel)}` : ''}</p>
  </div>
 </div>
 ${pdfSettings.showGeneratedOn ? `<div class="header-right"><div>${t('export_generated_on')}: ${exportDate}</div></div>` : ''}
</div>
${
 rows.length > 0
  ? `<table>
 <thead>
  <tr>${headerCells}</tr>
 </thead>
 <tbody>
  ${bodyRows}
 </tbody>
</table>`
  : `<div class="empty">${esc(t('transactions_export_empty'))}</div>`
}
${pdfSettings.showFooter ? `<div class="footer">www.arkam.app &middot; ${t('export_generated_on')} ${exportDate}</div>` : ''}
</body>
</html>`;
}

/** Standalone HTML document for a client-account ledger PDF export. Ported verbatim. */
export function generateLedgerHtml(
 ctx: PdfContext,
 params: {
  ledger: ClientAccountLedger;
  fromDate: string;
  toDate: string;
  colVisibility: PdfColVisibility;
  fromEntryKey?: string | null;
  toEntryKey?: string | null;
  selectedClientForLedger: Client | null;
  transactions: Transaction[];
  ledgerColumnOrder: LedgerColumnKey[];
 },
): string {
 const { t, numLocale, isRTL, language, pdfSettings } = ctx;
 const { ledger, fromDate, toDate, colVisibility, fromEntryKey, toEntryKey, selectedClientForLedger, transactions, ledgerColumnOrder } = params;
  const esc = (value: string) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);
  // Candidates are the entries within the chosen date range; the start/end transaction
  // pickers then narrow the exact boundaries (handy when a day has many transactions).
  const candidates = ledger.entries.filter((e) => {
   const d = e.createdAt.slice(0, 10);
   return d >= fromDate && d <= toDate;
  });
  const startIdx = fromEntryKey
   ? Math.max(
      0,
      candidates.findIndex((e) => ledgerEntryKey(e) === fromEntryKey),
     )
   : 0;
  const endIdxRaw = toEntryKey ? candidates.findIndex((e) => ledgerEntryKey(e) === toEntryKey) : -1;
  const endIdx = endIdxRaw === -1 ? candidates.length - 1 : endIdxRaw;
  const filteredEntries = startIdx <= endIdx ? candidates.slice(startIdx, endIdx + 1) : [];

  // Pre-balance includes everything chronologically before the first selected entry
  // (entries before the date range, plus same-range entries skipped by the start picker).
  const firstSelected = filteredEntries[0];
  const cutoffIndex = firstSelected ? ledger.entries.findIndex((e) => ledgerEntryKey(e) === ledgerEntryKey(firstSelected)) : ledger.entries.length;
  const preBalance = ledger.startingBalance + ledger.entries.slice(0, cutoffIndex < 0 ? 0 : cutoffIndex).reduce((sum, e) => sum + e.netChange, 0);

  // Build column definitions respecting user visibility; running_balance is always included
  type ColDef = { key: LedgerColumnKey; header: string; isNum?: boolean; cell: (e: ClientLedgerEntry, runBal: number) => string };
  const allCols: ColDef[] = [
   {
    key: 'created',
    header: t('date'),
    cell: (e) => {
     const iso = e.createdAt.slice(0, 10); // yyyy-mm-dd
     const [y, m, d] = iso.split('-');
     switch (pdfSettings.dateFormat) {
      case 'day-month':
       return `${d}/${m}`;
      case 'month-year':
       return `${m}/${y}`;
      case 'day-month-year-2':
       return `${d}/${m}/${y.slice(2)}`;
      case 'month-day':
       return `${m}/${d}`;
      default:
       return iso; // full yyyy-mm-dd
     }
    },
   },
   { key: 'counterparty', header: t('counterparty'), cell: (e) => e.counterpartyName },
   {
    key: 'direction',
    header: t('direction'),
    cell: (e) =>
     e.isAdjustment ? t(e.direction === 'outgoing' ? 'adjustment_direction_credit' : 'adjustment_direction_debit') : t(e.direction === 'outgoing' ? 'outgoing' : 'incoming'),
   },
   {
    key: 'type',
    header: t('transaction_type'),
    cell: (e) => (e.isAdjustment ? t('adjustment_label') : t(e.type === 'transfer' ? 'transaction_type_transfer' : 'transaction_type_exchange')),
   },
   {
    key: 'amount',
    header: t('amount'),
    isNum: true,
    cell: (e) => {
     const base = `<span class="${e.direction === 'outgoing' ? 'pos' : 'neg'}">${e.amount.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals })}${pdfSettings.showCurrencySymbol ? ` ${e.currencySymbol || e.currencyCode}` : ''}</span>`;
     if (e.isAdjustment || e.charges <= 0 || !e.chargeAffectsThisAccount) return base;
     const val = e.charges.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals });
     const desc = e.chargesDescription ? `<span class="charges-desc">${esc(e.chargesDescription)}</span>` : '';
     return `${base}<div class="charges-line"><span class="neg">−${val}</span>${desc}</div>`;
    },
   },
   {
    key: 'exchangeRate',
    header: t('exchange_rate'),
    isNum: true,
    cell: (e) => {
     if (e.pendingRate) {
      return '-';
     }
     // Show the actual rate (including 1), matching the on-screen ledger — which renders a
     // reversed (divided) rate as 1/rate. Applies to both transactions and adjustments; only a
     // genuinely unset cross-currency rate (pendingRate, handled above) renders as a dash.
     return formatRateValue(e.exchangeRateReversed ? 1 / e.exchangeRate : e.exchangeRate);
    },
   },
   { key: 'commission', header: t('commission'), isNum: true, cell: (e) => (e.isAdjustment || !e.commission ? '-' : formatRateValue(e.commission)) },
   {
    key: 'netChange',
    header: t('net_change'),
    isNum: true,
    cell: (e) =>
     e.pendingRate ? '-' : `<span class="${e.netChange >= 0 ? 'pos' : 'neg'}">${e.netChange.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals })}</span>`,
   },
   {
    key: 'runningBalance',
    header: t('running_balance'),
    isNum: true,
    cell: (_e, runBal) => `<span class="${runBal >= 0 ? 'pos' : 'neg'}">${runBal.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals })}</span>`,
   },
   { key: 'currency', header: t('currency'), cell: (e) => e.currencyCode },
   { key: 'description', header: t('transaction_description'), cell: (e) => e.description ?? '' },
  ];
  const visibleCols = ledgerColumnOrder
   .map((key) => allCols.find((col) => col.key === key))
   .filter((col): col is ColDef => Boolean(col))
   .filter((col) => col.key === 'runningBalance' || colVisibility[col.key]);
  // Ensure runningBalance is always present (append if somehow missing from order)
  if (!visibleCols.some((col) => col.key === 'runningBalance')) {
   const rbCol = allCols.find((col) => col.key === 'runningBalance');
   if (rbCol) visibleCols.push(rbCol);
  }
  const colCount = visibleCols.length;

  let runningBal = preBalance;
  const rows = filteredEntries
   .map((e) => {
    runningBal += e.netChange;
    const cells = visibleCols
     .map((col) => {
      const classes = [col.isNum ? 'num' : '', col.key === 'netChange' && pdfSettings.highlightNetChange ? 'hl' : ''].filter(Boolean).join(' ');
      return `<td${classes ? ` class="${classes}"` : ''}>${col.cell(e, runningBal)}</td>`;
     })
     .join('');
    return `<tr>${cells}</tr>`;
   })
   .join('');

  const headerCells = visibleCols.map((col) => `<th${col.isNum ? ' class="num"' : ''}>${col.header}</th>`).join('');

  const dir = isRTL ? 'rtl' : 'ltr';
  const logoUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/logo/arkam-logo.png`;
  const clientName = selectedClientForLedger?.name ?? '';
  const exportDate = new Date().toLocaleDateString(language);
  const companyNameHtml = pdfSettings.showCompanyName && pdfSettings.companyName.trim() ? `<p class="company-name">${esc(pdfSettings.companyName)}</p>` : '';

  const metaCards = [
   pdfSettings.showMetaClient ? `<div class="meta-card"><div class="label">${t('client')}</div><div class="value">${clientName}</div></div>` : '',
   pdfSettings.showMetaCurrency
    ? `<div class="meta-card"><div class="label">${t('currency')}</div><div class="value">${ledger.currencyName} (${ledger.currencySymbol || ledger.currencyCode})</div></div>`
    : '',
   pdfSettings.showMetaPeriod
    ? `<div class="meta-card"><div class="label">${t('export_period')}</div><div class="value" style="font-size:12px">${fromDate} &rarr; ${toDate}</div></div>`
    : '',
  ].filter(Boolean);
  const metaColCount = metaCards.length;

  // Sticky note: a per-ledger free-text note, shown only when the user opted it into the PDF.
  // Newlines are preserved (white-space: pre-wrap) so multi-line notes keep their shape.
  const noteHtml =
   ledger.noteShowInPdf && ledger.note.trim()
    ? `<div class="sticky-note"><div class="note-label">${esc(t('ledger_note_title'))}</div><div class="note-body">${esc(ledger.note)}</div></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="${language}" dir="${dir}">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap">
<style>
 /* Without this, Chromium's print/PDF pipeline silently drops all background colors
    (row striping, highlighted cells, meta cards) unless the user manually checks
    "Background graphics" in the print dialog — this forces them to always render. */
 * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
 body { font-family: ${pdfSettings.fontFamily}; font-size: ${pdfSettings.fontSize}px; color: #1e293b; padding: 32px; }
 .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e293b; padding-bottom: 12px; margin-bottom: 20px; }
 .header-left { display: flex; align-items: center; gap: 14px; }
 .brand-logo { height: 54px; width: auto; }
 .header-left h1 { font-size: calc(${pdfSettings.fontSize}px + 8px); font-weight: bold; }
 .header-left .company-name { font-size: calc(${pdfSettings.fontSize}px + 6px); font-weight: bold; color: #1e293b; margin-bottom: 2px; }
 .header-left p { font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; margin-top: 2px; }
 .header-left .brand-url { font-size: calc(${pdfSettings.fontSize}px - 3px); color: #94a3b8; margin-top: 1px; }
 .header-right { text-align: ${isRTL ? 'left' : 'right'}; font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; }
 .meta { display: grid; grid-template-columns: repeat(${metaColCount || 1}, 1fr); gap: 12px; margin-bottom: 20px; }
 .meta-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; background: #f8fafc; }
 .meta-card .label { font-size: calc(${pdfSettings.fontSize}px - 2px); text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
 .meta-card .value { font-size: calc(${pdfSettings.fontSize}px + 2px); font-weight: bold; margin-top: 4px; }
 .pos { color: #059669; }
 .neg { color: #dc2626; }
 .pre-balance { display: flex; justify-content: flex-start; align-items: center; gap: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; border-bottom-left-radius: 0; border-bottom-right-radius: 0; border-bottom: none; }
 .pre-balance .pb-label { font-size: calc(${pdfSettings.fontSize}px - 1px); text-transform: uppercase; letter-spacing: 0.05em; color: #475569; font-weight: 600; }
 .pre-balance .pb-value { font-size: calc(${pdfSettings.fontSize}px + 2px); font-weight: bold; font-variant-numeric: tabular-nums; }
 table { width: 100%; border-collapse: collapse; margin-top: 8px; }
 thead tr { background: #e2e8f0; }
 th { padding: 8px 10px; font-size: ${pdfSettings.headFontSize}px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #1e293b; text-align: center; border-bottom: 2px solid #94a3b8; }
 td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; text-align: center; }
 tbody tr:nth-child(odd) { background: #f1f5f9; }
 tbody tr:nth-child(even) { background: #ffffff; }
 td.num { font-variant-numeric: tabular-nums; }
 th.num { }
 td.hl { background: #eff6ff; }
 tr:last-child td { border-bottom: none; }
 .final-balance { display: flex; justify-content: center; align-items: center; gap: 16px; margin-top: 16px; padding: 12px 20px; border: 2px solid #1e293b; border-radius: 6px; background: #f8fafc; }
 .final-balance .fb-label { font-size: calc(${pdfSettings.fontSize}px + 1px); font-weight: 700; color: #1e293b; }
 .final-balance .fb-value { font-size: calc(${pdfSettings.fontSize}px + 2px); font-weight: 700; font-variant-numeric: tabular-nums; }
 .footer { margin-top: 24px; font-size: calc(${pdfSettings.fontSize}px - 2px); color: #94a3b8; text-align: center; }
 .charges-line { display: flex; align-items: center; justify-content: center; gap: 4px; font-size: calc(${pdfSettings.fontSize}px - 1px); font-weight: 600; margin-top: 2px; }
 .charges-desc { font-weight: 400; font-style: italic; color: #94a3b8; }
 .sticky-note { background: #fef9c3; border: 1px solid #fde047; border-${isRTL ? 'right' : 'left'}: 4px solid #eab308; border-radius: 6px; padding: 10px 14px; margin-bottom: 20px; }
 .sticky-note .note-label { font-size: calc(${pdfSettings.fontSize}px - 2px); text-transform: uppercase; letter-spacing: 0.05em; color: #a16207; font-weight: 700; margin-bottom: 4px; }
 .sticky-note .note-body { font-size: ${pdfSettings.fontSize}px; color: #422006; white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<div class="header">
 <div class="header-left">
  <img class="brand-logo" src="${logoUrl}" alt="Arkam" />
  <div>
   ${companyNameHtml}
   <p>${t('client_ledger_statement')}</p>
   <p class="brand-url">www.arkam.app</p>
  </div>
 </div>
 ${pdfSettings.showGeneratedOn ? `<div class="header-right"><div>${t('export_generated_on')}: ${exportDate}</div></div>` : ''}
</div>
${metaColCount > 0 ? `<div class="meta">${metaCards.join('')}</div>` : ''}
${noteHtml}
${pdfSettings.showPreBalance ? `<div class="pre-balance"><span class="pb-label">${t('export_pre_balance')}</span><span class="pb-value ${preBalance >= 0 ? 'pos' : 'neg'}">${preBalance.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals })}${pdfSettings.showCurrencySymbol ? ` ${ledger.currencySymbol || ledger.currencyCode}` : ''}</span></div>` : ''}
<table${pdfSettings.showPreBalance ? ' style="margin-top:0;border-top:1px solid #e2e8f0"' : ''}>
 <thead>
  <tr>${headerCells}</tr>
 </thead>
 <tbody>
  ${rows}
 </tbody>
</table>
<div class="final-balance">
 <span class="fb-value ${runningBal >= 0 ? 'pos' : 'neg'}">${Math.abs(runningBal).toLocaleString(numLocale, { minimumFractionDigits: pdfSettings.decimals, maximumFractionDigits: pdfSettings.decimals })}${pdfSettings.showCurrencySymbol ? ` ${ledger.currencySymbol || ledger.currencyCode}` : ''}</span>
 <span class="fb-label">${runningBal === 0 ? t('pdf_balance_zero') : runningBal < 0 ? t('pdf_balance_ours') : t('pdf_balance_theirs')}</span>
</div>
${pdfSettings.showFooter ? `<div class="footer">www.arkam.app &middot; ${t('export_generated_on')} ${exportDate}</div>` : ''}
</body>
</html>`;
}

/** One overview balance card, flattened to plain data for the PDF/print builder. */
export type OverviewPdfCard = {
 orgName: string;
 currencyCode: string;
 currencySymbol: string;
 isMain: boolean;
 total: number;
 // The card's own FX rate to the main currency, or null when unset / not applicable.
 rate: number | null;
 // When true (and a rate is set), render the card's "flipped" face: client balances and total
 // converted to the main currency, matching the converted view shown on screen.
 flipped?: boolean;
 clients: { clientName: string; balance: number }[];
};

/** Standalone HTML document for printing selected overview balance cards. */
export function generateOverviewCardsHtml(ctx: PdfContext, params: { cards: OverviewPdfCard[]; mainCode: string; mainSymbol: string }): string {
 const { t, numLocale, isRTL, language, pdfSettings } = ctx;
 const { cards, mainCode, mainSymbol } = params;
 const esc = (value: string) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);
 // Overview cards show whole-number balances on screen, so match that here.
 const fmt = (n: number) => n.toLocaleString(numLocale, { maximumFractionDigits: 0 });
 const sign = (n: number) => (n >= 0 ? 'pos' : 'neg');

 const dir = isRTL ? 'rtl' : 'ltr';
 const logoUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/logo/arkam-logo.png`;
 const exportDate = new Date().toLocaleDateString(language);
 const companyNameHtml = pdfSettings.showCompanyName && pdfSettings.companyName.trim() ? `<p class="company-name">${esc(pdfSettings.companyName)}</p>` : '';

 const cardHtml = cards
  .map((card) => {
   const symbol = card.currencySymbol || card.currencyCode;
   // A flipped card shows everything already converted to the main currency; the footer then
   // notes the rate and the original-currency total for provenance. A non-flipped card shows
   // original values with the converted total appended as a footer (when a rate is set).
   const flip = !card.isMain && card.flipped === true && card.rate != null;
   const rate = card.rate;
   const headSymbol = flip ? mainSymbol : symbol;
   const clientRows = card.clients
    .map((c) => {
     const bal = flip ? c.balance * (rate as number) : c.balance;
     return `<div class="row"><span class="name">${esc(c.clientName)}</span><span class="bal ${sign(bal)}">${fmt(bal)}</span></div>`;
    })
    .join('');
   const totalValue = flip ? card.total * (rate as number) : card.total;
   const totalSymbol = flip ? mainSymbol : symbol;
   let convertedHtml = '';
   if (flip) {
    convertedHtml = `<div class="converted"><span class="rate">1 ${esc(card.currencyCode)} = ${rate} ${esc(mainCode)}</span><span class="conv-total ${sign(card.total)}">${fmt(card.total)} ${esc(symbol)}</span></div>`;
   } else {
    const converted = !card.isMain && rate != null ? card.total * rate : null;
    if (converted != null) {
     convertedHtml = `<div class="converted"><span class="rate">1 ${esc(card.currencyCode)} = ${rate} ${esc(mainCode)}</span><span class="conv-total ${sign(converted)}">${fmt(converted)} ${esc(mainSymbol)}</span></div>`;
    }
   }
   return `<div class="card">
 <div class="card-head">
  <span class="org">${esc(card.orgName)}</span>
  <span class="cur">${esc(headSymbol)}</span>
 </div>
 <div class="card-body">${clientRows || `<div class="row muted">${esc(t('overview_no_balances'))}</div>`}</div>
 <div class="card-total">
  <span class="ct-label">${esc(t('overview_card_total'))}</span>
  <span class="ct-value ${sign(totalValue)}">${fmt(totalValue)} ${esc(totalSymbol)}</span>
 </div>
 ${convertedHtml}
</div>`;
  })
  .join('');

 return `<!DOCTYPE html>
<html lang="${language}" dir="${dir}">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap">
<style>
 /* Without this, Chromium's print/PDF pipeline silently drops all background colors
    (row striping, highlighted cells, meta cards) unless the user manually checks
    "Background graphics" in the print dialog — this forces them to always render. */
 * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
 body { font-family: ${pdfSettings.fontFamily}; font-size: ${pdfSettings.fontSize}px; color: #1e293b; padding: 32px; }
 .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e293b; padding-bottom: 12px; margin-bottom: 20px; }
 .header-left { display: flex; align-items: center; gap: 14px; }
 .brand-logo { height: 54px; width: auto; }
 .header-left .company-name { font-size: calc(${pdfSettings.fontSize}px + 6px); font-weight: bold; color: #1e293b; margin-bottom: 2px; }
 .header-left p { font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; }
 .header-right { text-align: ${isRTL ? 'left' : 'right'}; font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; }
 .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
 .card { border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; break-inside: avoid; }
 .card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; padding: 8px 12px; }
 .card-head .org { font-size: ${pdfSettings.headFontSize}px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; }
 .card-head .cur { font-size: ${pdfSettings.headFontSize}px; font-weight: 700; }
 .card-body { padding: 4px 12px; }
 .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 5px 0; border-bottom: 1px solid #f1f5f9; }
 .row:last-child { border-bottom: none; }
 .row .name { color: #334155; }
 .row .bal { font-variant-numeric: tabular-nums; font-weight: 500; }
 .row.muted { color: #94a3b8; font-style: italic; justify-content: center; }
 .card-total { display: flex; justify-content: space-between; align-items: center; gap: 12px; background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 8px 12px; }
 .card-total .ct-label { font-size: calc(${pdfSettings.fontSize}px - 2px); text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; }
 .card-total .ct-value { font-weight: 700; font-variant-numeric: tabular-nums; }
 .converted { display: flex; justify-content: space-between; align-items: center; gap: 12px; background: #eff6ff; border-top: 1px solid #bfdbfe; padding: 8px 12px; }
 .converted .rate { font-size: calc(${pdfSettings.fontSize}px - 2px); color: #2563eb; }
 .converted .conv-total { font-weight: 700; font-variant-numeric: tabular-nums; }
 .pos { color: #059669; }
 .neg { color: #dc2626; }
 .footer { margin-top: 24px; font-size: calc(${pdfSettings.fontSize}px - 2px); color: #94a3b8; text-align: center; }
 .empty { margin-top: 24px; text-align: center; color: #94a3b8; }
</style>
</head>
<body>
<div class="header">
 <div class="header-left">
  <img class="brand-logo" src="${logoUrl}" alt="Arkam" />
  <div>${companyNameHtml}<p>${esc(t('overview_balances_title'))}</p></div>
 </div>
 ${pdfSettings.showGeneratedOn ? `<div class="header-right"><div>${t('export_generated_on')}: ${exportDate}</div></div>` : ''}
</div>
${cards.length > 0 ? `<div class="grid">${cardHtml}</div>` : `<div class="empty">${esc(t('overview_no_balances'))}</div>`}
${pdfSettings.showFooter ? `<div class="footer">www.arkam.app &middot; ${t('export_generated_on')} ${exportDate}</div>` : ''}
</body>
</html>`;
}
