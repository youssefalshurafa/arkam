/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("accountingApi", {
    getDbInfo: () => ipcRenderer.invoke("db:get-info"),
    listAccounts: () => ipcRenderer.invoke("accounts:list"),
    addAccount: (code, name) => ipcRenderer.invoke("accounts:add", { code, name }),
});
