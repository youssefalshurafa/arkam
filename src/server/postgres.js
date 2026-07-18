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

// Neon (this project's Postgres host) auto-suspends its compute after a period of
// inactivity and "wakes up" on the next connection attempt — that cold start can take
// longer than a few seconds. Left unhandled this surfaced to users as "Connection
// terminated due to connection timeout" on the first request after any idle period (login
// being the most common one), forcing a manual refresh-and-retry. It's transient, not a
// real outage, so one retry after a short pause resolves the vast majority of cases
// automatically instead of surfacing an error the user has to retry themselves.
function isTransientConnectionError(error) {
    const message = String(error?.message || "");
    return (
        message.includes("Connection terminated") ||
        message.includes("timeout") ||
        error?.code === "ECONNRESET" ||
        error?.code === "ETIMEDOUT"
    );
}

async function withConnectionRetry(run) {
    try {
        return await run();
    } catch (error) {
        if (!isTransientConnectionError(error)) {
            throw error;
        }
        console.warn("[postgres] Transient connection error, retrying once:", error?.message || error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return run();
    }
}

function getPool() {
    if (!pool) {
        pool = new Pool({
            connectionString: getDatabaseUrl(),
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 15000,
            keepAlive: true,
            ...(shouldUseSsl() ? { ssl: { rejectUnauthorized: false } } : {}),
        });

        // Without this listener, an error on an already-idle pooled connection (e.g. the
        // server/proxy closing a socket server-side) is an *unhandled* 'error' event on the
        // Pool, which crashes the entire Node process. Logging and swallowing it here just
        // lets the pool discard that client and open a fresh one on the next query, same as
        // pg's own docs recommend.
        pool.on("error", (error) => {
            console.error("[postgres] Idle client error (pool recovers automatically):", error);
        });

        // Wrapped here (not just in the query() export below) so every caller gets retry
        // protection automatically, including auth-db.js's own runQuery()/fetchOne(), which
        // call `getPool().query(...)` directly.
        //
        // IMPORTANT: only .query() is safe to wrap this way. pg-pool's own Pool.query()
        // implementation calls `this.connect(callback)` *internally*, in callback style, to
        // check out a client before running the query — wrapping .connect() with a function
        // that ignores its arguments (as query() below does) swallows that callback, so pg's
        // internal query machinery waits forever for a callback that will never fire. That
        // was a real regression: it turned every query — including login — into an infinite
        // hang instead of a timeout. withTransaction() below applies the same retry directly
        // around its own `getPool().connect()` call instead, without touching the shared
        // .connect method.
        const rawQuery = pool.query.bind(pool);
        pool.query = (text, params) => withConnectionRetry(() => rawQuery(text, params));
    }

    return pool;
}

async function query(text, params = [], executor = getPool()) {
    return executor.query(text, params);
}

async function withTransaction(run) {
    const client = await withConnectionRetry(() => getPool().connect());

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

                    -- Access-approval gate. Self-service signups (credentials or Google) are
                    -- 'approved' immediately with a free trial window (see subscription_ends_at
                    -- below); 'pending'/'rejected' are only used for accounts a super admin
                    -- creates/reviews by hand. Existing users default to 'approved' so nobody is
                    -- locked out by this column's addition.
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';

                    -- Subscription window. Set to a free trial on signup, then extended by a paid
                    -- renewal (self-service or admin-approved). A user is signed out and blocked
                    -- from logging back in once subscription_ends_at passes (see auth-options.ts).
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ;
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ;

                    -- Extra profile details, settable from account settings after signup.
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

                    -- One renewal-payment request per submission (self-service, or from the
                    -- logged-out /renew page once a trial/subscription has lapsed). The payment
                    -- screenshot is stored inline as bytea and only served through the
                    -- super-admin-gated proof endpoint.
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

                    -- User-initiated password reset requests for username-only accounts that the
                    -- email-based /forgot-password flow can't reach. The user files a request; the
                    -- super admin verifies identity out-of-band (calling users.phone, the trusted
                    -- contact on file) and on approval mints a one-time reset link. A pending row
                    -- changes nothing about the account, so filing one can never lock a user out.
                    CREATE TABLE IF NOT EXISTS password_reset_requests (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        note TEXT NOT NULL DEFAULT '',
                        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        reviewed_at TIMESTAMPTZ,
                        reviewed_by TEXT
                    );

                    CREATE INDEX IF NOT EXISTS idx_password_reset_requests_status ON password_reset_requests(status);
                    CREATE INDEX IF NOT EXISTS idx_password_reset_requests_user_id ON password_reset_requests(user_id);

                    -- Global marketing images. One row per homepage "mockup slot"
                    -- (see src/config/marketing.ts). The super admin uploads a real
                    -- screenshot to replace the built-in CSS mockup; the bytes are
                    -- stored inline as bytea and served publicly through the
                    -- /api/marketing-image/[slot] route. An absent row means the
                    -- homepage falls back to its default CSS mockup.
                    CREATE TABLE IF NOT EXISTS marketing_assets (
                        slot TEXT PRIMARY KEY,
                        mime TEXT NOT NULL DEFAULT '',
                        data BYTEA,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );

                    -- Behavioral usage telemetry, surfaced only in the super-admin per-user
                    -- detail page (logins, app opens, and per-section page visits). One raw row
                    -- per event; the admin view aggregates them. workspace_id is nullable since
                    -- an app-open/login isn't tied to a specific workspace. No financial data.
                    CREATE TABLE IF NOT EXISTS user_activity_events (
                        id BIGSERIAL PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
                        event_type TEXT NOT NULL CHECK (event_type IN ('app_open', 'section_visit', 'login')),
                        section TEXT,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );

                    CREATE INDEX IF NOT EXISTS idx_user_activity_events_user ON user_activity_events(user_id, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_user_activity_events_user_type ON user_activity_events(user_id, event_type);

                    -- Audit trail of super-admin actions (approvals, deletions, password
                    -- resets, subscription changes, marketing edits). target_user_id is a
                    -- plain column, NOT a foreign key: the audit row must survive after the
                    -- user it refers to is deleted, so we snapshot email/name at write time.
                    CREATE TABLE IF NOT EXISTS admin_audit (
                        id BIGSERIAL PRIMARY KEY,
                        actor_email TEXT,
                        action TEXT NOT NULL,
                        target_user_id TEXT,
                        target_email TEXT,
                        target_name TEXT,
                        meta JSONB,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );

                    CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);
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

                ALTER TABLE ${schema}.clients ADD COLUMN IF NOT EXISTS exclude_from_balance BOOLEAN NOT NULL DEFAULT FALSE;

                CREATE TABLE IF NOT EXISTS ${schema}.client_accounts (
                    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    client_id INTEGER NOT NULL REFERENCES ${schema}.clients(id) ON DELETE CASCADE,
                    currency_id INTEGER NOT NULL REFERENCES ${schema}.currencies(id) ON DELETE CASCADE,
                    starting_balance DOUBLE PRECISION NOT NULL DEFAULT 0,
                    note TEXT NOT NULL DEFAULT '',
                    note_show_in_pdf BOOLEAN NOT NULL DEFAULT FALSE,
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

                -- Free-text "sticky note" attached to a single client-currency ledger. note_show_in_pdf
                -- controls whether it's rendered on that ledger's exported PDF statement.
                ALTER TABLE ${schema}.client_accounts ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
                ALTER TABLE ${schema}.client_accounts ADD COLUMN IF NOT EXISTS note_show_in_pdf BOOLEAN NOT NULL DEFAULT FALSE;

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
                -- For exchange (صرف) transactions: the real settled destination amount when it differs from
                -- the computed amount × exchange_rate_to. NULL means no override (use the computed value).
                -- The house's exchange gain/loss is derivable as amount * exchange_rate_to - exchange_actual_amount.
                ALTER TABLE ${schema}.transactions ADD COLUMN IF NOT EXISTS exchange_actual_amount DOUBLE PRECISION;

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

                -- Daily FX reference rates for حصاد اليوم (Today's Harvest) and Overview's
                -- balance cards — the SAME underlying rate, shared by both features (Overview
                -- always means "today"; Harvest can view/edit any past day via its
                -- day-navigator). One explicit row per (day, organization, currency); a day
                -- with no explicit row has no rate of its own — resolveHarvestRate on the
                -- client does an EXACT (day, organization, currency) lookup only, no fallback
                -- to another day, so a rate set on one day can never change what an earlier or
                -- later day (including Overview's "today") displays. organization_id is
                -- nullable ("no organization" bucket, matches clients.organization_id).
                -- "day" is TEXT (yyyy-mm-dd), not DATE: the rest of this app deliberately
                -- treats calendar days as opaque local strings (see localDateKey/createdAt
                -- handling) rather than DB/JS Date objects, specifically to dodge timezone
                -- conversion bugs — a DATE column would round-trip through node-postgres as a
                -- JS Date and serialize to a UTC ISO timestamp, silently breaking the plain
                -- string comparisons the resolver relies on.
                CREATE TABLE IF NOT EXISTS ${schema}.harvest_rates (
                    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    day TEXT NOT NULL,
                    organization_id INTEGER REFERENCES ${schema}.organizations(id) ON DELETE CASCADE,
                    currency_id INTEGER NOT NULL REFERENCES ${schema}.currencies(id) ON DELETE CASCADE,
                    rate DOUBLE PRECISION NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                -- Postgres treats NULL != NULL in a plain UNIQUE constraint, which would let
                -- two "no organization" rows coexist for the same (day, currency). This
                -- expression index folds NULL to -1 so exactly one row can exist per (day,
                -- currency, org-or-none); the ON CONFLICT upsert targets this same expression.
                -- ON DELETE CASCADE (not SET NULL like clients.organization_id): SET NULL could
                -- collide with an already-existing "no organization" row under this index,
                -- aborting the whole organization delete with a unique-violation. Cascading the
                -- (rare) loss of that org's own rate history is safer than a delete that can
                -- fail unpredictably.
                CREATE UNIQUE INDEX IF NOT EXISTS harvest_rates_day_currency_org_key
                    ON ${schema}.harvest_rates (day, currency_id, (COALESCE(organization_id, -1)));

                -- A pre-TEXT revision of this table created "day" as DATE in some workspace
                -- schemas before CREATE TABLE IF NOT EXISTS above locked in TEXT for new ones;
                -- a DATE column there never gets migrated by IF NOT EXISTS, and every rate saved
                -- into it comes back from node-postgres as a JS Date, JSON-serializing into a
                -- UTC timestamp that can never string-match a plain "yyyy-mm-dd" target day —
                -- silently unresolvable everywhere. date::text always yields 'YYYY-MM-DD' and
                -- text::text is a no-op, so this heals either type safely, every time.
                ALTER TABLE ${schema}.harvest_rates ALTER COLUMN day TYPE TEXT USING day::text;
            `);

            // NOTE: the currency catalog (ISO currencies + non-ISO extras like USDT) is
            // intentionally NOT seeded here. It's seeded by the app's reseed path
            // (db.seedCurrenciesForSchema, triggered from useWorkspaceData when the catalog
            // is empty/under-seeded) which needs Intl helpers that live in db.js — and db.js
            // requires this file, so seeding here would be a layering inversion. A previous
            // version seeded USDT alone at this point, which left the catalog non-empty and
            // silently defeated the client's "reseed when empty" trigger, so a fresh
            // workspace ended up with ONLY USDT and none of the 160+ ISO currencies.

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