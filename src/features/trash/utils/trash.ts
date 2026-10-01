import type { TrashBatch, TrashBatchKind, TrashRestoreResult, TrashTransactionRow } from '@/lib/accountingApi';
import type { WorkspaceRole } from '@/lib/accountingApi';

type Translate = (key: string, params?: Record<string, string | number>) => string;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Delete kinds a member may restore (their own single/bulk transaction deletes). */
const TRANSACTION_KINDS: TrashBatchKind[] = ['transaction', 'transactions'];
const CLIENT_KINDS: TrashBatchKind[] = ['client', 'client_account', 'all_clients'];

export type TrashFilter = 'all' | 'transactions' | 'clients';

/**
 * Whole days left before the 30-day purge removes a batch for good, rounded UP so a batch deleted
 * a moment ago reads "30 days" and one with hours to go reads "1 day" — 0 only once it's due.
 * `now` is the server's clock (TrashListResponse.serverNow), so a skewed client clock can't make
 * the countdown lie.
 */
export function daysRemaining(deletedAt: string, now: string | number | Date, retentionDays: number): number {
 const deleted = new Date(deletedAt).getTime();
 const current = new Date(now).getTime();
 if (!Number.isFinite(deleted) || !Number.isFinite(current)) return retentionDays;
 const remainingMs = deleted + retentionDays * DAY_MS - current;
 return Math.max(0, Math.ceil(remainingMs / DAY_MS));
}

export function isExpiringSoon(days: number): boolean {
 return days <= 3;
}

export function isTransactionKind(kind: TrashBatchKind): boolean {
 return TRANSACTION_KINDS.includes(kind);
}

export function filterBatches(batches: TrashBatch[], filter: TrashFilter): TrashBatch[] {
 if (filter === 'transactions') return batches.filter((batch) => batch.kind === 'all_transactions' || isTransactionKind(batch.kind));
 if (filter === 'clients') return batches.filter((batch) => CLIENT_KINDS.includes(batch.kind));
 return batches;
}

/** Mirrors the server rule in db.js's restoreTrash — the server stays the authority. */
export function canRestoreBatch(role: WorkspaceRole | null | undefined, userId: string | null | undefined, batch: Pick<TrashBatch, 'kind' | 'deletedBy'>): boolean {
 if (role === 'owner' || role === 'admin') return true;
 if (role !== 'member' || !userId) return false;
 return isTransactionKind(batch.kind) && batch.deletedBy === userId;
}

/** canRestoreBatch for one row of the Trash's transactions table — judged by the delete it came from. */
export function canRestoreTransaction(
 role: WorkspaceRole | null | undefined,
 userId: string | null | undefined,
 row: Pick<TrashTransactionRow, 'batchKind' | 'deletedBy'>,
): boolean {
 return canRestoreBatch(role, userId, { kind: row.batchKind, deletedBy: row.deletedBy });
}

/**
 * The Trash table's search: every whitespace-separated term must appear in the row's description,
 * either party (client or free-text counterparty), its currency, or its amount (typed with or
 * without thousands separators).
 */
export function searchTrashTransactions<T extends Pick<TrashTransactionRow, 'description' | 'clientFromName' | 'clientToName' | 'counterParty' | 'currencyCode' | 'amount'>>(
 rows: T[],
 search: string,
): T[] {
 const terms = search.toLowerCase().replace(/,/g, '').split(/\s+/).filter(Boolean);
 if (!terms.length) return rows;
 return rows.filter((row) => {
  const haystack = [row.description, row.clientFromName, row.clientToName, row.counterParty, row.currencyCode, String(row.amount)].join(' ').toLowerCase();
  return terms.every((term) => haystack.includes(term));
 });
}

/** Permanent deletion ("Delete permanently", "Empty Trash") is owner/admin only. */
export function canPurge(role: WorkspaceRole | null | undefined): boolean {
 return role === 'owner' || role === 'admin';
}

/** A one-line title for a Trash card, e.g. "Client: Ahmed" or "3 transactions". */
export function batchTitle(batch: Pick<TrashBatch, 'kind' | 'label' | 'counts'>, t: Translate): string {
 const { clients, accounts, transactions } = batch.counts;
 switch (batch.kind) {
  case 'transaction':
   return t('trash_kind_transaction');
  case 'transactions':
   return t('trash_kind_transactions', { count: transactions });
  case 'all_transactions':
   return t('trash_kind_all_transactions', { count: transactions });
  case 'client':
   return t('trash_kind_client', { name: batch.label });
  case 'client_account':
   return t('trash_kind_client_account', { name: batch.label });
  case 'all_clients':
   return t('trash_kind_all_clients', { count: clients || accounts });
  default:
   return batch.label;
 }
}

/**
 * What a restore had to leave behind, as one sentence — or '' when everything came back. Names
 * the clients to restore first, since that's the actionable part.
 */
export function describeBlockedRestore(result: Pick<TrashRestoreResult, 'blocked' | 'blockedCount'>, t: Translate): string {
 if (!result.blockedCount) return '';
 const accountExists = result.blocked.some((entry) => entry.reason === 'account_exists');
 const names = [...new Set(result.blocked.filter((entry) => entry.reason !== 'account_exists').map((entry) => entry.name).filter(Boolean))];
 const parts: string[] = [];
 if (names.length) parts.push(t('trash_blocked_restore_first', { count: result.blockedCount, names: names.join(', ') }));
 if (accountExists) parts.push(t('trash_blocked_account_exists'));
 return parts.join(' ') || t('trash_blocked_generic', { count: result.blockedCount });
}
