import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import ar from '../../../../public/locales/ar/common.json';
import en from '../../../../public/locales/en/common.json';
import fr from '../../../../public/locales/fr/common.json';
import { excelExportWorkbooks, safePathSegment, safeSheetName, workbookSpecToXlsx, type ExcelExportData, type ExcelWorkbookSpec } from './excelExport';
import type { Client, ClientAccount, Currency, LedgerColumnKey, Organization, Transaction } from '@/shared/types';

// Same lookup + {{param}} substitution as useTranslation. `missing` collects any key the locale
// lacks, which the app would otherwise print raw.
function translator(dict: Record<string, string>, missing: Set<string> = new Set()) {
 return (key: string, params?: Record<string, string | number>) => {
  const template = dict[key];
  if (!template) missing.add(key);
  const text = template || key;
  return params ? text.replace(/\{\{(\w+)\}\}/g, (match, name) => (name in params ? String(params[name]) : match)) : text;
 };
}
const t = translator(en);
const ledgerColumnOrder: LedgerColumnKey[] = ['created', 'counterparty', 'direction', 'type', 'amount', 'currency', 'exchangeRate', 'commission', 'netChange', 'runningBalance', 'description'];
const options = { t, language: 'en', dateFormat: 'full' as const, ledgerColumnOrder };

function org(id: number, name: string): Organization {
 return { id, name, createdAt: '', updatedAt: '' };
}

function client(id: number, name: string, organizationId: number | null): Client {
 return { id, organizationId, organizationName: null, name, email: '', phone: '', address: '', excludeFromBalance: false, distributionCommissionEnabled: false, accountCount: 0, createdAt: '', updatedAt: '' };
}

function account(id: number, clientId: number, clientName: string, currencyId: number, currencyCode: string, startingBalance = 0): ClientAccount {
 return { id, clientId, clientName, currencyId, currencyCode, currencySymbol: currencyCode, startingBalance, note: '', noteShowInPdf: false, isSystem: false, systemKind: null, ownerUserId: null, isDormant: false, createdAt: '' };
}

function tx(overrides: Partial<Transaction>): Transaction {
 return {
  id: 1,
  accountFromId: null,
  clientFromName: '',
  accountFromCurrencyCode: 'USD',
  accountFromCurrencySymbol: '$',
  accountToId: null,
  clientToName: '',
  accountToCurrencyCode: 'USD',
  accountToCurrencySymbol: '$',
  currencyId: 1,
  currencyCode: 'USD',
  currencySymbol: '$',
  amount: 0,
  type: 'transfer',
  exchangeRateFrom: 1,
  commissionFrom: 0,
  exchangeRateTo: 1,
  commissionTo: 0,
  exchangeRateFromReversed: 0,
  exchangeRateToReversed: 0,
  charges: 0,
  chargesCurrencyId: null,
  chargesCurrencyCode: null,
  chargesCurrencySymbol: null,
  chargesPayer: '',
  chargesExchangeRate: 1,
  chargesDescription: '',
  charges2: 0,
  charges2CurrencyId: null,
  charges2CurrencyCode: null,
  charges2CurrencySymbol: null,
  chargesPayer2: '',
  charges2ExchangeRate: 1,
  charges2Description: '',
  description: '',
  descriptionFrom: '',
  descriptionTo: '',
  exchangeActualAmount: null,
  archiveNote: '',
  counterParty: '',
  isArchived: 0,
  archiveHidden: 0,
  distributionLocationId: null,
  distributionLocationName: null,
  distributionLocationKind: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  ...overrides,
 };
}

const currencies: Currency[] = [
 { id: 1, code: 'USD', name: 'US Dollar', symbol: '$' } as Currency,
 { id: 2, code: 'AED', name: 'UAE Dirham', symbol: 'AED' } as Currency,
];

// أحمد (org 1) holds USD + AED; two clients both called "Bob" share org 2; org 3's name cleans
// up to the same folder name as org 2's; Carol and "Con" have no organization; org 4 is empty.
const data: ExcelExportData = {
 organizations: [org(1, 'شركة النور'), org(2, 'Acme: Trading/Co.'), org(3, 'ACME_ TRADING_CO'), org(4, 'Empty Org')],
 clients: [client(1, 'أحمد', 1), client(2, 'Bob', 2), client(3, 'Bob', 2), client(4, 'Carol', null), client(5, 'Zed', 3), client(6, 'Con', null)],
 clientAccounts: [account(11, 1, 'أحمد', 1, 'USD', 100), account(12, 1, 'أحمد', 2, 'AED'), account(21, 2, 'Bob', 1, 'USD'), account(31, 3, 'Bob', 1, 'USD')],
 currencies,
 reconciliations: [],
 transactions: [
  // Bob → أحمد, 50 USD.
  tx({ id: 1, accountFromId: 21, clientFromName: 'Bob', accountToId: 11, clientToName: 'أحمد', amount: 50, createdAt: '2026-11-01T09:00:00.000Z', description: 'first' }),
  // أحمد moves 10 USD from his USD account into his AED account at 3.67.
  tx({ id: 2, accountFromId: 11, clientFromName: 'أحمد', accountToId: 12, clientToName: 'أحمد', accountToCurrencyCode: 'AED', amount: 10, exchangeRateTo: 3.67, createdAt: '2026-11-02T09:00:00.000Z' }),
  // Archived: never on a ledger, only in the Archive sheet.
  tx({ id: 3, accountFromId: 21, clientFromName: 'Bob', accountToId: 31, clientToName: 'Bob', amount: 999, isArchived: 1, archiveNote: 'old' }),
  // With a charge the sender pays.
  tx({ id: 4, accountFromId: 31, clientFromName: 'Bob', accountToId: 21, clientToName: 'Bob', amount: 20, charges: 5, chargesCurrencyCode: 'USD', chargesPayer: 'from', createdAt: '2026-11-03T09:00:00.000Z' }),
 ],
};

const workbooks = [...excelExportWorkbooks(data, options)];
const byPath = new Map<string, ExcelWorkbookSpec>(workbooks.map((wb) => [wb.path, wb]));
const sheet = (path: string, name: string) => {
 const found = byPath.get(path)?.sheets.find((s) => s.name === name);
 if (!found) throw new Error(`missing sheet ${path} › ${name}`);
 return found;
};
const column = (rows: (string | number)[][], header: string) => rows.slice(1).map((row) => row[rows[0].indexOf(header)]);

describe('excelExportWorkbooks layout', () => {
 it('puts the transactions file at the root and each client in its organization folder', () => {
  expect(workbooks.map((wb) => wb.path).sort()).toEqual(
   [
    'Transactions.xlsx',
    'شركة النور/أحمد.xlsx',
    'Acme_ Trading_Co/Bob.xlsx',
    'Acme_ Trading_Co/Bob (2).xlsx',
    'ACME_ TRADING_CO (2)/Zed.xlsx',
    'Unassigned/Carol.xlsx',
    'Unassigned/_Con.xlsx',
   ].sort(),
  );
  expect(workbooks[0].path).toBe('Transactions.xlsx');
 });

 it('gives a client a summary sheet plus one ledger sheet per currency', () => {
  expect(byPath.get('شركة النور/أحمد.xlsx')?.sheets.map((s) => s.name)).toEqual(['Summary', 'AED', 'USD']);
  // No accounts → just the summary.
  expect(byPath.get('Unassigned/Carol.xlsx')?.sheets.map((s) => s.name)).toEqual(['Summary']);
 });

 it('writes the ledger with an opening row and the same running balance as the app', () => {
  const usd = sheet('شركة النور/أحمد.xlsx', 'USD');
  expect(usd.rows[0]).toEqual(['Date', 'Counterparty', 'Direction', 'Type', 'Amount', 'Currency', 'Exchange Rate', 'Commission', 'Net change', 'Running balance', 'Description']);
  expect(usd.rows[1][0]).toBe('Opening Balance');
  // Opening 100, received 50 from Bob (−50), sent 10 to his own AED account (+10).
  expect(column(usd.rows, 'Running balance')).toEqual([100, 50, 60]);
  expect(column(usd.rows, 'Counterparty')).toEqual(['', 'Bob', 'أحمد']);
  expect(usd.moneyColumns).toEqual([4, 8, 9]);
  expect(usd.autoFilter).toBe(true);

  const aed = sheet('شركة النور/أحمد.xlsx', 'AED');
  expect(column(aed.rows, 'Running balance')).toEqual([0, -36.7]);
 });

 it('keeps archived transactions off every ledger', () => {
  const bob2 = sheet('Acme_ Trading_Co/Bob (2).xlsx', 'USD');
  expect(column(bob2.rows, 'Amount')).toEqual(['', 20]);
 });

 it('summarises each account', () => {
  const summary = sheet('شركة النور/أحمد.xlsx', 'Summary');
  expect(summary.rows[0]).toEqual(['Client name', 'أحمد']);
  expect(summary.rows[1]).toEqual(['Organization name', 'شركة النور']);
  expect(summary.rows.slice(-3)).toEqual([
   ['Currency', 'Currency name', 'Opening Balance', 'Balance', 'Transactions'],
   ['AED', 'United Arab Emirates Dirham', 0, -36.7, 1],
   ['USD', 'US Dollar', 100, 60, 2],
  ]);
  expect(summary.moneyColumns).toEqual([2, 3]);
 });

 it('splits transactions and archive, dropping columns nothing uses', () => {
  const book = byPath.get('Transactions.xlsx')!;
  expect(book.sheets.map((s) => s.name)).toEqual(['Transactions', 'Archive']);
  const active = book.sheets[0];
  expect(active.rows).toHaveLength(4); // header + ids 1, 2, 4 in date order
  expect(column(active.rows, 'Amount')).toEqual([50, 10, 20]);
  const headers = active.rows[0];
  expect(headers).toContain('Expenses');
  expect(headers).toContain('Expenses — Paid by');
  expect(headers).not.toContain('Expenses 2');
  expect(headers).not.toContain('Actual');
  expect(headers).not.toContain('Archive note');
  expect(column(active.rows, 'Expenses — Paid by')).toEqual(['', '', 'Bob']);
  expect(column(active.rows, 'Exchange Rate — Receiver')).toEqual([1, 3.67, 1]);
  expect(column(book.sheets[1].rows, 'Archive note')).toEqual(['old']);
 });
});

describe('export language', () => {
 const locales = { en, ar, fr } as Record<string, Record<string, string>>;

 it.each(['en', 'ar', 'fr'])('has a translation for every label it writes in %s', (language) => {
  const missing = new Set<string>();
  // A blank organization name exercises the numbered fallback label too.
  const withBlankOrg = { ...data, organizations: [...data.organizations, org(9, ' ... ')], clients: [...data.clients, client(9, 'Nameless Org Client', 9)] };
  const books = [...excelExportWorkbooks(withBlankOrg, { ...options, t: translator(locales[language], missing), language })];
  expect(books.length).toBeGreaterThan(0);
  expect([...missing]).toEqual([]);
 });

 it('writes everything it generates in Arabic when the app is in Arabic', () => {
  const withBlankOrg = { ...data, organizations: [...data.organizations, org(9, ' ... ')], clients: [...data.clients, client(9, 'Nameless Org Client', 9)] };
  const books = [...excelExportWorkbooks(withBlankOrg, { ...options, t: translator(ar), language: 'ar' })];
  const paths = books.map((wb) => wb.path);
  expect(paths[0]).toBe('المعاملات.xlsx');
  expect(paths).toContain('غير مُعين/Carol.xlsx');
  expect(paths).toContain('شركة 9/Nameless Org Client.xlsx');

  const ahmad = books.find((wb) => wb.path === 'شركة النور/أحمد.xlsx')!;
  expect(ahmad.sheets.map((s) => s.name)).toEqual(['ملخص', 'AED', 'USD']);
  const summary = ahmad.sheets[0].rows;
  expect(summary[0]).toEqual(['اسم العميل', 'أحمد']);
  expect(summary.at(-1)?.slice(0, 2)).toEqual(['USD', 'دولار أمريكي']);

  const usd = ahmad.sheets[2].rows;
  expect(usd[0]).toEqual(['التاريخ', 'الطرف المقابل', 'الاتجاه', 'النوع', 'المبلغ', 'العملة', 'سعر الصرف', 'العمولة', 'صافي الحركة', 'الرصيد التراكمي', 'الوصف']);
  expect(usd[1][0]).toBe('الرصيد الافتتاحي');
  // Generated cell values (direction, type) are translated too.
  expect(usd[2].slice(2, 4)).toEqual([ar.incoming, ar.transaction_type_transfer]);

  const transactions = books[0].sheets[0].rows;
  expect(transactions[0].slice(0, 3)).toEqual(['التاريخ', 'النوع', 'دائن']);
 });

 it('names currencies in French when the app is in French', () => {
  const books = [...excelExportWorkbooks(data, { ...options, t: translator(fr), language: 'fr' })];
  const summary = books.find((wb) => wb.path.endsWith('/أحمد.xlsx'))!.sheets[0];
  expect(summary.name).toBe('Résumé');
  expect(summary.rows.at(-1)?.slice(0, 2)).toEqual(['USD', 'dollar des États-Unis']);
 });
});

describe('name cleaning', () => {
 it('makes folder and file names safe on every OS', () => {
  expect(safePathSegment('a<b>c:d"e/f\\g|h?i*j', 'x')).toBe('a_b_c_d_e_f_g_h_i_j');
  expect(safePathSegment('  trailing dots... ', 'x')).toBe('trailing dots');
  expect(safePathSegment('nul.txt', 'x')).toBe('_nul.txt');
  expect(safePathSegment('   ', 'Fallback')).toBe('Fallback');
  expect(Array.from(safePathSegment('ع'.repeat(200), 'x'))).toHaveLength(80);
 });

 it('makes sheet names Excel accepts', () => {
  expect(safeSheetName('a[b]c:d*e?f/g\\h', 'x')).toBe('a_b_c_d_e_f_g_h');
  expect(safeSheetName("'quoted'", 'x')).toBe('quoted');
  expect(safeSheetName('x'.repeat(40), 'x')).toHaveLength(31);
  expect(safeSheetName('History', 'x')).toBe('History_');
  expect(safeSheetName('', 'Ledger')).toBe('Ledger');
 });
});

describe('workbookSpecToXlsx', () => {
 it('writes a workbook Excel can read back, with money formats and RTL when asked', () => {
  const spec = byPath.get('شركة النور/أحمد.xlsx')!;
  const bytes = workbookSpecToXlsx(XLSX, spec, { rtl: true });
  const book = XLSX.read(bytes, { type: 'array', cellNF: true });
  expect(book.SheetNames).toEqual(['Summary', 'AED', 'USD']);
  const usd = book.Sheets.USD;
  expect(usd.B3.v).toBe('Bob');
  expect(usd.J4.v).toBe(60);
  expect(usd.J4.z).toBe('#,##0.00##');
  expect(usd['!autofilter']).toBeDefined();
  expect(book.Workbook?.Views?.[0]?.RTL).toBe(true);

  const ltr = XLSX.read(workbookSpecToXlsx(XLSX, spec, { rtl: false }), { type: 'array' });
  expect(ltr.Workbook?.Views?.[0]?.RTL ?? false).toBe(false);
 });
});
