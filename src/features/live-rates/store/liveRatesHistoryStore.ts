import { create } from 'zustand';

const HISTORY_CAP = 30;

/**
 * Rolling per-pair history of `sell` prices accumulated across polls. Updated from
 * the live-rates query function (outside React render), so the section can draw a
 * live sparkline and a session-relative % change without a setState-in-effect. The
 * upstream feed carries no daily-change field, hence this client-side accumulation.
 */
type LiveRatesHistoryStore = {
 history: Record<string, number[]>;
 record: (rates: { code: string; sell: number }[]) => void;
};

export const useLiveRatesHistoryStore = create<LiveRatesHistoryStore>((set) => ({
 history: {},
 record: (rates) =>
  set((state) => {
   const next: Record<string, number[]> = { ...state.history };
   for (const r of rates) {
    const arr = next[r.code] ? [...next[r.code]] : [];
    arr.push(r.sell);
    if (arr.length > HISTORY_CAP) arr.shift();
    next[r.code] = arr;
   }
   return { history: next };
  }),
}));
