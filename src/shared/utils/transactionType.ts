// Locale key for a transaction's type label. Handles buy/sell/exchange/transfer;
// unknown or legacy values fall back to "transfer". Keep in sync with the type
// <option>s in the new-transaction form and the transaction_type_* locale keys.
export function transactionTypeLabelKey(type: string): string {
  switch (type) {
    case 'buy':
      return 'transaction_type_buy';
    case 'sell':
      return 'transaction_type_sell';
    case 'exchange':
      return 'transaction_type_exchange';
    default:
      return 'transaction_type_transfer';
  }
}
