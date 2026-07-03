import { formatDateValue } from '@/shared/utils/date';
import type { PdfSettings, Section, Transaction } from '@/shared/types';

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
