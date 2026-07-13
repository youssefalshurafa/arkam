import { create } from 'zustand';
import type { ExchangeSettings, PdfSettings } from '@/shared/types';
import { getStoredPdfSettings, pdfSettingsStorageKey, getStoredExchangeSettings, saveExchangeSettings } from '@/shared/lib/localStorage';

/**
 * App-wide settings that persist per browser. The PDF export formatting options
 * (read by the PDF editor tab and the ledger PDF export) plus the exchange (صرف)
 * rules. Each updater mirrors the previous inline handler pattern: merge + persist
 * to the same localStorage key. The exchange settings key is workspace-shared (see
 * sharedTableSettings), so the tolerance stays consistent across members.
 */
type SettingsStore = {
 pdfSettings: PdfSettings;
 updatePdfSettings: (partial: Partial<PdfSettings>) => void;
 exchangeSettings: ExchangeSettings;
 updateExchangeSettings: (partial: Partial<ExchangeSettings>) => void;
};

export const useSettingsStore = create<SettingsStore>((set, get) => ({
 pdfSettings: getStoredPdfSettings(),
 updatePdfSettings: (partial) => {
  const next = { ...get().pdfSettings, ...partial };
  try {
   window.localStorage.setItem(pdfSettingsStorageKey, JSON.stringify(next));
  } catch {
   /* ignore */
  }
  set({ pdfSettings: next });
 },
 exchangeSettings: getStoredExchangeSettings(),
 updateExchangeSettings: (partial) => {
  const next = { ...get().exchangeSettings, ...partial };
  saveExchangeSettings(next);
  set({ exchangeSettings: next });
 },
}));
