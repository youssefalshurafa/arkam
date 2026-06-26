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
        return schemaName;
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
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            `);

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