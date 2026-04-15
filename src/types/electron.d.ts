export {};

type Organization = {
 id: number;
 name: string;
 createdAt: string;
 updatedAt: string;
};

type OrganizationInput = {
 id?: number;
 name: string;
};

type Currency = {
 id: number;
 code: string;
 name: string;
 symbol: string;
 isEnabled: number;
 isMain: number;
 createdAt: string;
};

type CurrencyInput = {
 id?: number;
 code: string;
 name: string;
 symbol: string;
};

type Client = {
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

type ClientInput = {
 id?: number;
 organizationId: number | null;
 name: string;
 email: string;
 phone: string;
 address: string;
};

type ClientAccount = {
 id: number;
 clientId: number;
 clientName: string;
 currencyId: number;
 currencyCode: string;
 currencySymbol: string;
 startingBalance: number;
 createdAt: string;
};

type ClientAccountInput = {
 clientId: number;
 currencyId: number;
 startingBalance?: number;
};

type Transaction = {
 id: number;
 accountFromId: number;
 clientFromName: string;
 accountFromCurrencyCode: string;
 accountFromCurrencySymbol: string;
 accountToId: number;
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
 charges: number;
 description: string;
 createdAt: string;
};

type TransactionInput = {
 accountFromId: number;
 accountToId: number;
 currencyId: number;
 amount: number;
 type: string;
 exchangeRateFrom: number;
 commissionFrom: number;
 exchangeRateTo: number;
 commissionTo: number;
 charges: number;
 description: string;
};

type TransactionUpdateInput = TransactionInput & {
 id: number;
 createdAt: string;
};

type DbInfo = {
 dbPath: string;
 dbDirectory: string;
};

declare global {
 interface Window {
  accountingApi?: {
   getDbInfo: () => Promise<DbInfo>;
   chooseDbDirectory: () => Promise<string | null>;
   setDbDirectory: (nextDirectory: string) => Promise<DbInfo>;
   listOrganizations: () => Promise<Organization[]>;
   createOrganization: (organization: OrganizationInput) => Promise<{ ok: true }>;
   updateOrganization: (organization: OrganizationInput) => Promise<{ ok: true }>;
   deleteOrganization: (organizationId: number) => Promise<{ ok: true }>;
   listClients: () => Promise<Client[]>;
   createClient: (client: ClientInput) => Promise<{ ok: true }>;
   updateClient: (client: ClientInput) => Promise<{ ok: true }>;
   deleteClient: (clientId: number) => Promise<{ ok: true }>;
   listAllClientAccounts: () => Promise<ClientAccount[]>;
   listClientAccounts: (clientId: number) => Promise<ClientAccount[]>;
   createClientAccount: (account: ClientAccountInput) => Promise<{ ok: true }>;
   updateClientAccountStartingBalance: (payload: { accountId: number; startingBalance: number }) => Promise<{ ok: true }>;
   deleteClientAccount: (accountId: number) => Promise<{ ok: true }>;
   listCurrencies: () => Promise<Currency[]>;
   createCurrency: (currency: CurrencyInput) => Promise<{ ok: true }>;
   updateCurrency: (currency: CurrencyInput) => Promise<{ ok: true }>;
   deleteCurrency: (currencyId: number) => Promise<{ ok: true }>;
   enableCurrency: (currencyId: number) => Promise<{ ok: true }>;
   disableCurrency: (currencyId: number) => Promise<{ ok: true }>;
   setMainCurrency: (currencyId: number) => Promise<{ ok: true }>;
   listTransactions: () => Promise<Transaction[]>;
   createTransaction: (transaction: TransactionInput) => Promise<{ ok: true }>;
   updateTransaction: (transaction: TransactionUpdateInput) => Promise<{ ok: true }>;
   deleteTransaction: (transactionId: number) => Promise<{ ok: true }>;
  };
 }
}
