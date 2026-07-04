import { create } from 'zustand';
import type { PdfSettings } from '@/shared/types';
import { getStoredPdfSettings, pdfSettingsStorageKey } from '@/shared/lib/localStorage';

/**
 * App-wide settings that persist per browser. Currently the PDF export formatting
 * options, read both by the PDF editor tab and by the ledger PDF export in the
 * page. updatePdfSettings mirrors the previous inline handler (merge + persist to
 * the same localStorage key).
 */
type SettingsStore = {
 pdfSettings: PdfSettings;
 updatePdfSettings: (partial: Partial<PdfSettings>) => void;
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
}));
