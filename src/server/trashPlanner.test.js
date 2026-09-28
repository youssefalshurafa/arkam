import { describe, expect, it } from 'vitest';
import { planRestore } from './trashPlanner';

const info = (entries) => new Map(entries.map(([id, clientId, clientName, live]) => [id, { clientId, clientName, live }]));

describe('planRestore', () => {
    it('restores a single trashed transaction whose accounts are live', () => {
        const plan = planRestore({
            transactions: [{ id: 1, accountFromId: 10, accountToId: 20 }],
            accountInfo: info([[10, 1, 'A', true], [20, 2, 'B', true]]),
        });
        expect(plan.restoreTransactionIds).toEqual([1]);
        expect(plan.blocked).toEqual([]);
    });

    it('restores a one-sided transaction (null side) when its only account is live', () => {
        const plan = planRestore({
            transactions: [{ id: 1, accountFromId: null, accountToId: 20 }],
            accountInfo: info([[20, 2, 'B', true]]),
        });
        expect(plan.restoreTransactionIds).toEqual([1]);
    });

    it('restores a whole client batch: client, its accounts, and transactions on both sides', () => {
        const plan = planRestore({
            clients: [{ id: 1 }],
            accounts: [{ id: 10, clientId: 1, currencyId: 5 }],
            transactions: [
                { id: 100, accountFromId: 10, accountToId: 20 },
                { id: 101, accountFromId: null, accountToId: 10 },
            ],
            accountInfo: info([[10, 1, 'A', false], [20, 2, 'B', true]]),
        });
        expect(plan.restoreClientIds).toEqual([1]);
        expect(plan.restoreAccountIds).toEqual([10]);
        expect(plan.restoreTransactionIds).toEqual([100, 101]);
        expect(plan.blocked).toEqual([]);
    });

    it('blocks a transaction whose counterparty was trashed by a different delete', () => {
        // Client A deleted (this batch); B was deleted separately later. The A<->B row is held
        // back with B's name so the UI can say "restore B first".
        const plan = planRestore({
            clients: [{ id: 1 }],
            accounts: [{ id: 10, clientId: 1, currencyId: 5 }],
            transactions: [
                { id: 100, accountFromId: 10, accountToId: 20 },
                { id: 101, accountFromId: 10, accountToId: 30 },
            ],
            accountInfo: info([[10, 1, 'A', false], [20, 2, 'B', false], [30, 3, 'C', true]]),
        });
        expect(plan.restoreTransactionIds).toEqual([101]);
        expect(plan.blocked).toEqual([{ kind: 'transaction', id: 100, reason: 'account_in_trash', name: 'B' }]);
    });

    it('picks the held-back row up on a second run once the blocker is live again', () => {
        const input = {
            transactions: [{ id: 100, accountFromId: 10, accountToId: 20 }],
            accountInfo: info([[10, 1, 'A', true], [20, 2, 'B', false]]),
        };
        expect(planRestore(input).restoreTransactionIds).toEqual([]);
        input.accountInfo = info([[10, 1, 'A', true], [20, 2, 'B', true]]);
        expect(planRestore(input).restoreTransactionIds).toEqual([100]);
    });

    it('keeps an account in the Trash when a live account already exists for the same client and currency', () => {
        const plan = planRestore({
            accounts: [{ id: 10, clientId: 1, currencyId: 5 }],
            transactions: [{ id: 100, accountFromId: 10, accountToId: 20 }],
            accountInfo: info([[10, 1, 'A', false], [20, 2, 'B', true]]),
            liveClientIds: new Set([1]),
            liveAccountKeys: new Set(['1:5']),
            clientNames: new Map([[1, 'A']]),
        });
        expect(plan.restoreAccountIds).toEqual([]);
        expect(plan.restoreTransactionIds).toEqual([]);
        expect(plan.blocked).toEqual([
            { kind: 'account', id: 10, reason: 'account_exists', name: 'A' },
            { kind: 'transaction', id: 100, reason: 'account_in_trash', name: 'A' },
        ]);
    });

    it('never restores two accounts from one batch into the same (client, currency)', () => {
        const plan = planRestore({
            accounts: [
                { id: 11, clientId: 1, currencyId: 5 },
                { id: 10, clientId: 1, currencyId: 5 },
            ],
            liveClientIds: new Set([1]),
        });
        expect(plan.restoreAccountIds).toEqual([10]);
        expect(plan.blocked).toEqual([{ kind: 'account', id: 11, reason: 'account_exists', name: '' }]);
    });

    it('blocks an account whose client is still in the Trash under another delete', () => {
        const plan = planRestore({
            accounts: [{ id: 10, clientId: 1, currencyId: 5 }],
            clientNames: new Map([[1, 'A']]),
        });
        expect(plan.restoreAccountIds).toEqual([]);
        expect(plan.blocked).toEqual([{ kind: 'account', id: 10, reason: 'client_in_trash', name: 'A' }]);
    });
});
