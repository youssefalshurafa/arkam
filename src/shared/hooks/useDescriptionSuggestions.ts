'use client';

import { useMemo, useState } from 'react';
import { getStoredDescriptionSuggestionExclusions, saveDescriptionSuggestionExclusions } from '@/shared/lib/localStorage';
import type { Transaction } from '@/shared/types';

const MAX_SUGGESTIONS = 8;

type Scope = {
 transactions: Transaction[];
 query: string;
 // The up-to-two accounts currently relevant to this description field (e.g. the form's
 // From/To pickers, or a ledger row's own account + counterparty). Order doesn't matter —
 // pass whatever's set; nulls/undefined are ignored. Omit entirely for an unscoped list.
 accountIds?: Array<number | null | undefined>;
};

/**
 * Ranked, deduped past-description suggestions for a transaction description field, plus a
 * per-user "exclude this suggestion" action (persisted, synced like other per-user settings —
 * see descriptionSuggestionExclusionsStorageKey — so a dismissed suggestion stays gone across
 * reloads and follows the user to another device).
 *
 * Ranking, three scope tiers from most to least specific (each tier only fills in the gaps
 * the previous one left, so more relevant results always sort first, even before the 8-item
 * cap is reached):
 *  1. Both given accounts appear on the transaction (either direction) — "what do I usually
 *     write between these two parties."
 *  2. Either given account appears on the transaction — "what do I usually write on this
 *     account," used when only one side is picked yet, or as a wider net if tier 1 came up short.
 *  3. Every past transaction, unscoped.
 * Within a tier: a prefix match beats a plain substring match; then a higher usage count (how
 * many times this exact description has been used within that tier) beats a lower one; then a
 * more-recently-used one beats an older one. This is closer to "what do I actually tend to type
 * here" than a flat most-recent-first list.
 */
export function useDescriptionSuggestions({ transactions, query, accountIds: rawAccountIds = [] }: Scope) {
 const [excluded, setExcluded] = useState<Set<string>>(() => getStoredDescriptionSuggestionExclusions());

 const excludeSuggestion = (desc: string) => {
  setExcluded((current) => {
   const next = new Set(current);
   next.add(desc.trim().toLowerCase());
   saveDescriptionSuggestionExclusions(next);
   return next;
  });
 };

 const suggestions = useMemo(() => {
  const q = query.trim().toLowerCase();
  const ids = [...new Set(rawAccountIds.filter((id): id is number => id != null))];

  type Stat = { display: string; count: number; lastAt: number };

  const buildStats = (predicate: (tx: Transaction) => boolean): Map<string, Stat> => {
   const stats = new Map<string, Stat>();
   for (const tx of transactions) {
    const desc = tx.description?.trim();
    if (!desc) continue;
    const key = desc.toLowerCase();
    if (key === q || excluded.has(key)) continue;
    if (q && !key.includes(q)) continue;
    if (!predicate(tx)) continue;
    const at = new Date(tx.createdAt).getTime();
    const existing = stats.get(key);
    if (existing) {
     existing.count += 1;
     if (at > existing.lastAt) existing.lastAt = at;
    } else {
     stats.set(key, { display: desc, count: 1, lastAt: at });
    }
   }
   return stats;
  };

  const rank = (stats: Map<string, Stat>): string[] =>
   [...stats.entries()]
    .sort(([keyA, a], [keyB, b]) => {
     const prefixA = !q || keyA.startsWith(q);
     const prefixB = !q || keyB.startsWith(q);
     if (prefixA !== prefixB) return prefixA ? -1 : 1;
     if (b.count !== a.count) return b.count - a.count;
     return b.lastAt - a.lastAt;
    })
    .map(([, stat]) => stat.display);

  const seen = new Set<string>();
  const result: string[] = [];
  const addAll = (stats: Map<string, Stat>) => {
   for (const display of rank(stats)) {
    const key = display.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(display);
    if (result.length >= MAX_SUGGESTIONS) return;
   }
  };

  if (ids.length === 2) {
   const [a, b] = ids;
   addAll(buildStats((tx) => (tx.accountFromId === a && tx.accountToId === b) || (tx.accountFromId === b && tx.accountToId === a)));
  }
  if (result.length < MAX_SUGGESTIONS && ids.length > 0) {
   const idSet = new Set(ids);
   addAll(buildStats((tx) => (tx.accountFromId != null && idSet.has(tx.accountFromId)) || (tx.accountToId != null && idSet.has(tx.accountToId))));
  }
  if (result.length < MAX_SUGGESTIONS) {
   addAll(buildStats(() => true));
  }

  return result;
 }, [transactions, query, rawAccountIds, excluded]);

 return { suggestions, excludeSuggestion };
}
