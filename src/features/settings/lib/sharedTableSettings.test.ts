import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { themeStorageKey, transactionTableSettingsStorageKey } from '@/shared/lib/localStorage';
import { applyUserSettings, snapshotUserSettings } from './sharedTableSettings';

// Minimal in-memory localStorage behind a fake `window`, since vitest runs in node.
function installFakeWindow() {
 const store = new Map<string, string>();
 const localStorage = {
  get length() {
   return store.size;
  },
  key: (index: number) => [...store.keys()][index] ?? null,
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
 };
 (globalThis as unknown as { window: unknown }).window = { localStorage, dispatchEvent: () => true };
 return localStorage;
}

let storage: ReturnType<typeof installFakeWindow>;

beforeEach(() => {
 storage = installFakeWindow();
});

afterEach(() => {
 delete (globalThis as unknown as { window?: unknown }).window;
});

describe('per-user settings sync and the theme', () => {
 it('never sends this device\'s theme to the server', () => {
  storage.setItem(themeStorageKey, 'light');
  storage.setItem(transactionTableSettingsStorageKey, '{"a":1}');
  const snapshot = snapshotUserSettings();
  expect(snapshot).not.toHaveProperty(themeStorageKey);
  expect(snapshot).toHaveProperty(transactionTableSettingsStorageKey);
 });

 it('ignores a theme carried by a snapshot saved on another device (or before this fix)', () => {
  storage.setItem(themeStorageKey, 'light');
  applyUserSettings({ [themeStorageKey]: 'dark', [transactionTableSettingsStorageKey]: '{"b":2}' });
  expect(storage.getItem(themeStorageKey)).toBe('light');
  // Everything else in the snapshot still applies.
  expect(storage.getItem(transactionTableSettingsStorageKey)).toBe('{"b":2}');
 });
});
