/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

let dbInstance;
let dbFilePath;

function getSettingsFilePath(app) {
    return path.join(app.getPath("userData"), "settings.json");
}

function readSettings(app) {
    const settingsPath = getSettingsFilePath(app);

    try {
        if (!fs.existsSync(settingsPath)) {
            return {};
        }

        return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
        return {};
    }
}

function writeSettings(app, nextSettings) {
    const settingsPath = getSettingsFilePath(app);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2));
}

function getBaseDataDirectory(app) {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir) {
        return path.join(portableDir, "data");
    }

    return path.join(app.getPath("userData"), "data");
}

function getConfiguredDataDirectory(app) {
    const settings = readSettings(app);

    if (typeof settings.dbDirectory === "string" && settings.dbDirectory.trim()) {
        return settings.dbDirectory;
    }

    return getBaseDataDirectory(app);
}

function getSupportedCurrencyCodes() {
    if (typeof Intl.supportedValuesOf === "function") {
        return Intl.supportedValuesOf("currency");
    }

    return ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "AED", "SAR", "MAD"];
}

function getCurrencyDisplayName(code) {
    try {
        if (typeof Intl.DisplayNames === "function") {
            return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) || code;
        }
    } catch {
        // ignore
    }

    return code;
}

function getCurrencySymbol(code) {
    try {
        const narrowSymbol = new Intl.NumberFormat("en", {
            style: "currency",
            currency: code,
            currencyDisplay: "narrowSymbol",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).formatToParts(0).find((part) => part.type === "currency")?.value;

        if (narrowSymbol) {
            return narrowSymbol;
        }

        const symbol = new Intl.NumberFormat("en", {
            style: "currency",
            currency: code,
            currencyDisplay: "symbol",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).formatToParts(0).find((part) => part.type === "currency")?.value;

        return symbol || code;
    } catch {
        return code;
    }
}

function seedCurrencies(db) {
    const upsertCurrency = db.prepare(`
        INSERT INTO currencies (code, name, symbol)
        VALUES (?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
            name = excluded.name,
            symbol = excluded.symbol
    `);
    const clearDisabledMainCurrencies = db.prepare("UPDATE currencies SET is_main = 0 WHERE is_enabled = 0");
    const countEnabledCurrencies = db.prepare("SELECT COUNT(*) AS count FROM currencies WHERE is_enabled = 1");
    const countEnabledMainCurrencies = db.prepare("SELECT COUNT(*) AS count FROM currencies WHERE is_enabled = 1 AND is_main = 1");
    const setMainByCode = db.prepare("UPDATE currencies SET is_main = 1 WHERE is_enabled = 1 AND code = ?");
    const setMainFirstEnabled = db.prepare("UPDATE currencies SET is_main = 1 WHERE id = (SELECT id FROM currencies WHERE is_enabled = 1 ORDER BY code COLLATE NOCASE ASC LIMIT 1)");

    const syncCurrencies = db.transaction(() => {
        for (const code of getSupportedCurrencyCodes()) {
            upsertCurrency.run(code, getCurrencyDisplayName(code), getCurrencySymbol(code));
        }

        clearDisabledMainCurrencies.run();

        if (countEnabledCurrencies.get().count > 0 && !countEnabledMainCurrencies.get().count) {
            const { changes } = setMainByCode.run("USD");
            if (!changes) {
                setMainFirstEnabled.run();
            }
        }
    });

    syncCurrencies();
}

function initializeDb(db) {
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    db.exec(`
    CREATE TABLE IF NOT EXISTS chart_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

        CREATE TABLE IF NOT EXISTS organizations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS currencies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            symbol TEXT NOT NULL DEFAULT '',
            is_enabled INTEGER NOT NULL DEFAULT 0,
            is_main INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER,
            currency_id INTEGER,
            name TEXT NOT NULL,
            email TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            address TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
            FOREIGN KEY (currency_id) REFERENCES currencies(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS client_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER NOT NULL,
            currency_id INTEGER NOT NULL,
            starting_balance REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(client_id, currency_id),
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (currency_id) REFERENCES currencies(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_from_id INTEGER NOT NULL,
            account_to_id INTEGER NOT NULL,
            currency_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            type TEXT NOT NULL DEFAULT 'exchange',
            exchange_rate_from REAL NOT NULL DEFAULT 1,
            commission_from REAL NOT NULL DEFAULT 0,
            exchange_rate_to REAL NOT NULL DEFAULT 1,
            commission_to REAL NOT NULL DEFAULT 0,
            charges REAL NOT NULL DEFAULT 0,
            description TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (account_from_id) REFERENCES client_accounts(id) ON DELETE CASCADE,
            FOREIGN KEY (account_to_id) REFERENCES client_accounts(id) ON DELETE CASCADE,
            FOREIGN KEY (currency_id) REFERENCES currencies(id) ON DELETE CASCADE
        );
  `);

    try {
        db.exec("ALTER TABLE clients ADD COLUMN currency_id INTEGER REFERENCES currencies(id) ON DELETE SET NULL");
    } catch {
        // Column already exists – ignore
    }

    try {
        const existingClients = db.prepare("SELECT id, currency_id FROM clients WHERE currency_id IS NOT NULL").all();
        const insertAcc = db.prepare("INSERT OR IGNORE INTO client_accounts (client_id, currency_id) VALUES (?, ?)");
        const migrateAccounts = db.transaction(() => {
            for (const c of existingClients) insertAcc.run(c.id, c.currency_id);
        });
        migrateAccounts();
    } catch {
        // ignore
    }

    try {
        const cols = db.pragma("table_info(transactions)").map((c) => c.name);
        if (!cols.includes("account_from_id") || !cols.includes("currency_id") || cols.includes("currency_from_id")) {
            db.exec("DROP TABLE IF EXISTS transactions");
            db.exec(`
                CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account_from_id INTEGER NOT NULL,
                    account_to_id INTEGER NOT NULL,
                    currency_id INTEGER NOT NULL,
                    amount REAL NOT NULL,
                    type TEXT NOT NULL DEFAULT 'exchange',
                    exchange_rate_from REAL NOT NULL DEFAULT 1,
                    commission_from REAL NOT NULL DEFAULT 0,
                    exchange_rate_to REAL NOT NULL DEFAULT 1,
                    commission_to REAL NOT NULL DEFAULT 0,
                    charges REAL NOT NULL DEFAULT 0,
                    description TEXT DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (account_from_id) REFERENCES client_accounts(id) ON DELETE CASCADE,
                    FOREIGN KEY (account_to_id) REFERENCES client_accounts(id) ON DELETE CASCADE,
                    FOREIGN KEY (currency_id) REFERENCES currencies(id) ON DELETE CASCADE
                )
            `);
        }
    } catch {
        // ignore
    }

    try {
        db.exec("ALTER TABLE currencies ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 0");
    } catch {
        // Column already exists – ignore
    }

    try {
        db.exec("ALTER TABLE transactions ADD COLUMN charges REAL NOT NULL DEFAULT 0");
    } catch {
        // Column already exists – ignore
    }

    try {
        db.exec("ALTER TABLE client_accounts ADD COLUMN starting_balance REAL NOT NULL DEFAULT 0");
    } catch {
        // Column already exists – ignore
    }

    seedCurrencies(db);
}

function closeDb() {
    if (!dbInstance) {
        return;
    }

    try {
        dbInstance.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
        // ignore
    }

    dbInstance.close();
    dbInstance = undefined;
    dbFilePath = undefined;
}

function copyDatabaseArtifacts(sourceDbPath, targetDbPath) {
    for (const suffix of ["", "-wal", "-shm"]) {
        const sourcePath = `${sourceDbPath}${suffix}`;
        const targetPath = `${targetDbPath}${suffix}`;

        if (fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, targetPath);
        }
    }
}

function getOrCreateDb(app) {
    if (dbInstance) {
        return { db: dbInstance, dbPath: dbFilePath };
    }

    const baseDir = getConfiguredDataDirectory(app);
    fs.mkdirSync(baseDir, { recursive: true });

    dbFilePath = path.join(baseDir, "accounting.sqlite");
    dbInstance = new Database(dbFilePath);
    initializeDb(dbInstance);

    return { db: dbInstance, dbPath: dbFilePath };
}

function getDbInfo(app) {
    const { dbPath } = getOrCreateDb(app);
    return {
        dbPath,
        dbDirectory: path.dirname(dbPath),
    };
}

function setDbDirectory(app, nextDirectory) {
    if (!nextDirectory?.trim()) {
        throw new Error("Database folder is required.");
    }

    const resolvedDirectory = path.resolve(nextDirectory.trim());
    const targetDbPath = path.join(resolvedDirectory, "accounting.sqlite");
    const { dbPath: currentDbPath } = getOrCreateDb(app);

    if (path.resolve(currentDbPath) === path.resolve(targetDbPath)) {
        writeSettings(app, { ...readSettings(app), dbDirectory: resolvedDirectory });
        return getDbInfo(app);
    }

    fs.mkdirSync(resolvedDirectory, { recursive: true });

    closeDb();

    if (!fs.existsSync(targetDbPath)) {
        copyDatabaseArtifacts(currentDbPath, targetDbPath);
    }

    writeSettings(app, { ...readSettings(app), dbDirectory: resolvedDirectory });

    return getDbInfo(app);
}

function listOrganizations(app) {
    const { db } = getOrCreateDb(app);
    const stmt = db.prepare(`
                        SELECT id, name, created_at as createdAt, updated_at as updatedAt
      FROM organizations
      ORDER BY name COLLATE NOCASE ASC
    `);
    return stmt.all();
}

function createOrganization(app, organization) {
    if (!organization.name?.trim()) {
        throw new Error("Organization name is required.");
    }

    const { db } = getOrCreateDb(app);
    const stmt = db.prepare("INSERT INTO organizations (name) VALUES (?)");
    stmt.run(organization.name.trim());
}

function updateOrganization(app, organization) {
    if (!organization.id) {
        throw new Error("Organization id is required.");
    }

    if (!organization.name?.trim()) {
        throw new Error("Organization name is required.");
    }

    const { db } = getOrCreateDb(app);
    const stmt = db.prepare("UPDATE organizations SET name = ?, updated_at = datetime('now') WHERE id = ?");
    stmt.run(organization.name.trim(), organization.id);
}

function deleteOrganization(app, organizationId) {
    const { db } = getOrCreateDb(app);
    const stmt = db.prepare("DELETE FROM organizations WHERE id = ?");
    stmt.run(organizationId);
}

function listClients(app) {
    const { db } = getOrCreateDb(app);
    const stmt = db.prepare(`
      SELECT
        clients.id,
        clients.organization_id as organizationId,
        organizations.name as organizationName,
        clients.name,
        clients.email,
        clients.phone,
        clients.address,
        clients.created_at as createdAt,
        clients.updated_at as updatedAt,
        (SELECT COUNT(*) FROM client_accounts WHERE client_id = clients.id) as accountCount
      FROM clients
      LEFT JOIN organizations ON organizations.id = clients.organization_id
      ORDER BY clients.name COLLATE NOCASE ASC
    `);
    return stmt.all();
}

function createClient(app, client) {
    if (!client.name?.trim()) {
        throw new Error("Client name is required.");
    }

    const { db } = getOrCreateDb(app);
    const stmt = db.prepare(`
      INSERT INTO clients (organization_id, name, email, phone, address)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
        client.organizationId || null,
        client.name.trim(),
        client.email?.trim() || "",
        client.phone?.trim() || "",
        client.address?.trim() || "",
    );
}

function updateClient(app, client) {
    if (!client.id) {
        throw new Error("Client id is required.");
    }

    if (!client.name?.trim()) {
        throw new Error("Client name is required.");
    }

    const { db } = getOrCreateDb(app);
    const stmt = db.prepare(`
      UPDATE clients
      SET organization_id = ?, name = ?, email = ?, phone = ?, address = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(
        client.organizationId || null,
        client.name.trim(),
        client.email?.trim() || "",
        client.phone?.trim() || "",
        client.address?.trim() || "",
        client.id,
    );
}

function deleteClient(app, clientId) {
    const { db } = getOrCreateDb(app);
    const stmt = db.prepare("DELETE FROM clients WHERE id = ?");
    stmt.run(clientId);
}

// ── Client Accounts ─────────────────────────────────────────────────────────

function listAllClientAccounts(app) {
    const { db } = getOrCreateDb(app);
    return db.prepare(`
        SELECT
            ca.id,
            ca.client_id AS clientId,
            c.name AS clientName,
            ca.currency_id AS currencyId,
            cur.code AS currencyCode,
            cur.symbol AS currencySymbol,
            ca.starting_balance AS startingBalance,
            ca.created_at AS createdAt
        FROM client_accounts ca
        JOIN clients c ON c.id = ca.client_id
        JOIN currencies cur ON cur.id = ca.currency_id
        ORDER BY c.name COLLATE NOCASE ASC, cur.code ASC
    `).all();
}

function listClientAccounts(app, clientId) {
    const { db } = getOrCreateDb(app);
    return db.prepare(`
        SELECT
            ca.id,
            ca.client_id AS clientId,
            c.name AS clientName,
            ca.currency_id AS currencyId,
            cur.code AS currencyCode,
            cur.symbol AS currencySymbol,
            ca.starting_balance AS startingBalance,
            ca.created_at AS createdAt
        FROM client_accounts ca
        JOIN clients c ON c.id = ca.client_id
        JOIN currencies cur ON cur.id = ca.currency_id
        WHERE ca.client_id = ?
        ORDER BY cur.code ASC
    `).all(clientId);
}

function createClientAccount(app, { clientId, currencyId, startingBalance }) {
    if (!clientId || !currencyId) throw new Error("Client and currency are required.");
    const { db } = getOrCreateDb(app);
    db.prepare("INSERT OR IGNORE INTO client_accounts (client_id, currency_id, starting_balance) VALUES (?, ?, ?)").run(clientId, currencyId, startingBalance ?? 0);
}

function updateClientAccountStartingBalance(app, { accountId, startingBalance }) {
    if (!accountId) throw new Error("Account id is required.");
    const { db } = getOrCreateDb(app);
    db.prepare("UPDATE client_accounts SET starting_balance = ? WHERE id = ?").run(startingBalance ?? 0, accountId);
}

function deleteClientAccount(app, accountId) {
    const { db } = getOrCreateDb(app);
    db.prepare("DELETE FROM client_accounts WHERE id = ?").run(accountId);
}

// ── Currencies ──────────────────────────────────────────────────────────────

function listCurrencies(app) {
    const { db } = getOrCreateDb(app);
    return db.prepare(`
        SELECT id, code, name, symbol, is_enabled as isEnabled, is_main as isMain, created_at as createdAt
        FROM currencies ORDER BY code COLLATE NOCASE ASC
    `).all();
}

function enableCurrency(app, currencyId) {
    const { db } = getOrCreateDb(app);
    const countEnabledMainCurrencies = db.prepare("SELECT COUNT(*) AS count FROM currencies WHERE is_enabled = 1 AND is_main = 1");

    const enable = db.transaction(() => {
        db.prepare("UPDATE currencies SET is_enabled = 1 WHERE id = ?").run(currencyId);

        if (!countEnabledMainCurrencies.get().count) {
            db.prepare("UPDATE currencies SET is_main = 1 WHERE id = ?").run(currencyId);
        }
    });

    enable();
}

function disableCurrency(app, currencyId) {
    const { db } = getOrCreateDb(app);
    const countEnabledMainCurrencies = db.prepare("SELECT COUNT(*) AS count FROM currencies WHERE is_enabled = 1 AND is_main = 1");
    const setMainByCode = db.prepare("UPDATE currencies SET is_main = 1 WHERE is_enabled = 1 AND code = ?");
    const setMainFirstEnabled = db.prepare("UPDATE currencies SET is_main = 1 WHERE id = (SELECT id FROM currencies WHERE is_enabled = 1 ORDER BY code COLLATE NOCASE ASC LIMIT 1)");

    const disable = db.transaction(() => {
        db.prepare("UPDATE currencies SET is_enabled = 0, is_main = 0 WHERE id = ?").run(currencyId);

        if (!countEnabledMainCurrencies.get().count) {
            const { changes } = setMainByCode.run("USD");
            if (!changes) {
                setMainFirstEnabled.run();
            }
        }
    });

    disable();
}

function createCurrency(app, currency) {
    if (!currency.code?.trim() || !currency.name?.trim()) {
        throw new Error("Currency code and name are required.");
    }
    const { db } = getOrCreateDb(app);
    db.prepare(`INSERT INTO currencies (code, name, symbol) VALUES (?, ?, ?)`).run(
        currency.code.trim().toUpperCase(),
        currency.name.trim(),
        currency.symbol?.trim() || "",
    );
}

function updateCurrency(app, currency) {
    if (!currency.id) throw new Error("Currency id is required.");
    if (!currency.code?.trim() || !currency.name?.trim()) {
        throw new Error("Currency code and name are required.");
    }
    const { db } = getOrCreateDb(app);
    db.prepare(`
        UPDATE currencies SET code = ?, name = ?, symbol = ? WHERE id = ?
    `).run(
        currency.code.trim().toUpperCase(),
        currency.name.trim(),
        currency.symbol?.trim() || "",
        currency.id,
    );
}

function deleteCurrency(app, currencyId) {
    const { db } = getOrCreateDb(app);
    db.prepare("DELETE FROM currencies WHERE id = ?").run(currencyId);
}

function setMainCurrency(app, currencyId) {
    const { db } = getOrCreateDb(app);
    const currency = db.prepare("SELECT id, is_enabled as isEnabled FROM currencies WHERE id = ?").get(currencyId);
    if (!currency) {
        throw new Error("Currency not found.");
    }
    if (!currency.isEnabled) {
        throw new Error("Select this currency in the used currencies list before making it the main currency.");
    }

    const setMain = db.transaction(() => {
        db.prepare("UPDATE currencies SET is_main = 0").run();
        db.prepare("UPDATE currencies SET is_main = 1 WHERE id = ?").run(currencyId);
    });
    setMain();
}

// ── Transactions ────────────────────────────────────────────────────────────

function listTransactions(app) {
    const { db } = getOrCreateDb(app);
    return db.prepare(`
        SELECT
            t.id,
            t.account_from_id AS accountFromId,
            c_from.name AS clientFromName,
            acur_from.code AS accountFromCurrencyCode,
            acur_from.symbol AS accountFromCurrencySymbol,
            t.account_to_id AS accountToId,
            c_to.name AS clientToName,
            acur_to.code AS accountToCurrencyCode,
            acur_to.symbol AS accountToCurrencySymbol,
            t.currency_id AS currencyId,
            cur.code AS currencyCode,
            cur.symbol AS currencySymbol,
            t.amount,
            t.type,
            t.exchange_rate_from AS exchangeRateFrom,
            t.commission_from AS commissionFrom,
            t.exchange_rate_to AS exchangeRateTo,
            t.commission_to AS commissionTo,
            t.charges,
            t.description,
            t.created_at AS createdAt
        FROM transactions t
        JOIN client_accounts ca_from ON ca_from.id = t.account_from_id
        JOIN clients c_from ON c_from.id = ca_from.client_id
        JOIN currencies acur_from ON acur_from.id = ca_from.currency_id
        JOIN client_accounts ca_to ON ca_to.id = t.account_to_id
        JOIN clients c_to ON c_to.id = ca_to.client_id
        JOIN currencies acur_to ON acur_to.id = ca_to.currency_id
        JOIN currencies cur ON cur.id = t.currency_id
        ORDER BY t.created_at DESC
    `).all();
}

function createTransaction(app, txn) {
    if (!txn.accountFromId || !txn.accountToId) throw new Error("Both accounts are required.");
    if (!txn.currencyId) throw new Error("Amount currency is required.");
    if (!txn.amount || txn.amount <= 0) throw new Error("Amount must be greater than zero.");

    const { db } = getOrCreateDb(app);
    db.prepare(`
        INSERT INTO transactions (account_from_id, account_to_id, currency_id, amount, type, exchange_rate_from, commission_from, exchange_rate_to, commission_to, charges, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        txn.accountFromId,
        txn.accountToId,
        txn.currencyId,
        txn.amount,
        txn.type || "exchange",
        txn.exchangeRateFrom || 1,
        txn.commissionFrom || 0,
        txn.exchangeRateTo || 1,
        txn.commissionTo || 0,
        txn.charges || 0,
        txn.description?.trim() || "",
    );
}

function updateTransaction(app, txn) {
    if (!txn.id) throw new Error("Transaction id is required.");
    if (!txn.accountFromId || !txn.accountToId) throw new Error("Both accounts are required.");
    if (!txn.currencyId) throw new Error("Amount currency is required.");
    if (!txn.amount || txn.amount <= 0) throw new Error("Amount must be greater than zero.");

    const { db } = getOrCreateDb(app);
    db.prepare(`
        UPDATE transactions
        SET account_from_id = ?,
            account_to_id = ?,
            currency_id = ?,
            amount = ?,
            type = ?,
            exchange_rate_from = ?,
            commission_from = ?,
            exchange_rate_to = ?,
            commission_to = ?,
            charges = ?,
            description = ?,
            created_at = ?
        WHERE id = ?
    `).run(
        txn.accountFromId,
        txn.accountToId,
        txn.currencyId,
        txn.amount,
        txn.type || "exchange",
        txn.exchangeRateFrom || 1,
        txn.commissionFrom || 0,
        txn.exchangeRateTo || 1,
        txn.commissionTo || 0,
        txn.charges || 0,
        txn.description?.trim() || "",
        txn.createdAt,
        txn.id,
    );
}

function deleteTransaction(app, transactionId) {
    const { db } = getOrCreateDb(app);
    db.prepare("DELETE FROM transactions WHERE id = ?").run(transactionId);
}

module.exports = {
    getDbInfo,
    setDbDirectory,
    listOrganizations,
    createOrganization,
    updateOrganization,
    deleteOrganization,
    listClients,
    createClient,
    updateClient,
    deleteClient,
    listAllClientAccounts,
    listClientAccounts,
    createClientAccount,
    updateClientAccountStartingBalance,
    deleteClientAccount,
    listCurrencies,
    createCurrency,
    updateCurrency,
    deleteCurrency,
    enableCurrency,
    disableCurrency,
    setMainCurrency,
    listTransactions,
    createTransaction,
    updateTransaction,
    deleteTransaction,
};
