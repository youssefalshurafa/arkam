type ApiOptions = {
 action: string;
 payload?: unknown;
};

async function request<T>({ action, payload }: ApiOptions): Promise<T> {
 const response = await fetch('/api/accounting', {
  method: 'POST',
  headers: {
   'Content-Type': 'application/json',
  },
  body: JSON.stringify({ action, payload }),
 });

 const data = await response.json();

 if (!response.ok) {
  throw new Error(data?.error || 'Request failed.');
 }

 return data as T;
}

function exportHtmlAsPdfFallback(html: string, title: string): Promise<{ ok: boolean; filePath?: string }> {
 const popup = window.open('', '_blank');

 if (!popup) {
  return Promise.resolve({ ok: false });
 }

 popup.document.open();
 popup.document.write(html);
 popup.document.title = title;
 popup.document.close();

 popup.focus();
 popup.print();

 return Promise.resolve({ ok: true });
}

export const accountingApi = {
 getDbInfo: () => request<{ dbPath: string; dbDirectory: string }>({ action: 'getDbInfo' }),
 chooseDbDirectory: async () => null,
 setDbDirectory: (nextDirectory: string) => request<{ dbPath: string; dbDirectory: string }>({ action: 'setDbDirectory', payload: nextDirectory }),
 listOrganizations: () => request<unknown[]>({ action: 'listOrganizations' }),
 createOrganization: (organization: unknown) => request<{ ok: true }>({ action: 'createOrganization', payload: organization }),
 updateOrganization: (organization: unknown) => request<{ ok: true }>({ action: 'updateOrganization', payload: organization }),
 deleteOrganization: (organizationId: number) => request<{ ok: true }>({ action: 'deleteOrganization', payload: organizationId }),
 listClients: () => request<unknown[]>({ action: 'listClients' }),
 createClient: (client: unknown) => request<{ ok: true }>({ action: 'createClient', payload: client }),
 updateClient: (client: unknown) => request<{ ok: true }>({ action: 'updateClient', payload: client }),
 deleteClient: (clientId: number) => request<{ ok: true }>({ action: 'deleteClient', payload: clientId }),
 listAllClientAccounts: () => request<unknown[]>({ action: 'listAllClientAccounts' }),
 listClientAccounts: (clientId: number) => request<unknown[]>({ action: 'listClientAccounts', payload: clientId }),
 createClientAccount: (account: unknown) => request<{ ok: true }>({ action: 'createClientAccount', payload: account }),
 updateClientAccountStartingBalance: (payload: unknown) => request<{ ok: true }>({ action: 'updateClientAccountStartingBalance', payload }),
 deleteClientAccount: (accountId: number) => request<{ ok: true }>({ action: 'deleteClientAccount', payload: accountId }),
 listCurrencies: () => request<unknown[]>({ action: 'listCurrencies' }),
 createCurrency: (currency: unknown) => request<{ ok: true }>({ action: 'createCurrency', payload: currency }),
 updateCurrency: (currency: unknown) => request<{ ok: true }>({ action: 'updateCurrency', payload: currency }),
 deleteCurrency: (currencyId: number) => request<{ ok: true }>({ action: 'deleteCurrency', payload: currencyId }),
 enableCurrency: (currencyId: number) => request<{ ok: true }>({ action: 'enableCurrency', payload: currencyId }),
 disableCurrency: (currencyId: number) => request<{ ok: true }>({ action: 'disableCurrency', payload: currencyId }),
 setMainCurrency: (currencyId: number) => request<{ ok: true }>({ action: 'setMainCurrency', payload: currencyId }),
 listTransactions: () => request<unknown[]>({ action: 'listTransactions' }),
 createTransaction: (transaction: unknown) => request<{ ok: true }>({ action: 'createTransaction', payload: transaction }),
 updateTransaction: (transaction: unknown) => request<{ ok: true }>({ action: 'updateTransaction', payload: transaction }),
 deleteTransaction: (transactionId: number) => request<{ ok: true }>({ action: 'deleteTransaction', payload: transactionId }),
 exportLedgerPdf: ({ html, defaultFileName }: { html: string; defaultFileName: string }) => exportHtmlAsPdfFallback(html, defaultFileName),
};
