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
