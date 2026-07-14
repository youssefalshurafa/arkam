import { create } from 'zustand';
import {
 getStoredLiveRatesInterval,
 saveLiveRatesInterval,
 minLiveRatesInterval,
 maxLiveRatesInterval,
} from '@/shared/lib/localStorage';

/**
 * User-configurable poll interval (in seconds) for the Live Rates screen. Persisted to
 * localStorage so the choice survives reloads, and held in a store so the setting and the
 * live-rates query stay in sync — changing it in Settings updates the poll rate immediately.
 */
type LiveRatesSettingsStore = {
 intervalSec: number;
 setIntervalSec: (value: number) => void;
};

export const useLiveRatesSettingsStore = create<LiveRatesSettingsStore>((set) => ({
 intervalSec: getStoredLiveRatesInterval(),
 setIntervalSec: (value) => {
  const clamped = Math.min(maxLiveRatesInterval, Math.max(minLiveRatesInterval, Math.round(value)));
  saveLiveRatesInterval(clamped);
  set({ intervalSec: clamped });
 },
}));
