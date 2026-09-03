'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi, type TransactionHistoryResponse } from '@/lib/accountingApi';
import { queryKeys } from '@/lib/queryClient';
import { formatDateValue } from '@/shared/utils/date';
import type { ClientAccount, Currency, PdfSettings, Transaction } from '@/shared/types';

/**
 * The audit trail for one transaction: who created it, and every recorded change since.
 *
 * Its own component (rather than markup inside TransactionDetailsModal) for two reasons: the
 * modal returns early before this data would ever be needed, so a hook there would break the
 * rules of hooks; and the query is `enabled` only once the user expands the section, so
 * opening a transaction's details costs nothing extra until someone actually asks who touched
 * it.
 */

type TrackedField = {
 // Key in the history snapshot, which holds the raw DB row (snake_case).
 column: string;
 // Matching key on the live Transaction (camelCase), needed to diff the newest entry against
 // the row as it stands today.
 field: keyof Transaction;
 labelKey: string;
 kind?: 'account' | 'currency';
};

// The fields worth surfacing. A snapshot holds the whole row, but listing all ~30 raw columns
// would bury the signal — these are the ones that change what the transaction MEANS: the
// money, the parties, and the text identifying it.
const TRACKED_FIELDS: TrackedField[] = [
 { column: 'amount', field: 'amount', labelKey: 'amount' },
 { column: 'account_from_id', field: 'accountFromId', labelKey: 'transaction_account_from', kind: 'account' },
 { column: 'account_to_id', field: 'accountToId', labelKey: 'transaction_account_to', kind: 'account' },
 { column: 'currency_id', field: 'currencyId', labelKey: 'currency', kind: 'currency' },
 { column: 'exchange_rate_from', field: 'exchangeRateFrom', labelKey: 'exchange_rate' },
 { column: 'commission_from', field: 'commissionFrom', labelKey: 'commission' },
 { column: 'exchange_rate_to', field: 'exchangeRateTo', labelKey: 'exchange_rate' },
 { column: 'commission_to', field: 'commissionTo', labelKey: 'commission' },
 { column: 'charges', field: 'charges', labelKey: 'charges' },
 { column: 'description', field: 'description', labelKey: 'transaction_description' },
 { column: 'counter_party', field: 'counterParty', labelKey: 'counterparty' },
 { column: 'created_at', field: 'createdAt', labelKey: 'date' },
];

type Props = {
 transaction: Transaction;
 clientAccounts: ClientAccount[];
 currencies: Currency[];
 dateFormat: PdfSettings['dateFormat'];
};

export default function TransactionHistorySection({ transaction, clientAccounts, currencies, dateFormat }: Props) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const [expanded, setExpanded] = useState(false);

 const { data, isPending, isError } = useQuery<TransactionHistoryResponse>({
  queryKey: queryKeys.transactionHistory(transaction.id),
  queryFn: () => accountingApi.listTransactionHistory(transaction.id),
  enabled: expanded,
 });

 // An id missing from `users` belongs to a login that has since been deleted — the audit
 // columns are deliberately not foreign keys so the record outlives the account. Render that
 // as unknown rather than inventing a name.
 const nameFor = (userId: string | null | undefined) => (userId && data?.users[userId]?.name) || t('audit_unknown_user');

 // Raw ids mean nothing to a reader, so resolve the two id-valued fields to the names the
 // rest of the app shows. An id that no longer resolves (the account or currency was deleted
 // since) falls back to the id itself rather than vanishing.
 const readable = (value: unknown, kind: TrackedField['kind']): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (kind === 'account') {
   const account = clientAccounts.find((candidate) => candidate.id === Number(value));
   return account ? `${account.clientName} (${account.currencyCode})` : String(value);
  }
  if (kind === 'currency') {
   return currencies.find((candidate) => candidate.id === Number(value))?.code ?? String(value);
  }
  if (kind === undefined && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
   return formatDateValue(value, dateFormat);
  }
  return String(value);
 };

 return (
  <div className="mt-3 rounded border border-border bg-surface-2 px-3 py-2">
   <button type="button" onClick={() => setExpanded((prev) => !prev)} className="flex w-full items-center justify-between gap-2 py-1 text-start">
    <span className="text-xs font-medium uppercase tracking-wide text-fg-faint">{t('audit_history')}</span>
    <span className="text-xs text-fg-muted">{expanded ? '▲' : '▼'}</span>
   </button>

   {expanded ? (
    <div className="pb-1 pt-2 text-sm">
     {isPending ? <p className="text-fg-muted">{t('loading')}</p> : null}
     {isError ? <p className="text-bad-text">{t('error_failed_load')}</p> : null}

     {data ? (
      <div className="flex flex-col gap-3">
       <p className="text-fg-muted">
        {t('audit_created_by', {
         user: nameFor(data.current?.createdBy),
         date: formatDateValue(data.current?.createdAt ?? transaction.createdAt, dateFormat),
        })}
       </p>

       {data.history.length === 0 ? (
        <p className="text-fg-faint">{t('audit_no_changes')}</p>
       ) : (
        <ul className="flex flex-col gap-2">
         {data.history.map((entry, index) => {
          // Each snapshot is the row BEFORE that change, so what it was changed TO lives in
          // the next-newer snapshot — or, for the newest entry, in the transaction as it
          // stands right now. `history` is ordered newest-first, so index-1 is newer.
          const after: Record<string, unknown> | null =
           index === 0 ? Object.fromEntries(TRACKED_FIELDS.map(({ column, field }) => [column, transaction[field]])) : data.history[index - 1].snapshot;

          // Compare the RENDERED values, not the raw ones. A timestamp displayed at day
          // granularity can differ underneath while looking identical on screen, and listing
          // "date: 2026-08-29 → 2026-08-29" as a change is worse than not listing it: it
          // claims an edit the reader cannot see. If a difference isn't visible at the
          // precision shown, it isn't reported.
          const changes = TRACKED_FIELDS.map(({ column, labelKey, kind }) => ({
           key: column,
           label: t(labelKey),
           before: readable(entry.snapshot[column], kind),
           after: readable(after?.[column], kind),
          })).filter((change) => change.before !== change.after);

          return (
           <li key={entry.id} className="rounded border border-border bg-surface px-3 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
             <span className={`text-xs font-semibold ${entry.action === 'delete' ? 'text-bad-text' : 'text-fg'}`}>
              {entry.action === 'delete' ? t('audit_action_delete') : t('audit_action_update')}
             </span>
             <span className="text-xs text-fg-faint">
              {nameFor(entry.changedBy)} · {formatDateValue(entry.changedAt, dateFormat)}
             </span>
            </div>

            {entry.action === 'delete' ? null : changes.length > 0 ? (
             <ul className="mt-1 flex flex-col gap-0.5">
              {changes.map((change) => (
               <li key={change.key} className="text-xs text-fg-muted">
                <span className="text-fg-faint">{change.label}:</span> <span className="line-through">{change.before}</span> → <span className="text-fg">{change.after}</span>
               </li>
              ))}
             </ul>
            ) : (
             // The edit only touched fields outside TRACKED_FIELDS (a per-side description
             // override, an archive note…). Say so rather than render an empty entry.
             <p className="mt-1 text-xs text-fg-faint">{t('audit_other_changes')}</p>
            )}
           </li>
          );
         })}
        </ul>
       )}
      </div>
     ) : null}
    </div>
   ) : null}
  </div>
 );
}
