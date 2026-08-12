'use client';

import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { useRef } from 'react';
import { confirmDialog } from '@/components/ui/AppDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { useWorkspaceActions } from '@/features/workspace/hooks/useWorkspaceActions';
import { useClientsStore } from '@/features/clients/store/clientsStore';
import { useTransactionsStore } from '@/features/transactions/store/transactionsStore';
import { emptyClientForm, createNewClientAccountDraft } from '@/features/clients/forms';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { clientsOrgOrderStorageKey, notifySettingsChanged } from '@/shared/lib/localStorage';
import { nextCreatedAtForDate } from '@/shared/utils/createdAt';
import { localDateKey } from '@/shared/utils/date';
import { useReconciliationLocks } from '@/features/ledger/hooks/useReconciliationLocks';
import { NEW_ROW_REF_ID } from '@/features/ledger/utils/reconciliation';
import type { Client, ClientAccount, Currency, Reconciliation, Section, Transaction } from '@/shared/types';

type ClientsByOrganizationGroup = { id: number | null; clients: Client[] };

type UseClientActionsParams = {
 clients: Client[];
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 reconciliations: Reconciliation[];
 numLocale: string;
 selectedClientForAccounts: Client | null;
 setSelectedClientForAccounts: Dispatch<SetStateAction<Client | null>>;
 selectedClientForLedger: Client | null;
 setSelectedClientForLedger: Dispatch<SetStateAction<Client | null>>;
 setSelectedLedgerAccountId: Dispatch<SetStateAction<number | null>>;
 navigateToSection: (section: Section) => void;
 currencyMap: Map<number, Currency>;
 clientAccountMap: Map<number, ClientAccount & { clientName?: string }>;
 clientsByOrganization: ClientsByOrganizationGroup[];
 lockPastEditsEnabled: boolean;
};

/**
 * Client CRUD, client-account CRUD (add/edit/move/write-off), and the
 * organization-group drag reorder on the clients list. Grouped together since
 * they all revolve around clientsStore + the client/account arrays.
 */
export function useClientActions({
 clients,
 clientAccounts,
 transactions,
 reconciliations,
 numLocale,
 selectedClientForAccounts,
 setSelectedClientForAccounts,
 selectedClientForLedger,
 setSelectedClientForLedger,
 setSelectedLedgerAccountId,
 navigateToSection,
 currencyMap,
 clientAccountMap,
 clientsByOrganization,
 lockPastEditsEnabled,
}: UseClientActionsParams) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { invalidate: loadData, setters, setError } = useWorkspaceActions();
 const setClientAccounts = setters.setClientAccounts as Dispatch<SetStateAction<ClientAccount[]>>;
 const showToast = useAppStatusStore((s) => s.showToast);
 const clientSubmitLock = useRef(false);
 const { confirmIfLocked, blockedByPastEditLock } = useReconciliationLocks({ reconciliations, clientAccountMap, lockPastEditsEnabled });

 const clientForm = useClientsStore((s) => s.clientForm);
 const setClientForm = useClientsStore((s) => s.setClientForm);
 const openAccountOnCreate = useClientsStore((s) => s.openAccountOnCreate);
 const setOpenAccountOnCreate = useClientsStore((s) => s.setOpenAccountOnCreate);
 const newClientAccountDrafts = useClientsStore((s) => s.newClientAccountDrafts);
 const setNewClientAccountDrafts = useClientsStore((s) => s.setNewClientAccountDrafts);
 const setIsSubmittingClient = useClientsStore((s) => s.setIsSubmittingClient);
 const newAccountCurrencyId = useClientsStore((s) => s.newAccountCurrencyId);
 const setNewAccountCurrencyId = useClientsStore((s) => s.setNewAccountCurrencyId);
 const newAccountStartingBalance = useClientsStore((s) => s.newAccountStartingBalance);
 const setNewAccountStartingBalance = useClientsStore((s) => s.setNewAccountStartingBalance);
 const newAccountBalanceType = useClientsStore((s) => s.newAccountBalanceType);
 const setNewAccountBalanceType = useClientsStore((s) => s.setNewAccountBalanceType);
 const setShowAddAccountForm = useClientsStore((s) => s.setShowAddAccountForm);
 const editingAccountId = useClientsStore((s) => s.editingAccountId);
 const setEditingAccountId = useClientsStore((s) => s.setEditingAccountId);
 const editingAccountCurrencyId = useClientsStore((s) => s.editingAccountCurrencyId);
 const editingAccountBalance = useClientsStore((s) => s.editingAccountBalance);
 const editingAccountBalanceType = useClientsStore((s) => s.editingAccountBalanceType);
 const moveTargetAccountId = useClientsStore((s) => s.moveTargetAccountId);
 const setMoveTargetAccountId = useClientsStore((s) => s.setMoveTargetAccountId);
 const setIsMovingAccount = useClientsStore((s) => s.setIsMovingAccount);
 const draggedOrgKey = useClientsStore((s) => s.draggedOrgKey);
 const setDraggedOrgKey = useClientsStore((s) => s.setDraggedOrgKey);
 const setDragOverOrgKey = useClientsStore((s) => s.setDragOverOrgKey);
 const setClientsOrgOrder = useClientsStore((s) => s.setClientsOrgOrder);
 const setSelectedTransactionIds = useTransactionsStore((s) => s.setSelectedTransactionIds);
 const setTransactionTableDrafts = useTransactionsStore((s) => s.setTransactionTableDrafts);
 const setCommissionExpandedTxns = useTransactionsStore((s) => s.setCommissionExpandedTxns);
 const setExpensesExpandedTxns = useTransactionsStore((s) => s.setExpensesExpandedTxns);

async function onClientSubmit(event: FormEvent<HTMLFormElement>) {
 event.preventDefault();
 // Guard against a rapid double-submit creating a duplicate (button disabled may not have
 // re-rendered yet). Cleared in the finally below.
 if (clientSubmitLock.current) return;
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 if (!clientForm.name.trim()) {
  setError(t('client_required'));
  return;
 }

 // Reject a name already used by another client (case/whitespace-insensitive).
 const nameKey = clientForm.name.trim().replace(/\s+/g, ' ').toLowerCase();
 const duplicateName = clients.some((client) => client.id !== clientForm.id && client.name.trim().replace(/\s+/g, ' ').toLowerCase() === nameKey);
 if (duplicateName) {
  setError(t('client_name_duplicate'));
  return;
 }

 if (!clientForm.id && openAccountOnCreate) {
  if (!newClientAccountDrafts.length || newClientAccountDrafts.some((draft) => !draft.currencyId)) {
   setError(t('client_account_currency_placeholder'));
   return;
  }

  const selectedCurrencyIds = newClientAccountDrafts.map((draft) => draft.currencyId).filter((currencyId): currencyId is number => Boolean(currencyId));
  if (new Set(selectedCurrencyIds).size !== selectedCurrencyIds.length) {
   setError('Choose a different currency for each account.');
   return;
  }
 }

 clientSubmitLock.current = true;
 setIsSubmittingClient(true);
 try {
  if (clientForm.id) {
   await accountingApi.updateClient(clientForm);
  } else {
   const created = await accountingApi.createClient(clientForm);
   if (openAccountOnCreate) {
    for (const draft of newClientAccountDrafts) {
     if (!draft.currencyId) {
      continue;
     }

     await accountingApi.createClientAccount({
      clientId: created.clientId,
      currencyId: draft.currencyId,
      startingBalance: (() => {
       const abs = Math.abs(parseFloat(draft.startingBalance.replace(/,/g, '')) || 0);
       return draft.balanceType === 'debit' ? -abs : abs;
      })(),
     });
    }
   }
  }

  const wasCreate = !clientForm.id;
  setClientForm(emptyClientForm());
  setOpenAccountOnCreate(true);
  setNewClientAccountDrafts([createNewClientAccountDraft()]);
  setError('');
  if (wasCreate) showToast(t('toast_client_created'));
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_update'));
 } finally {
  clientSubmitLock.current = false;
  setIsSubmittingClient(false);
 }
}

async function onDeleteClient(id: number) {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 if (!(await confirmDialog({ message: t('client_delete_confirm'), confirmText: t('delete'), tone: 'danger' }))) {
  return;
 }

 try {
  await accountingApi.deleteClient(id);
  if (clientForm.id === id) {
   setClientForm(emptyClientForm());
  }
  if (selectedClientForAccounts?.id === id) {
   setSelectedClientForAccounts(null);
  }
  if (selectedClientForLedger?.id === id) {
   setSelectedClientForLedger(null);
   navigateToSection('clients');
  }
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_delete'));
 }
}

async function onDeleteAllClients() {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 if (!clients.length) {
  setError(t('no_clients'));
  return;
 }

 const firstConfirm = await confirmDialog({
  title: t('danger_action_cannot_undo'),
  message: t('danger_delete_all_clients_confirm'),
  confirmText: t('delete'),
  tone: 'danger',
 });
 if (!firstConfirm) {
  return;
 }

 try {
  await accountingApi.deleteAllClients();
  setClientForm(emptyClientForm());
  setSelectedClientForAccounts(null);
  setSelectedClientForLedger(null);
  setSelectedLedgerAccountId(null);
  setSelectedTransactionIds(new Set());
  setTransactionTableDrafts({});
  setCommissionExpandedTxns(new Set());
  setExpensesExpandedTxns(new Set());
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_delete'));
 }
}

// dateKey lets a caller pin the write-off to a specific day instead of today — the client
// ledger's per-row write-off passes that row's own date so the adjustment lands right after it
// (same day) instead of jumping to the bottom of the ledger under today's date.
async function onWriteOffBalance(accountId: number, balance: number, dateKey: string = localDateKey()) {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 const amount = Math.abs(balance);
 if (amount <= 0) return;

 const account = clientAccounts.find((a) => a.id === accountId);
 const client = account ? clients.find((c) => c.id === account.clientId) : undefined;
 if (!account || !client) return;

 const confirmed = await confirmDialog({
  title: t('write_off_confirm_title'),
  message: t('write_off_confirm_message')
   .replace('{amount}', amount.toLocaleString(numLocale, { maximumFractionDigits: 2 }))
   .replace('{currency}', account.currencySymbol || account.currencyCode)
   .replace('{name}', client.name),
  confirmText: t('write_off_confirm_button'),
  tone: 'danger',
 });
 if (!confirmed) return;

 // balance > 0 means this account is owed money — a write-off must move the balance DOWN
 // toward zero, i.e. net negatively, which is the "to" side's sign (see
 // computeTransactionSideNetChange); balance < 0 is the mirror "from" side case.
 const accountFromId = balance > 0 ? null : accountId;
 const accountToId = balance > 0 ? accountId : null;
 const createdAt = nextCreatedAtForDate(dateKey, transactions);

 if (blockedByPastEditLock([createdAt])) return;
 // Reconciliation guard: a write-off creates a new row, same as any other create path — one
 // dated at or before a lock line rewrites reconciled history. This was previously the one
 // create path in the app with no lock-aware warning at all.
 if (!(await confirmIfLocked([accountFromId, accountToId], createdAt, NEW_ROW_REF_ID))) return;

 try {
  await accountingApi.createTransaction({
   accountFromId,
   accountToId,
   acknowledgeReconciliationOverride: true,
   currencyId: account.currencyId,
   amount,
   type: 'adjustment',
   isArchived: false,
   exchangeRateFrom: 1,
   commissionFrom: 0,
   exchangeRateTo: 1,
   commissionTo: 0,
   exchangeRateFromReversed: false,
   exchangeRateToReversed: false,
   charges: 0,
   chargesCurrencyId: null,
   chargesPayer: '',
   chargesExchangeRate: 1,
   chargesDescription: '',
   description: t('write_off_description'),
   descriptionFrom: '',
   descriptionTo: '',
   exchangeActualAmount: null,
   archiveNote: '',
   counterParty: '',
   distributionLocationId: null,
   createdAt,
  });
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 }
}

async function onAddClientAccount(clientId: number) {
 if (!accountingApi || !newAccountCurrencyId) return;
 try {
  const abs = Math.abs(parseFloat(newAccountStartingBalance.replace(/,/g, '')) || 0);
  const startingBalance = newAccountBalanceType === 'debit' ? -abs : abs;
  await accountingApi.createClientAccount({ clientId, currencyId: newAccountCurrencyId, startingBalance });
  setNewAccountCurrencyId(null);
  setNewAccountStartingBalance('0');
  setNewAccountBalanceType('debit');
  setShowAddAccountForm(false);
  await loadData();
  // Re-sync selectedClientForAccounts with updated client data
  setSelectedClientForAccounts((prev) => (prev ? { ...prev } : null));
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 }
}

async function onSaveEditAccount() {
 if (!accountingApi || !editingAccountId || !editingAccountCurrencyId) return;
 const accountId = editingAccountId;
 const currencyId = editingAccountCurrencyId;
 try {
  const abs = Math.abs(parseFloat(editingAccountBalance.replace(/,/g, '')) || 0);
  const startingBalance = editingAccountBalanceType === 'debit' ? -abs : abs;
  await accountingApi.updateClientAccount({ accountId, currencyId, startingBalance });
  setEditingAccountId(null);
  const currency = currencyMap.get(currencyId);
  setClientAccounts((prev) =>
   prev.map((account) =>
    account.id === accountId
     ? { ...account, currencyId, startingBalance, currencyCode: currency?.code ?? account.currencyCode, currencySymbol: currency?.symbol ?? account.currencySymbol }
     : account,
   ),
  );
  void loadData();
  setSelectedClientForAccounts((prev) => (prev ? { ...prev } : null));
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 }
}

async function onDeleteClientAccount(accountId: number) {
 if (!accountingApi) return;
 if (!(await confirmDialog({ message: t('client_account_delete_confirm'), confirmText: t('delete'), tone: 'danger' }))) return;
 try {
  await accountingApi.deleteClientAccount(accountId);
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_delete'));
 }
}

async function onMoveAccountTransactions(fromAccountId: number) {
 if (!accountingApi || !moveTargetAccountId || moveTargetAccountId === fromAccountId) return;
 const target = clientAccountMap.get(moveTargetAccountId);
 const targetLabel = target ? `${target.clientName} · ${target.currencyCode}` : '';
 if (!(await confirmDialog({ message: t('client_account_move_confirm', { target: targetLabel }), confirmText: t('client_account_move_action') }))) return;
 setIsMovingAccount(true);
 try {
  await accountingApi.moveAccountTransactions({ fromAccountId, toAccountId: moveTargetAccountId });
  setMoveTargetAccountId(null);
  setEditingAccountId(null);
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 } finally {
  setIsMovingAccount(false);
 }
}

async function onUpdateAccountStartingBalance(accountId: number, value: string) {
 if (!accountingApi) return;
 const startingBalance = parseFloat(value) || 0;
 try {
  await accountingApi.updateClientAccountStartingBalance({ accountId, startingBalance });
  setClientAccounts((prev) => prev.map((account) => (account.id === accountId ? { ...account, startingBalance } : account)));
  void loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 }
}

function onClientsOrgDrop(targetKey: string) {
 const dragged = draggedOrgKey;
 setDraggedOrgKey(null);
 setDragOverOrgKey(null);
 if (!dragged || dragged === targetKey) return;
 const keys = clientsByOrganization.map((group) => (group.id == null ? '__unassigned__' : String(group.id)));
 const from = keys.indexOf(dragged);
 const to = keys.indexOf(targetKey);
 if (from === -1 || to === -1) return;
 const next = [...keys];
 next.splice(from, 1);
 next.splice(to, 0, dragged);
 setClientsOrgOrder(next);
 if (typeof window !== 'undefined') {
  window.localStorage.setItem(clientsOrgOrderStorageKey, JSON.stringify(next));
  notifySettingsChanged();
 }
}

 return {
  onClientSubmit,
  onDeleteClient,
  onDeleteAllClients,
  onWriteOffBalance,
  onAddClientAccount,
  onSaveEditAccount,
  onDeleteClientAccount,
  onMoveAccountTransactions,
  onUpdateAccountStartingBalance,
  onClientsOrgDrop,
 };
}
