export type DbInfo = {
 provider: string;
 host: string;
 port: string;
 database: string;
 schema: string;
 dbPath: string;
 dbDirectory: string;
 supportsDirectoryChange: boolean;
};

export type Organization = {
 id: number;
 name: string;
 createdAt: string;
 updatedAt: string;
};

export type OrganizationForm = {
 id?: number;
 name: string;
};

export type Client = {
 id: number;
 organizationId: number | null;
 organizationName: string | null;
 name: string;
 email: string;
 phone: string;
 address: string;
 accountCount: number;
 createdAt: string;
 updatedAt: string;
};

export type ClientForm = {
 id?: number;
 organizationId: number | null;
 name: string;
 email: string;
 phone: string;
 address: string;
};

export type NewClientAccountDraft = {
 currencyId: number | null;
 startingBalance: string;
 balanceType: 'debit' | 'credit';
};

export type ClientAccount = {
 id: number;
 clientId: number;
 clientName: string;
 currencyId: number;
 currencyCode: string;
 currencySymbol: string;
 startingBalance: number;
 createdAt: string;
};

export type Currency = {
 id: number;
 code: string;
 name: string;
 symbol: string;
 isEnabled: number;
 isMain: number;
 createdAt: string;
};

export type Transaction = {
 id: number;
 accountFromId: number | null;
 clientFromName: string;
 accountFromCurrencyCode: string;
 accountFromCurrencySymbol: string;
 accountToId: number | null;
 clientToName: string;
 accountToCurrencyCode: string;
 accountToCurrencySymbol: string;
 currencyId: number;
 currencyCode: string;
 currencySymbol: string;
 amount: number;
 type: string;
 exchangeRateFrom: number;
 commissionFrom: number;
 exchangeRateTo: number;
 commissionTo: number;
 exchangeRateFromReversed: number;
 exchangeRateToReversed: number;
 charges: number;
 chargesCurrencyId: number | null;
 chargesCurrencyCode: string | null;
 chargesCurrencySymbol: string | null;
 chargesPayer: string;
 chargesExchangeRate: number;
 chargesDescription: string;
 description: string;
 descriptionFrom: string;
 descriptionTo: string;
 archiveNote: string;
 isArchived: number;
 createdAt: string;
};

export type TransactionTableRow = Transaction & {
 adjustmentId?: number;
 isAdjustment?: boolean;
 adjustmentDirection?: 'debit' | 'credit';
};

export type TransactionForm = {
 accountFromId: number | null;
 accountToId: number | null;
 currencyId: number | null;
 amount: string;
 type: string;
 adjustmentDirection: 'debit' | 'credit';
 exchangeRateFrom: string;
 commissionFrom: string;
 exchangeRateTo: string;
 commissionTo: string;
 charges: string;
 chargesCurrencyId: number | null;
 chargesPayer: string;
 chargesExchangeRate: string;
 chargesDescription: string;
 description: string;
 descriptionFrom: string;
 descriptionTo: string;
};
export type TransactionUpdateInput = {
 id: number;
 accountFromId: number | null;
 accountToId: number | null;
 currencyId: number;
 amount: number;
 type: string;
 exchangeRateFrom: number;
 commissionFrom: number;
 exchangeRateTo: number;
 commissionTo: number;
 exchangeRateFromReversed?: number;
 exchangeRateToReversed?: number;
 charges: number;
 chargesCurrencyId: number | null;
 chargesPayer: string;
 chargesExchangeRate: number;
 chargesDescription: string;
 description: string;
 descriptionFrom?: string;
 descriptionTo?: string;
 archiveNote?: string;
 createdAt: string;
};

export type TransactionTableDraft = {
 transactionId: number;
 adjustmentId?: number;
 isAdjustment?: boolean;
 accountFromId: number | null;
 accountToId: number | null;
 currencyId: number | null;
 type: string;
 adjustmentDirection?: 'debit' | 'credit';
 amount: string;
 exchangeRateFrom: string;
 commissionFrom: string;
 exchangeRateTo: string;
 commissionTo: string;
 charges: string;
 chargesCurrencyId: number | null;
 chargesPayer: string;
 chargesExchangeRate: string;
 chargesDescription: string;
 description: string;
 archiveNote: string;
 createdDate: string;
};

export type LedgerTransactionDraft = {
 transactionId: number;
 adjustmentId?: number;
 isAdjustment?: boolean;
 adjustmentDirection?: 'debit' | 'credit';
 ledgerAccountId: number;
 createdDate: string;
 direction: 'incoming' | 'outgoing';
 counterpartyAccountId: number | null;
 type: string;
 currencyId: number | null;
 amount: string;
 exchangeRate: string;
 exchangeRateReversed?: boolean;
 commission: string;
 description: string;
 charges: string;
 chargesCurrencyId: number | null;
 chargesPayer: string;
 chargesExchangeRate: string;
 chargesDescription: string;
};

export type ClientLedgerEntry = {
 transactionId: number;
 adjustmentId?: number;
 isAdjustment?: boolean;
 createdAt: string;
 counterpartyName: string;
 counterpartyClientId: number | null;
 direction: 'incoming' | 'outgoing';
 type: string;
 amount: number;
 currencyCode: string;
 currencySymbol: string;
 exchangeRate: number;
 exchangeRateReversed: boolean;
 // True when the entry's amount is in a different currency than the account and no
 // exchange rate has been entered yet. Such entries show a dash for the rate and are
 // excluded from the running/accumulated balance (netChange forced to 0) until a rate is set.
 pendingRate: boolean;
 commission: number;
 netChange: number;
 runningBalance: number;
 description: string;
 charges: number;
 chargesCurrencyCode: string | null;
 chargesPayer: string;
 chargesExchangeRate: number;
 chargesDescription: string;
 // True when the charge is displayed as reducing this account's balance (shown red with a
 // minus). Derived from the signed ledger effect for this account's side.
 isChargesPayerThisAccount: boolean;
 // Whether the charge touches this account's ledger at all (shown + counted). False for the
 // "off side" of an org-settled charge, which only affects the one named client.
 chargeAffectsThisAccount: boolean;
};

export type ClientAdjustment = {
 id: number;
 accountId: number;
 amount: number;
 direction: 'debit' | 'credit';
 currencyId: number | null;
 currencyCode: string;
 currencySymbol: string;
 exchangeRate: number;
 exchangeRateReversed: boolean;
 description: string;
 createdAt: string;
};

export type ClientAccountLedger = {
 accountId: number;
 currencyName: string;
 currencyCode: string;
 currencySymbol: string;
 startingBalance: number;
 currentBalance: number;
 transactionCount: number;
 entries: ClientLedgerEntry[];
};

// One overview balance card: all clients of an organization that hold accounts in
// a given currency, with each client's net balance and the group total.
export type OverviewBalanceGroup = {
 key: string;
 organizationId: number | null;
 organizationName: string | null;
 currencyId: number;
 currencyCode: string;
 currencySymbol: string;
 isMain: boolean;
 clients: Array<{ clientId: number; clientName: string; balance: number }>;
 total: number;
};

export type ImportedTransactionRow = {
 fromName: string;
 toName: string;
 amount: number;
 createdAt: string | null;
 description: string;
};

export type ImportMappingState = {
 dateColumn: number | null;
 fromColumn: number | null;
 toColumn: number | null;
 amountColumn: number | null;
 descriptionColumn: number | null;
 currencyId: number | null;
};

export type PendingImportData = {
 fileName: string;
 rows: unknown[][];
 columnOptions: Array<{ index: number; label: string }>;
};

// One reviewable name derived from an imported sheet. Before anything is created
// the user can: rename it, map it to an existing client, assign an organization,
// open extra-currency accounts, or flag it as an expense (e.g. طريق) rather than
// a real client.
export type ImportClientReview = {
 key: string; // normalized original name from the sheet (stable id, matches parsed rows)
 originalName: string;
 isExpense: boolean; // when true this name is an expense marker, not a client
 existingClientId: number | null; // when set, map to this existing client instead of creating one
 existingAccountId: number | null; // which of the existing client's accounts this name feeds
 pendingEntryKey: string | null; // when set, reuse the client being created by another review entry
 targetCurrencyId: number | null; // for new/pending entries: which opened account receives the rows
 name: string; // editable final name when creating a new client
 organizationId: number | null; // org applied to a newly created client
 accountCurrencyIds: number[]; // currency accounts to open for this client (user-controlled)
 currencyId: number | null; // the import currency (used for the transactions themselves); null when no global import currency was chosen
 transactionCount: number; // how many imported rows reference this name
};

// Per-row decision for a sheet row that involves an expense-marked name.
export type ImportRowOverride = {
 mode: 'expense' | 'transaction'; // expense on one client, or a transfer between two
 direction: 'debit' | 'credit'; // expense mode: debit (owes you) or credit (you owe)
 swap: boolean; // transaction mode: swap the sheet's from/to direction
};
export type LedgerColumnKey = 'created' | 'counterparty' | 'direction' | 'type' | 'amount' | 'currency' | 'exchangeRate' | 'commission' | 'netChange' | 'runningBalance' | 'description';
export type TransactionColumnKey = 'created' | 'description' | 'accountFrom' | 'accountTo' | 'amount' | 'charges' | 'commission';
export type DataCache = {
 organizations: Organization[];
 clients: Client[];
 currencies: Currency[];
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
 clientAccounts: ClientAccount[];
};
export type PdfColVisibility = Record<LedgerColumnKey, boolean>;
export type StoredLedgerSettings = {
 decimals: number;
 showCurrencySymbol: boolean;
 dateFormat: PdfSettings['dateFormat'];
 highlightNetChange: boolean;
 netChangeHighlightColor: string;
 rowHighlightColor: string;
 rowClickHighlight: boolean;
};
export type TransactionColumnVisibility = Record<TransactionColumnKey, boolean>;

export type TransactionTableSettings = {
 columns: TransactionColumnVisibility;
 showExchangeRate: boolean;
 dateFormat: PdfSettings['dateFormat'];
};
export type PdfSettings = {
 decimals: number;
 fontFamily: string;
 fontSize: number;
 headFontSize: number;
 dateFormat: 'full' | 'day-month' | 'month-year' | 'day-month-year-2' | 'month-day';
 showPreBalance: boolean;
 showMetaClient: boolean;
 showMetaCurrency: boolean;
 showMetaPeriod: boolean;
 showFooter: boolean;
 showGeneratedOn: boolean;
 showCurrencySymbol: boolean;
 highlightNetChange: boolean;
};
export type SettingsTab = 'account' | 'team' | 'database' | 'language' | 'clients' | 'organizations' | 'currencies' | 'danger' | 'pdf';

export type Section = 'overview' | 'settings' | 'organizations' | 'organization-clients' | 'clients' | 'client-ledger' | 'currencies' | 'transactions' | 'archive' | 'live-rates';
export type IconName = 'home' | 'organizations' | 'clients' | 'currencies' | 'transactions' | 'settings' | 'database' | 'auth' | 'archive' | 'rates';

// A normalized live FX/gold quote, as returned by the /api/live-rates proxy.
export type LiveRate = {
 code: string;
 buy: number;
 sell: number;
 high: number;
 low: number;
 time: string;
};
export type LiveRatesResponse = { ok: boolean; rates?: LiveRate[]; timestamp?: string; error?: string };
