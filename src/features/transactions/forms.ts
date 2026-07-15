import type { TransactionForm } from '@/shared/types';

export const emptyTransactionForm = (): TransactionForm => ({
 accountFromId: null,
 accountToId: null,
 currencyId: null,
 amount: '',
 type: 'transfer',
 adjustmentDirection: 'debit',
 exchangeRateFrom: '1.00',
 commissionFrom: '',
 exchangeRateTo: '1.00',
 commissionTo: '',
 charges: '0',
 chargesCurrencyId: null,
 chargesPayer: '',
 chargesExchangeRate: '1.00',
 chargesDescription: '',
 description: '',
 descriptionFrom: '',
 descriptionTo: '',
 exchangeActualAmount: '',
});
