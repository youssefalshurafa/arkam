// Pure planning step behind db.js's restoreTrash: given what one restore request wants to bring
// back and the current state of every account/client it depends on, decides what can actually
// be restored and why the rest can't. No I/O, so the rules that keep the Trash consistent are
// unit-testable (trashPlanner.test.js) without a database.
//
// The invariants it protects (see the soft-delete block in postgres.js):
//   * a live transaction's accounts are live;
//   * a live account's client is live;
//   * at most one live account per (client, currency).
// Parents are never restored implicitly — a transaction whose account is still in the Trash
// under a DIFFERENT delete is reported as blocked ("restore that client first") rather than
// silently dragging the other delete back with it. Blocked rows keep their batch, so running the
// same restore again after the blocker is restored picks them up.

/**
 * @param {object} input
 * @param {{ id: number }[]} input.clients                         trashed clients being restored
 * @param {{ id: number, clientId: number, currencyId: number }[]} input.accounts  trashed accounts being restored
 * @param {{ id: number, accountFromId: number|null, accountToId: number|null }[]} input.transactions  trashed transactions being restored
 * @param {Map<number, { clientId: number, clientName: string, live: boolean }>} input.accountInfo
 *        every account any candidate references (live or not), keyed by account id
 * @param {Set<number>} input.liveClientIds       clients (of candidate accounts) that are live right now
 * @param {Set<string>} input.liveAccountKeys     `${clientId}:${currencyId}` of every live account
 *        sharing a (client, currency) with a candidate account
 * @param {Map<number, string>} [input.clientNames]  names for candidate accounts' clients, for messages
 */
function planRestore({ clients = [], accounts = [], transactions = [], accountInfo = new Map(), liveClientIds = new Set(), liveAccountKeys = new Set(), clientNames = new Map() }) {
    const blocked = [];

    const restoreClientIds = new Set(clients.map((client) => Number(client.id)));
    const isClientLive = (clientId) => liveClientIds.has(Number(clientId)) || restoreClientIds.has(Number(clientId));

    const restoreAccountIds = new Set();
    const claimedKeys = new Set(liveAccountKeys);
    for (const account of [...accounts].sort((a, b) => Number(a.id) - Number(b.id))) {
        const clientId = Number(account.clientId);
        if (!isClientLive(clientId)) {
            blocked.push({ kind: 'account', id: Number(account.id), reason: 'client_in_trash', name: clientNames.get(clientId) || '' });
            continue;
        }
        const key = `${clientId}:${Number(account.currencyId)}`;
        if (claimedKeys.has(key)) {
            // Someone re-created this client's account in the same currency after it was deleted.
            // Restoring would make two live ledgers for one (client, currency), which the unique
            // index forbids — leave it in the Trash and say so.
            blocked.push({ kind: 'account', id: Number(account.id), reason: 'account_exists', name: clientNames.get(clientId) || '' });
            continue;
        }
        claimedKeys.add(key);
        restoreAccountIds.add(Number(account.id));
    }

    const isAccountLive = (accountId) => {
        const id = Number(accountId);
        if (restoreAccountIds.has(id)) return true;
        return Boolean(accountInfo.get(id)?.live);
    };

    const restoreTransactionIds = new Set();
    for (const transaction of transactions) {
        const sides = [transaction.accountFromId, transaction.accountToId].filter((id) => id != null);
        const blocker = sides.find((accountId) => !isAccountLive(accountId));
        if (blocker != null) {
            blocked.push({ kind: 'transaction', id: Number(transaction.id), reason: 'account_in_trash', name: accountInfo.get(Number(blocker))?.clientName || '' });
            continue;
        }
        restoreTransactionIds.add(Number(transaction.id));
    }

    return {
        restoreClientIds: [...restoreClientIds],
        restoreAccountIds: [...restoreAccountIds],
        restoreTransactionIds: [...restoreTransactionIds],
        blocked,
    };
}

module.exports = { planRestore };
