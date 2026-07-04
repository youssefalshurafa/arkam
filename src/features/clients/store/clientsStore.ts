import { create } from 'zustand';
import type { Dispatch, SetStateAction } from 'react';
import { getStoredClientsOrgOrder } from '@/shared/lib/localStorage';
import type { ClientForm, NewClientAccountDraft } from '@/shared/types';
import { emptyClientForm, createNewClientAccountDraft } from '@/features/clients/forms';

/**
 * UI state for the Clients feature (per browser): the create/edit client form,
 * list search/sort/pagination/grouping + drag order, and the client-account
 * editor's sub-state (add/edit/move). Migrated out of the page component so the
 * (large) Clients view can later read it directly instead of via ~50 props.
 *
 * Setters are setState-compatible so the existing call sites (many use functional
 * updaters) keep working unchanged after swapping useState -> store selectors.
 */
type ClientSort = { key: 'name' | 'organization'; dir: 'asc' | 'desc' };
type BalanceType = 'debit' | 'credit';

type ClientsStore = {
 clientForm: ClientForm;
 setClientForm: Dispatch<SetStateAction<ClientForm>>;
 isSubmittingClient: boolean;
 setIsSubmittingClient: Dispatch<SetStateAction<boolean>>;
 clientSearch: string;
 setClientSearch: Dispatch<SetStateAction<string>>;
 clientSort: ClientSort;
 setClientSort: Dispatch<SetStateAction<ClientSort>>;
 clientsPage: number;
 setClientsPage: Dispatch<SetStateAction<number>>;
 clientsPageSize: number;
 setClientsPageSize: Dispatch<SetStateAction<number>>;
 clientsGroupByOrg: boolean;
 setClientsGroupByOrg: Dispatch<SetStateAction<boolean>>;
 clientsOrgOrder: string[];
 setClientsOrgOrder: Dispatch<SetStateAction<string[]>>;
 draggedOrgKey: string | null;
 setDraggedOrgKey: Dispatch<SetStateAction<string | null>>;
 dragOverOrgKey: string | null;
 setDragOverOrgKey: Dispatch<SetStateAction<string | null>>;
 openAccountOnCreate: boolean;
 setOpenAccountOnCreate: Dispatch<SetStateAction<boolean>>;
 newClientAccountDrafts: NewClientAccountDraft[];
 setNewClientAccountDrafts: Dispatch<SetStateAction<NewClientAccountDraft[]>>;
 newAccountCurrencyId: number | null;
 setNewAccountCurrencyId: Dispatch<SetStateAction<number | null>>;
 newAccountStartingBalance: string;
 setNewAccountStartingBalance: Dispatch<SetStateAction<string>>;
 newAccountBalanceType: BalanceType;
 setNewAccountBalanceType: Dispatch<SetStateAction<BalanceType>>;
 showAddAccountForm: boolean;
 setShowAddAccountForm: Dispatch<SetStateAction<boolean>>;
 editingAccountId: number | null;
 setEditingAccountId: Dispatch<SetStateAction<number | null>>;
 editingAccountCurrencyId: number | null;
 setEditingAccountCurrencyId: Dispatch<SetStateAction<number | null>>;
 editingAccountBalance: string;
 setEditingAccountBalance: Dispatch<SetStateAction<string>>;
 editingAccountBalanceType: BalanceType;
 setEditingAccountBalanceType: Dispatch<SetStateAction<BalanceType>>;
 moveTargetAccountId: number | null;
 setMoveTargetAccountId: Dispatch<SetStateAction<number | null>>;
 isMovingAccount: boolean;
 setIsMovingAccount: Dispatch<SetStateAction<boolean>>;
};

export const useClientsStore = create<ClientsStore>((set) => {
 // Builds a setState-compatible setter for one field.
 const setter =
  <K extends keyof ClientsStore>(key: K) =>
  (updater: SetStateAction<ClientsStore[K]>) =>
   set((s) => ({ [key]: typeof updater === 'function' ? (updater as (v: ClientsStore[K]) => ClientsStore[K])(s[key]) : updater } as Pick<ClientsStore, K>));

 return {
  clientForm: emptyClientForm(),
  setClientForm: setter('clientForm'),
  isSubmittingClient: false,
  setIsSubmittingClient: setter('isSubmittingClient'),
  clientSearch: '',
  setClientSearch: setter('clientSearch'),
  clientSort: { key: 'name', dir: 'asc' },
  setClientSort: setter('clientSort'),
  clientsPage: 1,
  setClientsPage: setter('clientsPage'),
  clientsPageSize: 25,
  setClientsPageSize: setter('clientsPageSize'),
  clientsGroupByOrg: true,
  setClientsGroupByOrg: setter('clientsGroupByOrg'),
  clientsOrgOrder: getStoredClientsOrgOrder(),
  setClientsOrgOrder: setter('clientsOrgOrder'),
  draggedOrgKey: null,
  setDraggedOrgKey: setter('draggedOrgKey'),
  dragOverOrgKey: null,
  setDragOverOrgKey: setter('dragOverOrgKey'),
  openAccountOnCreate: true,
  setOpenAccountOnCreate: setter('openAccountOnCreate'),
  newClientAccountDrafts: [createNewClientAccountDraft()],
  setNewClientAccountDrafts: setter('newClientAccountDrafts'),
  newAccountCurrencyId: null,
  setNewAccountCurrencyId: setter('newAccountCurrencyId'),
  newAccountStartingBalance: '0',
  setNewAccountStartingBalance: setter('newAccountStartingBalance'),
  newAccountBalanceType: 'debit',
  setNewAccountBalanceType: setter('newAccountBalanceType'),
  showAddAccountForm: false,
  setShowAddAccountForm: setter('showAddAccountForm'),
  editingAccountId: null,
  setEditingAccountId: setter('editingAccountId'),
  editingAccountCurrencyId: null,
  setEditingAccountCurrencyId: setter('editingAccountCurrencyId'),
  editingAccountBalance: '0',
  setEditingAccountBalance: setter('editingAccountBalance'),
  editingAccountBalanceType: 'debit',
  setEditingAccountBalanceType: setter('editingAccountBalanceType'),
  moveTargetAccountId: null,
  setMoveTargetAccountId: setter('moveTargetAccountId'),
  isMovingAccount: false,
  setIsMovingAccount: setter('isMovingAccount'),
 };
});
