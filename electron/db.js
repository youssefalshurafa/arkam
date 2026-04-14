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

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_from_id INTEGER NOT NULL,
            client_to_id INTEGER NOT NULL,
            type TEXT NOT NULL DEFAULT 'exchange',
            currency_from_id INTEGER NOT NULL,
            currency_to_id INTEGER NOT NULL,
            amount_from REAL NOT NULL,
            amount_to REAL NOT NULL,
            exchange_rate REAL NOT NULL,
            description TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (client_from_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (client_to_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (currency_from_id) REFERENCES currencies(id),
            FOREIGN KEY (currency_to_id) REFERENCES currencies(id)
        );
  `);

    // Migrate existing clients table to add currency_id if it doesn't exist
    try {
        dbInstance.exec("ALTER TABLE clients ADD COLUMN currency_id INTEGER REFERENCES currencies(id) ON DELETE SET NULL");
    } catch (_e) {
        // Column already exists – ignore
    }

    // Migrate transactions table: old schema had client_id, new one has client_from_id + client_to_id
    try {
        const cols = dbInstance.pragma("table_info(transactions)").map((c) => c.name);
        if (cols.includes("client_id") && !cols.includes("client_from_id")) {
            dbInstance.exec("DROP TABLE transactions");
            dbInstance.exec(`
                CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    client_from_id INTEGER NOT NULL,
                    client_to_id INTEGER NOT NULL,
                    type TEXT NOT NULL DEFAULT 'exchange',
                    currency_from_id INTEGER NOT NULL,
                    currency_to_id INTEGER NOT NULL,
                    amount_from REAL NOT NULL,
                    amount_to REAL NOT NULL,
                    exchange_rate REAL NOT NULL,
                    description TEXT DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (client_from_id) REFERENCES clients(id) ON DELETE CASCADE,
                    FOREIGN KEY (client_to_id) REFERENCES clients(id) ON DELETE CASCADE,
                    FOREIGN KEY (currency_from_id) REFERENCES currencies(id),
                    FOREIGN KEY (currency_to_id) REFERENCES currencies(id)
                )
            `);
        }
    } catch (_e) {
        // Table doesn't exist yet or already migrated – ignore
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
        clients.currency_id as currencyId,
        currencies.code as currencyCode,
        currencies.symbol as currencySymbol,
        clients.name,
        clients.email,
        clients.phone,
        clients.address,
        clients.created_at as createdAt,
        clients.updated_at as updatedAt
      FROM clients
      LEFT JOIN organizations ON organizations.id = clients.organization_id
      LEFT JOIN currencies ON currencies.id = clients.currency_id
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
      INSERT INTO clients (organization_id, currency_id, name, email, phone, address)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
        client.organizationId || null,
        client.currencyId || null,
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
      SET organization_id = ?, currency_id = ?, name = ?, email = ?, phone = ?, address = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(
        client.organizationId || null,
        client.currencyId || null,
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
            t.client_from_id AS clientFromId,
            cfrom.name AS clientFromName,
            t.client_to_id AS clientToId,
            cto.name AS clientToName,
            t.type,
            t.currency_from_id AS currencyFromId,
            cf.code AS currencyFromCode,
            cf.symbol AS currencyFromSymbol,
            t.currency_to_id AS currencyToId,
            ct.code AS currencyToCode,
            ct.symbol AS currencyToSymbol,
            t.amount_from AS amountFrom,
            t.amount_to AS amountTo,
            t.exchange_rate AS exchangeRate,
            t.description,
            t.created_at AS createdAt
        FROM transactions t
        JOIN clients cfrom ON cfrom.id = t.client_from_id
        JOIN clients cto ON cto.id = t.client_to_id
        JOIN currencies cf ON cf.id = t.currency_from_id
        JOIN currencies ct ON ct.id = t.currency_to_id
        ORDER BY t.created_at DESC
    `).all();
}

function createTransaction(app, txn) {
    if (!txn.clientFromId || !txn.clientToId) throw new Error("Both clients are required.");
    if (!txn.currencyFromId || !txn.currencyToId) throw new Error("Both currencies are required.");
    if (!txn.amountFrom || txn.amountFrom <= 0) throw new Error("Amount must be greater than zero.");
    if (!txn.exchangeRate || txn.exchangeRate <= 0) throw new Error("Exchange rate must be greater than zero.");

    const { db } = getOrCreateDb(app);
    db.prepare(`
        INSERT INTO transactions (client_from_id, client_to_id, type, currency_from_id, currency_to_id, amount_from, amount_to, exchange_rate, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        txn.clientFromId,
        txn.clientToId,
        txn.type || "exchange",
        txn.currencyFromId,
        txn.currencyToId,
        txn.amountFrom,
        txn.amountTo,
        txn.exchangeRate,
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
    listCurrencies,
    createCurrency,
    updateCurrency,
    deleteCurrency,
    setMainCurrency,
    listTransactions,
    createTransaction,
    deleteTransaction,
};
