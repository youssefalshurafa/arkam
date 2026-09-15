import type { ClientAccount, Currency, Transaction } from '@/shared/types';

/**
 * The payload shape every create path sends. Optional fields are the ones only some of them
 * carry — the archive form has no charges slots, the one-sided modal no split descriptions.
 */
export type TransactionCreateInput = {
 accountFromId: number | null;
 accountToId: number | null;
 currencyId: number | null;
 amount: number;
 type: string;
 isArchived?: boolean;
 exchangeRateFrom: number;
 commissionFrom: number;
 exchangeRateTo: number;
 commissionTo: number;
 // The form sends 0/1, the one-sided modal sends a boolean; the stored column is numeric.
 exchangeRateFromReversed: number | boolean;
 exchangeRateToReversed: number | boolean;
 charges: number;
 chargesCurrencyId: number | null;
 chargesPayer: string;
 chargesExchangeRate: number;
 chargesDescription: string;
 charges2?: number;
 charges2CurrencyId?: number | null;
 chargesPayer2?: string;
 charges2ExchangeRate?: number;
 charges2Description?: string;
 description: string;
 descriptionFrom?: string;
 descriptionTo?: string;
 exchangeActualAmount?: number | null;
 archiveNote?: string;
 counterParty?: string;
 distributionLocationId: number | null;
 createdAt: string;
};

/**
 * The row a create puts on screen before the server has answered.
 *
 * This is what the user looks at for the moment between pressing save and the reconciling
 * refetch, so it has to land exactly where the server will — derived display fields resolved the
 * same way, free text trimmed the same way. Anything it gets wrong is visible until that refetch
 * and reads as the save having changed something nobody typed. The normalizations mirror
 * applyTransactionPatch (useTransactionPatchers.ts), which in turn mirrors db.js.
 *
 * `id` is a temporary id while the create is in flight (see pendingTransactionWrites) and is
 * swapped for the real one when it lands.
 */
export function buildOptimisticTransactionRow(
 input: TransactionCreateInput,
 id: number,
 clientAccountMap: Map<number, ClientAccount & { clientName?: string }>,
 currencyMap: Map<number, Currency>,
): Transaction {
 const fromAccount = input.accountFromId != null ? clientAccountMap.get(input.accountFromId) : undefined;
 const toAccount = input.accountToId != null ? clientAccountMap.get(input.accountToId) : undefined;
 const currency = input.currencyId != null ? currencyMap.get(input.currencyId) : undefined;
 const chargesCurrency = input.chargesCurrencyId != null ? currencyMap.get(input.chargesCurrencyId) : null;
 const charges2Currency = input.charges2CurrencyId != null ? currencyMap.get(input.charges2CurrencyId) : null;
 const trimmed = (value: string | null | undefined) => (value ?? '').trim();

 return {
  id,
  accountFromId: input.accountFromId,
  clientFromName: fromAccount?.clientName ?? '',
  accountFromCurrencyCode: fromAccount?.currencyCode ?? '',
  accountFromCurrencySymbol: fromAccount?.currencySymbol ?? '',
  accountToId: input.accountToId,
  clientToName: toAccount?.clientName ?? '',
  accountToCurrencyCode: toAccount?.currencyCode ?? '',
  accountToCurrencySymbol: toAccount?.currencySymbol ?? '',
  currencyId: input.currencyId ?? 0,
  currencyCode: currency?.code ?? '',
  currencySymbol: currency?.symbol ?? '',
  amount: input.amount,
  type: input.type,
  exchangeRateFrom: input.exchangeRateFrom,
  commissionFrom: input.commissionFrom,
  exchangeRateTo: input.exchangeRateTo,
  commissionTo: input.commissionTo,
  exchangeRateFromReversed: Number(input.exchangeRateFromReversed),
  exchangeRateToReversed: Number(input.exchangeRateToReversed),
  charges: input.charges,
  chargesCurrencyId: input.chargesCurrencyId,
  chargesCurrencyCode: chargesCurrency?.code ?? null,
  chargesCurrencySymbol: chargesCurrency?.symbol ?? null,
  chargesPayer: input.chargesPayer,
  chargesExchangeRate: input.chargesExchangeRate,
  chargesDescription: trimmed(input.chargesDescription),
  charges2: input.charges2 ?? 0,
  charges2CurrencyId: input.charges2CurrencyId ?? null,
  charges2CurrencyCode: charges2Currency?.code ?? null,
  charges2CurrencySymbol: charges2Currency?.symbol ?? null,
  chargesPayer2: input.chargesPayer2 ?? '',
  charges2ExchangeRate: input.charges2ExchangeRate ?? 1,
  charges2Description: trimmed(input.charges2Description),
  description: trimmed(input.description),
  descriptionFrom: trimmed(input.descriptionFrom),
  descriptionTo: trimmed(input.descriptionTo),
  exchangeActualAmount: input.exchangeActualAmount ?? null,
  archiveNote: trimmed(input.archiveNote),
  counterParty: trimmed(input.counterParty),
  isArchived: input.isArchived ? 1 : 0,
  archiveHidden: 0,
  distributionLocationId: input.distributionLocationId || null,
  distributionLocationName: null,
  distributionLocationKind: null,
  createdAt: input.createdAt,
 };
}
