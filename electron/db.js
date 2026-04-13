/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

let dbInstance;
let dbFilePath;

function getBaseDataDirectory(app) {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir) {
        return path.join(portableDir, "data");
    }

    return path.join(app.getPath("userData"), "data");
}

function getOrCreateDb(app) {
    if (dbInstance) {
        return { db: dbInstance, dbPath: dbFilePath };
    }

    const baseDir = getBaseDataDirectory(app);
    fs.mkdirSync(baseDir, { recursive: true });

    dbFilePath = path.join(baseDir, "accounting.sqlite");
    dbInstance = new Database(dbFilePath);

    dbInstance.pragma("journal_mode = WAL");
    dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS chart_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

    return { db: dbInstance, dbPath: dbFilePath };
}

function getDbInfo(app) {
    const { dbPath } = getOrCreateDb(app);
    return { dbPath };
}

function listAccounts(app) {
    const { db } = getOrCreateDb(app);
    const stmt = db.prepare(
        "SELECT id, code, name, created_at as createdAt FROM chart_accounts ORDER BY code ASC",
    );
    return stmt.all();
}

function addAccount(app, code, name) {
    if (!code || !name) {
        throw new Error("Both account code and account name are required.");
    }

    const { db } = getOrCreateDb(app);
    const stmt = db.prepare("INSERT INTO chart_accounts (code, name) VALUES (?, ?)");
    stmt.run(code, name);
}

module.exports = {
    getDbInfo,
    listAccounts,
    addAccount,
};
