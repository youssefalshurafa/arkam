// Settings → Database → "Download as Excel": the whole workspace as a ZIP of Excel workbooks.
//
//   <Transactions>.xlsx           every transaction (plus an Archive sheet when there is one)
//   <Organization>/<Client>.xlsx  one workbook per client: a summary sheet, then one ledger
//                                 sheet per currency account with its running balance
//   <Unassigned>/<Client>.xlsx    clients without an organization
//
// This file decides WHAT goes where (pure, no xlsx dependency) and turns one workbook spec into
// .xlsx bytes given the xlsx module. The hook in useBackupActions drives it and zips the result.
//
// It is a read-only copy for opening in Excel or handing to someone — not a backup: the JSON
// backup next to it is the only thing Restore accepts.

import { computeClientLedgers } from '@/features/ledger/utils/ledgerBalances';
import { ledgerExcelColumns } from '@/features/ledger/utils/ledgerExcelColumns';
import { parseChargesPayer, type ChargesPayerParty } from '@/shared/utils/commission';
import { localizedCurrencyName } from '@/shared/utils/currencyName';
import { formatDateValue } from '@/shared/utils/date';
import { transactionTypeLabelKey } from '@/shared/utils/transactionType';
import type { Client, ClientAccount, Currency, LedgerColumnKey, Organization, PdfSettings, Reconciliation, Transaction } from '@/shared/types';

export type ExcelCell = string | number;

export type ExcelSheetSpec = {
 name: string;
 rows: ExcelCell[][];
 // Column indexes holding money amounts — numeric cells there get a thousands-separated format.
 moneyColumns?: number[];
 // Turn on Excel's filter dropdowns over the header row (row 1).
 autoFilter?: boolean;
};

export type ExcelWorkbookSpec = {
 path: string;
 sheets: ExcelSheetSpec[];
};

export type ExcelExportData = {
 organizations: Organization[];
 clients: Client[];
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 reconciliations: Reconciliation[];
 currencies: Currency[];
};

// Everything the export writes itself — headers, sheet and folder names, labels such as the
// transaction type or "Opening Balance", currency names — comes out in the app's current language
// through `t` and `language`. Only what the user typed (client names, descriptions…) is left as is.
export type ExcelExportOptions = {
 t: (key: string, params?: Record<string, string | number>) => string;
 // The UI language code ('en' | 'ar' | 'fr'), for currency names.
 language: string;
 dateFormat: PdfSettings['dateFormat'];
 // The user's ledger column order; any column missing from it is appended in default order.
 ledgerColumnOrder: LedgerColumnKey[];
};

// ── Names ────────────────────────────────────────────────────────────────────────────────────

// Characters Windows refuses in a file or folder name (macOS and Linux refuse a subset of these).
const INVALID_PATH_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
// Device names Windows won't create a file or folder under, with or without an extension.
const RESERVED_PATH_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
// Folder and file names are cut to this many characters, keeping a deep path well under
// Windows' 260-character limit even when extracted somewhere nested.
const MAX_SEGMENT_LENGTH = 80;

function truncate(value: string, max: number): string {
 const chars = Array.from(value); // by code point, so an emoji is never split in half
 return chars.length > max ? chars.slice(0, max).join('') : value;
}

// A client or organization name made safe to use as one path segment on any OS. Windows also
// drops trailing dots and spaces silently, which would make two "different" names collide on
// extraction, so they're trimmed here instead.
export function safePathSegment(name: string, fallback: string): string {
 const clean = (value: string) => value.replace(INVALID_PATH_CHARS, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
 let segment = clean(truncate(clean(name), MAX_SEGMENT_LENGTH));
 if (RESERVED_PATH_NAME.test(segment)) segment = `_${segment}`;
 return segment || clean(fallback) || '_';
}

// Excel sheet names: at most 31 characters, none of []:*?/\, not empty, no leading/trailing
// apostrophe, and "History" is reserved.
export function safeSheetName(name: string, fallback: string): string {
 const clean = (value: string) => value.replace(/[[\]:*?/\\]/g, '_').replace(/^'+|'+$/g, '').trim();
 const sheet = clean(truncate(clean(name), 31));
 if (!sheet) return clean(fallback).slice(0, 31) || 'Sheet';
 return sheet.toLowerCase() === 'history' ? `${sheet}_` : sheet;
}

// `name`, or `name (2)`, `name (3)`… — whichever isn't taken yet. Compared case-insensitively
// because Windows/macOS file systems and Excel sheet names are. `limit` keeps the suffixed form
// within a length cap (Excel's 31 for sheets).
function claimUniqueName(name: string, taken: Set<string>, limit = Infinity): string {
 let candidate = name;
 for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
  const suffix = ` (${n})`;
  candidate = `${truncate(name, limit - suffix.length).trimEnd()}${suffix}`;
 }
 taken.add(candidate.toLowerCase());
 return candidate;
}

// ── Sheet building ───────────────────────────────────────────────────────────────────────────

type ColumnDef<T> = {
 header: string;
 cell: (item: T) => ExcelCell;
 money?: boolean;
 // Dropped from the sheet when no row has a value — keeps rarely used fields (a second charge,
 // the exchange "actual" amount…) from adding a wall of empty columns to every export.
 optional?: boolean;
};

function tableSheet<T>(name: string, columns: ColumnDef<T>[], items: T[]): ExcelSheetSpec {
 const kept = columns.filter((col) => !col.optional || items.some((item) => col.cell(item) !== ''));
 return {
  name,
  rows: [kept.map((col) => col.header), ...items.map((item) => kept.map((col) => col.cell(item)))],
  moneyColumns: kept.flatMap((col, index) => (col.money ? [index] : [])),
  autoFilter: true,
 };
}

// Blank instead of 0 for fields where 0 means "not set".
const orBlank = (value: number | null | undefined): ExcelCell => (value ? value : '');

// The rate as the user entered it: a reversed rate is stored as its multiplier, shown as 1 / it.
function displayRate(rate: number, reversed: number | boolean): ExcelCell {
 if (!rate) return '';
 return reversed ? 1 / rate : rate;
}

function transactionColumns(t: ExcelExportOptions['t'], dateFormat: ExcelExportOptions['dateFormat']): ColumnDef<Transaction>[] {
 const sender = t('transaction_account_from');
 const receiver = t('transaction_account_to');
 const party = (tx: Transaction, who: ChargesPayerParty) => (who === 'from' ? tx.clientFromName : who === 'to' ? tx.clientToName : who === 'me' ? t('charges_payer_me') : '');
 // Who paid the charge and who received it, as two columns: one "A → B" cell would put a
 // non-mirroring arrow between Arabic names, which reads backwards in a right-to-left sheet.
 const paidBy = (tx: Transaction, payer: string) => party(tx, parseChargesPayer(payer).payer);
 const paidTo = (tx: Transaction, payer: string) => party(tx, parseChargesPayer(payer).payee);
 // A side with no account is a one-sided transaction; its free-text counterparty stands in.
 const sideName = (tx: Transaction, side: 'from' | 'to') => {
  const accountId = side === 'from' ? tx.accountFromId : tx.accountToId;
  if (accountId != null) return side === 'from' ? tx.clientFromName : tx.clientToName;
  return tx.counterParty?.trim() ?? '';
 };
 return [
  { header: t('date'), cell: (tx) => formatDateValue(tx.createdAt, dateFormat) },
  { header: t('transaction_type'), cell: (tx) => t(transactionTypeLabelKey(tx.type)) },
  { header: sender, cell: (tx) => sideName(tx, 'from') },
  { header: `${sender} — ${t('currency')}`, cell: (tx) => (tx.accountFromId != null ? tx.accountFromCurrencyCode : '') },
  { header: receiver, cell: (tx) => sideName(tx, 'to') },
  { header: `${receiver} — ${t('currency')}`, cell: (tx) => (tx.accountToId != null ? tx.accountToCurrencyCode : '') },
  { header: t('amount'), cell: (tx) => tx.amount, money: true },
  { header: t('currency'), cell: (tx) => tx.currencyCode },
  { header: `${t('exchange_rate')} — ${sender}`, cell: (tx) => displayRate(tx.exchangeRateFrom, tx.exchangeRateFromReversed) },
  { header: `${t('commission')} % — ${sender}`, cell: (tx) => orBlank(tx.commissionFrom) },
  { header: `${t('exchange_rate')} — ${receiver}`, cell: (tx) => displayRate(tx.exchangeRateTo, tx.exchangeRateToReversed) },
  { header: `${t('commission')} % — ${receiver}`, cell: (tx) => orBlank(tx.commissionTo) },
  { header: t('exchange_actual_label'), cell: (tx) => (tx.type === 'exchange' && tx.exchangeActualAmount != null ? tx.exchangeActualAmount : ''), money: true, optional: true },
  { header: t('charges'), cell: (tx) => orBlank(tx.charges), money: true, optional: true },
  { header: `${t('charges')} — ${t('currency')}`, cell: (tx) => (tx.charges ? (tx.chargesCurrencyCode ?? '') : ''), optional: true },
  { header: `${t('charges')} — ${t('excel_export_paid_by')}`, cell: (tx) => (tx.charges ? paidBy(tx, tx.chargesPayer) : ''), optional: true },
  { header: `${t('charges')} — ${t('excel_export_paid_to')}`, cell: (tx) => (tx.charges ? paidTo(tx, tx.chargesPayer) : ''), optional: true },
  { header: t('charges_description'), cell: (tx) => (tx.charges ? tx.chargesDescription || '' : ''), optional: true },
  { header: `${t('charges')} 2`, cell: (tx) => orBlank(tx.charges2), money: true, optional: true },
  { header: `${t('charges')} 2 — ${t('currency')}`, cell: (tx) => (tx.charges2 ? (tx.charges2CurrencyCode ?? '') : ''), optional: true },
  { header: `${t('charges')} 2 — ${t('excel_export_paid_by')}`, cell: (tx) => (tx.charges2 ? paidBy(tx, tx.chargesPayer2) : ''), optional: true },
  { header: `${t('charges')} 2 — ${t('excel_export_paid_to')}`, cell: (tx) => (tx.charges2 ? paidTo(tx, tx.chargesPayer2) : ''), optional: true },
  { header: `${t('charges_description')} 2`, cell: (tx) => (tx.charges2 ? tx.charges2Description || '' : ''), optional: true },
  { header: t('transaction_description'), cell: (tx) => tx.description || '' },
  { header: `${t('transaction_description')} — ${sender}`, cell: (tx) => tx.descriptionFrom?.trim() || '', optional: true },
  { header: `${t('transaction_description')} — ${receiver}`, cell: (tx) => tx.descriptionTo?.trim() || '', optional: true },
  { header: t('excel_export_archive_note'), cell: (tx) => tx.archiveNote?.trim() || '', optional: true },
 ];
}

function byDateThenId(a: Transaction, b: Transaction) {
 if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
 return a.id - b.id;
}

function transactionsWorkbook(data: ExcelExportData, options: ExcelExportOptions, path: string): ExcelWorkbookSpec {
 const { t, dateFormat } = options;
 const columns = transactionColumns(t, dateFormat);
 const sorted = [...data.transactions].sort(byDateThenId);
 const active = sorted.filter((tx) => !tx.isArchived);
 const archived = sorted.filter((tx) => tx.isArchived);
 const taken = new Set<string>();
 const sheets = [tableSheet(claimUniqueName(safeSheetName(t('transactions_title'), 'Transactions'), taken, 31), columns, active)];
 if (archived.length > 0) sheets.push(tableSheet(claimUniqueName(safeSheetName(t('archive_title'), 'Archive'), taken, 31), columns, archived));
 return { path, sheets };
}

function clientWorkbook(
 client: Client,
 organizationName: string,
 accounts: ClientAccount[],
 transactions: Transaction[],
 reconciliations: Reconciliation[],
 context: { clientAccountMap: Map<number, ClientAccount>; currencyMap: Map<number, Currency> },
 options: ExcelExportOptions,
 path: string,
): ExcelWorkbookSpec {
 const { t } = options;
 // The same ledger the client's page shows: same entries, same order, same running balance.
 const ledgers = computeClientLedgers({
  selectedClientForLedger: client,
  section: 'client-ledger',
  pdfExportModal: null,
  clientAccounts: accounts,
  transactions,
  reconciliations,
  clientAccountMap: context.clientAccountMap,
  currencyMap: context.currencyMap,
  enabled: true,
 });

 const allColumns = ledgerExcelColumns(t, options.dateFormat);
 const orderedKeys = [...options.ledgerColumnOrder, ...allColumns.map((col) => col.key).filter((key) => !options.ledgerColumnOrder.includes(key))];
 const columns = orderedKeys.map((key) => allColumns.find((col) => col.key === key)).filter((col): col is (typeof allColumns)[number] => Boolean(col));
 const moneyKeys = new Set<LedgerColumnKey>(['amount', 'netChange', 'runningBalance']);
 // The opening-balance row's label goes in the first column, unless that column is the
 // balance itself (it holds the figure).
 const labelIndex = columns[0]?.key === 'runningBalance' ? 1 : 0;

 const taken = new Set<string>();
 const summaryName = claimUniqueName(safeSheetName(t('excel_export_summary_sheet'), 'Summary'), taken, 31);
 const hasNotes = ledgers.some((ledger) => ledger.note.trim());
 const summaryRows: ExcelCell[][] = [
  [t('client_name'), client.name],
  [t('organization_name'), organizationName],
  [t('client_phone'), client.phone || ''],
  [t('client_email'), client.email || ''],
  [t('client_address'), client.address || ''],
  [],
  [t('currency'), t('currency_name'), t('starting_balance'), t('balance'), t('transactions_title'), ...(hasNotes ? [t('excel_export_account_note')] : [])],
  ...ledgers.map((ledger) => [ledger.currencyCode, ledger.currencyName, ledger.startingBalance, ledger.currentBalance, ledger.transactionCount, ...(hasNotes ? [ledger.note.trim()] : [])]),
 ];
 const sheets: ExcelSheetSpec[] = [{ name: summaryName, rows: summaryRows, moneyColumns: [2, 3] }];

 for (const ledger of ledgers) {
  const opening = columns.map((col, index): ExcelCell => (col.key === 'runningBalance' ? ledger.startingBalance : index === labelIndex ? t('starting_balance') : ''));
  sheets.push({
   name: claimUniqueName(safeSheetName(ledger.currencyCode, 'Ledger'), taken, 31),
   rows: [columns.map((col) => col.header), opening, ...ledger.entries.map((entry) => columns.map((col) => col.cell(entry)))],
   moneyColumns: columns.flatMap((col, index) => (moneyKeys.has(col.key) ? [index] : [])),
   autoFilter: true,
  });
 }
 return { path, sheets };
}

// ── The export ───────────────────────────────────────────────────────────────────────────────

// Yields one workbook at a time so the caller can write each to .xlsx and give the browser a
// moment between them — a large workspace has hundreds of clients.
export function* excelExportWorkbooks(data: ExcelExportData, options: ExcelExportOptions): Generator<ExcelWorkbookSpec> {
 const { t } = options;
 const rootNames = new Set<string>();
 yield transactionsWorkbook(data, options, `${claimUniqueName(safePathSegment(t('transactions_title'), 'Transactions'), rootNames)}.xlsx`);

 // Treasury/Cashbox accounts belong to hidden system clients, which aren't in `clients` — so
 // only real clients get workbooks. Their transactions still appear on the counterparty's
 // ledger and in the transactions workbook.
 const accountsByClient = new Map<number, ClientAccount[]>();
 for (const account of data.clientAccounts) {
  const list = accountsByClient.get(account.clientId);
  if (list) list.push(account);
  else accountsByClient.set(account.clientId, [account]);
 }
 // Each client's ledger only needs the transactions touching its own accounts. Indexing them
 // once keeps the export linear in the number of transactions instead of scanning all of them
 // for every account.
 const transactionsByAccount = new Map<number, Transaction[]>();
 const addTo = (accountId: number | null, tx: Transaction) => {
  if (accountId == null) return;
  const list = transactionsByAccount.get(accountId);
  if (list) list.push(tx);
  else transactionsByAccount.set(accountId, [tx]);
 };
 for (const tx of data.transactions) {
  addTo(tx.accountFromId, tx);
  if (tx.accountToId !== tx.accountFromId) addTo(tx.accountToId, tx);
 }
 const reconciliationsByAccount = new Map<number, Reconciliation[]>();
 for (const rec of data.reconciliations) {
  const list = reconciliationsByAccount.get(rec.accountId);
  if (list) list.push(rec);
  else reconciliationsByAccount.set(rec.accountId, [rec]);
 }
 const context = {
  clientAccountMap: new Map(data.clientAccounts.map((account) => [account.id, account])),
  // Named in the UI language, as the ledger page shows them; computeClientLedgers carries the name
  // onto each ledger.
  currencyMap: new Map(data.currencies.map((currency) => [currency.id, { ...currency, name: localizedCurrencyName(currency.code, currency.name, options.language) }])),
 };

 // Folder per organization, named once and reused, so two organizations whose names clean up to
 // the same folder name get "Name" and "Name (2)" rather than being merged.
 const organizationNames = new Map(data.organizations.map((org) => [org.id, org.name]));
 const folderFor = new Map<number | null, { folder: string; label: string; files: Set<string> }>();
 const sortedClients = [...data.clients].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
 for (const client of sortedClients) {
  const orgId = client.organizationId != null && organizationNames.has(client.organizationId) ? client.organizationId : null;
  let folder = folderFor.get(orgId);
  if (!folder) {
   const label = orgId != null ? (organizationNames.get(orgId) ?? '') : t('unassigned');
   // A name that cleans down to nothing (only dots or spaces) falls back to a numbered label.
   const fallback = orgId != null ? t('excel_export_unnamed_organization', { id: orgId }) : 'Unassigned';
   folder = { folder: claimUniqueName(safePathSegment(label, fallback), rootNames), label, files: new Set() };
   folderFor.set(orgId, folder);
  }
  const accounts = accountsByClient.get(client.id) ?? [];
  const seen = new Set<number>();
  const transactions: Transaction[] = [];
  const reconciliations: Reconciliation[] = [];
  for (const account of accounts) {
   for (const tx of transactionsByAccount.get(account.id) ?? []) {
    if (seen.has(tx.id)) continue; // a transfer between two of the client's own accounts
    seen.add(tx.id);
    transactions.push(tx);
   }
   reconciliations.push(...(reconciliationsByAccount.get(account.id) ?? []));
  }
  const fileName = claimUniqueName(safePathSegment(client.name, t('excel_export_unnamed_client', { id: client.id })), folder.files);
  yield clientWorkbook(client, folder.label, accounts, transactions, reconciliations, context, options, `${folder.folder}/${fileName}.xlsx`);
 }
}

// ── Writing ──────────────────────────────────────────────────────────────────────────────────

type XlsxModule = typeof import('xlsx');

// Thousands separators with 2–4 decimals: whole amounts read "1,500.00", FX results keep enough
// precision to check by hand. The cell keeps its full value either way.
const MONEY_FORMAT = '#,##0.00##';

function columnWidths(rows: ExcelCell[][]): Array<{ wch: number }> {
 const widths: number[] = [];
 for (const row of rows) {
  row.forEach((cell, index) => {
   const length = typeof cell === 'number' ? Math.min(String(Math.round(cell)).length + 6, 20) : Array.from(String(cell)).length;
   widths[index] = Math.max(widths[index] ?? 0, length);
  });
 }
 return widths.map((width) => ({ wch: Math.min(Math.max(width + 2, 8), 50) }));
}

export function workbookSpecToXlsx(xlsx: XlsxModule, spec: ExcelWorkbookSpec, options: { rtl: boolean }): Uint8Array {
 const workbook = xlsx.utils.book_new();
 for (const sheet of spec.sheets) {
  const worksheet = xlsx.utils.aoa_to_sheet(sheet.rows);
  worksheet['!cols'] = columnWidths(sheet.rows);
  for (const column of sheet.moneyColumns ?? []) {
   for (let r = 0; r < sheet.rows.length; r++) {
    const cell = worksheet[xlsx.utils.encode_cell({ r, c: column })];
    if (cell && cell.t === 'n') cell.z = MONEY_FORMAT;
   }
  }
  if (sheet.autoFilter && worksheet['!ref']) worksheet['!autofilter'] = { ref: worksheet['!ref'] };
  xlsx.utils.book_append_sheet(workbook, worksheet, sheet.name);
 }
 // Arabic users get right-to-left sheets, matching the app.
 if (options.rtl) workbook.Workbook = { ...(workbook.Workbook ?? {}), Views: [{ RTL: true }] };
 const buffer = xlsx.write(workbook, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
 return new Uint8Array(buffer);
}
