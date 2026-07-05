/* eslint-disable @typescript-eslint/no-require-imports */
const {
    query,
    withTransaction,
    quoteIdentifier,
    getWorkspaceSchemaName,
    getDatabaseMetadata,
    ensureWorkspaceSchema,
} = require('@/server/postgres');

function getWorkspaceId(app) {
    const rawWorkspaceId = typeof app?.workspaceId === 'string' ? app.workspaceId.trim() : '';
    return rawWorkspaceId || 'public';
}

async function getSchemaInfo(app) {
    const workspaceId = getWorkspaceId(app);
    const schemaName = await ensureWorkspaceSchema(workspaceId);

    return {
        workspaceId,
        schemaName,
        schema: quoteIdentifier(schemaName),
    };
}

function getSupportedCurrencyCodes() {
    if (typeof Intl.supportedValuesOf === 'function') {
        return Intl.supportedValuesOf('currency');
    }

    return ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'AED', 'SAR', 'MAD'];
}

function getCurrencyDisplayName(code) {
    try {
        if (typeof Intl.DisplayNames === 'function') {
            return new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) || code;
        }
    } catch {
        // ignore
    }

    return code;
}

function getCurrencySymbol(code) {
    try {
        const narrowSymbol = new Intl.NumberFormat('en', {
            style: 'currency',
            currency: code,
            currencyDisplay: 'narrowSymbol',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).formatToParts(0).find((part) => part.type === 'currency')?.value;

        if (narrowSymbol) {
            return narrowSymbol;
        }

        const symbol = new Intl.NumberFormat('en', {
            style: 'currency',
            currency: code,
            currencyDisplay: 'symbol',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).formatToParts(0).find((part) => part.type === 'currency')?.value;

        return symbol || code;
    } catch {
        return code;
    }
}

// Non-ISO currencies (crypto/stablecoins) that Intl doesn't know about.
const EXTRA_CURRENCIES = [{ code: 'USDT', name: 'Tether (USDT)', symbol: '₮' }];

async function seedCurrenciesForSchema(schema, executor) {
    const isoCurrencies = getSupportedCurrencyCodes().map((code) => ({
        code,
        name: getCurrencyDisplayName(code),
        symbol: getCurrencySymbol(code),
    }));

    for (const { code, name, symbol } of [...isoCurrencies, ...EXTRA_CURRENCIES]) {
        await query(
            `
                INSERT INTO ${schema}.currencies (code, name, symbol)
                VALUES ($1, $2, $3)
                ON CONFLICT (code) DO UPDATE SET
                    name = EXCLUDED.name,
                    symbol = EXCLUDED.symbol
            `,
            [code, name, symbol],
            executor,
        );
    }

    await query(`UPDATE ${schema}.currencies SET is_main = FALSE WHERE is_enabled = FALSE`, [], executor);

    const enabledCount = Number((await query(`SELECT COUNT(*) AS count FROM ${schema}.currencies WHERE is_enabled = TRUE`, [], executor)).rows[0]?.count || 0);
    const enabledMainCount = Number((await query(`SELECT COUNT(*) AS count FROM ${schema}.currencies WHERE is_enabled = TRUE AND is_main = TRUE`, [], executor)).rows[0]?.count || 0);

    if (enabledCount > 0 && enabledMainCount === 0) {
        const setUsdAsMain = await query(`UPDATE ${schema}.currencies SET is_main = TRUE WHERE is_enabled = TRUE AND code = $1`, ['USD'], executor);

        if (!setUsdAsMain.rowCount) {
            await query(
                `
                    UPDATE ${schema}.currencies
                    SET is_main = TRUE
                    WHERE id = (
                        SELECT id
                        FROM ${schema}.currencies
                        WHERE is_enabled = TRUE
                        ORDER BY LOWER(code) ASC
                        LIMIT 1
                    )
                `,
                [],
                executor,
            );
        }
    }
}

async function getDbInfo(app) {
    const schemaInfo = await getSchemaInfo(app);
    const metadata = getDatabaseMetadata();

    return {
        provider: metadata.provider,
        host: metadata.host,
        port: metadata.port,
        database: metadata.database,
        schema: schemaInfo.schemaName,
        supportsDirectoryChange: false,
        dbDirectory: `${metadata.host}:${metadata.port}/${metadata.database}`,
        dbPath: schemaInfo.schemaName,
    };
}

async function setDbDirectory() {
    throw new Error('Database folders are not used with Postgres. Update DATABASE_URL instead.');
}

async function listOrganizations(app) {
    const { schema } = await getSchemaInfo(app);
    const result = await query(`
        SELECT id, name, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM ${schema}.organizations
        ORDER BY LOWER(name) ASC
    `);
    return result.rows;
}

async function createOrganization(app, organization) {
    if (!organization.name?.trim()) {
        throw new Error('Organization name is required.');
    }

    const { schema } = await getSchemaInfo(app);
    await query(`INSERT INTO ${schema}.organizations (name) VALUES ($1)`, [organization.name.trim()]);
}

async function updateOrganization(app, organization) {
    if (!organization.id) {
        throw new Error('Organization id is required.');
    }

    if (!organization.name?.trim()) {
        throw new Error('Organization name is required.');
    }

    const { schema } = await getSchemaInfo(app);
    await query(`UPDATE ${schema}.organizations SET name = $1, updated_at = NOW() WHERE id = $2`, [organization.name.trim(), organization.id]);
}

async function deleteOrganization(app, organizationId) {
    const { schema } = await getSchemaInfo(app);
    await query(`DELETE FROM ${schema}.organizations WHERE id = $1`, [organizationId]);
}

async function listClients(app) {
    const { schema } = await getSchemaInfo(app);
    const result = await query(`
        SELECT
            clients.id,
            clients.organization_id AS "organizationId",
            organizations.name AS "organizationName",
            clients.name,
            clients.email,
            clients.phone,
            clients.address,
            clients.created_at AS "createdAt",
            clients.updated_at AS "updatedAt",
            (
                SELECT COUNT(*)
                FROM ${schema}.client_accounts
                WHERE client_id = clients.id
            )::integer AS "accountCount"
        FROM ${schema}.clients clients
        LEFT JOIN ${schema}.organizations organizations ON organizations.id = clients.organization_id
        ORDER BY LOWER(clients.name) ASC
    `);
    return result.rows;
}

async function createClient(app, client) {
    if (!client.name?.trim()) {
        throw new Error('Client name is required.');
    }

    const { schema } = await getSchemaInfo(app);
    const result = await query(
        `
            INSERT INTO ${schema}.clients (organization_id, name, email, phone, address)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        `,
        [
            client.organizationId || null,
            client.name.trim(),
            client.email?.trim() || '',
            client.phone?.trim() || '',
            client.address?.trim() || '',
        ],
    );

    return result.rows[0]?.id || null;
}

async function updateClient(app, client) {
    if (!client.id) {
        throw new Error('Client id is required.');
    }

    if (!client.name?.trim()) {
        throw new Error('Client name is required.');
    }

    const { schema } = await getSchemaInfo(app);
    await query(
        `
            UPDATE ${schema}.clients
            SET organization_id = $1, name = $2, email = $3, phone = $4, address = $5, updated_at = NOW()
            WHERE id = $6
        `,
        [
            client.organizationId || null,
            client.name.trim(),
            client.email?.trim() || '',
            client.phone?.trim() || '',
            client.address?.trim() || '',
            client.id,
        ],
    );
}

async function deleteClient(app, clientId) {
    const { schema } = await getSchemaInfo(app);
    await query(`DELETE FROM ${schema}.clients WHERE id = $1`, [clientId]);
}

async function deleteAllClients(app) {
    const { schema } = await getSchemaInfo(app);
    await query(`DELETE FROM ${schema}.clients`);
}

async function listAllClientAccounts(app) {
    const { schema } = await getSchemaInfo(app);
    const result = await query(`
        SELECT
            ca.id,
            ca.client_id AS "clientId",
            c.name AS "clientName",
            ca.currency_id AS "currencyId",
            cur.code AS "currencyCode",
            cur.symbol AS "currencySymbol",
            ca.starting_balance AS "startingBalance",
            ca.created_at AS "createdAt"
        FROM ${schema}.client_accounts ca
        JOIN ${schema}.clients c ON c.id = ca.client_id
        JOIN ${schema}.currencies cur ON cur.id = ca.currency_id
        ORDER BY LOWER(c.name) ASC, cur.code ASC
    `);
    return result.rows;
}

async function listClientAccounts(app, clientId) {
    const { schema } = await getSchemaInfo(app);
    const result = await query(`
        SELECT
            ca.id,
            ca.client_id AS "clientId",
            c.name AS "clientName",
            ca.currency_id AS "currencyId",
            cur.code AS "currencyCode",
            cur.symbol AS "currencySymbol",
            ca.starting_balance AS "startingBalance",
            ca.created_at AS "createdAt"
        FROM ${schema}.client_accounts ca
        JOIN ${schema}.clients c ON c.id = ca.client_id
        JOIN ${schema}.currencies cur ON cur.id = ca.currency_id
        WHERE ca.client_id = $1
        ORDER BY cur.code ASC
    `, [clientId]);
    return result.rows;
}

async function createClientAccount(app, { clientId, currencyId, startingBalance }) {
    if (!clientId || !currencyId) {
        throw new Error('Client and currency are required.');
    }

    const { schema } = await getSchemaInfo(app);
    await query(
        `
            INSERT INTO ${schema}.client_accounts (client_id, currency_id, starting_balance)
            VALUES ($1, $2, $3)
            ON CONFLICT (client_id, currency_id) DO NOTHING
        `,
        [clientId, currencyId, startingBalance ?? 0],
    );
}

async function updateClientAccountStartingBalance(app, { accountId, startingBalance }) {
    if (!accountId) {
        throw new Error('Account id is required.');
    }

    const { schema } = await getSchemaInfo(app);
    await query(`UPDATE ${schema}.client_accounts SET starting_balance = $1 WHERE id = $2`, [startingBalance ?? 0, accountId]);
}

async function updateClientAccount(app, { accountId, currencyId, startingBalance }) {
    if (!accountId) {
        throw new Error('Account id is required.');
    }

    const { schema } = await getSchemaInfo(app);
    await query(
        `UPDATE ${schema}.client_accounts SET currency_id = $1, starting_balance = $2 WHERE id = $3`,
        [currencyId, startingBalance ?? 0, accountId],
    );
}

async function deleteClientAccount(app, accountId) {
    const { schema } = await getSchemaInfo(app);
    await query(`DELETE FROM ${schema}.client_accounts WHERE id = $1`, [accountId]);
}

// Re-points every transaction (both the "from" and "to" sides) and every adjustment from one
// account onto another, then leaves the now-empty source account in place. Both accounts must
// share the same currency: the stored per-side exchange rates convert into the original account's
// currency, so moving to a different-currency account would silently corrupt the ledger.
async function moveAccountTransactions(app, { fromAccountId, toAccountId }) {
    const from = Number(fromAccountId);
    const to = Number(toAccountId);
    if (!from || !to) {
        throw new Error('Source and destination accounts are required.');
    }
    if (from === to) {
        throw new Error('Source and destination accounts must be different.');
    }

    const { schema } = await getSchemaInfo(app);
    const accountsResult = await query(
        `SELECT id, currency_id AS "currencyId" FROM ${schema}.client_accounts WHERE id = ANY($1::bigint[])`,
        [[from, to]],
    );
    const fromAccount = accountsResult.rows.find((row) => Number(row.id) === from);
    const toAccount = accountsResult.rows.find((row) => Number(row.id) === to);
    if (!fromAccount || !toAccount) {
        throw new Error('One of the selected accounts no longer exists.');
    }
    if (Number(fromAccount.currencyId) !== Number(toAccount.currencyId)) {
        throw new Error('Both accounts must use the same currency.');
    }

    let moved = 0;
    await withTransaction(async (executor) => {
        const fromSide = await query(`UPDATE ${schema}.transactions SET account_from_id = $1 WHERE account_from_id = $2`, [to, from], executor);
        const toSide = await query(`UPDATE ${schema}.transactions SET account_to_id = $1 WHERE account_to_id = $2`, [to, from], executor);
        const adjustments = await query(`UPDATE ${schema}.client_adjustments SET account_id = $1 WHERE account_id = $2`, [to, from], executor);
        moved = (fromSide.rowCount || 0) + (toSide.rowCount || 0) + (adjustments.rowCount || 0);
    });

    return { ok: true, moved };
}

async function listCurrencies(app) {
    const { schema } = await getSchemaInfo(app);
    const result = await query(`
        SELECT
            id,
            code,
            name,
            symbol,
            CASE WHEN is_enabled THEN 1 ELSE 0 END AS "isEnabled",
            CASE WHEN is_main THEN 1 ELSE 0 END AS "isMain",
            created_at AS "createdAt"
        FROM ${schema}.currencies
        ORDER BY LOWER(code) ASC
    `);
    return result.rows;
}

async function enableCurrency(app, currencyId) {
    const { schema } = await getSchemaInfo(app);

    await withTransaction(async (client) => {
        await query(`UPDATE ${schema}.currencies SET is_enabled = TRUE WHERE id = $1`, [currencyId], client);
        const mainCount = Number((await query(`SELECT COUNT(*) AS count FROM ${schema}.currencies WHERE is_enabled = TRUE AND is_main = TRUE`, [], client)).rows[0]?.count || 0);

        if (!mainCount) {
            await query(`UPDATE ${schema}.currencies SET is_main = TRUE WHERE id = $1`, [currencyId], client);
        }
    });
}

async function disableCurrency(app, currencyId) {
    const { schema } = await getSchemaInfo(app);

    await withTransaction(async (client) => {
        await query(`UPDATE ${schema}.currencies SET is_enabled = FALSE, is_main = FALSE WHERE id = $1`, [currencyId], client);
        const mainCount = Number((await query(`SELECT COUNT(*) AS count FROM ${schema}.currencies WHERE is_enabled = TRUE AND is_main = TRUE`, [], client)).rows[0]?.count || 0);

        if (!mainCount) {
            const setUsdAsMain = await query(`UPDATE ${schema}.currencies SET is_main = TRUE WHERE is_enabled = TRUE AND code = $1`, ['USD'], client);

            if (!setUsdAsMain.rowCount) {
                await query(
                    `
                        UPDATE ${schema}.currencies
                        SET is_main = TRUE
                        WHERE id = (
                            SELECT id
                            FROM ${schema}.currencies
                            WHERE is_enabled = TRUE
                            ORDER BY LOWER(code) ASC
                            LIMIT 1
                        )
                    `,
                    [],
                    client,
                );
            }
        }
    });
}

async function createCurrency(app, currency) {
    if (!currency.code?.trim() || !currency.name?.trim()) {
        throw new Error('Currency code and name are required.');
    }

    const { schema } = await getSchemaInfo(app);
    await query(
        `INSERT INTO ${schema}.currencies (code, name, symbol) VALUES ($1, $2, $3)`,
        [currency.code.trim().toUpperCase(), currency.name.trim(), currency.symbol?.trim() || ''],
    );
}

async function updateCurrency(app, currency) {
    if (!currency.id) {
        throw new Error('Currency id is required.');
    }
    if (!currency.code?.trim() || !currency.name?.trim()) {
        throw new Error('Currency code and name are required.');
    }

    const { schema } = await getSchemaInfo(app);
    const code = currency.code.trim().toUpperCase();
    const symbol = currency.symbol?.trim() || '';

    await withTransaction(async (client) => {
        await query(
            `UPDATE ${schema}.currencies SET code = $1, name = $2, symbol = $3 WHERE id = $4`,
            [code, currency.name.trim(), symbol, currency.id],
            client,
        );
        // client_adjustments stores a denormalized copy of the currency code/symbol; keep it in sync.
        await query(
            `UPDATE ${schema}.client_adjustments SET currency_code = $1, currency_symbol = $2 WHERE currency_id = $3`,
            [code, symbol, currency.id],
            client,
        );
    });
}

async function deleteCurrency(app, currencyId) {
    const { schema } = await getSchemaInfo(app);
    await query(`DELETE FROM ${schema}.currencies WHERE id = $1`, [currencyId]);
}

async function deleteAllCurrencies(app) {
    const { schema } = await getSchemaInfo(app);
    await query(`DELETE FROM ${schema}.currencies`);
}

async function reseedCurrencies(app) {
    const { schema } = await getSchemaInfo(app);
    await withTransaction((client) => seedCurrenciesForSchema(schema, client));
}

async function setMainCurrency(app, currencyId) {
    const { schema } = await getSchemaInfo(app);
    const result = await query(
        `SELECT id, CASE WHEN is_enabled THEN 1 ELSE 0 END AS "isEnabled" FROM ${schema}.currencies WHERE id = $1`,
        [currencyId],
    );
    const currency = result.rows[0];

    if (!currency) {
        throw new Error('Currency not found.');
    }
    if (!currency.isEnabled) {
        throw new Error('Select this currency in the used currencies list before making it the main currency.');
    }

    await withTransaction(async (client) => {
        await query(`UPDATE ${schema}.currencies SET is_main = FALSE`, [], client);
        await query(`UPDATE ${schema}.currencies SET is_main = TRUE WHERE id = $1`, [currencyId], client);
    });
}

async function listTransactions(app) {
    const { schema } = await getSchemaInfo(app);
    const result = await query(`
        SELECT
            t.id,
            t.account_from_id AS "accountFromId",
            COALESCE(c_from.name, '') AS "clientFromName",
            COALESCE(acur_from.code, '') AS "accountFromCurrencyCode",
            COALESCE(acur_from.symbol, '') AS "accountFromCurrencySymbol",
            t.account_to_id AS "accountToId",
            COALESCE(c_to.name, '') AS "clientToName",
            COALESCE(acur_to.code, '') AS "accountToCurrencyCode",
            COALESCE(acur_to.symbol, '') AS "accountToCurrencySymbol",
            t.currency_id AS "currencyId",
            cur.code AS "currencyCode",
            cur.symbol AS "currencySymbol",
            t.amount,
            t.type,
            t.exchange_rate_from AS "exchangeRateFrom",
            t.commission_from AS "commissionFrom",
            t.exchange_rate_to AS "exchangeRateTo",
            t.commission_to AS "commissionTo",
            CASE WHEN t.exchange_rate_from_reversed THEN 1 ELSE 0 END AS "exchangeRateFromReversed",
            CASE WHEN t.exchange_rate_to_reversed THEN 1 ELSE 0 END AS "exchangeRateToReversed",
            t.charges,
            t.charges_currency_id AS "chargesCurrencyId",
            chcur.code AS "chargesCurrencyCode",
            chcur.symbol AS "chargesCurrencySymbol",
            t.charges_payer AS "chargesPayer",
            t.charges_exchange_rate AS "chargesExchangeRate",
            t.charges_description AS "chargesDescription",
            t.description,
            COALESCE(t.description_from, '') AS "descriptionFrom",
            COALESCE(t.description_to, '') AS "descriptionTo",
            COALESCE(t.archive_note, '') AS "archiveNote",
            CASE WHEN t.is_archived THEN 1 ELSE 0 END AS "isArchived",
            t.created_at AS "createdAt"
        FROM ${schema}.transactions t
        LEFT JOIN ${schema}.client_accounts ca_from ON ca_from.id = t.account_from_id
        LEFT JOIN ${schema}.clients c_from ON c_from.id = ca_from.client_id
        LEFT JOIN ${schema}.currencies acur_from ON acur_from.id = ca_from.currency_id
        LEFT JOIN ${schema}.client_accounts ca_to ON ca_to.id = t.account_to_id
        LEFT JOIN ${schema}.clients c_to ON c_to.id = ca_to.client_id
        LEFT JOIN ${schema}.currencies acur_to ON acur_to.id = ca_to.currency_id
        JOIN ${schema}.currencies cur ON cur.id = t.currency_id
        LEFT JOIN ${schema}.currencies chcur ON chcur.id = t.charges_currency_id
        ORDER BY t.created_at DESC
    `);
    return result.rows;
}

async function createTransaction(app, txn) {
    const isArchived = Boolean(txn.isArchived);
    // Archive-only records (pre-DB history) may have no party at all; normal transactions need at least one.
    if (!isArchived && !txn.accountFromId && !txn.accountToId) {
        throw new Error('At least one party (sender or receiver) is required.');
    }
    if (!txn.currencyId) {
        throw new Error('Amount currency is required.');
    }

    const { schema } = await getSchemaInfo(app);
    const hasCustomCreatedAt = typeof txn.createdAt === 'string' && txn.createdAt.trim().length > 0;

    if (hasCustomCreatedAt) {
        await query(
            `
                INSERT INTO ${schema}.transactions (
                    account_from_id,
                    account_to_id,
                    currency_id,
                    amount,
                    type,
                    exchange_rate_from,
                    commission_from,
                    exchange_rate_to,
                    commission_to,
                    exchange_rate_from_reversed,
                    exchange_rate_to_reversed,
                    charges,
                    charges_currency_id,
                    charges_payer,
                    charges_exchange_rate,
                    charges_description,
                    description,
                    description_from,
                    description_to,
                    is_archived,
                    created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
            `,
            [
                txn.accountFromId || null,
                txn.accountToId || null,
                txn.currencyId,
                txn.amount || 0,
                txn.type || 'exchange',
                txn.exchangeRateFrom != null ? txn.exchangeRateFrom : 1,
                txn.commissionFrom || 0,
                txn.exchangeRateTo != null ? txn.exchangeRateTo : 1,
                txn.commissionTo || 0,
                Boolean(txn.exchangeRateFromReversed),
                Boolean(txn.exchangeRateToReversed),
                txn.charges || 0,
                txn.chargesCurrencyId || null,
                txn.chargesPayer || '',
                txn.chargesExchangeRate != null ? txn.chargesExchangeRate : 1,
                txn.chargesDescription?.trim() || '',
                txn.description?.trim() || '',
                txn.descriptionFrom?.trim() || '',
                txn.descriptionTo?.trim() || '',
                isArchived,
                txn.createdAt.trim(),
            ],
        );
        return;
    }

    await query(
        `
            INSERT INTO ${schema}.transactions (
                account_from_id,
                account_to_id,
                currency_id,
                amount,
                type,
                exchange_rate_from,
                commission_from,
                exchange_rate_to,
                commission_to,
                exchange_rate_from_reversed,
                exchange_rate_to_reversed,
                charges,
                charges_currency_id,
                charges_payer,
                charges_exchange_rate,
                charges_description,
                description,
                description_from,
                description_to,
                is_archived
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        `,
        [
            txn.accountFromId || null,
            txn.accountToId || null,
            txn.currencyId,
            txn.amount || 0,
            txn.type || 'exchange',
            txn.exchangeRateFrom != null ? txn.exchangeRateFrom : 1,
            txn.commissionFrom || 0,
            txn.exchangeRateTo != null ? txn.exchangeRateTo : 1,
            txn.commissionTo || 0,
            Boolean(txn.exchangeRateFromReversed),
            Boolean(txn.exchangeRateToReversed),
            txn.charges || 0,
            txn.chargesCurrencyId || null,
            txn.chargesPayer || '',
            txn.chargesExchangeRate != null ? txn.chargesExchangeRate : 1,
            txn.chargesDescription?.trim() || '',
            txn.description?.trim() || '',
            txn.descriptionFrom?.trim() || '',
            txn.descriptionTo?.trim() || '',
            isArchived,
        ],
    );
}

async function updateTransaction(app, txn) {
    if (!txn.id) {
        throw new Error('Transaction id is required.');
    }
    if (!txn.accountFromId && !txn.accountToId) {
        throw new Error('At least one party (sender or receiver) is required.');
    }
    if (!txn.currencyId) {
        throw new Error('Amount currency is required.');
    }

    const { schema } = await getSchemaInfo(app);
    await query(
        `
            UPDATE ${schema}.transactions
            SET account_from_id = $1,
                account_to_id = $2,
                currency_id = $3,
                amount = $4,
                type = $5,
                exchange_rate_from = $6,
                commission_from = $7,
                exchange_rate_to = $8,
                commission_to = $9,
                exchange_rate_from_reversed = $10,
                exchange_rate_to_reversed = $11,
                charges = $12,
                charges_currency_id = $13,
                charges_payer = $14,
                charges_exchange_rate = $15,
                charges_description = $16,
                description = $17,
                archive_note = COALESCE($18, archive_note),
                created_at = $19,
                -- Per-side overrides are preserved (COALESCE) when a caller omits them, so the
                -- table inline-edit / reorder paths don't wipe descriptions set at creation time.
                description_from = COALESCE($21, description_from),
                description_to = COALESCE($22, description_to)
            WHERE id = $20
        `,
        [
            txn.accountFromId || null,
            txn.accountToId || null,
            txn.currencyId,
            txn.amount || 0,
            txn.type || 'exchange',
            txn.exchangeRateFrom != null ? txn.exchangeRateFrom : 1,
            txn.commissionFrom || 0,
            txn.exchangeRateTo != null ? txn.exchangeRateTo : 1,
            txn.commissionTo || 0,
            Boolean(txn.exchangeRateFromReversed),
            Boolean(txn.exchangeRateToReversed),
            txn.charges || 0,
            txn.chargesCurrencyId || null,
            txn.chargesPayer || '',
            txn.chargesExchangeRate != null ? txn.chargesExchangeRate : 1,
            txn.chargesDescription?.trim() || '',
            txn.description?.trim() || '',
            // Only the table inline-edit sends archiveNote; other paths leave it untouched via COALESCE.
            txn.archiveNote === undefined || txn.archiveNote === null ? null : String(txn.archiveNote).trim(),
            txn.createdAt,
            txn.id,
            txn.descriptionFrom === undefined || txn.descriptionFrom === null ? null : String(txn.descriptionFrom).trim(),
            txn.descriptionTo === undefined || txn.descriptionTo === null ? null : String(txn.descriptionTo).trim(),
        ],
    );
}

async function deleteTransaction(app, transactionId) {
    const { schema } = await getSchemaInfo(app);
    await query(`DELETE FROM ${schema}.transactions WHERE id = $1`, [transactionId]);
}

async function deleteAllTransactions(app) {
    const { schema } = await getSchemaInfo(app);
    await query(`DELETE FROM ${schema}.transactions`);
}

async function listClientAdjustments(app) {
    const { schema } = await getSchemaInfo(app);
    const result = await query(`
        SELECT
            a.id,
            a.account_id AS "accountId",
            a.amount,
            a.direction,
            a.currency_id AS "currencyId",
            a.currency_code AS "currencyCode",
            a.currency_symbol AS "currencySymbol",
            a.exchange_rate AS "exchangeRate",
            a.exchange_rate_reversed AS "exchangeRateReversed",
            a.description,
            a.created_at AS "createdAt"
        FROM ${schema}.client_adjustments a
        ORDER BY a.created_at ASC
    `);
    return result.rows;
}

async function createClientAdjustment(app, { accountId, amount, direction, currencyId, currencyCode, currencySymbol, exchangeRate, exchangeRateReversed, description, createdAt }) {
    const { schema } = await getSchemaInfo(app);
    if (!accountId) throw new Error('Account is required.');
    if (!amount || amount <= 0) throw new Error('Amount must be greater than zero.');
    if (!['debit', 'credit'].includes(direction)) throw new Error('Direction must be debit or credit.');
    const rate = exchangeRate != null ? exchangeRate : 1;
    const reversed = exchangeRateReversed ? true : false;
    const columns = ['account_id', 'amount', 'direction', 'currency_id', 'currency_code', 'currency_symbol', 'exchange_rate', 'exchange_rate_reversed', 'description'];
    const values = [accountId, amount, direction, currencyId ?? null, currencyCode || '', currencySymbol || '', rate, reversed, description?.trim() || ''];
    if (createdAt) {
        columns.push('created_at');
        values.push(createdAt);
    }
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const result = await query(
        `INSERT INTO ${schema}.client_adjustments (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
        values
    );
    return result.rows[0];
}

async function updateClientAdjustment(app, { id, amount, direction, currencyId, currencyCode, currencySymbol, exchangeRate, exchangeRateReversed, description, createdAt }) {
    const { schema } = await getSchemaInfo(app);
    const rate = exchangeRate != null ? exchangeRate : 1;
    const reversed = exchangeRateReversed ? true : false;
    await query(
        `UPDATE ${schema}.client_adjustments
         SET amount=$1, direction=$2, currency_id=$3, currency_code=$4, currency_symbol=$5, exchange_rate=$6, exchange_rate_reversed=$7, description=$8, created_at=$9
         WHERE id=$10`,
        [amount, direction, currencyId ?? null, currencyCode || '', currencySymbol || '', rate, reversed, description?.trim() || '', createdAt, id]
    );
}

async function deleteClientAdjustment(app, id) {
    const { schema } = await getSchemaInfo(app);
    await query(`DELETE FROM ${schema}.client_adjustments WHERE id = $1`, [id]);
}

// Deletes many transactions and/or adjustments in a single round-trip so the UI
// doesn't have to fire one request per selected row. Both deletes run inside one
// transaction so the operation is atomic.
async function deleteTransactionsBulk(app, payload) {
    const { schema } = await getSchemaInfo(app);
    const transactionIds = (payload?.transactionIds || []).map(Number).filter((id) => Number.isFinite(id));
    const adjustmentIds = (payload?.adjustmentIds || []).map(Number).filter((id) => Number.isFinite(id));

    if (!transactionIds.length && !adjustmentIds.length) {
        return { ok: true, deleted: 0 };
    }

    await withTransaction(async (executor) => {
        if (transactionIds.length) {
            await query(`DELETE FROM ${schema}.transactions WHERE id = ANY($1::bigint[])`, [transactionIds], executor);
        }
        if (adjustmentIds.length) {
            await query(`DELETE FROM ${schema}.client_adjustments WHERE id = ANY($1::bigint[])`, [adjustmentIds], executor);
        }
    });

    return { ok: true, deleted: transactionIds.length + adjustmentIds.length };
}

// Tables that make up a full workspace backup, listed in dependency order
// (parents before children) so a restore can insert them sequentially.
const BACKUP_TABLES = ['organizations', 'currencies', 'clients', 'client_accounts', 'transactions', 'client_adjustments'];

const BACKUP_FORMAT = 'arkam-backup';
const BACKUP_VERSION = 1;

// Dumps every row of every workspace table (raw column names, original ids
// preserved) so the result can later be re-imported by importWorkspaceData.
async function exportWorkspaceData(app) {
    const { schema, schemaName } = await getSchemaInfo(app);
    const metadata = getDatabaseMetadata();

    const tables = {};
    for (const table of BACKUP_TABLES) {
        const result = await query(`SELECT * FROM ${schema}.${quoteIdentifier(table)} ORDER BY id ASC`);
        tables[table] = result.rows;
    }

    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        database: metadata.database,
        schema: schemaName,
        tables,
    };
}

// Replaces the entire workspace dataset with the contents of a backup produced
// by exportWorkspaceData. Runs in a single transaction: every table is cleared
// (children first) and rebuilt (parents first), then identity sequences are
// realigned to the restored ids so future inserts don't collide.
async function importWorkspaceData(app, backup) {
    if (!backup || typeof backup !== 'object' || backup.format !== BACKUP_FORMAT || !backup.tables || typeof backup.tables !== 'object') {
        throw new Error('Invalid or unrecognized backup file.');
    }

    const { schema, schemaName } = await getSchemaInfo(app);

    await withTransaction(async (client) => {
        // Clear existing data, children before parents, to satisfy FK constraints.
        for (const table of [...BACKUP_TABLES].reverse()) {
            await query(`DELETE FROM ${schema}.${quoteIdentifier(table)}`, [], client);
        }

        // Re-insert, parents before children, preserving original ids. Rows are
        // grouped by column signature (normally one group since backups come from
        // SELECT *) and inserted in batched multi-row statements so a large
        // workspace restores in a few queries instead of one query per row.
        for (const table of BACKUP_TABLES) {
            const rows = Array.isArray(backup.tables[table]) ? backup.tables[table] : [];

            const groups = new Map();
            for (const row of rows) {
                if (!row || typeof row !== 'object') continue;
                const columns = Object.keys(row);
                if (!columns.length) continue;
                const signature = columns.join(' ');
                let group = groups.get(signature);
                if (!group) {
                    group = { columns, rows: [] };
                    groups.set(signature, group);
                }
                group.rows.push(row);
            }

            for (const { columns, rows: groupRows } of groups.values()) {
                const quotedColumns = columns.map((column) => quoteIdentifier(column)).join(', ');
                // Stay under Postgres's 65535 bound-parameter limit per statement.
                const maxRowsPerBatch = Math.max(1, Math.floor(60000 / columns.length));

                for (let start = 0; start < groupRows.length; start += maxRowsPerBatch) {
                    const batch = groupRows.slice(start, start + maxRowsPerBatch);
                    const values = [];
                    const tuples = batch.map((row) => {
                        const placeholders = columns.map((column) => {
                            values.push(row[column]);
                            return `$${values.length}`;
                        });
                        return `(${placeholders.join(', ')})`;
                    });

                    await query(
                        `INSERT INTO ${schema}.${quoteIdentifier(table)} (${quotedColumns}) VALUES ${tuples.join(', ')}`,
                        values,
                        client,
                    );
                }
            }

            // Realign the identity sequence so the next generated id is max(id) + 1.
            await query(
                `SELECT setval(
                    pg_get_serial_sequence($1, 'id'),
                    (SELECT COALESCE(MAX(id), 0) FROM ${schema}.${quoteIdentifier(table)}) + 1,
                    false
                 )`,
                [`${schemaName}.${table}`],
                client,
            );
        }
    });

    return { ok: true };
}

// Maps a camelCase transaction payload field to the value for a given DB column.
function txColValue(col, row, now) {
    switch (col) {
        case 'account_from_id': return row.accountFromId;
        case 'account_to_id': return row.accountToId;
        case 'currency_id': return row.currencyId ?? null;
        case 'amount': return row.amount;
        case 'type': return row.type || 'transfer';
        case 'exchange_rate_from': return row.exchangeRateFrom ?? 1;
        case 'commission_from': return row.commissionFrom ?? 0;
        case 'exchange_rate_to': return row.exchangeRateTo ?? 1;
        case 'commission_to': return row.commissionTo ?? 0;
        case 'exchange_rate_from_reversed': return row.exchangeRateFromReversed ? true : false;
        case 'exchange_rate_to_reversed': return row.exchangeRateToReversed ? true : false;
        case 'charges': return row.charges ?? 0;
        case 'charges_currency_id': return row.chargesCurrencyId ?? null;
        case 'charges_payer': return row.chargesPayer || '';
        case 'charges_exchange_rate': return row.chargesExchangeRate ?? 1;
        case 'charges_description': return row.chargesDescription || '';
        case 'description': return row.description?.trim() || '';
        case 'is_archived': return row.isArchived ? true : false;
        case 'created_at': return row.createdAt ?? now;
        default: return null;
    }
}

// Maps a camelCase adjustment payload field to the value for a given DB column.
function adjColValue(col, row, now) {
    switch (col) {
        case 'account_id': return row.accountId;
        case 'amount': return row.amount;
        case 'direction': return row.direction;
        case 'currency_id': return row.currencyId ?? null;
        case 'currency_code': return row.currencyCode || '';
        case 'currency_symbol': return row.currencySymbol || '';
        case 'exchange_rate': return row.exchangeRate ?? 1;
        case 'exchange_rate_reversed': return row.exchangeRateReversed ? true : false;
        case 'description': return row.description?.trim() || '';
        case 'created_at': return row.createdAt ?? now;
        default: return null;
    }
}

// Inserts all reviewed import rows (transactions + adjustments) in bulk using
// multi-row INSERTs, reducing ~1000 HTTP round-trips to a single request.
async function bulkImportTransactions(app, { transactions = [], adjustments = [] } = {}) {
    const { schema } = await getSchemaInfo(app);
    const now = new Date();

    await withTransaction(async (client) => {
        if (transactions.length > 0) {
            const cols = [
                'account_from_id', 'account_to_id', 'currency_id', 'amount', 'type',
                'exchange_rate_from', 'commission_from', 'exchange_rate_to', 'commission_to',
                'exchange_rate_from_reversed', 'exchange_rate_to_reversed',
                'charges', 'charges_currency_id', 'charges_payer', 'charges_exchange_rate',
                'charges_description', 'description', 'is_archived', 'created_at',
            ];
            const quotedCols = cols.map((c) => `"${c}"`).join(', ');
            const maxBatch = Math.max(1, Math.floor(60000 / cols.length));
            for (let i = 0; i < transactions.length; i += maxBatch) {
                const batch = transactions.slice(i, i + maxBatch);
                const values = [];
                const tuples = batch.map((row) => {
                    const placeholders = cols.map((col) => {
                        values.push(txColValue(col, row, now));
                        return `$${values.length}`;
                    });
                    return `(${placeholders.join(', ')})`;
                });
                await query(
                    `INSERT INTO ${schema}.transactions (${quotedCols}) VALUES ${tuples.join(', ')}`,
                    values,
                    client,
                );
            }
        }

        if (adjustments.length > 0) {
            const cols = [
                'account_id', 'amount', 'direction', 'currency_id', 'currency_code',
                'currency_symbol', 'exchange_rate', 'exchange_rate_reversed', 'description', 'created_at',
            ];
            const quotedCols = cols.map((c) => `"${c}"`).join(', ');
            const maxBatch = Math.max(1, Math.floor(60000 / cols.length));
            for (let i = 0; i < adjustments.length; i += maxBatch) {
                const batch = adjustments.slice(i, i + maxBatch);
                const values = [];
                const tuples = batch.map((row) => {
                    const placeholders = cols.map((col) => {
                        values.push(adjColValue(col, row, now));
                        return `$${values.length}`;
                    });
                    return `(${placeholders.join(', ')})`;
                });
                await query(
                    `INSERT INTO ${schema}.client_adjustments (${quotedCols}) VALUES ${tuples.join(', ')}`,
                    values,
                    client,
                );
            }
        }
    });

    return { createdTransactions: transactions.length, createdAdjustments: adjustments.length };
}

// Workspace-wide shared UI settings (single row). Returns defaults when unset.
async function getWorkspaceSettings(app) {
    const { schema } = await getSchemaInfo(app);
    const result = await query(
        `SELECT shared_enabled AS "sharedEnabled", settings, version
         FROM ${schema}.workspace_settings WHERE id = 1`,
    );
    const row = result.rows[0];
    if (!row) {
        return { sharedEnabled: false, settings: {}, version: 0 };
    }
    return {
        sharedEnabled: Boolean(row.sharedEnabled),
        settings: row.settings && typeof row.settings === 'object' ? row.settings : {},
        version: Number(row.version) || 0,
    };
}

// Upserts the shared settings. When `settings` is provided the version bumps so
// clients know to re-apply. `sharedEnabled` toggles sharing on/off (no bump).
async function saveWorkspaceSettings(app, payload) {
    const { schema } = await getSchemaInfo(app);
    const hasEnabled = typeof payload?.sharedEnabled === 'boolean';
    const hasSettings = payload?.settings && typeof payload.settings === 'object';

    const result = await query(
        `INSERT INTO ${schema}.workspace_settings (id, shared_enabled, settings, version, updated_at)
         VALUES (1, $1, $2, $3, NOW())
         ON CONFLICT (id) DO UPDATE SET
             shared_enabled = CASE WHEN $4 THEN EXCLUDED.shared_enabled ELSE ${schema}.workspace_settings.shared_enabled END,
             settings = CASE WHEN $5 THEN EXCLUDED.settings ELSE ${schema}.workspace_settings.settings END,
             version = CASE WHEN $5 THEN ${schema}.workspace_settings.version + 1 ELSE ${schema}.workspace_settings.version END,
             updated_at = NOW()
         RETURNING shared_enabled AS "sharedEnabled", settings, version`,
        [
            hasEnabled ? payload.sharedEnabled : false,
            hasSettings ? JSON.stringify(payload.settings) : '{}',
            hasSettings ? 1 : 0,
            hasEnabled,
            hasSettings,
        ],
    );
    const row = result.rows[0];
    return {
        sharedEnabled: Boolean(row.sharedEnabled),
        settings: row.settings && typeof row.settings === 'object' ? row.settings : {},
        version: Number(row.version) || 0,
    };
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
    deleteAllClients,
    listAllClientAccounts,
    listClientAccounts,
    createClientAccount,
    updateClientAccountStartingBalance,
    updateClientAccount,
    deleteClientAccount,
    moveAccountTransactions,
    listCurrencies,
    createCurrency,
    updateCurrency,
    deleteCurrency,
    deleteAllCurrencies,
    reseedCurrencies,
    enableCurrency,
    disableCurrency,
    setMainCurrency,
    listTransactions,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    deleteTransactionsBulk,
    deleteAllTransactions,
    listClientAdjustments,
    createClientAdjustment,
    updateClientAdjustment,
    deleteClientAdjustment,
    exportWorkspaceData,
    importWorkspaceData,
    bulkImportTransactions,
    getWorkspaceSettings,
    saveWorkspaceSettings,
};