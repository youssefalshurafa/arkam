/* eslint-disable @typescript-eslint/no-require-imports */
const { Pool } = require("pg");

let pool;
let publicSchemaReadyPromise;
const workspaceSchemaReadyPromises = new Map();

function getDatabaseUrl() {
    const databaseUrl = process.env.DATABASE_URL?.trim();

    if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for Postgres.");
    }

    return databaseUrl;
}

function shouldUseSsl() {
    const sslMode = process.env.POSTGRES_SSL?.trim().toLowerCase();
    return sslMode === "true" || sslMode === "1" || sslMode === "require";
}

function getPool() {
    if (!pool) {
        pool = new Pool({
            connectionString: getDatabaseUrl(),
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
            ...(shouldUseSsl() ? { ssl: { rejectUnauthorized: false } } : {}),
        });
    }

    return pool;
}

async function query(text, params = [], executor = getPool()) {
    return executor.query(text, params);
}

async function withTransaction(run) {
    const client = await getPool().connect();

    try {
        await client.query("BEGIN");
        const result = await run(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

function quoteIdentifier(identifier) {
    return `"${String(identifier).replace(/"/g, '""')}"`;
}

function getWorkspaceSchemaName(workspaceId) {
    const rawWorkspaceId = typeof workspaceId === "string" ? workspaceId.trim() : "";
    const safeWorkspaceId = (rawWorkspaceId || "public")
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase();

    return `workspace_${safeWorkspaceId || "public"}`;
}

function getDatabaseMetadata() {
    const databaseUrl = new URL(getDatabaseUrl());

    return {
        provider: "postgres",
        host: databaseUrl.hostname,
        port: databaseUrl.port || "5432",
        database: databaseUrl.pathname.replace(/^\//, "") || "postgres",
    };
}

async function ensurePublicSchema() {
    if (!publicSchemaReadyPromise) {
        publicSchemaReadyPromise = (async () => {
            // Advisory lock (class=1, key=1) serializes concurrent DDL across all server
            // instances, preventing the pg_type_typname_nsp_index race condition that
            // occurs when two requests try to CREATE TABLE at the exact same moment.
            await withTransaction(async (client) => {
                await client.query("SELECT pg_advisory_xact_lock(1, 1)");
                await client.query(`
                    CREATE TABLE IF NOT EXISTS users (
                        id TEXT PRIMARY KEY,
                        email TEXT NOT NULL UNIQUE,
                        name TEXT NOT NULL,
                        password_hash TEXT,
                        image TEXT,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );

                    CREATE TABLE IF NOT EXISTS workspaces (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        slug TEXT NOT NULL UNIQUE,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );

                    CREATE TABLE IF NOT EXISTS workspace_members (
                        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        PRIMARY KEY (workspace_id, user_id)
                    );

                    CREATE TABLE IF NOT EXISTS password_reset_tokens (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        token_hash TEXT NOT NULL UNIQUE,
                        expires_at TIMESTAMPTZ NOT NULL,
                        used_at TIMESTAMPTZ,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );

                    CREATE TABLE IF NOT EXISTS email_verification_tokens (
                        id TEXT PRIMARY KEY,
                        email TEXT NOT NULL,
                        name TEXT NOT NULL,
                        token_hash TEXT NOT NULL UNIQUE,
                        expires_at TIMESTAMPTZ NOT NULL,
                        used_at TIMESTAMPTZ,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );

                    CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id);
                    CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON workspace_members(workspace_id);
                    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
                    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);
                    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_email ON email_verification_tokens(email);

                    -- Access-approval gate: new signups are 'pending' until the super admin approves
                    -- their payment. Existing users default to 'approved' so nobody is locked out.
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';

                    -- Subscription window, set when the super admin approves/renews a payment.
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ;
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ;

                    -- Extra profile details collected at signup (carried through the
                    -- verification token, then persisted on the user).
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS company TEXT NOT NULL DEFAULT '';
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT '';
                    ALTER TABLE email_verification_tokens ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
                    ALTER TABLE email_verification_tokens ADD COLUMN IF NOT EXISTS company TEXT NOT NULL DEFAULT '';
                    ALTER TABLE email_verification_tokens ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT '';

                    -- Last data backup, stored on the workspace so the indicator syncs
                    -- across every device the user signs in from (not just the browser
                    -- that downloaded it). last_backup_device records where it came from.
                    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS last_backup_at TIMESTAMPTZ;
                    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS last_backup_device TEXT;

                    -- One payment/approval request per signup. The payment screenshot is stored
                    -- inline as bytea and only served through the super-admin-gated proof endpoint.
                    CREATE TABLE IF NOT EXISTS access_requests (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        plan TEXT NOT NULL DEFAULT '',
                        amount TEXT NOT NULL DEFAULT '',
                        network TEXT NOT NULL DEFAULT '',
                        tx_reference TEXT NOT NULL DEFAULT '',
                        proof_mime TEXT NOT NULL DEFAULT '',
                        proof_data BYTEA,
                        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
                        note TEXT NOT NULL DEFAULT '',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        reviewed_at TIMESTAMPTZ,
                        reviewed_by TEXT
                    );

                    CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);
                    CREATE INDEX IF NOT EXISTS idx_access_requests_user_id ON access_requests(user_id);

                    -- Length (in days) of the plan tier the user paid for; drives the
                    -- subscription window on approval and the extension on renewal.
                    ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS duration_days INTEGER NOT NULL DEFAULT 30;
                `);
            });
        })().catch((error) => {
            publicSchemaReadyPromise = undefined;
            throw error;
        });
    }

    return publicSchemaReadyPromise;
}

async function ensureWorkspaceSchema(workspaceId) {
    const schemaName = getWorkspaceSchemaName(workspaceId);
    const existing = workspaceSchemaReadyPromises.get(schemaName);

    if (existing) {
        // Return the in-flight promise (not the bare name) so concurrent callers
        // WAIT for the schema/tables to finish being created before querying them.
        // Returning the name early caused a race: parallel queries on a workspace's
        // first load could hit "relation ... does not exist".
        return existing;
    }

    const schemaReadyPromise = (async () => {
        // Advisory lock (class=2, key=hashtext(schemaName)) serializes concurrent DDL
        // for this specific workspace schema, preventing pg_type_typname_nsp_index races.
        return withTransaction(async (client) => {
            await client.query("SELECT pg_advisory_xact_lock(2, hashtext($1))", [schemaName]);
            const schema = quoteIdentifier(schemaName);

            await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
            await client.query(`
                CREATE TABLE IF NOT EXISTS ${schema}.organizations (
                    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS ${schema}.currencies (
                    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    code TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    symbol TEXT NOT NULL DEFAULT '',
                    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                    is_main BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS ${schema}.clients (
                    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    organization_id INTEGER REFERENCES ${schema}.organizations(id) ON DELETE SET NULL,
                    currency_id INTEGER REFERENCES ${schema}.currencies(id) ON DELETE SET NULL,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL DEFAULT '',
                    phone TEXT NOT NULL DEFAULT '',
                    address TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS ${schema}.client_accounts (
                    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    client_id INTEGER NOT NULL REFERENCES ${schema}.clients(id) ON DELETE CASCADE,
                    currency_id INTEGER NOT NULL REFERENCES ${schema}.currencies(id) ON DELETE CASCADE,
                    starting_balance DOUBLE PRECISION NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (client_id, currency_id)
                );

                CREATE TABLE IF NOT EXISTS ${schema}.transactions (
                    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    account_from_id INTEGER NOT NULL REFERENCES ${schema}.client_accounts(id) ON DELETE CASCADE,
                    account_to_id INTEGER NOT NULL REFERENCES ${schema}.client_accounts(id) ON DELETE CASCADE,
                    currency_id INTEGER NOT NULL REFERENCES ${schema}.currencies(id) ON DELETE CASCADE,
                    amount DOUBLE PRECISION NOT NULL,
                    type TEXT NOT NULL DEFAULT 'exchange',
                    exchange_rate_from DOUBLE PRECISION NOT NULL DEFAULT 1,
                    commission_from DOUBLE PRECISION NOT NULL DEFAULT 0,
                    exchange_rate_to DOUBLE PRECISION NOT NULL DEFAULT 1,
                    commission_to DOUBLE PRECISION NOT NULL DEFAULT 0,
                    exchange_rate_from_reversed BOOLEAN NOT NULL DEFAULT FALSE,
                    exchange_rate_to_reversed BOOLEAN NOT NULL DEFAULT FALSE,
                    charges DOUBLE PRECISION NOT NULL DEFAULT 0,
                    charges_currency_id INTEGER REFERENCES ${schema}.currencies(id) ON DELETE SET NULL,
                    charges_payer TEXT NOT NULL DEFAULT '',
                    charges_exchange_rate DOUBLE PRECISION NOT NULL DEFAULT 1,
                    charges_description TEXT NOT NULL DEFAULT '',
                    description TEXT NOT NULL DEFAULT '',
                    archive_note TEXT NOT NULL DEFAULT '',
                    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS ${schema}.client_adjustments (
                    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    account_id INTEGER NOT NULL REFERENCES ${schema}.client_accounts(id) ON DELETE CASCADE,
                    amount DOUBLE PRECISION NOT NULL,
                    direction TEXT NOT NULL DEFAULT 'debit',
                    currency_id INTEGER REFERENCES ${schema}.currencies(id) ON DELETE SET NULL,
                    currency_code TEXT NOT NULL DEFAULT '',
                    currency_symbol TEXT NOT NULL DEFAULT '',
                    exchange_rate DOUBLE PRECISION NOT NULL DEFAULT 1,
                    exchange_rate_reversed BOOLEAN NOT NULL DEFAULT FALSE,
                    description TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                ALTER TABLE ${schema}.client_adjustments ADD COLUMN IF NOT EXISTS currency_id INTEGER REFERENCES ${schema}.currencies(id) ON DELETE SET NULL;
                ALTER TABLE ${schema}.client_adjustments ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT '';
                ALTER TABLE ${schema}.client_adjustments ADD COLUMN IF NOT EXISTS currency_symbol TEXT NOT NULL DEFAULT '';
                ALTER TABLE ${schema}.client_adjustments ADD COLUMN IF NOT EXISTS exchange_rate DOUBLE PRECISION NOT NULL DEFAULT 1;
                ALTER TABLE ${schema}.client_adjustments ADD COLUMN IF NOT EXISTS exchange_rate_reversed BOOLEAN NOT NULL DEFAULT FALSE;

                -- A transaction may be missing one party (e.g. money received from an unknown sender);
                -- such incomplete transactions surface in the Archive until both parties are filled in.
                ALTER TABLE ${schema}.transactions ALTER COLUMN account_from_id DROP NOT NULL;
                ALTER TABLE ${schema}.transactions ALTER COLUMN account_to_id DROP NOT NULL;
                -- Free-text note shown in the Archive's "More info" column.
                ALTER TABLE ${schema}.transactions ADD COLUMN IF NOT EXISTS archive_note TEXT NOT NULL DEFAULT '';
                -- Archive-only records: historical transactions from before the DB. They live only in the
                -- Archive, never affect client balances/ledgers, and never appear in the main transactions list.
                ALTER TABLE ${schema}.transactions ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
                -- Optional per-side description overrides. When set, the sender ("from") and/or receiver ("to")
                -- ledger shows this text instead of the shared description; empty means fall back to description.
                ALTER TABLE ${schema}.transactions ADD COLUMN IF NOT EXISTS description_from TEXT NOT NULL DEFAULT '';
                ALTER TABLE ${schema}.transactions ADD COLUMN IF NOT EXISTS description_to TEXT NOT NULL DEFAULT '';

                -- Single-row store for workspace-wide UI settings shared across members.
                -- "settings" holds a snapshot of the shared ledger/transaction table
                -- preferences (a map of localStorage keys to values); "version" bumps on
                -- every owner save so each client re-applies only when it advances.
                CREATE TABLE IF NOT EXISTS ${schema}.workspace_settings (
                    id INTEGER PRIMARY KEY DEFAULT 1,
                    shared_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
                    version BIGINT NOT NULL DEFAULT 0,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT workspace_settings_singleton CHECK (id = 1)
                );

                -- Per-user table layout settings (ledger column visibility/order, transaction
                -- table settings, etc. — the same snapshot shape as the owner-shared settings
                -- above). Persisted server-side per (user, workspace) so a user's layout choices
                -- survive a cleared browser/new device instead of silently resetting to default,
                -- and round-trip through the manual backup like any other workspace data.
                -- id is a surrogate key (not user_id) so this table fits the generic backup
                -- export/import path, which orders by and realigns an integer "id" sequence.
                CREATE TABLE IF NOT EXISTS ${schema}.user_table_settings (
                    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    user_id TEXT NOT NULL UNIQUE,
                    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                -- Reconciliation marks: a client agreed their balance was correct at a
                -- specific ledger row. Keyed per client account (a transaction sits in two
                -- ledgers, but each side is reconciled independently). "anchor_created_at"
                -- + "anchor_ref_id" reproduce the ledger's (createdAt, id) sort order and
                -- form the lock boundary; anything at or before it is protected. "balance"
                -- captures the agreed running balance for display/verification. Multiple
                -- marks per account are kept as an audit trail; the newest is the lock line.
                CREATE TABLE IF NOT EXISTS ${schema}.reconciliations (
                    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    account_id INTEGER NOT NULL REFERENCES ${schema}.client_accounts(id) ON DELETE CASCADE,
                    anchor_kind TEXT NOT NULL DEFAULT 'transaction',
                    anchor_ref_id INTEGER NOT NULL,
                    anchor_created_at TIMESTAMPTZ NOT NULL,
                    balance DOUBLE PRECISION NOT NULL DEFAULT 0,
                    note TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            `);

            // Non-ISO currencies (e.g. crypto/stablecoins) aren't in Intl's currency list,
            // so seed them into the catalog here. DO NOTHING keeps any user edits/enabled state intact.
            await client.query(
                `INSERT INTO ${schema}.currencies (code, name, symbol)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (code) DO NOTHING`,
                ['USDT', 'Tether (USDT)', '₮'],
            );

            return schemaName;
        });
    })().catch((error) => {
        workspaceSchemaReadyPromises.delete(schemaName);
        throw error;
    });

    workspaceSchemaReadyPromises.set(schemaName, schemaReadyPromise);
    return schemaReadyPromise;
}

async function dropWorkspaceSchema(workspaceId) {
    const schemaName = getWorkspaceSchemaName(workspaceId);
    const schema = quoteIdentifier(schemaName);

    workspaceSchemaReadyPromises.delete(schemaName);
    await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
}

module.exports = {
    getPool,
    query,
    withTransaction,
    quoteIdentifier,
    getWorkspaceSchemaName,
    getDatabaseMetadata,
    ensurePublicSchema,
    ensureWorkspaceSchema,
    dropWorkspaceSchema,
};