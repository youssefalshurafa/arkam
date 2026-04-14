/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const db = require("./db");

const isDev = process.env.NODE_ENV === "development";

function createMainWindow() {
    const mainWindow = new BrowserWindow({
        width: 1360,
        height: 900,
        minWidth: 1024,
        minHeight: 720,
        backgroundColor: "#f1f5f9",
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    if (isDev) {
        mainWindow.loadURL("http://localhost:3000");
        mainWindow.webContents.openDevTools({ mode: "detach" });
        return;
    }

    mainWindow.loadFile(path.join(app.getAppPath(), "out", "index.html"));
}

function registerIpcHandlers() {
    ipcMain.handle("db:get-info", () => db.getDbInfo(app));
    ipcMain.handle("accounts:list", () => db.listAccounts(app));
    ipcMain.handle("accounts:add", (_event, payload) => {
        db.addAccount(app, payload.code, payload.name);
        return { ok: true };
    });
    ipcMain.handle("organizations:list", () => db.listOrganizations(app));
    ipcMain.handle("organizations:create", (_event, payload) => {
        db.createOrganization(app, payload);
        return { ok: true };
    });
    ipcMain.handle("organizations:update", (_event, payload) => {
        db.updateOrganization(app, payload);
        return { ok: true };
    });
    ipcMain.handle("organizations:delete", (_event, organizationId) => {
        db.deleteOrganization(app, organizationId);
        return { ok: true };
    });
    ipcMain.handle("clients:list", () => db.listClients(app));
    ipcMain.handle("clients:create", (_event, payload) => {
        db.createClient(app, payload);
        return { ok: true };
    });
    ipcMain.handle("clients:update", (_event, payload) => {
        db.updateClient(app, payload);
        return { ok: true };
    });
    ipcMain.handle("clients:delete", (_event, clientId) => {
        db.deleteClient(app, clientId);
        return { ok: true };
    });
    ipcMain.handle("currencies:list", () => db.listCurrencies(app));
    ipcMain.handle("currencies:create", (_event, payload) => {
        db.createCurrency(app, payload);
        return { ok: true };
    });
    ipcMain.handle("currencies:update", (_event, payload) => {
        db.updateCurrency(app, payload);
        return { ok: true };
    });
    ipcMain.handle("currencies:delete", (_event, currencyId) => {
        db.deleteCurrency(app, currencyId);
        return { ok: true };
    });
    ipcMain.handle("currencies:set-main", (_event, currencyId) => {
        db.setMainCurrency(app, currencyId);
        return { ok: true };
    });
}

app.whenReady().then(() => {
    registerIpcHandlers();
    createMainWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
