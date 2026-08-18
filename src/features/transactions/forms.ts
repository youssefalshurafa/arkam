import type { ArchiveEntryForm, TransactionForm } from '@/shared/types';

export const emptyTransactionForm = (): TransactionForm => ({
 accountFromId: null,
 accountToId: null,
 currencyId: null,
 amount: '',
 type: 'transfer',
 exchangeRateFrom: '1.00',
 commissionFrom: '',
 exchangeRateTo: '1.00',
 commissionTo: '',
 charges: '0',
 chargesCurrencyId: null,
 chargesPayer: '',
 chargesExchangeRate: '1.00',
 chargesDescription: '',
 charges2: '0',
 charges2CurrencyId: null,
 chargesPayer2: '',
 charges2ExchangeRate: '1.00',
 charges2Description: '',
 description: '',
 descriptionFrom: '',
 descriptionTo: '',
 exchangeActualAmount: '',
 distributionLocationId: null,
 counterParty: '',
 archiveNote: '',
});

export const emptyArchiveEntryForm = (): ArchiveEntryForm => ({
 accountFromId: null,
 accountToId: null,
 currencyId: null,
 amount: '',
 description: '',
 archiveNote: '',
});
