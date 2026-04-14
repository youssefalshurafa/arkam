export {};

type Account = {
 id: number;
 code: string;
 name: string;
 createdAt: string;
};

type Organization = {
 id: number;
 name: string;
 email: string;
 phone: string;
 address: string;
 taxId: string;
 createdAt: string;
 updatedAt: string;
};

type OrganizationInput = {
 id?: number;
 name: string;
 email: string;
 phone: string;
 address: string;
 taxId: string;
};

type Currency = {
 id: number;
 code: string;
 name: string;
 symbol: string;
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
 createdAt: string;
};

type ClientAccountInput = {
 clientId: number;
 currencyId: number;
};

type Transaction = {
 id: number;
 accountFromId: number;
 clientFromName: string;
 currencyFromCode: string;
 currencyFromSymbol: string;
 accountToId: number;
 clientToName: string;
 currencyToCode: string;
 currencyToSymbol: string;
 type: string;
 amountFrom: number;
 amountTo: number;
 exchangeRate: number;
 description: string;
 createdAt: string;
};

type TransactionInput = {
 accountFromId: number;
 accountToId: number;
 type: string;
 amountFrom: number;
 amountTo: number;
 exchangeRate: number;
 description: string;
};

declare global {
 interface Window {
  accountingApi?: {
   getDbInfo: () => Promise<{ dbPath: string }>;
   listAccounts: () => Promise<Account[]>;
   addAccount: (code: string, name: string) => Promise<{ ok: true }>;
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
   deleteClientAccount: (accountId: number) => Promise<{ ok: true }>;
   listCurrencies: () => Promise<Currency[]>;
   createCurrency: (currency: CurrencyInput) => Promise<{ ok: true }>;
   updateCurrency: (currency: CurrencyInput) => Promise<{ ok: true }>;
   deleteCurrency: (currencyId: number) => Promise<{ ok: true }>;
   setMainCurrency: (currencyId: number) => Promise<{ ok: true }>;
   listTransactions: () => Promise<Transaction[]>;
   createTransaction: (transaction: TransactionInput) => Promise<{ ok: true }>;
   deleteTransaction: (transactionId: number) => Promise<{ ok: true }>;
  };
 }
}
