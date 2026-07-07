import type { ClientForm, NewClientAccountDraft } from '@/shared/types';

export const emptyClientForm = (): ClientForm => ({
 organizationId: null,
 name: '',
 email: '',
 phone: '',
 address: '',
 excludeFromBalance: false,
});

export const createNewClientAccountDraft = (): NewClientAccountDraft => ({
 currencyId: null,
 startingBalance: '0',
 balanceType: 'debit',
});
