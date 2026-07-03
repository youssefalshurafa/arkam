import { formatDateValue } from '@/shared/utils/date';
import { formatRateValue } from '@/shared/utils/format';
import { chargeShowsInLedger } from '@/shared/utils/commission';
import { ledgerEntryKey } from '@/features/ledger/utils/ledgerEntries';
import type { Client, ClientAccountLedger, ClientLedgerEntry, LedgerColumnKey, PdfColVisibility, PdfSettings, Section, Transaction } from '@/shared/types';

/** Shared rendering context for the PDF/print HTML builders. */
export type PdfContext = {
 t: (key: string, params?: Record<string, string | number>) => string;
 numLocale: string;
 isRTL: boolean;
 language: string;
 pdfSettings: PdfSettings;
};

/** Standalone HTML document for the Archive PDF export. Ported verbatim. */
export function generateArchiveHtml(ctx: PdfContext, transactions: Transaction[]): string {
 const { t, numLocale, isRTL, language, pdfSettings } = ctx;
  const esc = (value: string) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

  const archived = transactions
   .filter((tx) => tx.isArchived || !tx.accountFromId || !tx.accountToId)
   .slice()
   .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const headers = [t('date'), t('transaction_account_from'), t('transaction_account_to'), t('amount'), t('archive_more_info'), t('transaction_description')];
  const headerCells = headers.map((header, index) => `<th${index === 3 ? ' class="num"' : ''}>${esc(header)}</th>`).join('');

  const rows = archived
   .map((tx) => {
    const from = tx.accountFromId
     ? `${esc(tx.clientFromName)} <span style="color:#64748b">${esc(tx.accountFromCurrencyCode)}</span>`
     : `<span class="muted">${esc(t('archive_no_sender'))}</span>`;
    const to = tx.accountToId
     ? `${esc(tx.clientToName)} <span style="color:#64748b">${esc(tx.accountToCurrencyCode)}</span>`
     : `<span class="muted">${esc(t('archive_no_receiver'))}</span>`;
    const amount = tx.amount
     ? `${tx.amount.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals })}${pdfSettings.showCurrencySymbol ? ` ${esc(tx.currencySymbol || tx.currencyCode)}` : ''}`
     : '-';
    return `<tr><td>${formatDateValue(tx.createdAt, pdfSettings.dateFormat)}</td><td>${from}</td><td>${to}</td><td class="num">${amount}</td><td>${esc(tx.archiveNote)}</td><td>${esc(tx.description)}</td></tr>`;
   })
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

  return `<!DOCTYPE html>
<html lang="${language}" dir="${dir}">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap">
<style>
 * { box-sizing: border-box; margin: 0; padding: 0; }
 body { font-family: ${pdfSettings.fontFamily}; font-size: ${pdfSettings.fontSize}px; color: #1e293b; padding: 32px; }
 .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e293b; padding-bottom: 12px; margin-bottom: 20px; }
 .header-left { display: flex; align-items: center; gap: 14px; }
 .brand-logo { height: 54px; width: auto; }
 .header-left h1 { font-size: calc(${pdfSettings.fontSize}px + 8px); font-weight: bold; }
 .header-left p { font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; margin-top: 2px; }
 .header-right { text-align: ${isRTL ? 'left' : 'right'}; font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; }
 table { width: 100%; border-collapse: collapse; margin-top: 8px; }
 thead tr { background: #e2e8f0; }
 th { padding: 8px 10px; font-size: ${pdfSettings.headFontSize}px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #1e293b; text-align: center; border-bottom: 2px solid #94a3b8; }
 td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; text-align: center; }
 tbody tr:nth-child(odd) { background: #f8fafc; }
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
${pdfSettings.showFooter ? `<div class="footer">${t('export_generated_on')} ${exportDate}</div>` : ''}
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
 * { box-sizing: border-box; margin: 0; padding: 0; }
 body { font-family: ${pdfSettings.fontFamily}; font-size: ${pdfSettings.fontSize}px; color: #1e293b; padding: 32px; }
 .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e293b; padding-bottom: 12px; margin-bottom: 20px; }
 .header-left { display: flex; align-items: center; gap: 14px; }
 .brand-logo { height: 54px; width: auto; }
 .header-left h1 { font-size: calc(${pdfSettings.fontSize}px + 8px); font-weight: bold; }
 .header-left p { font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; margin-top: 2px; }
 .header-right { text-align: ${isRTL ? 'left' : 'right'}; font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; }
 table { width: 100%; border-collapse: collapse; margin-top: 8px; }
 thead tr { background: #e2e8f0; }
 th { padding: 8px 10px; font-size: ${pdfSettings.headFontSize}px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #1e293b; text-align: center; border-bottom: 2px solid #94a3b8; }
 td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; text-align: center; }
 tbody tr:nth-child(odd) { background: #f8fafc; }
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
${pdfSettings.showFooter ? `<div class="footer">${t('export_generated_on')} ${exportDate}</div>` : ''}
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
    cell: (e) =>
     `<span class="${e.direction === 'outgoing' ? 'pos' : 'neg'}">${e.amount.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals })}${pdfSettings.showCurrencySymbol ? ` ${e.currencySymbol || e.currencyCode}` : ''}</span>`,
   },
   {
    key: 'exchangeRate',
    header: t('exchange_rate'),
    isNum: true,
    cell: (e) => {
     if (e.pendingRate) {
      return '-';
     }
     if (e.isAdjustment) {
      // Show the actual rate (including 1), matching the on-screen ledger. Only a genuinely
      // unset cross-currency rate (pendingRate, handled above) renders as a dash.
      return formatRateValue(e.exchangeRateReversed ? 1 / e.exchangeRate : e.exchangeRate);
     }
     return formatRateValue(e.exchangeRate);
    },
   },
   { key: 'commission', header: t('commission'), isNum: true, cell: (e) => (e.isAdjustment ? '-' : formatRateValue(e.commission)) },
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
  // Insert charges column before runningBalance when any entry has charges
  const hasCharges = filteredEntries.some((e) => !e.isAdjustment && e.charges > 0 && chargeShowsInLedger(e.chargesPayer));
  if (hasCharges) {
   const chargesCol: ColDef = {
    key: 'charges' as unknown as LedgerColumnKey,
    header: t('charges'),
    isNum: true,
    cell: (e) => {
     if (e.isAdjustment || e.charges <= 0 || !chargeShowsInLedger(e.chargesPayer)) return '';
     const sign = e.isChargesPayerThisAccount ? '−' : '+';
     const cls = e.isChargesPayerThisAccount ? 'neg' : 'pos';
     const val = e.charges.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals });
     const desc = e.chargesDescription ? `<div class="charges-desc">${esc(e.chargesDescription)}</div>` : '';
     return `<span class="${cls}">${sign}${val}</span>${desc}`;
    },
   };
   const amtIdx = visibleCols.findIndex((col) => col.key === 'amount');
   if (amtIdx === -1) visibleCols.push(chargesCol);
   else visibleCols.splice(amtIdx + 1, 0, chargesCol);
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

  return `<!DOCTYPE html>
<html lang="${language}" dir="${dir}">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap">
<style>
 * { box-sizing: border-box; margin: 0; padding: 0; }
 body { font-family: ${pdfSettings.fontFamily}; font-size: ${pdfSettings.fontSize}px; color: #1e293b; padding: 32px; }
 .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e293b; padding-bottom: 12px; margin-bottom: 20px; }
 .header-left { display: flex; align-items: center; gap: 14px; }
 .brand-logo { height: 54px; width: auto; }
 .header-left h1 { font-size: calc(${pdfSettings.fontSize}px + 8px); font-weight: bold; }
 .header-left p { font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; margin-top: 2px; }
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
 tbody tr:nth-child(odd) { background: #f8fafc; }
 tbody tr:nth-child(even) { background: #ffffff; }
 td.num { font-variant-numeric: tabular-nums; }
 th.num { }
 td.hl { background: #eff6ff; }
 tr:last-child td { border-bottom: none; }
 .final-balance { display: flex; justify-content: center; align-items: center; gap: 16px; margin-top: 16px; padding: 12px 20px; border: 2px solid #1e293b; border-radius: 6px; background: #f8fafc; }
 .final-balance .fb-label { font-size: calc(${pdfSettings.fontSize}px + 1px); font-weight: 700; color: #1e293b; }
 .final-balance .fb-value { font-size: calc(${pdfSettings.fontSize}px + 2px); font-weight: 700; font-variant-numeric: tabular-nums; }
 .footer { margin-top: 24px; font-size: calc(${pdfSettings.fontSize}px - 2px); color: #94a3b8; text-align: center; }
 .charges-line { font-size: calc(${pdfSettings.fontSize}px - 1px); font-weight: 600; margin-top: 2px; }
 .charges-desc { font-weight: 400; font-style: italic; color: #94a3b8; }
</style>
</head>
<body>
<div class="header">
 <div class="header-left">
  <img class="brand-logo" src="${logoUrl}" alt="Arkam" />
  <div>
   <p>${t('client_ledger_statement')}</p>
  </div>
 </div>
 ${pdfSettings.showGeneratedOn ? `<div class="header-right"><div>${t('export_generated_on')}: ${exportDate}</div></div>` : ''}
</div>
${metaColCount > 0 ? `<div class="meta">${metaCards.join('')}</div>` : ''}
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
${pdfSettings.showFooter ? `<div class="footer">${t('export_generated_on')} ${exportDate}</div>` : ''}
</body>
</html>`;
}
