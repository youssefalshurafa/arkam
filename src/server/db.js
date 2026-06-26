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

async function seedCurrenciesForSchema(schema, executor) {
    for (const code of getSupportedCurrencyCodes()) {
        await query(
            `
                INSERT INTO ${schema}.currencies (code, name, symbol)
                VALUES ($1, $2, $3)
                ON CONFLICT (code) DO UPDATE SET
                    name = EXCLUDED.name,
                    symbol = EXCLUDED.symbol
            `,
            [code, getCurrencyDisplayName(code), getCurrencySymbol(code)],
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
    await query(
        `UPDATE ${schema}.currencies SET code = $1, name = $2, symbol = $3 WHERE id = $4`,
        [currency.code.trim().toUpperCase(), currency.name.trim(), currency.symbol?.trim() || '', currency.id],
    );
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
            c_from.name AS "clientFromName",
            acur_from.code AS "accountFromCurrencyCode",
            acur_from.symbol AS "accountFromCurrencySymbol",
            t.account_to_id AS "accountToId",
            c_to.name AS "clientToName",
            acur_to.code AS "accountToCurrencyCode",
            acur_to.symbol AS "accountToCurrencySymbol",
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
            t.created_at AS "createdAt"
        FROM ${schema}.transactions t
        JOIN ${schema}.client_accounts ca_from ON ca_from.id = t.account_from_id
        JOIN ${schema}.clients c_from ON c_from.id = ca_from.client_id
        JOIN ${schema}.currencies acur_from ON acur_from.id = ca_from.currency_id
        JOIN ${schema}.client_accounts ca_to ON ca_to.id = t.account_to_id
        JOIN ${schema}.clients c_to ON c_to.id = ca_to.client_id
        JOIN ${schema}.currencies acur_to ON acur_to.id = ca_to.currency_id
        JOIN ${schema}.currencies cur ON cur.id = t.currency_id
        LEFT JOIN ${schema}.currencies chcur ON chcur.id = t.charges_currency_id
        ORDER BY t.created_at DESC
    `);
    return result.rows;
}

async function createTransaction(app, txn) {
    if (!txn.accountFromId || !txn.accountToId) {
        throw new Error('Both accounts are required.');
    }
    if (!txn.currencyId) {
        throw new Error('Amount currency is required.');
    }
    if (!txn.amount || txn.amount <= 0) {
        throw new Error('Amount must be greater than zero.');
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
                    created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            `,
            [
                txn.accountFromId,
                txn.accountToId,
                txn.currencyId,
                txn.amount,
                txn.type || 'exchange',
                txn.exchangeRateFrom || 1,
                txn.commissionFrom || 0,
                txn.exchangeRateTo || 1,
                txn.commissionTo || 0,
                Boolean(txn.exchangeRateFromReversed),
                Boolean(txn.exchangeRateToReversed),
                txn.charges || 0,
                txn.chargesCurrencyId || null,
                txn.chargesPayer || '',
                txn.chargesExchangeRate || 1,
                txn.chargesDescription?.trim() || '',
                txn.description?.trim() || '',
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
                description
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        `,
        [
            txn.accountFromId,
            txn.accountToId,
            txn.currencyId,
            txn.amount,
            txn.type || 'exchange',
            txn.exchangeRateFrom || 1,
            txn.commissionFrom || 0,
            txn.exchangeRateTo || 1,
            txn.commissionTo || 0,
            Boolean(txn.exchangeRateFromReversed),
            Boolean(txn.exchangeRateToReversed),
            txn.charges || 0,
            txn.chargesCurrencyId || null,
            txn.chargesPayer || '',
            txn.chargesExchangeRate || 1,
            txn.chargesDescription?.trim() || '',
            txn.description?.trim() || '',
        ],
    );
}

async function updateTransaction(app, txn) {
    if (!txn.id) {
        throw new Error('Transaction id is required.');
    }
    if (!txn.accountFromId || !txn.accountToId) {
        throw new Error('Both accounts are required.');
    }
    if (!txn.currencyId) {
        throw new Error('Amount currency is required.');
    }
    if (!txn.amount || txn.amount <= 0) {
        throw new Error('Amount must be greater than zero.');
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
                created_at = $18
            WHERE id = $19
        `,
        [
            txn.accountFromId,
            txn.accountToId,
            txn.currencyId,
            txn.amount,
            txn.type || 'exchange',
            txn.exchangeRateFrom || 1,
            txn.commissionFrom || 0,
            txn.exchangeRateTo || 1,
            txn.commissionTo || 0,
            Boolean(txn.exchangeRateFromReversed),
            Boolean(txn.exchangeRateToReversed),
            txn.charges || 0,
            txn.chargesCurrencyId || null,
            txn.chargesPayer || '',
            txn.chargesExchangeRate || 1,
            txn.chargesDescription?.trim() || '',
            txn.description?.trim() || '',
            txn.createdAt,
            txn.id,
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
    const rate = exchangeRate && exchangeRate > 0 ? exchangeRate : 1;
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
    const rate = exchangeRate && exchangeRate > 0 ? exchangeRate : 1;
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
    deleteAllTransactions,
    listClientAdjustments,
    createClientAdjustment,
    updateClientAdjustment,
    deleteClientAdjustment,
};