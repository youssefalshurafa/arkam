/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("accountingApi", {
    getDbInfo: () => ipcRenderer.invoke("db:get-info"),
    listAccounts: () => ipcRenderer.invoke("accounts:list"),
    addAccount: (code, name) => ipcRenderer.invoke("accounts:add", { code, name }),
    listOrganizations: () => ipcRenderer.invoke("organizations:list"),
    createOrganization: (organization) => ipcRenderer.invoke("organizations:create", organization),
    updateOrganization: (organization) => ipcRenderer.invoke("organizations:update", organization),
    deleteOrganization: (organizationId) => ipcRenderer.invoke("organizations:delete", organizationId),
    listClients: () => ipcRenderer.invoke("clients:list"),
    createClient: (client) => ipcRenderer.invoke("clients:create", client),
    updateClient: (client) => ipcRenderer.invoke("clients:update", client),
    deleteClient: (clientId) => ipcRenderer.invoke("clients:delete", clientId),
    listCurrencies: () => ipcRenderer.invoke("currencies:list"),
    createCurrency: (currency) => ipcRenderer.invoke("currencies:create", currency),
    updateCurrency: (currency) => ipcRenderer.invoke("currencies:update", currency),
    deleteCurrency: (currencyId) => ipcRenderer.invoke("currencies:delete", currencyId),
    setMainCurrency: (currencyId) => ipcRenderer.invoke("currencies:set-main", currencyId),
    listTransactions: () => ipcRenderer.invoke("transactions:list"),
    createTransaction: (transaction) => ipcRenderer.invoke("transactions:create", transaction),
    deleteTransaction: (transactionId) => ipcRenderer.invoke("transactions:delete", transactionId),
});
