'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import type { Dispatch, SetStateAction } from 'react';
import { useTransactionsStore } from '@/features/transactions/store/transactionsStore';
import { importNameKey, DEFAULT_IMPORT_ROW_OVERRIDE } from '@/features/transactions/utils/import';
import { emptyOrganizationForm } from '@/features/organizations/forms';
import type { Client, ClientAccount, Currency, ImportClientReview, ImportRowOverride, Organization, OrganizationForm } from '@/shared/types';

type ImportWizardProps = {
 clients: Client[];
 clientAccounts: ClientAccount[];
 enabledCurrencies: Currency[];
 currencies: Currency[];
 organizations: Organization[];
 // Archive imports allow a row to name only a sender or only a receiver.
 allowOneSided: boolean;
 onPrepareImportReview: () => void;
 onCancelImportTransactions: () => void;
 onConfirmImportTransactions: () => void;
 updateImportReviewEntry: (key: string, patch: Partial<ImportClientReview>) => void;
 updateImportRowOverride: (index: number, patch: Partial<ImportRowOverride>) => void;
 setOrgDialogTargetReviewKey: Dispatch<SetStateAction<string | null>>;
 setOrganizationForm: Dispatch<SetStateAction<OrganizationForm>>;
 setShowCreateOrgDialog: Dispatch<SetStateAction<boolean>>;
};

export default function ImportWizard({
 clients, clientAccounts, enabledCurrencies, currencies, organizations, allowOneSided,
 onPrepareImportReview, onCancelImportTransactions, onConfirmImportTransactions,
 updateImportReviewEntry, updateImportRowOverride, setOrgDialogTargetReviewKey,
 setOrganizationForm, setShowCreateOrgDialog,
}: ImportWizardProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const pendingImportData = useTransactionsStore((s) => s.pendingImportData);
 const importMapping = useTransactionsStore((s) => s.importMapping);
 const setImportMapping = useTransactionsStore((s) => s.setImportMapping);
 const importReview = useTransactionsStore((s) => s.importReview);
 const setImportReview = useTransactionsStore((s) => s.setImportReview);
 const importParsedRows = useTransactionsStore((s) => s.importParsedRows);
 const importRowOverrides = useTransactionsStore((s) => s.importRowOverrides);
 const isImportingTransactions = useTransactionsStore((s) => s.isImportingTransactions);

 return (
  <>
   {pendingImportData && !importReview ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
     <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded bg-surface shadow-2xl">
      <div className="border-b border-border p-6">
       <h3 className="text-lg font-semibold text-fg">{t('import_setup_title')}</h3>
       <p className="mt-1 text-sm text-fg-faint">{t('import_setup_subtitle', { fileName: pendingImportData.fileName })}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
       <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm text-fg-muted">
         <span className="block text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('import_setup_date_label')}</span>
         <select
          value={importMapping.dateColumn ?? ''}
          onChange={(event) => setImportMapping((current) => ({ ...current, dateColumn: event.target.value === '' ? null : Number(event.target.value) }))}
          className="mt-1 w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
         >
          <option value="">{t('import_setup_date_none')}</option>
          {pendingImportData.columnOptions.map((option) => (
           <option
            key={option.index}
            value={option.index}
           >
            {option.label}
           </option>
          ))}
         </select>
        </label>

        <label className="text-sm text-fg-muted">
         <span className="block text-xs font-semibold uppercase tracking-wide text-fg-faint">
          {t('import_setup_sender_label')}
          {allowOneSided ? <span className="ml-1 font-normal normal-case text-fg-faint">({t('import_setup_optional')})</span> : null}
         </span>
         <select
          value={importMapping.fromColumn ?? ''}
          onChange={(event) => setImportMapping((current) => ({ ...current, fromColumn: event.target.value === '' ? null : Number(event.target.value) }))}
          className="mt-1 w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
         >
          <option value="">{t('import_setup_sender_placeholder')}</option>
          {pendingImportData.columnOptions.map((option) => (
           <option
            key={option.index}
            value={option.index}
           >
            {option.label}
           </option>
          ))}
         </select>
        </label>

        <label className="text-sm text-fg-muted">
         <span className="block text-xs font-semibold uppercase tracking-wide text-fg-faint">
          {t('import_setup_receiver_label')}
          {allowOneSided ? <span className="ml-1 font-normal normal-case text-fg-faint">({t('import_setup_optional')})</span> : null}
         </span>
         <select
          value={importMapping.toColumn ?? ''}
          onChange={(event) => setImportMapping((current) => ({ ...current, toColumn: event.target.value === '' ? null : Number(event.target.value) }))}
          className="mt-1 w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
         >
          <option value="">{t('import_setup_receiver_placeholder')}</option>
          {pendingImportData.columnOptions.map((option) => (
           <option
            key={option.index}
            value={option.index}
           >
            {option.label}
           </option>
          ))}
         </select>
        </label>

        <label className="text-sm text-fg-muted">
         <span className="block text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('import_setup_amount_label')}</span>
         <select
          value={importMapping.amountColumn ?? ''}
          onChange={(event) => setImportMapping((current) => ({ ...current, amountColumn: event.target.value === '' ? null : Number(event.target.value) }))}
          className="mt-1 w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
         >
          <option value="">{t('import_setup_amount_placeholder')}</option>
          {pendingImportData.columnOptions.map((option) => (
           <option
            key={option.index}
            value={option.index}
           >
            {option.label}
           </option>
          ))}
         </select>
        </label>

        <label className="text-sm text-fg-muted">
         <span className="block text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('import_setup_description_label')}</span>
         <select
          value={importMapping.descriptionColumn ?? ''}
          onChange={(event) => setImportMapping((current) => ({ ...current, descriptionColumn: event.target.value === '' ? null : Number(event.target.value) }))}
          className="mt-1 w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
         >
          <option value="">{t('import_setup_description_none')}</option>
          {pendingImportData.columnOptions.map((option) => (
           <option
            key={option.index}
            value={option.index}
           >
            {option.label}
           </option>
          ))}
         </select>
        </label>

        {/* Archive imports carry a per-row "More info" note (archiveNote). */}
        {allowOneSided ? (
         <label className="text-sm text-fg-muted">
          <span className="block text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('import_setup_more_info_label')}</span>
          <select
           value={importMapping.moreInfoColumn ?? ''}
           onChange={(event) => setImportMapping((current) => ({ ...current, moreInfoColumn: event.target.value === '' ? null : Number(event.target.value) }))}
           className="mt-1 w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
          >
           <option value="">{t('import_setup_more_info_none')}</option>
           {pendingImportData.columnOptions.map((option) => (
            <option
             key={option.index}
             value={option.index}
            >
             {option.label}
            </option>
           ))}
          </select>
         </label>
        ) : null}

        <label className="text-sm text-fg-muted">
         <span className="block text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('import_setup_currency_label')}</span>
         <select
          value={importMapping.currencyId ?? ''}
          onChange={(event) => setImportMapping((current) => ({ ...current, currencyId: event.target.value === '' ? null : Number(event.target.value) }))}
          className="mt-1 w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
         >
          <option value="">{t('import_setup_currency_placeholder')}</option>
          {currencies.map((currency) => (
           <option
            key={currency.id}
            value={currency.id}
           >
            {currency.code} - {currency.name}
           </option>
          ))}
         </select>
        </label>
       </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-border p-6">
       <button
        type="button"
        onClick={onCancelImportTransactions}
        disabled={isImportingTransactions}
        className="rounded border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
       >
        {t('import_cancel')}
       </button>
       <button
        type="button"
        onClick={onPrepareImportReview}
        disabled={isImportingTransactions}
        className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
       >
        {t('import_review_clients')}
       </button>
      </div>
     </div>
    </div>
   ) : null}
   {importReview ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
     <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded bg-surface shadow-2xl">
      <div className="border-b border-border p-6">
       <h3 className="text-lg font-semibold text-fg">{t('import_review_title')}</h3>
       <p className="mt-1 text-sm text-fg-faint">
        {t('import_review_subtitle', { count: importReview.length, fileName: pendingImportData?.fileName ?? t('import_review_the_file') })}
       </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
       <div className="flex flex-col gap-3">
        {importReview.map((entry) => {
         const addableCurrencies = enabledCurrencies.filter((item) => !entry.accountCurrencyIds.includes(item.id));
         return (
          <div
           key={entry.key}
           className={`rounded border p-3 ${entry.isExpense ? 'border-amber-300 bg-warn-bg' : 'border-border'}`}
          >
           <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-fg-muted">{entry.originalName}</span>
            <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-fg-muted">
             <input
              type="checkbox"
              checked={entry.isExpense}
              onChange={(event) => updateImportReviewEntry(entry.key, { isExpense: event.target.checked })}
             />
             {t('import_review_expense_checkbox')}
            </label>
           </div>

           {entry.isExpense ? (
            <div className="mt-2">
             <p className="text-xs text-warn-text">{t('import_review_expense_hint', { name: entry.originalName })}</p>
             <div className="mt-2 flex flex-col gap-1.5">
              {importParsedRows
               .map((row, index) => ({ row, index }))
               .filter(({ row }) => importNameKey(row.fromName) === entry.key || importNameKey(row.toName) === entry.key)
               .map(({ row, index }) => {
                const counterparty = importNameKey(row.fromName) === entry.key ? row.toName : row.fromName;
                const override = importRowOverrides[index] ?? DEFAULT_IMPORT_ROW_OVERRIDE;
                const sendName = override.swap ? row.toName : row.fromName;
                const receiveName = override.swap ? row.fromName : row.toName;
                return (
                 <div
                  key={index}
                  className="rounded border border-amber-200 bg-surface px-2.5 py-1.5 text-xs"
                 >
                  <div className="flex items-center justify-between gap-2">
                   <span className="min-w-0 flex-1 truncate text-fg-muted">
                    {row.fromName} → {row.toName} · {row.amount}
                    {row.createdAt ? ` · ${row.createdAt.slice(0, 10)}` : ''}
                   </span>
                   <select
                    value={override.mode}
                    onChange={(event) => updateImportRowOverride(index, { mode: event.target.value as ImportRowOverride['mode'] })}
                    className="shrink-0 rounded border border-border-strong bg-surface px-2 py-1 text-xs outline-none ring-blue-300 focus:ring"
                   >
                    <option value="expense">{t('import_review_mode_expense')}</option>
                    <option value="transaction">{t('import_review_mode_transaction')}</option>
                   </select>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                   {override.mode === 'expense' ? (
                    <>
                     <span className="text-fg-faint">{t('import_review_on_party', { party: counterparty || t('import_review_other_party') })}</span>
                     <select
                      value={override.direction}
                      onChange={(event) => updateImportRowOverride(index, { direction: event.target.value as ImportRowOverride['direction'] })}
                      className="rounded border border-border-strong bg-surface px-2 py-1 text-xs outline-none ring-blue-300 focus:ring"
                     >
                      <option value="debit">{t('import_review_debit')}</option>
                      <option value="credit">{t('import_review_credit')}</option>
                     </select>
                    </>
                   ) : (
                    <>
                     <span className="text-fg-muted">
                      {t('import_review_from')} <span className="font-semibold">{sendName}</span> → {t('import_review_to')} <span className="font-semibold">{receiveName}</span>
                     </span>
                     <button
                      type="button"
                      onClick={() => updateImportRowOverride(index, { swap: !override.swap })}
                      className="inline-flex items-center gap-1 rounded border border-border-strong px-2 py-1 font-semibold text-fg-muted transition hover:bg-surface-hover"
                     >
                      ⇄ {t('import_review_swap')}
                     </button>
                    </>
                   )}
                  </div>
                 </div>
                );
               })}
             </div>
            </div>
           ) : (
            <>
             {/* Client selector — DB clients + new clients being created in this import */}
             <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
              <label className="flex-1 text-sm text-fg-muted">
               <span className="block text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('client')}</span>
               <select
                value={entry.existingClientId != null ? String(entry.existingClientId) : entry.pendingEntryKey != null ? `__pending__${entry.pendingEntryKey}` : '__new__'}
                onChange={(event) => {
                 const val = event.target.value;
                 if (val === '__new__') {
                  updateImportReviewEntry(entry.key, { existingClientId: null, existingAccountId: null, pendingEntryKey: null, targetCurrencyId: null });
                  return;
                 }
                 if (val.startsWith('__pending__')) {
                  const refKey = val.slice('__pending__'.length);
                  const refEntry = importReview!.find((e) => e.key === refKey);
                  const firstCurrencyId = refEntry?.accountCurrencyIds[0] ?? null;
                  updateImportReviewEntry(entry.key, { existingClientId: null, existingAccountId: null, pendingEntryKey: refKey, targetCurrencyId: firstCurrencyId });
                  return;
                 }
                 const clientId = Number(val);
                 const accountsForClient = clientAccounts.filter((account) => account.clientId === clientId);
                 const defaultAccount = accountsForClient.find((account) => account.currencyId === entry.currencyId) ?? accountsForClient[0] ?? null;
                 updateImportReviewEntry(entry.key, { existingClientId: clientId, existingAccountId: defaultAccount?.id ?? null, pendingEntryKey: null, targetCurrencyId: null });
                }}
                className="mt-1 w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
               >
                <option value="__new__">{t('import_review_create_new')}</option>
                {/* Other review entries whose new clients can be reused */}
                {importReview!.filter((e) => e.key !== entry.key && !e.isExpense && e.existingClientId == null && e.pendingEntryKey == null && e.name.trim()).length > 0 ? (
                 <optgroup label={t('import_review_from_import')}>
                  {importReview!
                   .filter((e) => e.key !== entry.key && !e.isExpense && e.existingClientId == null && e.pendingEntryKey == null && e.name.trim())
                   .map((e) => (
                    <option
                     key={e.key}
                     value={`__pending__${e.key}`}
                    >
                     {e.name.trim()}
                    </option>
                   ))}
                 </optgroup>
                ) : null}
                {clients.length > 0 ? (
                 <optgroup label={t('import_review_existing_clients')}>
                  {clients.map((client) => (
                   <option
                    key={client.id}
                    value={client.id}
                   >
                    {client.name}
                   </option>
                  ))}
                 </optgroup>
                ) : null}
               </select>
              </label>

              {/* New client name — only for entries creating a fresh client */}
              {entry.existingClientId == null && entry.pendingEntryKey == null ? (
               <label className="flex-1 text-sm text-fg-muted">
                <span className="block text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('import_review_new_client_name')}</span>
                <input
                 type="text"
                 value={entry.name}
                 onChange={(event) => updateImportReviewEntry(entry.key, { name: event.target.value })}
                 className="mt-1 w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                />
               </label>
              ) : null}
             </div>

             {/* Organization — only for new clients */}
             {entry.existingClientId == null && entry.pendingEntryKey == null ? (
              <label className="mt-3 block text-sm text-fg-muted">
               <span className="block text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('client_organization')}</span>
               <select
                value={entry.organizationId ?? ''}
                onChange={(event) => {
                 if (event.target.value === '__create__') {
                  setOrgDialogTargetReviewKey(entry.key);
                  setOrganizationForm(emptyOrganizationForm());
                  setShowCreateOrgDialog(true);
                  return;
                 }
                 updateImportReviewEntry(entry.key, { organizationId: event.target.value === '' ? null : Number(event.target.value) });
                }}
                className="mt-1 w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
               >
                <option value="">{t('overview_no_organization')}</option>
                {organizations.map((organization) => (
                 <option
                  key={organization.id}
                  value={organization.id}
                 >
                  {organization.name}
                 </option>
                ))}
                <option value="__create__">{t('client_organization_create')}</option>
               </select>
              </label>
             ) : null}

             {/* Existing DB client — account selector (only when 2+ accounts) */}
             {entry.existingClientId != null
              ? (() => {
                 const accountsForClient = clientAccounts.filter((account) => account.clientId === entry.existingClientId);
                 if (!accountsForClient.length) {
                  return <p className="mt-2 text-xs text-warn-text">{t('import_review_existing_no_accounts')}</p>;
                 }
                 if (accountsForClient.length === 1) return null;
                 return (
                  <label className="mt-3 block text-sm text-fg-muted">
                   <span className="block text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('import_review_apply_account')}</span>
                   <select
                    value={entry.existingAccountId ?? ''}
                    onChange={(event) => updateImportReviewEntry(entry.key, { existingAccountId: event.target.value === '' ? null : Number(event.target.value) })}
                    className={`mt-1 w-full rounded border px-3 py-2 text-sm outline-none ring-blue-300 focus:ring bg-surface ${entry.existingAccountId == null ? 'border-red-400' : 'border-border-strong'}`}
                   >
                    <option value="">{t('import_review_select_account')}</option>
                    {accountsForClient.map((account) => (
                     <option
                      key={account.id}
                      value={account.id}
                     >
                      {account.currencyCode}
                      {account.currencySymbol ? ` (${account.currencySymbol})` : ''}
                     </option>
                    ))}
                   </select>
                  </label>
                 );
                })()
              : null}

             {/* Pending-entry reference — "post rows to" from the referenced entry's accounts */}
             {entry.pendingEntryKey != null
              ? (() => {
                 const refEntry = importReview!.find((e) => e.key === entry.pendingEntryKey);
                 const refCurrencies = (refEntry?.accountCurrencyIds ?? [])
                  .map((id) => enabledCurrencies.find((c) => c.id === id) ?? currencies.find((c) => c.id === id))
                  .filter(Boolean);
                 if (refCurrencies.length === 0) {
                  return <p className="mt-2 text-xs text-warn-text">{t('import_review_ref_no_accounts', { name: refEntry?.name || refEntry?.originalName || '' })}</p>;
                 }
                 if (refCurrencies.length === 1) return null;
                 return (
                  <label className="mt-3 block text-sm text-fg-muted">
                   <span className="block text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('import_review_post_to')}</span>
                   <select
                    value={entry.targetCurrencyId ?? ''}
                    onChange={(event) => updateImportReviewEntry(entry.key, { targetCurrencyId: event.target.value === '' ? null : Number(event.target.value) })}
                    className={`mt-1 w-full rounded border px-3 py-2 text-sm outline-none ring-blue-300 focus:ring bg-surface ${entry.targetCurrencyId == null ? 'border-red-400' : 'border-border-strong'}`}
                   >
                    <option value="">{t('import_review_select_account')}</option>
                    {refCurrencies.map(
                     (currency) =>
                      currency && (
                       <option
                        key={currency.id}
                        value={currency.id}
                       >
                        {currency.code}
                        {currency.symbol ? ` (${currency.symbol})` : ''}
                       </option>
                      ),
                    )}
                   </select>
                  </label>
                 );
                })()
              : null}

             {/* New client — accounts to open + which one to post rows to */}
             {entry.existingClientId == null && entry.pendingEntryKey == null ? (
              <div className="mt-3 space-y-2">
               <div>
                <span className="block text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('import_review_accounts_to_open')}</span>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                 {entry.accountCurrencyIds.length === 0 ? <span className="text-xs font-semibold text-bad-text">{t('import_review_accounts_required')}</span> : null}
                 {entry.accountCurrencyIds.map((currencyId) => {
                  const currency = enabledCurrencies.find((item) => item.id === currencyId) ?? currencies.find((item) => item.id === currencyId);
                  return (
                   <span
                    key={currencyId}
                    className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2.5 py-1 text-xs font-semibold text-fg-muted"
                   >
                    {currency ? currency.code : currencyId}
                    <button
                     type="button"
                     onClick={() => {
                      const next = entry.accountCurrencyIds.filter((id) => id !== currencyId);
                      updateImportReviewEntry(entry.key, {
                       accountCurrencyIds: next,
                       targetCurrencyId: entry.targetCurrencyId === currencyId ? (next[0] ?? null) : entry.targetCurrencyId,
                      });
                     }}
                     aria-label={t('close')}
                     className="text-fg-faint transition hover:text-fg-muted"
                    >
                     <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                     >
                      <path d="M18 6 6 18M6 6l12 12" />
                     </svg>
                    </button>
                   </span>
                  );
                 })}
                 {addableCurrencies.length ? (
                  <select
                   value=""
                   onChange={(event) => {
                    const currencyId = Number(event.target.value);
                    if (!currencyId) return;
                    updateImportReviewEntry(entry.key, {
                     accountCurrencyIds: [...entry.accountCurrencyIds, currencyId],
                     targetCurrencyId: entry.targetCurrencyId ?? currencyId,
                    });
                   }}
                   className="rounded-full border border-dashed border-border-strong bg-surface px-2.5 py-1 text-xs text-fg-muted outline-none ring-blue-300 focus:ring"
                  >
                   <option value="">{t('import_review_add_account')}</option>
                   {addableCurrencies.map((currency) => (
                    <option
                     key={currency.id}
                     value={currency.id}
                    >
                     {currency.code} - {currency.name}
                    </option>
                   ))}
                  </select>
                 ) : null}
                </div>
               </div>
               {entry.accountCurrencyIds.length >= 2 ? (
                <label className="block text-sm text-fg-muted">
                 <span className="block text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('import_review_post_to')}</span>
                 <select
                  value={entry.targetCurrencyId ?? ''}
                  onChange={(event) => updateImportReviewEntry(entry.key, { targetCurrencyId: event.target.value === '' ? null : Number(event.target.value) })}
                  className={`mt-1 w-full rounded border px-3 py-2 text-sm outline-none ring-blue-300 focus:ring bg-surface ${entry.targetCurrencyId == null ? 'border-red-400' : 'border-border-strong'}`}
                 >
                  <option value="">{t('import_review_select_account')}</option>
                  {entry.accountCurrencyIds.map((currencyId) => {
                   const currency = enabledCurrencies.find((c) => c.id === currencyId) ?? currencies.find((c) => c.id === currencyId);
                   return currency ? (
                    <option
                     key={currencyId}
                     value={currencyId}
                    >
                     {currency.code}
                     {currency.symbol ? ` (${currency.symbol})` : ''}
                    </option>
                   ) : null;
                  })}
                 </select>
                </label>
               ) : null}
              </div>
             ) : null}
            </>
           )}

           <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {entry.isExpense ? (
             <span className="rounded-full bg-warn-bg px-2 py-0.5 font-semibold text-warn-text">{t('import_review_badge_expense')}</span>
            ) : entry.existingClientId != null ? (
             <span className="rounded-full bg-surface-hover px-2 py-0.5 font-semibold text-fg-muted">{t('import_review_badge_existing')}</span>
            ) : entry.pendingEntryKey != null ? (
             <span className="rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-700">{t('import_review_badge_new_from_import')}</span>
            ) : (
             <span className="rounded-full bg-good-bg px-2 py-0.5 font-semibold text-good-text">{t('import_review_badge_new')}</span>
            )}
            <span className="text-fg-faint">{t('import_review_row_count', { count: entry.transactionCount })}</span>
           </div>
          </div>
         );
        })}
       </div>
      </div>

      {/* Live preview: count rows that will be skipped before the user clicks import */}
      {(() => {
       const normKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
       const reviewMap = new Map(importReview.map((e) => [e.key, e]));

       // Returns true if the entry will have an account to post rows to after setup.
       const willHaveAccount = (entry: ImportClientReview): boolean => {
        if (entry.existingClientId != null) {
         // Existing clients are never given new accounts automatically, so they
         // post only to a chosen account or one they already hold in the import currency.
         if (entry.existingAccountId != null) return true;
         if (importMapping.currencyId == null) return false;
         return clientAccounts.some((a) => a.clientId === entry.existingClientId && a.currencyId === importMapping.currencyId);
        }
        if (entry.pendingEntryKey != null) {
         const ref = reviewMap.get(entry.pendingEntryKey);
         if (!ref) return false;
         const tid = entry.targetCurrencyId ?? importMapping.currencyId ?? 0;
         return ref.accountCurrencyIds.includes(tid);
        }
        const tid = entry.targetCurrencyId ?? importMapping.currencyId ?? 0;
        return entry.accountCurrencyIds.includes(tid);
       };

       let skipCount = 0;
       const skipNames: string[] = [];
       importParsedRows.forEach((row, index) => {
        const fromEntry = reviewMap.get(normKey(row.fromName)) ?? null;
        const toEntry = reviewMap.get(normKey(row.toName)) ?? null;
        const fromIsExpense = !!fromEntry?.isExpense;
        const toIsExpense = !!toEntry?.isExpense;
        const override = importRowOverrides[index] ?? DEFAULT_IMPORT_ROW_OVERRIDE;
        const asExpense = (fromIsExpense || toIsExpense) && override.mode !== 'transaction';

        if (asExpense) {
         if (fromIsExpense && toIsExpense) return;
         const realEntry = fromIsExpense ? toEntry : fromEntry;
         if (!realEntry || !willHaveAccount(realEntry)) {
          skipCount += 1;
          if (realEntry && !skipNames.includes(realEntry.originalName)) skipNames.push(realEntry.originalName);
         }
        } else if (allowOneSided && (!fromEntry || !toEntry)) {
         // One-sided archive row: it posts only if the single named party has an account.
         const soleEntry = fromEntry ?? toEntry;
         if (soleEntry && !willHaveAccount(soleEntry)) {
          skipCount += 1;
          if (!skipNames.includes(soleEntry.originalName)) skipNames.push(soleEntry.originalName);
         }
        } else {
         if (!fromEntry || !toEntry) return;
         const sendEntry = override.swap ? toEntry : fromEntry;
         const receiveEntry = override.swap ? fromEntry : toEntry;
         let skip = false;
         if (!willHaveAccount(sendEntry)) {
          skip = true;
          if (!skipNames.includes(sendEntry.originalName)) skipNames.push(sendEntry.originalName);
         }
         if (!willHaveAccount(receiveEntry)) {
          skip = true;
          if (!skipNames.includes(receiveEntry.originalName)) skipNames.push(receiveEntry.originalName);
         }
         if (skip) skipCount += 1;
        }
       });

       if (skipCount === 0) return null;
       return (
        <div className="border-t border-amber-200 bg-warn-bg px-6 py-3 text-xs text-warn-text">
         <span className="font-semibold">{t('import_skip_count', { count: skipCount })}</span>
         {' — '}
         {t('import_skip_hint_pre')} <span className="font-medium">{skipNames.join(', ')}</span>. {t('import_skip_hint_post')}
        </div>
       );
      })()}

      <div className="flex flex-wrap justify-end gap-2 border-t border-border p-6">
       <button
        type="button"
        onClick={() => setImportReview(null)}
        disabled={isImportingTransactions}
        className="rounded border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
       >
        {t('import_back')}
       </button>
       <button
        type="button"
        onClick={() => void onConfirmImportTransactions()}
        disabled={
         isImportingTransactions ||
         importReview.some((entry) => !entry.isExpense && entry.existingClientId == null && entry.pendingEntryKey == null && !entry.name.trim()) ||
         importReview.some((entry) => !entry.isExpense && entry.existingClientId == null && entry.pendingEntryKey == null && entry.accountCurrencyIds.length === 0) ||
         importReview.some(
          (entry) => !entry.isExpense && entry.existingClientId == null && entry.pendingEntryKey == null && entry.accountCurrencyIds.length >= 2 && entry.targetCurrencyId == null,
         ) ||
         importReview.some(
          (entry) =>
           !entry.isExpense &&
           entry.pendingEntryKey != null &&
           entry.targetCurrencyId == null &&
           (importReview.find((e) => e.key === entry.pendingEntryKey)?.accountCurrencyIds.length ?? 0) >= 2,
         ) ||
         importReview.some(
          (entry) =>
           !entry.isExpense && entry.existingClientId != null && entry.existingAccountId == null && clientAccounts.filter((a) => a.clientId === entry.existingClientId).length >= 2,
         )
        }
        className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
       >
        {isImportingTransactions ? t('import_creating') : t('import_create_transactions')}
       </button>
      </div>
     </div>
    </div>
   ) : null}
  </>
 );
}
