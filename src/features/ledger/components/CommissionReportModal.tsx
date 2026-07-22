'use client';

import { useEffect, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { compactFieldInputClassName, compactFieldLabelClassName } from '@/shared/styles';
import { normalizePlainDecimalInput } from '@/shared/utils/decimal';
import { formatDateValue, localDateKey } from '@/shared/utils/date';
import { getLedgerTransactionDraftKey } from '@/features/ledger/utils/ledgerEntries';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { computeDistributionBreakdown, groupEntriesByDescription } from '@/features/ledger/utils/distributionCommission';
import type { ClientAccount, ClientAccountLedger, ClientLedgerEntry } from '@/shared/types';

type CommissionReportModalProps = {
 ledgers: ClientAccountLedger[];
 clientAccounts: ClientAccount[];
};

// On-demand "Commission Distribution" report popup (see Client.distributionCommissionEnabled)
// — opened via the "Calculate commission" toolbar button, or via the ledger row's right-click
// "Calculate commission between highlighted rows" action (which pre-scopes the range before
// this even renders). Classifies the range's own transactions by their free-text description —
// no pre-configured location list: every distinct description found among incoming rows becomes
// a "receiving" candidate (assign a commission rate, or leave ignored) and every distinct
// description among outgoing rows becomes a "settlement" candidate (mark as settlement, or leave
// ignored). Only classified rows enter the math. Never books anything on its own — "Insert
// commission" hands off to the existing add-adjustment modal for the user to review and confirm.
export default function CommissionReportModal({ ledgers, clientAccounts }: CommissionReportModalProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const numLocale = language === 'fr' ? 'en-US' : language;
 const pdfSettings = useSettingsStore((s) => s.pdfSettings);
 const highlightedLedgerRows = useLedgerStore((s) => s.highlightedLedgerRows);
 const commissionModal = useLedgerStore((s) => s.commissionModal);
 const setCommissionModal = useLedgerStore((s) => s.setCommissionModal);
 const setAdjustmentModal = useLedgerStore((s) => s.setAdjustmentModal);

 // Every table header/cell in this modal aligns this way — RTL mirrors the table itself, so
 // text-align needs the explicit flip too (same convention as the main ledger table).
 const alignClassName = isRTL ? 'text-right' : 'text-left';

 const ledger = commissionModal ? ledgers.find((l) => l.accountId === commissionModal.accountId) : undefined;

 const allEntries = useMemo<Array<ClientLedgerEntry & { rowKey: string }>>(() => {
  if (!ledger) return [];
  return [...ledger.entries]
   .map((entry) => ({ ...entry, rowKey: getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId) }))
   .sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (diff !== 0) return diff;
    return (a.isAdjustment ? (a.adjustmentId ?? 0) : a.transactionId) - (b.isAdjustment ? (b.adjustmentId ?? 0) : b.transactionId);
   });
 }, [ledger]);

 const highlightedInScope = useMemo(
  () => (ledger ? allEntries.filter((entry) => highlightedLedgerRows.has(entry.rowKey)) : []),
  [ledger, allEntries, highlightedLedgerRows],
 );

 const entryLabel = (entry: ClientLedgerEntry) =>
  `${formatDateValue(entry.createdAt, pdfSettings.dateFormat)} · ${entry.counterpartyName} · ${entry.direction === 'outgoing' ? '−' : '+'}${entry.amount.toLocaleString(numLocale, { maximumFractionDigits: 2 })} ${entry.currencySymbol || entry.currencyCode}`;

 const rangeEntries = useMemo(() => {
  if (!commissionModal) return [];
  if (commissionModal.fromEntryKey && commissionModal.toEntryKey) {
   const startIdx = allEntries.findIndex((e) => e.rowKey === commissionModal.fromEntryKey);
   const endIdx = allEntries.findIndex((e) => e.rowKey === commissionModal.toEntryKey);
   return startIdx !== -1 && endIdx !== -1 && startIdx <= endIdx ? allEntries.slice(startIdx, endIdx + 1) : [];
  }
  if (commissionModal.fromDate || commissionModal.toDate) {
   return allEntries.filter((entry) => {
    const day = entry.createdAt.slice(0, 10);
    if (commissionModal.fromDate && day < commissionModal.fromDate) return false;
    if (commissionModal.toDate && day > commissionModal.toDate) return false;
    return true;
   });
  }
  return allEntries;
 }, [allEntries, commissionModal]);

 const receivingGroups = useMemo(() => groupEntriesByDescription(rangeEntries.filter((e) => e.direction === 'incoming')), [rangeEntries]);
 const settlementGroups = useMemo(() => groupEntriesByDescription(rangeEntries.filter((e) => e.direction === 'outgoing')), [rangeEntries]);

 // Default every newly-seen description to included so the popup opens ready-to-go — the user
 // unchecks the exceptions (e.g. an invoice that isn't a real settlement) instead of having to
 // check everything by hand. Descriptions the user already touched (present in the selections
 // map, even as unchecked) are left alone.
 useEffect(() => {
  if (!commissionModal) return;
  const missingReceiving = receivingGroups.filter((g) => !(g.description in commissionModal.receivingSelections));
  const missingSettlement = settlementGroups.filter((g) => !(g.description in commissionModal.settlementSelections));
  if (missingReceiving.length === 0 && missingSettlement.length === 0) return;
  setCommissionModal((prev) => {
   if (!prev) return prev;
   const receivingSelections = { ...prev.receivingSelections };
   for (const g of missingReceiving) receivingSelections[g.description] = { included: true, rate: '' };
   const settlementSelections = { ...prev.settlementSelections };
   for (const g of missingSettlement) settlementSelections[g.description] = true;
   return { ...prev, receivingSelections, settlementSelections };
  });
 }, [receivingGroups, settlementGroups, commissionModal, setCommissionModal]);

 const breakdown = useMemo(() => {
  if (!commissionModal) return null;
  const receivingSelections: Record<string, { included: boolean; rate: number }> = {};
  for (const [description, selection] of Object.entries(commissionModal.receivingSelections)) {
   const parsed = parseFloat(selection.rate);
   receivingSelections[description] = { included: selection.included, rate: Number.isFinite(parsed) ? parsed : 0 };
  }
  return computeDistributionBreakdown({
   receivingGroups,
   settlementGroups,
   receivingSelections,
   settlementSelections: commissionModal.settlementSelections,
  });
 }, [commissionModal, receivingGroups, settlementGroups]);

 if (!commissionModal || !ledger || !breakdown) return null;

 const rangeActive = !!(commissionModal.fromEntryKey && commissionModal.toEntryKey);
 const rangeFirst = rangeActive ? allEntries.find((e) => e.rowKey === commissionModal.fromEntryKey) : undefined;
 const rangeLast = rangeActive ? allEntries.find((e) => e.rowKey === commissionModal.toEntryKey) : undefined;
 const breakdownByDescription = new Map(breakdown.receiving.map((row) => [row.description, row]));
 const includedReceivingCount = breakdown.receiving.length;
 const includedSettlementCount = settlementGroups.filter((g) => commissionModal.settlementSelections[g.description]).length;

 function close() {
  setCommissionModal(null);
 }

 function useHighlightedRows() {
  if (!commissionModal || highlightedInScope.length === 0) return;
  const last = highlightedInScope[highlightedInScope.length - 1];
  const first = highlightedInScope.length >= 2 ? highlightedInScope[highlightedInScope.length - 2] : last;
  setCommissionModal((prev) => (prev ? { ...prev, fromEntryKey: first.rowKey, toEntryKey: last.rowKey } : prev));
 }

 function clearRange() {
  setCommissionModal((prev) => (prev ? { ...prev, fromEntryKey: null, toEntryKey: null } : prev));
 }

 function setReceivingIncluded(description: string, included: boolean) {
  setCommissionModal((prev) =>
   prev
    ? { ...prev, receivingSelections: { ...prev.receivingSelections, [description]: { included, rate: prev.receivingSelections[description]?.rate ?? '' } } }
    : prev,
  );
 }

 function setReceivingRate(description: string, rate: string) {
  setCommissionModal((prev) =>
   prev
    ? { ...prev, receivingSelections: { ...prev.receivingSelections, [description]: { included: prev.receivingSelections[description]?.included ?? false, rate } } }
    : prev,
  );
 }

 function setSettlementIncluded(description: string, included: boolean) {
  setCommissionModal((prev) => (prev ? { ...prev, settlementSelections: { ...prev.settlementSelections, [description]: included } } : prev));
 }

 function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
 }

 function printReport() {
  if (!breakdown) return;
  const account = clientAccounts.find((a) => a.id === ledger!.accountId);
  const clientName = account?.clientName ?? '';
  const currencyLabel = ledger!.currencyName || ledger!.currencyCode;
  const generatedOn = formatDateValue(new Date().toISOString(), pdfSettings.dateFormat);
  // Dates only — no counterparty names — since this report is printed to hand to the client
  // themselves, not kept as an internal reference.
  const rangeLabel = rangeActive
   ? `${rangeFirst ? formatDateValue(rangeFirst.createdAt, pdfSettings.dateFormat) : ''} ${isRTL ? '←' : '→'} ${rangeLast ? formatDateValue(rangeLast.createdAt, pdfSettings.dateFormat) : ''}`
   : commissionModal!.fromDate || commissionModal!.toDate
     ? `${commissionModal!.fromDate || '…'} — ${commissionModal!.toDate || '…'}`
     : t('commission_report_print_all_range');

  const receivingRows = breakdown.receiving
   .map(
    (row) => `<tr>
     <td>${escapeHtml(row.description)} <span class="muted">×${row.count}</span></td>
     <td class="red">${row.total.toLocaleString(numLocale, { maximumFractionDigits: 2 })}</td>
     <td>${row.commissionRate}%</td>
     <td>${(row.percentOfReceived * 100).toFixed(2)}%</td>
     <td>${row.proratedShare.toLocaleString(numLocale, { maximumFractionDigits: 2 })}</td>
     <td class="green"><strong>${row.commission.toLocaleString(numLocale, { maximumFractionDigits: 2 })}</strong></td>
    </tr>`,
   )
   .join('');

  const settlementRows = settlementGroups
   .filter((group) => commissionModal!.settlementSelections[group.description])
   .map(
    (group) => `<tr>
     <td>${escapeHtml(group.description)} <span class="muted">×${group.count}</span></td>
     <td class="green">${group.total.toLocaleString(numLocale, { maximumFractionDigits: 2 })}</td>
    </tr>`,
   )
   .join('');

  const html = `<!doctype html>
<html dir="${isRTL ? 'rtl' : 'ltr'}" lang="${language}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(t('distribution_panel_title'))} — ${escapeHtml(clientName)}</title>
<style>
 body { font-family: ${pdfSettings.fontFamily}; font-size: ${pdfSettings.fontSize}px; color: #111; padding: 24px; }
 h1 { font-size: calc(${pdfSettings.fontSize}px + 8px); margin: 0 0 4px; }
 h3 { font-size: calc(${pdfSettings.fontSize}px + 1px); margin: 20px 0 6px; }
 .sub { color: #555; font-size: calc(${pdfSettings.fontSize}px - 1px); margin: 0 0 12px; }
 table { width: 100%; border-collapse: collapse; font-size: ${pdfSettings.fontSize}px; }
 th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: ${isRTL ? 'right' : 'left'}; }
 th { background: #f2f2f2; font-size: ${pdfSettings.headFontSize}px; }
 .muted { color: #777; font-size: calc(${pdfSettings.fontSize}px - 2px); }
 .empty { color: #777; font-size: ${pdfSettings.fontSize}px; }
 .summary { display: flex; gap: 16px; margin-top: 20px; }
 .summary div { border: 1px solid #ccc; border-radius: 4px; padding: 8px 14px; }
 .summary .label { font-size: calc(${pdfSettings.fontSize}px - 2px); text-transform: uppercase; color: #777; }
 .summary .value { font-size: calc(${pdfSettings.fontSize}px + 3px); font-weight: 700; }
 .red { color: #b91c1c; }
 .green { color: #15803d; }
 @media print { body { padding: 0; } }
</style>
</head>
<body>
 <h1>${escapeHtml(t('distribution_panel_title'))} — ${escapeHtml(clientName)}</h1>
 <p class="sub">${escapeHtml(currencyLabel)} · ${escapeHtml(rangeLabel)} · ${escapeHtml(t('commission_report_print_generated_on', { date: generatedOn }))}</p>

 <h3>${escapeHtml(t('commission_report_print_receiving_heading'))}</h3>
 ${
  breakdown.receiving.length
   ? `<table><thead><tr>
   <th>${escapeHtml(t('commission_report_description_column'))}</th>
   <th>${escapeHtml(t('amount'))}</th>
   <th>${escapeHtml(t('distribution_panel_rate'))}</th>
   <th>%</th>
   <th>${escapeHtml(t('distribution_panel_share'))}</th>
   <th>${escapeHtml(t('distribution_panel_commission'))}</th>
  </tr></thead><tbody>${receivingRows}</tbody></table>`
   : `<p class="empty">${escapeHtml(t('commission_report_no_receiving'))}</p>`
 }

 <h3>${escapeHtml(t('commission_report_print_settlement_heading'))}</h3>
 ${
  settlementRows
   ? `<table><thead><tr>
   <th>${escapeHtml(t('commission_report_description_column'))}</th>
   <th>${escapeHtml(t('amount'))}</th>
  </tr></thead><tbody>${settlementRows}</tbody></table>`
   : `<p class="empty">${escapeHtml(t('commission_report_no_settlement'))}</p>`
 }

 <div class="summary">
  <div><div class="label">${escapeHtml(t('distribution_panel_received_total'))}</div><div class="value red">${breakdown.totalReceived.toLocaleString(numLocale, { maximumFractionDigits: 2 })}</div></div>
  <div><div class="label">${escapeHtml(t('distribution_panel_settled_total'))}</div><div class="value green">${breakdown.totalSettled.toLocaleString(numLocale, { maximumFractionDigits: 2 })}</div></div>
  <div><div class="label">${escapeHtml(t('distribution_panel_total_commission'))}</div><div class="value green">${breakdown.totalCommission.toLocaleString(numLocale, { maximumFractionDigits: 0 })}</div></div>
 </div>
</body>
</html>`;

  const printWindow = window.open('', '_blank', 'width=900,height=1000');
  if (!printWindow) return;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
 }

 function insertCommission() {
  if (!breakdown || breakdown.totalCommission <= 0) return;
  const account = clientAccounts.find((a) => a.id === ledger!.accountId);
  // Kept short on purpose: just the description and its commission rate — the full math
  // (amounts included) is already visible in the report itself.
  const descriptionBody = breakdown.receiving
   .map((row) => `${row.description} ${row.commissionRate.toLocaleString(numLocale, { maximumFractionDigits: 2 })}%`)
   .join(' · ');
  setAdjustmentModal({
   accountId: ledger!.accountId,
   editingId: null,
   amount: breakdown.totalCommission.toFixed(0),
   direction: 'debit',
   currencyId: account?.currencyId ?? null,
   exchangeRate: '1',
   exchangeRateReversed: false,
   description: `${t('commission_report_description_prefix')}: ${descriptionBody}`,
   date: localDateKey(),
  });
  close();
 }

 return (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
   <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded bg-surface p-6 shadow-2xl">
    <div className="flex items-start justify-between gap-4">
     <div>
      <h3 className="text-lg font-semibold text-fg">{t('distribution_panel_title')}</h3>
      <p className="mt-1 text-sm text-fg-faint">{ledger.currencyName || `${ledger.currencyCode}`}</p>
     </div>
     <div className="rounded border border-accent bg-accent-weak px-4 py-2 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">{t('distribution_panel_total_commission')}</p>
      <p className="text-xl font-bold text-good-text">{breakdown.totalCommission.toLocaleString(numLocale, { maximumFractionDigits: 0 })}</p>
     </div>
    </div>
    <p className="mt-3 rounded border border-border bg-surface-2 px-3 py-2 text-sm text-fg-muted">{t('commission_report_hint')}</p>

    {/* Step 1: range */}
    <div className="mt-5">
     <h4 className="text-sm font-semibold text-fg">{t('commission_report_step_range')}</h4>
     {rangeActive ? (
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-amber-400 bg-warn-bg px-3 py-2 text-sm text-warn-text">
       <span className="font-medium">{t('distribution_panel_range_active')}</span>
       <span>
        {rangeFirst ? entryLabel(rangeFirst) : '—'} {isRTL ? '←' : '→'} {rangeLast ? entryLabel(rangeLast) : '—'}
       </span>
       <button
        type="button"
        onClick={clearRange}
        className="ms-auto cursor-pointer rounded border border-warn-text/40 px-2 py-0.5 text-xs font-semibold hover:bg-warn-bg"
       >
        {t('distribution_panel_range_clear')}
       </button>
      </div>
     ) : (
      <div className="mt-2 flex flex-wrap items-end gap-3">
       <div className="flex flex-col gap-1">
        <label className={compactFieldLabelClassName}>{t('distribution_panel_date_from')}</label>
        <input
         type="date"
         value={commissionModal.fromDate}
         onChange={(event) => {
          const value = event.target.value;
          setCommissionModal((prev) => (prev ? { ...prev, fromDate: value } : prev));
         }}
         className={compactFieldInputClassName}
        />
       </div>
       <div className="flex flex-col gap-1">
        <label className={compactFieldLabelClassName}>{t('distribution_panel_date_to')}</label>
        <input
         type="date"
         value={commissionModal.toDate}
         onChange={(event) => {
          const value = event.target.value;
          setCommissionModal((prev) => (prev ? { ...prev, toDate: value } : prev));
         }}
         className={compactFieldInputClassName}
        />
       </div>
       {highlightedInScope.length > 0 ? (
        <div className="flex flex-col gap-1">
         <button
          type="button"
          onClick={useHighlightedRows}
          className="cursor-pointer rounded border border-amber-400 bg-warn-bg px-3 py-2 text-sm font-semibold text-warn-text transition hover:bg-warn-bg"
         >
          {t('distribution_panel_use_highlights')}
         </button>
        </div>
       ) : null}
      </div>
     )}
     {!rangeActive && highlightedInScope.length > 0 ? <p className="mt-1 text-xs text-fg-faint">{t('distribution_panel_use_highlights_hint')}</p> : null}
    </div>

    {/* Step 2: receiving classification */}
    <div className="mt-6">
     <div className="flex items-baseline justify-between gap-2">
      <h4 className="text-sm font-semibold text-fg">{t('commission_report_step_receiving')}</h4>
      <span className="text-xs text-fg-faint">{t('commission_report_included_count', { count: includedReceivingCount, total: receivingGroups.length })}</span>
     </div>
     {receivingGroups.length === 0 ? (
      <p className="mt-2 text-sm text-fg-faint">{t('commission_report_no_receiving')}</p>
     ) : (
      <div className="mt-2 overflow-x-auto rounded border border-border">
       <table className="w-full min-w-160 border-collapse text-sm">
        <thead>
         <tr className={`border-b border-border bg-surface-2 text-xs font-semibold uppercase tracking-wide text-fg-faint ${alignClassName}`}>
          <th className={`w-10 px-3 py-2 ${alignClassName}`}></th>
          <th className={`px-3 py-2 ${alignClassName}`}>{t('commission_report_description_column')}</th>
          <th className={`px-3 py-2 ${alignClassName}`}>{t('amount')}</th>
          <th className={`px-3 py-2 ${alignClassName}`}>{t('distribution_panel_rate')}</th>
          <th className={`px-3 py-2 ${alignClassName} border-s border-border`}>%</th>
          <th className={`px-3 py-2 ${alignClassName}`}>{t('distribution_panel_share')}</th>
          <th className={`px-3 py-2 ${alignClassName}`}>{t('distribution_panel_commission')}</th>
         </tr>
        </thead>
        <tbody>
         {receivingGroups.map((group) => {
          const selection = commissionModal.receivingSelections[group.description];
          const included = !!selection?.included;
          const computed = breakdownByDescription.get(group.description);
          return (
           <tr
            key={group.description}
            className={`border-b border-border last:border-b-0 ${included ? 'bg-good-bg/40' : 'opacity-60'}`}
           >
            <td className={`px-3 py-2 ${alignClassName}`}>
             <input
              type="checkbox"
              checked={included}
              onChange={(event) => setReceivingIncluded(group.description, event.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-border-strong"
             />
            </td>
            <td className={`px-3 py-2 font-medium ${alignClassName}`}>
             {group.description}
             <span className="ms-1.5 text-xs font-normal text-fg-faint">{t('commission_report_count', { count: group.count })}</span>
            </td>
            <td className={`px-3 py-2 text-bad-text ${alignClassName}`}>{group.total.toLocaleString(numLocale, { maximumFractionDigits: 2 })}</td>
            <td className={`px-3 py-2 ${alignClassName}`}>
             <input
              type="text"
              inputMode="decimal"
              dir="ltr"
              disabled={!included}
              value={selection?.rate ?? ''}
              onChange={(event) => setReceivingRate(group.description, normalizePlainDecimalInput(event.target.value))}
              className={`${compactFieldInputClassName} w-16 disabled:cursor-not-allowed disabled:opacity-50`}
              placeholder="0"
             />
             %
            </td>
            <td className={`px-3 py-2 border-s border-border text-fg-muted ${alignClassName}`}>{computed ? `${(computed.percentOfReceived * 100).toFixed(2)}%` : '—'}</td>
            <td className={`px-3 py-2 text-fg-muted ${alignClassName}`}>{computed ? computed.proratedShare.toLocaleString(numLocale, { maximumFractionDigits: 2 }) : '—'}</td>
            <td className={`px-3 py-2 font-semibold text-good-text ${alignClassName}`}>{computed ? computed.commission.toLocaleString(numLocale, { maximumFractionDigits: 2 }) : '—'}</td>
           </tr>
          );
         })}
        </tbody>
       </table>
      </div>
     )}
    </div>

    {/* Step 3: settlement classification */}
    <div className="mt-6">
     <div className="flex items-baseline justify-between gap-2">
      <h4 className="text-sm font-semibold text-fg">{t('commission_report_step_settlement')}</h4>
      <span className="text-xs text-fg-faint">{t('commission_report_included_count', { count: includedSettlementCount, total: settlementGroups.length })}</span>
     </div>
     {settlementGroups.length === 0 ? (
      <p className="mt-2 text-sm text-fg-faint">{t('commission_report_no_settlement')}</p>
     ) : (
      <div className="mt-2 overflow-x-auto rounded border border-border">
       <table className="w-full min-w-80 border-collapse text-sm">
        <thead>
         <tr className={`border-b border-border bg-surface-2 text-xs font-semibold uppercase tracking-wide text-fg-faint ${alignClassName}`}>
          <th className={`w-10 px-3 py-2 ${alignClassName}`}></th>
          <th className={`px-3 py-2 ${alignClassName}`}>{t('commission_report_description_column')}</th>
          <th className={`px-3 py-2 ${alignClassName}`}>{t('amount')}</th>
         </tr>
        </thead>
        <tbody>
         {settlementGroups.map((group) => {
          const included = !!commissionModal.settlementSelections[group.description];
          return (
           <tr
            key={group.description}
            className={`border-b border-border last:border-b-0 ${included ? 'bg-good-bg/40' : 'opacity-60'}`}
           >
            <td className={`px-3 py-2 ${alignClassName}`}>
             <input
              type="checkbox"
              checked={included}
              onChange={(event) => setSettlementIncluded(group.description, event.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-border-strong"
             />
            </td>
            <td className={`px-3 py-2 font-medium ${alignClassName}`}>
             {group.description}
             <span className="ms-1.5 text-xs font-normal text-fg-faint">{t('commission_report_count', { count: group.count })}</span>
            </td>
            <td className={`px-3 py-2 text-good-text ${alignClassName}`}>{group.total.toLocaleString(numLocale, { maximumFractionDigits: 2 })}</td>
           </tr>
          );
         })}
        </tbody>
       </table>
      </div>
     )}
    </div>

    {/* Step 4: result */}
    <div className="mt-6 grid gap-2 text-sm sm:grid-cols-3">
     <div className="rounded border border-border bg-surface-2 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('distribution_panel_received_total')}</p>
      <p className="mt-1 text-lg font-semibold text-bad-text">{breakdown.totalReceived.toLocaleString(numLocale, { maximumFractionDigits: 2 })}</p>
     </div>
     <div className="rounded border border-border bg-surface-2 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('distribution_panel_settled_total')}</p>
      <p className="mt-1 text-lg font-semibold text-good-text">{breakdown.totalSettled.toLocaleString(numLocale, { maximumFractionDigits: 2 })}</p>
     </div>
     <div className="rounded border border-accent bg-accent-weak p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('distribution_panel_total_commission')}</p>
      <p className="mt-1 text-lg font-semibold text-good-text">{breakdown.totalCommission.toLocaleString(numLocale, { maximumFractionDigits: 0 })}</p>
     </div>
    </div>

    <div className="mt-5 flex justify-end gap-2">
     <button
      type="button"
      onClick={printReport}
      className="rounded border border-border-strong px-4 py-2 text-sm font-semibold text-fg-muted hover:bg-surface-hover"
     >
      {t('commission_report_print')}
     </button>
     <button
      type="button"
      onClick={close}
      className="rounded border border-border-strong px-4 py-2 text-sm font-semibold text-fg-muted hover:bg-surface-hover"
     >
      {t('cancel')}
     </button>
     <button
      type="button"
      onClick={insertCommission}
      disabled={breakdown.totalCommission <= 0}
      className="rounded bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-40"
     >
      {t('commission_report_insert')}
     </button>
    </div>
   </div>
  </div>
 );
}
