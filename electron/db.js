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

    dbInstance.pragma("foreign_keys = ON");
    dbInstance.pragma("journal_mode = WAL");
    dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS chart_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

        CREATE TABLE IF NOT EXISTS organizations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            email TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            address TEXT DEFAULT '',
            tax_id TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS currencies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            symbol TEXT NOT NULL DEFAULT '',
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
            description TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (account_from_id) REFERENCES client_accounts(id) ON DELETE CASCADE,
            FOREIGN KEY (account_to_id) REFERENCES client_accounts(id) ON DELETE CASCADE,
            FOREIGN KEY (currency_id) REFERENCES currencies(id) ON DELETE CASCADE
        );
  `);

    // Migrate existing clients table to add currency_id if it doesn't exist
    try {
        dbInstance.exec("ALTER TABLE clients ADD COLUMN currency_id INTEGER REFERENCES currencies(id) ON DELETE SET NULL");
    } catch (_e) {
        // Column already exists – ignore
    }

    // Populate client_accounts from clients.currency_id (idempotent)
    try {
        const existingClients = dbInstance.prepare("SELECT id, currency_id FROM clients WHERE currency_id IS NOT NULL").all();
        const insertAcc = dbInstance.prepare("INSERT OR IGNORE INTO client_accounts (client_id, currency_id) VALUES (?, ?)");
        const migrateAccounts = dbInstance.transaction(() => {
            for (const c of existingClients) insertAcc.run(c.id, c.currency_id);
        });
        migrateAccounts();
    } catch (_e) {
        // ignore
    }

    // Migrate old transactions schema → account_from_id / account_to_id
    try {
        const cols = dbInstance.pragma("table_info(transactions)").map((c) => c.name);
        if (!cols.includes("account_from_id") || !cols.includes("currency_id") || cols.includes("currency_from_id")) {
            dbInstance.exec("DROP TABLE IF EXISTS transactions");
            dbInstance.exec(`
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
                    description TEXT DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (account_from_id) REFERENCES client_accounts(id) ON DELETE CASCADE,
                    FOREIGN KEY (account_to_id) REFERENCES client_accounts(id) ON DELETE CASCADE,
                    FOREIGN KEY (currency_id) REFERENCES currencies(id) ON DELETE CASCADE
                )
            `);
        }
    } catch (_e) {
        // ignore
    }

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

function listOrganizations(app) {
    const { db } = getOrCreateDb(app);
    const stmt = db.prepare(`
      SELECT id, name, email, phone, address, tax_id as taxId, created_at as createdAt, updated_at as updatedAt
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
    const stmt = db.prepare(`
      INSERT INTO organizations (name, email, phone, address, tax_id)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
        organization.name.trim(),
        organization.email?.trim() || "",
        organization.phone?.trim() || "",
        organization.address?.trim() || "",
        organization.taxId?.trim() || "",
    );
}

function updateOrganization(app, organization) {
    if (!organization.id) {
        throw new Error("Organization id is required.");
    }

    if (!organization.name?.trim()) {
        throw new Error("Organization name is required.");
    }

    const { db } = getOrCreateDb(app);
    const stmt = db.prepare(`
      UPDATE organizations
      SET name = ?, email = ?, phone = ?, address = ?, tax_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(
        organization.name.trim(),
        organization.email?.trim() || "",
        organization.phone?.trim() || "",
        organization.address?.trim() || "",
        organization.taxId?.trim() || "",
        organization.id,
    );
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
            ca.created_at AS createdAt
        FROM client_accounts ca
        JOIN clients c ON c.id = ca.client_id
        JOIN currencies cur ON cur.id = ca.currency_id
        WHERE ca.client_id = ?
        ORDER BY cur.code ASC
    `).all(clientId);
}

function createClientAccount(app, { clientId, currencyId }) {
    if (!clientId || !currencyId) throw new Error("Client and currency are required.");
    const { db } = getOrCreateDb(app);
    db.prepare("INSERT OR IGNORE INTO client_accounts (client_id, currency_id) VALUES (?, ?)").run(clientId, currencyId);
}

function deleteClientAccount(app, accountId) {
    const { db } = getOrCreateDb(app);
    db.prepare("DELETE FROM client_accounts WHERE id = ?").run(accountId);
}

// ── Currencies ──────────────────────────────────────────────────────────────

function listCurrencies(app) {
    const { db } = getOrCreateDb(app);
    return db.prepare(`
        SELECT id, code, name, symbol, is_main as isMain, created_at as createdAt
        FROM currencies ORDER BY code COLLATE NOCASE ASC
    `).all();
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
            t.account_to_id AS accountToId,
            c_to.name AS clientToName,
            acur_to.code AS accountToCurrencyCode,
            t.currency_id AS currencyId,
            cur.code AS currencyCode,
            cur.symbol AS currencySymbol,
            t.amount,
            t.type,
            t.exchange_rate_from AS exchangeRateFrom,
            t.commission_from AS commissionFrom,
            t.exchange_rate_to AS exchangeRateTo,
            t.commission_to AS commissionTo,
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
        INSERT INTO transactions (account_from_id, account_to_id, currency_id, amount, type, exchange_rate_from, commission_from, exchange_rate_to, commission_to, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        txn.description?.trim() || "",
    );
}

function deleteTransaction(app, transactionId) {
    const { db } = getOrCreateDb(app);
    db.prepare("DELETE FROM transactions WHERE id = ?").run(transactionId);
}

module.exports = {
    getDbInfo,
    listAccounts,
    addAccount,
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
    deleteClientAccount,
    listCurrencies,
    createCurrency,
    updateCurrency,
    deleteCurrency,
    setMainCurrency,
    listTransactions,
    createTransaction,
    deleteTransaction,
};
