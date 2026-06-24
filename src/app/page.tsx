'use client';

import { ChangeEvent, DragEvent, Fragment, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useLanguage } from '@/contexts/LanguageContext';
import LoginPage from '@/components/auth/LoginPage';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';

type DbInfo = {
 provider: string;
 host: string;
 port: string;
 database: string;
 schema: string;
 dbPath: string;
 dbDirectory: string;
 supportsDirectoryChange: boolean;
};

type Organization = {
 id: number;
 name: string;
 createdAt: string;
 updatedAt: string;
};

type OrganizationForm = {
 id?: number;
 name: string;
};

type Client = {
 id: number;
 organizationId: number | null;
 organizationName: string | null;
 name: string;
 email: string;
 phone: string;
 address: string;
 accountCount: number;
 createdAt: string;
 updatedAt: string;
};

type ClientForm = {
 id?: number;
 organizationId: number | null;
 name: string;
 email: string;
 phone: string;
 address: string;
};

type NewClientAccountDraft = {
 currencyId: number | null;
 startingBalance: string;
};

type ClientAccount = {
 id: number;
 clientId: number;
 clientName: string;
 currencyId: number;
 currencyCode: string;
 currencySymbol: string;
 startingBalance: number;
 createdAt: string;
};

type Currency = {
 id: number;
 code: string;
 name: string;
 symbol: string;
 isEnabled: number;
 isMain: number;
 createdAt: string;
};

type Transaction = {
 id: number;
 accountFromId: number;
 clientFromName: string;
 accountFromCurrencyCode: string;
 accountFromCurrencySymbol: string;
 accountToId: number;
 clientToName: string;
 accountToCurrencyCode: string;
 accountToCurrencySymbol: string;
 currencyId: number;
 currencyCode: string;
 currencySymbol: string;
 amount: number;
 type: string;
 exchangeRateFrom: number;
 commissionFrom: number;
 exchangeRateTo: number;
 commissionTo: number;
 exchangeRateFromReversed: number;
 exchangeRateToReversed: number;
 charges: number;
 chargesCurrencyId: number | null;
 chargesCurrencyCode: string | null;
 chargesCurrencySymbol: string | null;
 chargesPayer: string;
 chargesExchangeRate: number;
 chargesDescription: string;
 description: string;
 createdAt: string;
};

type TransactionForm = {
 accountFromId: number | null;
 accountToId: number | null;
 currencyId: number | null;
 amount: string;
 type: string;
 exchangeRateFrom: string;
 commissionFrom: string;
 exchangeRateTo: string;
 commissionTo: string;
 charges: string;
 chargesCurrencyId: number | null;
 chargesPayer: string;
 chargesExchangeRate: string;
 chargesDescription: string;
 description: string;
};

type TransactionUpdateInput = {
 id: number;
 accountFromId: number;
 accountToId: number;
 currencyId: number;
 amount: number;
 type: string;
 exchangeRateFrom: number;
 commissionFrom: number;
 exchangeRateTo: number;
 commissionTo: number;
 exchangeRateFromReversed?: number;
 exchangeRateToReversed?: number;
 charges: number;
 chargesCurrencyId: number | null;
 chargesPayer: string;
 chargesExchangeRate: number;
 chargesDescription: string;
 description: string;
 createdAt: string;
};

type TransactionTableDraft = {
 transactionId: number;
 accountFromId: number | null;
 accountToId: number | null;
 currencyId: number | null;
 type: string;
 amount: string;
 exchangeRateFrom: string;
 commissionFrom: string;
 exchangeRateTo: string;
 commissionTo: string;
 charges: string;
 chargesCurrencyId: number | null;
 chargesPayer: string;
 chargesExchangeRate: string;
 chargesDescription: string;
 description: string;
 createdDate: string;
};

type LedgerTransactionDraft = {
 transactionId: number;
 ledgerAccountId: number;
 createdDate: string;
 direction: 'incoming' | 'outgoing';
 counterpartyAccountId: number | null;
 type: string;
 amount: string;
 exchangeRate: string;
 commission: string;
 description: string;
};

type ClientLedgerEntry = {
 transactionId: number;
 createdAt: string;
 counterpartyName: string;
 counterpartyClientId: number | null;
 direction: 'incoming' | 'outgoing';
 type: string;
 amount: number;
 currencyCode: string;
 currencySymbol: string;
 exchangeRate: number;
 exchangeRateReversed: boolean;
 commission: number;
 netChange: number;
 runningBalance: number;
 description: string;
 charges: number;
 chargesCurrencyCode: string | null;
 chargesPayer: string;
 chargesExchangeRate: number;
 chargesDescription: string;
 isChargesPayerThisAccount: boolean;
};

type ClientAccountLedger = {
 accountId: number;
 currencyName: string;
 currencyCode: string;
 currencySymbol: string;
 startingBalance: number;
 currentBalance: number;
 transactionCount: number;
 entries: ClientLedgerEntry[];
};

type ImportedTransactionRow = {
 fromName: string;
 toName: string;
 amount: number;
 createdAt: string | null;
 description: string;
};

type ImportMappingState = {
 dateColumn: number | null;
 fromColumn: number | null;
 toColumn: number | null;
 amountColumn: number | null;
 descriptionColumn: number | null;
 currencyId: number | null;
};

type PendingImportData = {
 fileName: string;
 rows: unknown[][];
 columnOptions: Array<{ index: number; label: string }>;
};

type LedgerColumnKey = 'created' | 'counterparty' | 'direction' | 'type' | 'amount' | 'exchangeRate' | 'commission' | 'netChange' | 'runningBalance' | 'description';

const defaultLedgerColumnOrder: LedgerColumnKey[] = [
 'created',
 'counterparty',
 'direction',
 'type',
 'amount',
 'exchangeRate',
 'commission',
 'netChange',
 'runningBalance',
 'description',
];

const ledgerColumnOrderStorageKey = 'arkam:ledger-column-order';

type SettingsTab = 'database' | 'language' | 'clients' | 'organizations' | 'currencies' | 'danger';

type Section = 'overview' | 'settings' | 'organizations' | 'organization-clients' | 'clients' | 'client-ledger' | 'currencies' | 'transactions';

const allowedSections: Section[] = ['overview', 'settings', 'organizations', 'organization-clients', 'clients', 'client-ledger', 'currencies', 'transactions'];

function getSectionFromHash(hash: string): Section {
 const normalized = hash.replace('#', '');
 return allowedSections.includes(normalized as Section) ? (normalized as Section) : 'overview';
}

function normalizeDecimalInput(value: string) {
 return value
  .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
  .replace(/\u066B/g, '.')
  .replace(/[\u066C,\s]/g, '')
  .replace(/[^0-9.\-]/g, '');
}

function normalizeImportHeader(value: string) {
 return value
  .trim()
  .toLowerCase()
  .replace(/[\u064B-\u065F]/g, '')
  .replace(/[\s_\-]/g, '');
}

function toImportString(value: unknown) {
 return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function toImportAmount(value: unknown) {
 const normalized = normalizeDecimalInput(toImportString(value));
 const parsed = Number.parseFloat(normalized);
 return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function pad2(value: number) {
 return String(value).padStart(2, '0');
}

function toSqlDateTimeFromParts(year: number, month: number, day: number) {
 if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
  return null;
 }
 if (month < 1 || month > 12 || day < 1 || day > 31) {
  return null;
 }
 return `${year}-${pad2(month)}-${pad2(day)} 00:00:00`;
}

function parseImportedDate(value: unknown) {
 if (value instanceof Date && !Number.isNaN(value.getTime())) {
  return toSqlDateTimeFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
 }

 const raw = toImportString(value);
 if (!raw) {
  return null;
 }

 const normalized = raw
  .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
  .replace(/\u066C/g, '')
  .trim();

 const yyyymmdd = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
 if (yyyymmdd) {
  return toSqlDateTimeFromParts(Number.parseInt(yyyymmdd[1], 10), Number.parseInt(yyyymmdd[2], 10), Number.parseInt(yyyymmdd[3], 10));
 }

 const dayMonthYear = normalized.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
 if (dayMonthYear) {
  const first = Number.parseInt(dayMonthYear[1], 10);
  const second = Number.parseInt(dayMonthYear[2], 10);
  const maybeYear = dayMonthYear[3] ? Number.parseInt(dayMonthYear[3], 10) : new Date().getFullYear();
  const year = maybeYear < 100 ? 2000 + maybeYear : maybeYear;

  // Prefer day/month, but if impossible (e.g. 07/28/2024), treat as month/day.
  const dayFirst = toSqlDateTimeFromParts(year, second, first);
  if (dayFirst) {
   return dayFirst;
  }

  const monthFirst = toSqlDateTimeFromParts(year, first, second);
  if (monthFirst) {
   return monthFirst;
  }
 }

 const yearMonthDay = normalized.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
 if (yearMonthDay) {
  return toSqlDateTimeFromParts(Number.parseInt(yearMonthDay[1], 10), Number.parseInt(yearMonthDay[2], 10), Number.parseInt(yearMonthDay[3], 10));
 }

 if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
  const serial = Number.parseFloat(normalized);
  if (Number.isFinite(serial) && serial >= 1 && serial <= 100000) {
   const wholeDays = Math.floor(serial);
   const excelEpochUtc = Date.UTC(1899, 11, 30);
   const date = new Date(excelEpochUtc + wholeDays * 24 * 60 * 60 * 1000);
   if (!Number.isNaN(date.getTime())) {
    return toSqlDateTimeFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
   }
  }
 }

 const parsedMillis = Date.parse(raw);
 if (!Number.isNaN(parsedMillis)) {
  const parsedDate = new Date(parsedMillis);
  return toSqlDateTimeFromParts(parsedDate.getFullYear(), parsedDate.getMonth() + 1, parsedDate.getDate());
 }

 return null;
}

function getExcelLikeColumnName(index: number) {
 let value = index;
 let result = '';

 do {
  result = String.fromCharCode(65 + (value % 26)) + result;
  value = Math.floor(value / 26) - 1;
 } while (value >= 0);

 return result;
}

function buildImportColumnOptions(rows: unknown[][]) {
 const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);

 return Array.from({ length: maxColumns }, (_, index) => {
  const sample = rows
   .slice(0, 8)
   .map((row) => toImportString(row[index]))
   .find((value) => value.length > 0);

  return {
   index,
   label: `${getExcelLikeColumnName(index)} - ${sample || `Column ${index + 1}`}`,
  };
 });
}

function escapeRegex(value: string) {
 return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeClientNameForCurrencySuffix(name: string, currency: Currency) {
 const compactName = name.trim().replace(/\s+/g, ' ');
 if (!compactName) {
  return compactName;
 }

 const currencyAliasesByCode: Record<string, string[]> = {
  EUR: ['euro', 'euros', 'ÙŠÙˆØ±Ùˆ'],
  USD: ['dollar', 'dollars', 'usd', 'Ø¯ÙˆÙ„Ø§Ø±'],
  TRY: ['turk', 'turkish', 'lira', 'try', 'Ù„ÙŠØ±Ø©', 'ØªØ±ÙƒÙŠ'],
  GBP: ['pound', 'sterling', 'gbp', 'Ø¬Ù†ÙŠÙ‡'],
  AED: ['aed', 'dirham', 'Ø¯Ø±Ù‡Ù…'],
  SAR: ['sar', 'riyal', 'Ø±ÙŠØ§Ù„'],
 };

 const aliases = [currency.code, currency.name, currency.symbol, ...(currencyAliasesByCode[currency.code] || [])]
  .map((alias) => toImportString(alias).toLowerCase())
  .filter((alias, index, list) => alias.length > 0 && list.indexOf(alias) === index)
  .sort((left, right) => right.length - left.length);

 let normalized = compactName;

 for (const alias of aliases) {
  const aliasPattern = new RegExp(`(?:\\s|[-_/()])${escapeRegex(alias)}$`, 'i');
  const exactAliasPattern = new RegExp(`^${escapeRegex(alias)}$`, 'i');

  if (exactAliasPattern.test(normalized)) {
   continue;
  }

  if (aliasPattern.test(normalized)) {
   normalized = normalized.replace(aliasPattern, '').trim().replace(/\s+/g, ' ');
  }
 }

 return normalized || compactName;
}

function parseTransactionRowsFromMappedSheet(rows: unknown[][], mapping: ImportMappingState, currency: Currency) {
 if (mapping.fromColumn == null || mapping.toColumn == null || mapping.amountColumn == null) {
  throw new Error('Please choose columns for From, To, and Amount.');
 }

 const parsedRows: ImportedTransactionRow[] = [];

 for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
  const row = rows[rowIndex];
  const fromRaw = toImportString(row[mapping.fromColumn]);
  const toRaw = toImportString(row[mapping.toColumn]);
  const amountRaw = toImportString(row[mapping.amountColumn]);
  const amount = toImportAmount(amountRaw);
  const description = mapping.descriptionColumn == null ? '' : toImportString(row[mapping.descriptionColumn]);
  const createdAt = mapping.dateColumn == null ? null : parseImportedDate(row[mapping.dateColumn]);

  const isCompletelyEmpty = !fromRaw && !toRaw && !amountRaw;
  if (isCompletelyEmpty) {
   continue;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
   continue;
  }

  const fromName = normalizeClientNameForCurrencySuffix(fromRaw, currency);
  const toName = normalizeClientNameForCurrencySuffix(toRaw, currency);

  if (!fromName || !toName) {
   continue;
  }

  parsedRows.push({
   fromName,
   toName,
   amount,
   createdAt,
   description,
  });
 }

 if (!parsedRows.length) {
  throw new Error('No valid transaction rows were found for the selected columns.');
 }

 return parsedRows;
}

function getStoredLedgerColumnOrder() {
 if (typeof window === 'undefined') {
  return defaultLedgerColumnOrder;
 }

 try {
  const rawValue = window.localStorage.getItem(ledgerColumnOrderStorageKey);
  if (!rawValue) {
   return defaultLedgerColumnOrder;
  }

  const parsedValue = JSON.parse(rawValue);
  if (!Array.isArray(parsedValue) || parsedValue.length !== defaultLedgerColumnOrder.length) {
   return defaultLedgerColumnOrder;
  }

  const normalizedOrder = parsedValue.filter((column): column is LedgerColumnKey => defaultLedgerColumnOrder.includes(column as LedgerColumnKey));
  if (normalizedOrder.length !== defaultLedgerColumnOrder.length) {
   return defaultLedgerColumnOrder;
  }

  if (new Set(normalizedOrder).size !== defaultLedgerColumnOrder.length) {
   return defaultLedgerColumnOrder;
  }

  return normalizedOrder;
 } catch {
  return defaultLedgerColumnOrder;
 }
}

function getCommissionAmount(baseAmount: number, commissionPercent: number) {
 return baseAmount * (commissionPercent / 100);
}

type IconName = 'home' | 'organizations' | 'clients' | 'currencies' | 'transactions' | 'settings' | 'database' | 'auth';

function renderIcon(icon: IconName, className = 'h-5 w-5') {
 const commonProps = {
  className,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
 };

 switch (icon) {
  case 'home':
   return (
    <svg {...commonProps}>
     <path d="M3 10.5 12 3l9 7.5" />
     <path d="M5 9.5V21h14V9.5" />
     <path d="M9 21v-6h6v6" />
    </svg>
   );
  case 'organizations':
   return (
    <svg {...commonProps}>
     <path d="M4 21h16" />
     <path d="M6 21V7l6-3 6 3v14" />
     <path d="M9 10h.01M12 10h.01M15 10h.01M9 14h.01M12 14h.01M15 14h.01" />
    </svg>
   );
  case 'clients':
   return (
    <svg {...commonProps}>
     <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
     <circle
      cx="9.5"
      cy="7"
      r="3.5"
     />
     <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
     <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
   );
  case 'currencies':
   return (
    <svg {...commonProps}>
     <path d="M12 3v18" />
     <path d="M16.5 7.5c0-1.93-2.01-3.5-4.5-3.5S7.5 5.57 7.5 7.5 9.51 11 12 11s4.5 1.57 4.5 3.5S14.49 18 12 18s-4.5-1.57-4.5-3.5" />
    </svg>
   );
  case 'transactions':
   return (
    <svg {...commonProps}>
     <path d="M7 7h11" />
     <path d="m13 3 5 4-5 4" />
     <path d="M17 17H6" />
     <path d="m11 13-5 4 5 4" />
    </svg>
   );
  case 'settings':
   return (
    <svg {...commonProps}>
     <circle
      cx="12"
      cy="12"
      r="3"
     />
     <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01A1.65 1.65 0 0 0 20.91 10H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
   );
  case 'database':
   return (
    <svg {...commonProps}>
     <ellipse
      cx="12"
      cy="5"
      rx="7"
      ry="3"
     />
     <path d="M5 5v6c0 1.66 3.13 3 7 3s7-1.34 7-3V5" />
     <path d="M5 11v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" />
    </svg>
   );
  case 'auth':
   return (
    <svg {...commonProps}>
     <circle
      cx="12"
      cy="8"
      r="3"
     />
     <path d="M5 20v-1.2A5.8 5.8 0 0 1 10.8 13h2.4A5.8 5.8 0 0 1 19 18.8V20" />
     <path d="M15.5 10.5 17 12l1.5-1.5" />
     <path d="M17 12v-4" />
    </svg>
   );
 }
}

const emptyOrganizationForm = (): OrganizationForm => ({
 name: '',
});

const emptyClientForm = (): ClientForm => ({
 organizationId: null,
 name: '',
 email: '',
 phone: '',
 address: '',
});

const createNewClientAccountDraft = (): NewClientAccountDraft => ({
 currencyId: null,
 startingBalance: '0',
});

const emptyTransactionForm = (): TransactionForm => ({
 accountFromId: null,
 accountToId: null,
 currencyId: null,
 amount: '',
 type: 'transfer',
 exchangeRateFrom: '1.00',
 commissionFrom: '0.00',
 exchangeRateTo: '1.00',
 commissionTo: '0.00',
 charges: '0',
 chargesCurrencyId: null,
 chargesPayer: '',
 chargesExchangeRate: '1.00',
 chargesDescription: '',
 description: '',
});

function AuthenticatedHome() {
 const router = useRouter();
 const { language, setLanguage, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const [section, setSection] = useState<Section>('overview');
 const [settingsTab, setSettingsTab] = useState<SettingsTab>('clients');
 const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
 const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
 const [organizations, setOrganizations] = useState<Organization[]>([]);
 const [clients, setClients] = useState<Client[]>([]);
 const [currencies, setCurrencies] = useState<Currency[]>([]);
 const [transactions, setTransactions] = useState<Transaction[]>([]);
 const [clientAccounts, setClientAccounts] = useState<ClientAccount[]>([]);
 const [selectedClientForAccounts, setSelectedClientForAccounts] = useState<Client | null>(null);
 const [selectedClientForLedger, setSelectedClientForLedger] = useState<Client | null>(null);
 const [clientLedgerBackSection, setClientLedgerBackSection] = useState<'clients' | 'organization-clients'>('clients');
 const [isClientLedgerEditMode, setIsClientLedgerEditMode] = useState(false);
 const [ledgerStartingBalanceDrafts, setLedgerStartingBalanceDrafts] = useState<Record<number, string>>({});
 const [selectedLedgerAccountId, setSelectedLedgerAccountId] = useState<number | null>(null);
 const [isTransactionsEditMode, setIsTransactionsEditMode] = useState(false);
 const [selectedTransactionIds, setSelectedTransactionIds] = useState<Set<number>>(new Set());
 const [transactionsPage, setTransactionsPage] = useState(1);
 const [transactionsPageSize, setTransactionsPageSize] = useState(100);
 const [commissionExpandedTxns, setCommissionExpandedTxns] = useState<Set<number>>(new Set());
 const [expensesExpandedTxns, setExpensesExpandedTxns] = useState<Set<number>>(new Set());
 const [ledgerCommissionExpandedEntries, setLedgerCommissionExpandedEntries] = useState<Set<string>>(new Set());
 const [isNewTransactionSectionOpen, setIsNewTransactionSectionOpen] = useState(false);
 const [isNewTransactionExpensesOpen, setIsNewTransactionExpensesOpen] = useState(false);
 const [showLedgerCurrencySymbol, setShowLedgerCurrencySymbol] = useState(true);
 const [draggedLedgerColumn, setDraggedLedgerColumn] = useState<LedgerColumnKey | null>(null);
 const [ledgerColumnOrder, setLedgerColumnOrder] = useState<LedgerColumnKey[]>(() => getStoredLedgerColumnOrder());
 const [ledgerColumnVisibility, setLedgerColumnVisibility] = useState<Record<LedgerColumnKey, boolean>>({
  created: true,
  counterparty: true,
  direction: false,
  type: false,
  amount: true,
  exchangeRate: true,
  commission: true,
  netChange: true,
  runningBalance: true,
  description: true,
 });
 const [ledgerTransactionDrafts, setLedgerTransactionDrafts] = useState<Record<string, LedgerTransactionDraft>>({});
 const [transactionTableDrafts, setTransactionTableDrafts] = useState<Record<number, TransactionTableDraft>>({});
 const [selectedOrganizationForClients, setSelectedOrganizationForClients] = useState<Organization | null>(null);
 const [newAccountCurrencyId, setNewAccountCurrencyId] = useState<number | null>(null);
 const [newAccountStartingBalance, setNewAccountStartingBalance] = useState<string>('0');
 const [pdfExportModal, setPdfExportModal] = useState<{ accountId: number; fromDate: string; toDate: string } | null>(null);
 const [selectedCatalogCurrencyId, setSelectedCatalogCurrencyId] = useState<number | null>(null);
 const [catalogCurrencyQuery, setCatalogCurrencyQuery] = useState('');
 const [organizationForm, setOrganizationForm] = useState<OrganizationForm>(emptyOrganizationForm);
 const [clientForm, setClientForm] = useState<ClientForm>(emptyClientForm);
 const [openAccountOnCreate, setOpenAccountOnCreate] = useState(false);
 const [newClientAccountDrafts, setNewClientAccountDrafts] = useState<NewClientAccountDraft[]>([createNewClientAccountDraft()]);
 const [transactionForm, setTransactionForm] = useState<TransactionForm>(emptyTransactionForm);
 const [txFromQuery, setTxFromQuery] = useState('');
 const [txFromOpen, setTxFromOpen] = useState(false);
 const [txToQuery, setTxToQuery] = useState('');
 const [txToOpen, setTxToOpen] = useState(false);
 const [txFromRateReversed, setTxFromRateReversed] = useState(false);
 const [txToRateReversed, setTxToRateReversed] = useState(false);
 const [ledgerRateReversed, setLedgerRateReversed] = useState<Record<string, boolean>>({});
 const [ledgerDisplayRateReversed, setLedgerDisplayRateReversed] = useState<Record<string, boolean>>({});
 const [tableRateFromReversed, setTableRateFromReversed] = useState<Record<number, boolean>>({});
 const [tableRateToReversed, setTableRateToReversed] = useState<Record<number, boolean>>({});
 const [error, setError] = useState('');
 const [importSummary, setImportSummary] = useState('');
 const [isImportingTransactions, setIsImportingTransactions] = useState(false);
 const [pendingImportData, setPendingImportData] = useState<PendingImportData | null>(null);
 const [importMapping, setImportMapping] = useState<ImportMappingState>({
  dateColumn: null,
  fromColumn: null,
  toColumn: null,
  amountColumn: null,
  descriptionColumn: null,
  currencyId: null,
 });
 const transactionsImportInputRef = useRef<HTMLInputElement | null>(null);

 const loadData = useCallback(async () => {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  try {
   const [db, organizationRows, clientRows, currencyRows, transactionRows, clientAccountRows] = (await Promise.all([
    accountingApi.getDbInfo(),
    accountingApi.listOrganizations(),
    accountingApi.listClients(),
    accountingApi.listCurrencies(),
    accountingApi.listTransactions(),
    accountingApi.listAllClientAccounts(),
   ])) as [DbInfo, Organization[], Client[], Currency[], Transaction[], ClientAccount[]];

   let nextCurrencies = currencyRows;
   if (!nextCurrencies.length) {
    await accountingApi.reseedCurrencies();
    nextCurrencies = (await accountingApi.listCurrencies()) as Currency[];
   }

   setDbInfo(db);
   setOrganizations(organizationRows);
   setClients(clientRows);
   setCurrencies(nextCurrencies);
   setTransactions(transactionRows);
   setClientAccounts(clientAccountRows);
   setSelectedOrganizationForClients((current) => (current ? (organizationRows.find((organization) => organization.id === current.id) ?? null) : null));
   setSelectedClientForAccounts((current) => (current ? (clientRows.find((client) => client.id === current.id) ?? null) : null));
   setSelectedClientForLedger((current) => (current ? (clientRows.find((client) => client.id === current.id) ?? null) : null));
   setError('');
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_load'));
  }
 }, [t]);

 useEffect(() => {
  const timeoutId = window.setTimeout(() => {
   void loadData();
  }, 0);

  return () => {
   window.clearTimeout(timeoutId);
  };
 }, [loadData]);

 useEffect(() => {
  const applyHashSection = () => {
   setSection(getSectionFromHash(window.location.hash));
  };

  applyHashSection();
  window.addEventListener('hashchange', applyHashSection);

  return () => {
   window.removeEventListener('hashchange', applyHashSection);
  };
 }, []);

 useEffect(() => {
  window.localStorage.setItem(ledgerColumnOrderStorageKey, JSON.stringify(ledgerColumnOrder));
 }, [ledgerColumnOrder]);

 useEffect(() => {
  const transactionIds = new Set(transactions.map((transaction) => transaction.id));
  setSelectedTransactionIds((current) => new Set([...current].filter((id) => transactionIds.has(id))));
 }, [transactions]);

 const totalTransactionPages = Math.max(1, Math.ceil(transactions.length / transactionsPageSize));
 const paginatedTransactions = useMemo(() => {
  const start = (transactionsPage - 1) * transactionsPageSize;
  return transactions.slice(start, start + transactionsPageSize);
 }, [transactions, transactionsPage, transactionsPageSize]);

 useEffect(() => {
  setTransactionsPage((current) => Math.min(current, totalTransactionPages));
 }, [totalTransactionPages]);

 useEffect(() => {
  if (!transactionForm.currencyId || !transactionForm.accountFromId) return;
  const selectedCurrency = currencies.find((c) => c.id === transactionForm.currencyId);
  const accountFrom = clientAccounts.find((a) => a.id === transactionForm.accountFromId);
  if (selectedCurrency && accountFrom && selectedCurrency.code === accountFrom.currencyCode) {
   setTransactionForm((current) => ({ ...current, exchangeRateFrom: '1.00' }));
  }
 }, [transactionForm.currencyId, transactionForm.accountFromId, currencies, clientAccounts]);

 useEffect(() => {
  if (!transactionForm.currencyId || !transactionForm.accountToId) return;
  const selectedCurrency = currencies.find((c) => c.id === transactionForm.currencyId);
  const accountTo = clientAccounts.find((a) => a.id === transactionForm.accountToId);
  if (selectedCurrency && accountTo && selectedCurrency.code === accountTo.currencyCode) {
   setTransactionForm((current) => ({ ...current, exchangeRateTo: '1.00' }));
  }
 }, [transactionForm.currencyId, transactionForm.accountToId, currencies, clientAccounts]);

 useEffect(() => {
  if (!transactionForm.chargesCurrencyId || !transactionForm.chargesPayer) return;
  const chargesCur = currencies.find((c) => c.id === transactionForm.chargesCurrencyId);
  const payerAccountId = transactionForm.chargesPayer === 'from' ? transactionForm.accountFromId : transactionForm.accountToId;
  const payerAccount = payerAccountId ? clientAccounts.find((a) => a.id === payerAccountId) : undefined;
  if (chargesCur && payerAccount && chargesCur.code === payerAccount.currencyCode) {
   setTransactionForm((current) => ({ ...current, chargesExchangeRate: '1.00' }));
  }
 }, [transactionForm.chargesCurrencyId, transactionForm.chargesPayer, transactionForm.accountFromId, transactionForm.accountToId, currencies, clientAccounts]);

 function navigateToSection(nextSection: Section) {
  setSection(nextSection);
  window.history.replaceState(null, '', `#${nextSection}`);
 }

 function openOrganizationClientsPage(organization: Organization) {
  setSelectedOrganizationForClients(organization);
  navigateToSection('organization-clients');
 }

 function openClientLedger(client: Client, origin: 'clients' | 'organization-clients' = 'clients') {
  setClientLedgerBackSection(origin);
  setIsClientLedgerEditMode(false);
  setLedgerTransactionDrafts({});
  setSelectedClientForLedger(client);
  const firstAccount = clientAccounts.find((account) => account.clientId === client.id);
  setSelectedLedgerAccountId(firstAccount?.id ?? null);
  navigateToSection('client-ledger');
 }

 function toggleLedgerColumn(column: LedgerColumnKey) {
  setLedgerColumnVisibility((current) => ({
   ...current,
   [column]: !current[column],
  }));
 }

 function onLedgerColumnDragStart(event: DragEvent<HTMLElement>, column: LedgerColumnKey) {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', column);
  setDraggedLedgerColumn(column);
 }

 function onLedgerColumnDrop(targetColumn: LedgerColumnKey) {
  if (!draggedLedgerColumn || draggedLedgerColumn === targetColumn) {
   setDraggedLedgerColumn(null);
   return;
  }

  setLedgerColumnOrder((current) => {
   const nextOrder = [...current];
   const draggedIndex = nextOrder.indexOf(draggedLedgerColumn);
   const targetIndex = nextOrder.indexOf(targetColumn);

   if (draggedIndex === -1 || targetIndex === -1) {
    return current;
   }

   nextOrder.splice(draggedIndex, 1);
   nextOrder.splice(targetIndex, 0, draggedLedgerColumn);
   return nextOrder;
  });

  setDraggedLedgerColumn(null);
 }

 function formatRateValue(value: number): string {
  if (!Number.isFinite(value)) {
   return '1';
  }
  return parseFloat(value.toFixed(6)).toString();
 }

 function buildLedgerTransactionDraft(transaction: Transaction, ledgerAccountId: number): LedgerTransactionDraft {
  const isOutgoing = transaction.accountFromId === ledgerAccountId;
  const rate = isOutgoing ? transaction.exchangeRateFrom : transaction.exchangeRateTo;
  const reversed = isOutgoing ? !!transaction.exchangeRateFromReversed : !!transaction.exchangeRateToReversed;
  return {
   transactionId: transaction.id,
   ledgerAccountId,
   createdDate: transaction.createdAt.slice(0, 10),
   direction: isOutgoing ? 'outgoing' : 'incoming',
   counterpartyAccountId: isOutgoing ? transaction.accountToId : transaction.accountFromId,
   type: transaction.type,
   amount: String(transaction.amount),
   exchangeRate: reversed ? formatRateValue(1 / rate) : String(rate),
   commission: String(isOutgoing ? transaction.commissionFrom : transaction.commissionTo),
   description: transaction.description,
  };
 }

 function buildTransactionTableDraft(transaction: Transaction): TransactionTableDraft {
  const fromReversed = !!transaction.exchangeRateFromReversed;
  const toReversed = !!transaction.exchangeRateToReversed;
  return {
   transactionId: transaction.id,
   accountFromId: transaction.accountFromId,
   accountToId: transaction.accountToId,
   currencyId: transaction.currencyId,
   type: transaction.type,
   amount: String(transaction.amount),
   exchangeRateFrom: fromReversed ? formatRateValue(1 / transaction.exchangeRateFrom) : transaction.exchangeRateFrom.toFixed(2),
   commissionFrom: transaction.commissionFrom.toFixed(2),
   exchangeRateTo: toReversed ? formatRateValue(1 / transaction.exchangeRateTo) : transaction.exchangeRateTo.toFixed(2),
   commissionTo: transaction.commissionTo.toFixed(2),
   charges: String(transaction.charges),
   chargesCurrencyId: transaction.chargesCurrencyId,
   chargesPayer: transaction.chargesPayer,
   chargesExchangeRate: transaction.chargesExchangeRate.toFixed(2),
   chargesDescription: transaction.chargesDescription,
   description: transaction.description,
   createdDate: transaction.createdAt.slice(0, 10),
  };
 }

 function getLedgerTransactionDraftKey(transactionId: number, ledgerAccountId: number) {
  return `${transactionId}:${ledgerAccountId}`;
 }

 function updateLedgerTransactionDraft(transactionId: number, ledgerAccountId: number, nextValues: Partial<LedgerTransactionDraft>) {
  setLedgerTransactionDrafts((current) => {
   const draftKey = getLedgerTransactionDraftKey(transactionId, ledgerAccountId);
   const existingDraft = current[draftKey];
   if (!existingDraft) {
    return current;
   }

   return {
    ...current,
    [draftKey]: {
     ...existingDraft,
     ...nextValues,
    },
   };
  });
 }

 function beginClientLedgerEditMode() {
  const nextDrafts: Record<string, LedgerTransactionDraft> = {};
  const nextReversed: Record<string, boolean> = {};

  selectedClientLedgers.forEach((ledger) => {
   ledger.entries.forEach((entry) => {
    const transaction = transactions.find((currentTransaction) => currentTransaction.id === entry.transactionId);
    const draftKey = getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId);
    if (!transaction || nextDrafts[draftKey]) {
     return;
    }

    nextDrafts[draftKey] = buildLedgerTransactionDraft(transaction, ledger.accountId);
    const isOutgoing = transaction.accountFromId === ledger.accountId;
    const reversed = isOutgoing ? transaction.exchangeRateFromReversed : transaction.exchangeRateToReversed;
    if (reversed) {
     nextReversed[draftKey] = true;
    }
   });
  });

  setLedgerTransactionDrafts(nextDrafts);
  setLedgerRateReversed(nextReversed);
  setLedgerCommissionExpandedEntries(new Set());
  setLedgerStartingBalanceDrafts({});
  setIsClientLedgerEditMode(true);
 }

 function cancelClientLedgerEditMode() {
  setLedgerTransactionDrafts({});
  setLedgerCommissionExpandedEntries(new Set());
  setLedgerStartingBalanceDrafts({});
  setLedgerRateReversed({});
  setIsClientLedgerEditMode(false);
 }

 function beginTransactionsEditMode() {
  const fromReversed: Record<number, boolean> = {};
  const toReversed: Record<number, boolean> = {};
  transactions.forEach((transaction) => {
   if (transaction.exchangeRateFromReversed) {
    fromReversed[transaction.id] = true;
   }
   if (transaction.exchangeRateToReversed) {
    toReversed[transaction.id] = true;
   }
  });

  setTransactionTableDrafts({});
  setSelectedTransactionIds(new Set());
  setCommissionExpandedTxns(new Set());
  setExpensesExpandedTxns(new Set());
  setTableRateFromReversed(fromReversed);
  setTableRateToReversed(toReversed);
  setIsTransactionsEditMode(true);
 }

 function cancelTransactionsEditMode() {
  setTransactionTableDrafts({});
  setSelectedTransactionIds(new Set());
  setCommissionExpandedTxns(new Set());
  setExpensesExpandedTxns(new Set());
  setTableRateFromReversed({});
  setTableRateToReversed({});
  setIsTransactionsEditMode(false);
 }

 function updateTransactionTableDraft(transactionId: number, nextValues: Partial<TransactionTableDraft>) {
  setTransactionTableDrafts((current) => {
   const existingDraft =
    current[transactionId] ??
    (() => {
     const transaction = transactionMap.get(transactionId);
     return transaction ? buildTransactionTableDraft(transaction) : null;
    })();

   if (!existingDraft) {
    return current;
   }

   return {
    ...current,
    [transactionId]: {
     ...existingDraft,
     ...nextValues,
    },
   };
  });
 }

 function getTransactionTableDraft(transactionId: number) {
  const existingDraft = transactionTableDrafts[transactionId];
  if (existingDraft) {
   return existingDraft;
  }

  const transaction = transactionMap.get(transactionId);
  return transaction ? buildTransactionTableDraft(transaction) : null;
 }

 function onCancelTransactionTableRow(transactionId: number) {
  const transaction = transactions.find((currentTransaction) => currentTransaction.id === transactionId);
  if (!transaction) {
   return;
  }

  setTransactionTableDrafts((current) => ({
   ...current,
   [transactionId]: buildTransactionTableDraft(transaction),
  }));
 }

 function getClientLedgerDraft(transactionId: number, ledgerAccountId: number) {
  const draftKey = getLedgerTransactionDraftKey(transactionId, ledgerAccountId);
  const existingDraft = ledgerTransactionDrafts[draftKey];
  if (existingDraft) {
   return existingDraft;
  }

  const transaction = transactions.find((currentTransaction) => currentTransaction.id === transactionId);
  return transaction ? buildLedgerTransactionDraft(transaction, ledgerAccountId) : null;
 }

 async function onSaveLedgerTransaction(transactionId: number, ledgerAccountId: number) {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  const draft = ledgerTransactionDrafts[getLedgerTransactionDraftKey(transactionId, ledgerAccountId)];
  const transaction = transactions.find((currentTransaction) => currentTransaction.id === transactionId);

  if (!draft || !transaction) {
   return;
  }

  const amount = parseFloat(draft.amount);
  const rawLedgerRate = parseFloat(draft.exchangeRate) || 1;
  const exchangeRate = ledgerRateReversed[getLedgerTransactionDraftKey(transactionId, ledgerAccountId)] ? 1 / rawLedgerRate : rawLedgerRate;
  const commission = parseFloat(draft.commission) || 0;

  if (!draft.counterpartyAccountId || !amount) {
   setError(t('transaction_required'));
   return;
  }

  const currentTime = transaction.createdAt.includes(' ') ? transaction.createdAt.split(' ')[1] : '00:00:00';
  const createdAt = `${draft.createdDate} ${currentTime}`;
  const payload: TransactionUpdateInput = {
   id: transaction.id,
   accountFromId: draft.direction === 'outgoing' ? draft.ledgerAccountId : draft.counterpartyAccountId,
   accountToId: draft.direction === 'outgoing' ? draft.counterpartyAccountId : draft.ledgerAccountId,
   currencyId: transaction.currencyId,
   amount,
   type: draft.type,
   exchangeRateFrom: draft.direction === 'outgoing' ? exchangeRate : transaction.exchangeRateFrom,
   commissionFrom: draft.direction === 'outgoing' ? commission : transaction.commissionFrom,
   exchangeRateTo: draft.direction === 'incoming' ? exchangeRate : transaction.exchangeRateTo,
   commissionTo: draft.direction === 'incoming' ? commission : transaction.commissionTo,
   exchangeRateFromReversed:
    draft.direction === 'outgoing' ? (ledgerRateReversed[getLedgerTransactionDraftKey(transactionId, ledgerAccountId)] ? 1 : 0) : (transaction.exchangeRateFromReversed ?? 0),
   exchangeRateToReversed:
    draft.direction === 'incoming' ? (ledgerRateReversed[getLedgerTransactionDraftKey(transactionId, ledgerAccountId)] ? 1 : 0) : (transaction.exchangeRateToReversed ?? 0),
   charges: transaction.charges,
   chargesCurrencyId: transaction.chargesCurrencyId,
   chargesPayer: transaction.chargesPayer,
   chargesExchangeRate: transaction.chargesExchangeRate,
   chargesDescription: transaction.chargesDescription,
   description: draft.description,
   createdAt,
  };

  try {
   await accountingApi.updateTransaction(payload);
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 function onCancelLedgerTransaction(transactionId: number, ledgerAccountId: number) {
  const transaction = transactions.find((currentTransaction) => currentTransaction.id === transactionId);
  if (!transaction) {
   return;
  }

  const draftKey = getLedgerTransactionDraftKey(transactionId, ledgerAccountId);
  setLedgerTransactionDrafts((current) => ({
   ...current,
   [draftKey]: buildLedgerTransactionDraft(transaction, ledgerAccountId),
  }));
 }

 async function onSaveAllLedgerTransactions() {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  try {
   for (const [accountId, value] of Object.entries(ledgerStartingBalanceDrafts)) {
    await accountingApi.updateClientAccountStartingBalance({ accountId: Number(accountId), startingBalance: parseFloat(value) || 0 });
   }

   for (const draftKey of Object.keys(ledgerTransactionDrafts)) {
    const draft = ledgerTransactionDrafts[draftKey];
    const transaction = transactions.find((currentTransaction) => currentTransaction.id === draft.transactionId);
    if (!draft || !transaction) continue;

    const amount = parseFloat(draft.amount);
    const rawBulkRate = parseFloat(draft.exchangeRate) || 1;
    const exchangeRate = ledgerRateReversed[draftKey] ? 1 / rawBulkRate : rawBulkRate;
    const commission = parseFloat(draft.commission) || 0;

    if (!draft.counterpartyAccountId || !amount) {
     setError(t('transaction_required'));
     return;
    }

    const currentTime = transaction.createdAt.includes(' ') ? transaction.createdAt.split(' ')[1] : '00:00:00';
    const createdAt = `${draft.createdDate} ${currentTime}`;
    const payload: TransactionUpdateInput = {
     id: transaction.id,
     accountFromId: draft.direction === 'outgoing' ? draft.ledgerAccountId : draft.counterpartyAccountId,
     accountToId: draft.direction === 'outgoing' ? draft.counterpartyAccountId : draft.ledgerAccountId,
     currencyId: transaction.currencyId,
     amount,
     type: draft.type,
     exchangeRateFrom: draft.direction === 'outgoing' ? exchangeRate : transaction.exchangeRateFrom,
     commissionFrom: draft.direction === 'outgoing' ? commission : transaction.commissionFrom,
     exchangeRateTo: draft.direction === 'incoming' ? exchangeRate : transaction.exchangeRateTo,
     commissionTo: draft.direction === 'incoming' ? commission : transaction.commissionTo,
     exchangeRateFromReversed: draft.direction === 'outgoing' ? (ledgerRateReversed[draftKey] ? 1 : 0) : (transaction.exchangeRateFromReversed ?? 0),
     exchangeRateToReversed: draft.direction === 'incoming' ? (ledgerRateReversed[draftKey] ? 1 : 0) : (transaction.exchangeRateToReversed ?? 0),
     charges: transaction.charges,
     chargesCurrencyId: transaction.chargesCurrencyId,
     chargesPayer: transaction.chargesPayer,
     chargesExchangeRate: transaction.chargesExchangeRate,
     chargesDescription: transaction.chargesDescription,
     description: draft.description,
     createdAt,
    };

    await accountingApi.updateTransaction(payload);
   }

   setError('');
   cancelClientLedgerEditMode();
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 async function onOrganizationSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!organizationForm.name.trim()) {
   setError(t('organization_required'));
   return;
  }

  try {
   if (organizationForm.id) {
    await accountingApi.updateOrganization(organizationForm);
   } else {
    await accountingApi.createOrganization(organizationForm);
   }

   setOrganizationForm(emptyOrganizationForm());
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 async function onClientSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!clientForm.name.trim()) {
   setError(t('client_required'));
   return;
  }

  if (!clientForm.id && openAccountOnCreate) {
   if (!newClientAccountDrafts.length || newClientAccountDrafts.some((draft) => !draft.currencyId)) {
    setError(t('client_account_currency_placeholder'));
    return;
   }

   const selectedCurrencyIds = newClientAccountDrafts.map((draft) => draft.currencyId).filter((currencyId): currencyId is number => Boolean(currencyId));
   if (new Set(selectedCurrencyIds).size !== selectedCurrencyIds.length) {
    setError('Choose a different currency for each account.');
    return;
   }
  }

  try {
   if (clientForm.id) {
    await accountingApi.updateClient(clientForm);
   } else {
    const created = await accountingApi.createClient(clientForm);
    if (openAccountOnCreate) {
     for (const draft of newClientAccountDrafts) {
      if (!draft.currencyId) {
       continue;
      }

      await accountingApi.createClientAccount({
       clientId: created.clientId,
       currencyId: draft.currencyId,
       startingBalance: parseFloat(draft.startingBalance) || 0,
      });
     }
    }
   }

   setClientForm(emptyClientForm());
   setOpenAccountOnCreate(false);
   setNewClientAccountDrafts([createNewClientAccountDraft()]);
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 async function onDeleteOrganization(id: number) {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!window.confirm(t('organization_delete_confirm'))) {
   return;
  }

  try {
   await accountingApi.deleteOrganization(id);
   if (organizationForm.id === id) {
    setOrganizationForm(emptyOrganizationForm());
   }
   if (selectedOrganizationForClients?.id === id) {
    setSelectedOrganizationForClients(null);
    navigateToSection('organizations');
   }
   if (clientForm.organizationId === id) {
    setClientForm((current) => ({ ...current, organizationId: null }));
   }
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
 }

 async function onDeleteClient(id: number) {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!window.confirm(t('client_delete_confirm'))) {
   return;
  }

  try {
   await accountingApi.deleteClient(id);
   if (clientForm.id === id) {
    setClientForm(emptyClientForm());
   }
   if (selectedClientForAccounts?.id === id) {
    setSelectedClientForAccounts(null);
   }
   if (selectedClientForLedger?.id === id) {
    setSelectedClientForLedger(null);
    navigateToSection('clients');
   }
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
 }

 async function onDeleteAllTransactions() {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!transactions.length) {
   setError(t('no_transactions'));
   return;
  }

  const firstConfirm = window.confirm(`${t('danger_action_cannot_undo')}\n\n${t('danger_delete_all_transactions_confirm')}`);
  if (!firstConfirm) {
   return;
  }

  try {
   await accountingApi.deleteAllTransactions();
   setSelectedTransactionIds(new Set());
   setTransactionTableDrafts({});
   setCommissionExpandedTxns(new Set());
   setExpensesExpandedTxns(new Set());
   setTransactionsPage(1);
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
 }

 async function onDeleteAllClients() {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!clients.length) {
   setError(t('no_clients'));
   return;
  }

  const firstConfirm = window.confirm(`${t('danger_action_cannot_undo')}\n\n${t('danger_delete_all_clients_confirm')}`);
  if (!firstConfirm) {
   return;
  }

  try {
   await accountingApi.deleteAllClients();
   setClientForm(emptyClientForm());
   setSelectedClientForAccounts(null);
   setSelectedClientForLedger(null);
   setSelectedLedgerAccountId(null);
   setSelectedTransactionIds(new Set());
   setTransactionTableDrafts({});
   setCommissionExpandedTxns(new Set());
   setExpensesExpandedTxns(new Set());
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
 }

 async function onSetMainCurrency(id: number) {
  if (!accountingApi) return;
  try {
   await accountingApi.setMainCurrency(id);
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 async function onEnableCurrency(id: number) {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  try {
   await accountingApi.enableCurrency(id);
   setSelectedCatalogCurrencyId(null);
   setCatalogCurrencyQuery('');
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 async function onDisableCurrency(id: number) {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  const isUsedInClientAccounts = clientAccounts.some((account) => account.currencyId === id);
  const isUsedInTransactions = transactions.some((transaction) => {
   if (transaction.currencyId === id) {
    return true;
   }

   const fromAccount = clientAccounts.find((account) => account.id === transaction.accountFromId);
   const toAccount = clientAccounts.find((account) => account.id === transaction.accountToId);

   return fromAccount?.currencyId === id || toAccount?.currencyId === id;
  });

  const confirmMessage = isUsedInClientAccounts || isUsedInTransactions ? t('currency_disable_confirm_used') : t('currency_disable_confirm');

  if (!window.confirm(confirmMessage)) {
   return;
  }

  try {
   await accountingApi.disableCurrency(id);
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 async function onTransactionSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  const amount = parseFloat(transactionForm.amount);

  if (!transactionForm.accountFromId || !transactionForm.accountToId || !transactionForm.currencyId || !amount) {
   setError(t('transaction_required'));
   return;
  }

  try {
   await accountingApi.createTransaction({
    accountFromId: transactionForm.accountFromId,
    accountToId: transactionForm.accountToId,
    currencyId: transactionForm.currencyId,
    amount,
    type: transactionForm.type,
    exchangeRateFrom: txFromRateReversed ? 1 / (parseFloat(transactionForm.exchangeRateFrom) || 1) : parseFloat(transactionForm.exchangeRateFrom) || 1,
    commissionFrom: parseFloat(transactionForm.commissionFrom) || 0,
    exchangeRateTo: txToRateReversed ? 1 / (parseFloat(transactionForm.exchangeRateTo) || 1) : parseFloat(transactionForm.exchangeRateTo) || 1,
    commissionTo: parseFloat(transactionForm.commissionTo) || 0,
    exchangeRateFromReversed: txFromRateReversed ? 1 : 0,
    exchangeRateToReversed: txToRateReversed ? 1 : 0,
    charges: parseFloat(transactionForm.charges) || 0,
    chargesCurrencyId: transactionForm.chargesCurrencyId || null,
    chargesPayer: transactionForm.chargesPayer,
    chargesExchangeRate: parseFloat(transactionForm.chargesExchangeRate) || 1,
    chargesDescription: transactionForm.chargesDescription,
    description: transactionForm.description,
   });

   setTransactionForm(emptyTransactionForm());
   setTxFromQuery('');
   setTxFromOpen(false);
   setTxToQuery('');
   setTxToOpen(false);
   setTxFromRateReversed(false);
   setTxToRateReversed(false);
   setIsNewTransactionSectionOpen(false);
   setIsNewTransactionExpensesOpen(false);
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  }
 }

 async function onImportTransactionsFile(event: ChangeEvent<HTMLInputElement>) {
  const file = event.target.files?.[0];
  if (!file) {
   return;
  }

  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  setError('');
  setImportSummary('');

  try {
   const xlsxModule = await import('xlsx');
   const fileBuffer = await file.arrayBuffer();
   const workbook = xlsxModule.read(fileBuffer, { type: 'array', cellDates: true });
   const firstSheetName = workbook.SheetNames[0];

   if (!firstSheetName) {
    throw new Error('The selected file has no sheets.');
   }

   const sheet = workbook.Sheets[firstSheetName];
   const rawRows = xlsxModule.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: '',
   }) as unknown[][];

   const rows = rawRows;
   const columnOptions = buildImportColumnOptions(rows);
   if (!columnOptions.length) {
    throw new Error('The selected sheet has no columns.');
   }

   const headerAliases = {
    from: ['Ø¹Ù„ÙŠÙ‡', 'from', 'accountfrom', 'sender', 'debtor'],
    to: ['Ù„Ù‡', 'to', 'accountto', 'receiver', 'creditor'],
    amount: ['Ø§Ù„Ù‚ÙŠÙ…Ø©', 'Ø§Ù„Ù…Ø¨Ù„Øº', 'amount', 'value'],
    date: ['Ø§Ù„ØªØ§Ø±ÙŠØ®', 'date', 'createdat'],
    description: ['Ø§Ù„ÙˆØµÙ', 'Ø§Ù„Ø¨ÙŠØ§Ù†', 'Ù…Ù„Ø§Ø­Ø¸Ø©', 'description', 'note', 'details'],
   };

   const detectColumnByAliases = (aliases: string[]) => {
    const normalizedAliasSet = new Set(aliases.map((alias) => normalizeImportHeader(alias)));
    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 10); rowIndex += 1) {
     const row = rows[rowIndex];
     for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
      const cell = normalizeImportHeader(toImportString(row[cellIndex]));
      if (normalizedAliasSet.has(cell)) {
       return cellIndex;
      }
     }
    }
    return null;
   };

   const preferredCurrency = enabledCurrencies[0] ?? currencies[0] ?? null;

   setPendingImportData({
    fileName: file.name,
    rows,
    columnOptions,
   });

   setImportMapping({
    dateColumn: detectColumnByAliases(headerAliases.date),
    fromColumn: detectColumnByAliases(headerAliases.from),
    toColumn: detectColumnByAliases(headerAliases.to),
    amountColumn: detectColumnByAliases(headerAliases.amount),
    descriptionColumn: detectColumnByAliases(headerAliases.description),
    currencyId: preferredCurrency?.id ?? null,
   });
  } catch (e) {
   setError(e instanceof Error ? e.message : 'Failed to read import file.');
  } finally {
   if (transactionsImportInputRef.current) {
    transactionsImportInputRef.current.value = '';
   }
  }
 }

 async function onConfirmImportTransactions() {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!pendingImportData) {
   setError('No file is selected for import.');
   return;
  }

  if (importMapping.fromColumn == null || importMapping.toColumn == null || importMapping.amountColumn == null) {
   setError('Please answer the column mapping questions before importing.');
   return;
  }

  if (!importMapping.currencyId) {
   setError('Please choose a currency for this import.');
   return;
  }

  const selectedCurrency = currencies.find((currency) => currency.id === importMapping.currencyId) ?? null;
  if (!selectedCurrency) {
   setError('Selected currency was not found. Please reselect it.');
   return;
  }

  setIsImportingTransactions(true);
  setError('');
  setImportSummary('');

  try {
   const importedRows = parseTransactionRowsFromMappedSheet(pendingImportData.rows, importMapping, selectedCurrency);

   const normalizeLookup = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
   let nextClients = [...clients];
   let nextCurrencies = [...currencies];
   let nextClientAccounts = [...clientAccounts];

   const stats = {
    createdClients: 0,
    enabledCurrencies: 0,
    createdAccounts: 0,
    createdTransactions: 0,
   };

   const getClientByName = (name: string) => {
    const needle = normalizeLookup(name);
    return nextClients.find((client) => normalizeLookup(client.name) === needle) ?? null;
   };

   const getClientAccount = (clientId: number, currencyId: number) => {
    return nextClientAccounts.find((account) => account.clientId === clientId && account.currencyId === currencyId) ?? null;
   };

   let importCurrency = nextCurrencies.find((currency) => currency.id === selectedCurrency.id) ?? selectedCurrency;

   if (importCurrency.isEnabled !== 1) {
    await accountingApi.enableCurrency(importCurrency.id);
    nextCurrencies = nextCurrencies.map((currency) => (currency.id === importCurrency.id ? { ...currency, isEnabled: 1 } : currency));
    importCurrency = { ...importCurrency, isEnabled: 1 };
    stats.enabledCurrencies += 1;
   }

   for (const row of importedRows) {
    let fromClient = getClientByName(row.fromName);
    if (!fromClient) {
     await accountingApi.createClient({
      organizationId: organizations[0]?.id ?? null,
      name: row.fromName,
      email: '',
      phone: '',
      address: '',
     });
     nextClients = (await accountingApi.listClients()) as Client[];
     fromClient = getClientByName(row.fromName);
     stats.createdClients += 1;
    }

    let toClient = getClientByName(row.toName);
    if (!toClient) {
     await accountingApi.createClient({
      organizationId: organizations[0]?.id ?? null,
      name: row.toName,
      email: '',
      phone: '',
      address: '',
     });
     nextClients = (await accountingApi.listClients()) as Client[];
     toClient = getClientByName(row.toName);
     stats.createdClients += 1;
    }

    if (!fromClient || !toClient) {
     continue;
    }

    let fromAccount = getClientAccount(fromClient.id, importCurrency.id);
    if (!fromAccount) {
     await accountingApi.createClientAccount({ clientId: fromClient.id, currencyId: importCurrency.id, startingBalance: 0 });
     nextClientAccounts = (await accountingApi.listAllClientAccounts()) as ClientAccount[];
     fromAccount = getClientAccount(fromClient.id, importCurrency.id);
     stats.createdAccounts += 1;
    }

    let toAccount = getClientAccount(toClient.id, importCurrency.id);
    if (!toAccount) {
     await accountingApi.createClientAccount({ clientId: toClient.id, currencyId: importCurrency.id, startingBalance: 0 });
     nextClientAccounts = (await accountingApi.listAllClientAccounts()) as ClientAccount[];
     toAccount = getClientAccount(toClient.id, importCurrency.id);
     stats.createdAccounts += 1;
    }

    if (!fromAccount || !toAccount) {
     continue;
    }

    await accountingApi.createTransaction({
     accountFromId: fromAccount.id,
     accountToId: toAccount.id,
     currencyId: importCurrency.id,
     amount: row.amount,
     type: 'transfer',
     exchangeRateFrom: 1,
     commissionFrom: 0,
     exchangeRateTo: 1,
     commissionTo: 0,
     charges: 0,
     chargesCurrencyId: null,
     chargesPayer: '',
     chargesExchangeRate: 1,
     chargesDescription: '',
     description: row.description,
     createdAt: row.createdAt ?? undefined,
    });

    stats.createdTransactions += 1;
   }

   if (!stats.createdTransactions) {
    throw new Error('No transactions were imported. Check the mapping questions and selected currency.');
   }

   await loadData();
   setImportSummary(
    `Imported ${stats.createdTransactions} transactions from ${pendingImportData.fileName}. Created ${stats.createdClients} clients and ${stats.createdAccounts} accounts.`,
   );
   setPendingImportData(null);
   setImportMapping({
    dateColumn: null,
    fromColumn: null,
    toColumn: null,
    amountColumn: null,
    descriptionColumn: null,
    currencyId: null,
   });
  } catch (e) {
   setError(e instanceof Error ? e.message : 'Failed to import transactions.');
  } finally {
   setIsImportingTransactions(false);
  }
 }

 function onCancelImportTransactions() {
  setPendingImportData(null);
  setImportMapping({
   dateColumn: null,
   fromColumn: null,
   toColumn: null,
   amountColumn: null,
   descriptionColumn: null,
   currencyId: null,
  });
 }

 async function onSaveAllTransactionDrafts() {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  try {
   for (const transactionId of Object.keys(transactionTableDrafts).map(Number)) {
    const draft = transactionTableDrafts[transactionId];
    const transaction = transactions.find((currentTransaction) => currentTransaction.id === transactionId);
    if (!draft || !transaction) continue;
    const amount = parseFloat(draft.amount);
    if (!draft.accountFromId || !draft.accountToId || !draft.currencyId || !amount) {
     setError(t('transaction_required'));
     return;
    }
    const currentTime = transaction.createdAt.includes(' ') ? transaction.createdAt.split(' ')[1] : '00:00:00';
    await accountingApi.updateTransaction({
     id: transaction.id,
     accountFromId: draft.accountFromId,
     accountToId: draft.accountToId,
     currencyId: draft.currencyId,
     amount,
     type: draft.type,
     exchangeRateFrom: tableRateFromReversed[transactionId] ? 1 / (parseFloat(draft.exchangeRateFrom) || 1) : parseFloat(draft.exchangeRateFrom) || 1,
     commissionFrom: parseFloat(draft.commissionFrom) || 0,
     exchangeRateTo: tableRateToReversed[transactionId] ? 1 / (parseFloat(draft.exchangeRateTo) || 1) : parseFloat(draft.exchangeRateTo) || 1,
     commissionTo: parseFloat(draft.commissionTo) || 0,
     exchangeRateFromReversed: tableRateFromReversed[transactionId] ? 1 : 0,
     exchangeRateToReversed: tableRateToReversed[transactionId] ? 1 : 0,
     charges: parseFloat(draft.charges) || 0,
     chargesCurrencyId: draft.chargesCurrencyId || null,
     chargesPayer: draft.chargesPayer,
     chargesExchangeRate: parseFloat(draft.chargesExchangeRate) || 1,
     chargesDescription: draft.chargesDescription,
     description: draft.description,
     createdAt: `${draft.createdDate} ${currentTime}`,
    });
   }
   setError('');
   cancelTransactionsEditMode();
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 async function onDeleteTransaction(id: number) {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!window.confirm(t('transaction_delete_confirm'))) {
   return;
  }

  try {
   await accountingApi.deleteTransaction(id);
   setSelectedTransactionIds((current) => {
    const next = new Set(current);
    next.delete(id);
    return next;
   });
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
 }

 function onToggleTransactionSelection(transactionId: number) {
  if (!isTransactionsEditMode) {
   return;
  }

  setSelectedTransactionIds((current) => {
   const next = new Set(current);
   if (next.has(transactionId)) {
    next.delete(transactionId);
   } else {
    next.add(transactionId);
   }
   return next;
  });
 }

 function onToggleSelectAllTransactions() {
  if (!isTransactionsEditMode) {
   return;
  }

  setSelectedTransactionIds((current) => {
   const visibleIds = paginatedTransactions.map((transaction) => transaction.id);
   const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id));

   if (allVisibleSelected) {
    const next = new Set(current);
    visibleIds.forEach((id) => next.delete(id));
    return next;
   }

   const next = new Set(current);
   visibleIds.forEach((id) => next.add(id));
   return next;
  });
 }

 async function onDeleteSelectedTransactions() {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  const idsToDelete = [...selectedTransactionIds];
  if (!idsToDelete.length) {
   setError('No transactions selected.');
   return;
  }

  const confirmed = window.confirm(`Delete ${idsToDelete.length} selected transactions?`);
  if (!confirmed) {
   return;
  }

  try {
   for (const transactionId of idsToDelete) {
    await accountingApi.deleteTransaction(transactionId);
   }
   setSelectedTransactionIds(new Set());
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
 }

 async function onSaveTransactionTableRow(transactionId: number) {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  const draft = transactionTableDrafts[transactionId];
  const transaction = transactions.find((currentTransaction) => currentTransaction.id === transactionId);

  if (!draft || !transaction) {
   return;
  }

  const amount = parseFloat(draft.amount);

  if (!draft.accountFromId || !draft.accountToId || !draft.currencyId || !amount) {
   setError(t('transaction_required'));
   return;
  }

  const currentTime = transaction.createdAt.includes(' ') ? transaction.createdAt.split(' ')[1] : '00:00:00';

  try {
   await accountingApi.updateTransaction({
    id: transaction.id,
    accountFromId: draft.accountFromId,
    accountToId: draft.accountToId,
    currencyId: draft.currencyId,
    amount,
    type: draft.type,
    exchangeRateFrom: tableRateFromReversed[transactionId] ? 1 / (parseFloat(draft.exchangeRateFrom) || 1) : parseFloat(draft.exchangeRateFrom) || 1,
    commissionFrom: parseFloat(draft.commissionFrom) || 0,
    exchangeRateTo: tableRateToReversed[transactionId] ? 1 / (parseFloat(draft.exchangeRateTo) || 1) : parseFloat(draft.exchangeRateTo) || 1,
    commissionTo: parseFloat(draft.commissionTo) || 0,
    exchangeRateFromReversed: tableRateFromReversed[transactionId] ? 1 : 0,
    exchangeRateToReversed: tableRateToReversed[transactionId] ? 1 : 0,
    charges: parseFloat(draft.charges) || 0,
    chargesCurrencyId: draft.chargesCurrencyId || null,
    chargesPayer: draft.chargesPayer,
    chargesExchangeRate: parseFloat(draft.chargesExchangeRate) || 1,
    chargesDescription: draft.chargesDescription,
    description: draft.description,
    createdAt: `${draft.createdDate} ${currentTime}`,
   });
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 async function onAddClientAccount(clientId: number) {
  if (!accountingApi || !newAccountCurrencyId) return;
  try {
   await accountingApi.createClientAccount({ clientId, currencyId: newAccountCurrencyId, startingBalance: parseFloat(newAccountStartingBalance) || 0 });
   setNewAccountCurrencyId(null);
   setNewAccountStartingBalance('0');
   await loadData();
   // Re-sync selectedClientForAccounts with updated client data
   setSelectedClientForAccounts((prev) => (prev ? { ...prev } : null));
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  }
 }

 async function onDeleteClientAccount(accountId: number) {
  if (!accountingApi) return;
  if (!window.confirm(t('client_account_delete_confirm'))) return;
  try {
   await accountingApi.deleteClientAccount(accountId);
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
 }

 async function onUpdateAccountStartingBalance(accountId: number, value: string) {
  if (!accountingApi) return;
  try {
   await accountingApi.updateClientAccountStartingBalance({ accountId, startingBalance: parseFloat(value) || 0 });
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  }
 }

 function generateLedgerHtml(ledger: ClientAccountLedger, fromDate: string, toDate: string): string {
  const filteredEntries = ledger.entries.filter((e) => {
   const d = e.createdAt.slice(0, 10);
   return d >= fromDate && d <= toDate;
  });

  const preBalance = ledger.startingBalance + ledger.entries.filter((e) => e.createdAt.slice(0, 10) < fromDate).reduce((sum, e) => sum + e.netChange, 0);

  // Build column definitions respecting user visibility; running_balance is always included
  type ColDef = { key: LedgerColumnKey; header: string; isNum?: boolean; cell: (e: ClientLedgerEntry, runBal: number) => string };
  const allCols: ColDef[] = [
   { key: 'created', header: t('date'), cell: (e) => e.createdAt.slice(0, 10) },
   { key: 'counterparty', header: t('counterparty'), cell: (e) => e.counterpartyName },
   { key: 'direction', header: t('direction'), cell: (e) => t(e.direction === 'outgoing' ? 'outgoing' : 'incoming') },
   { key: 'type', header: t('transaction_type'), cell: (e) => t(e.type === 'transfer' ? 'transaction_type_transfer' : 'transaction_type_exchange') },
   { key: 'amount', header: t('amount'), isNum: true, cell: (e) => e.amount.toLocaleString(language, { maximumFractionDigits: 2 }) },
   { key: 'exchangeRate', header: t('exchange_rate'), isNum: true, cell: (e) => e.exchangeRate.toFixed(2) },
   { key: 'commission', header: t('commission'), isNum: true, cell: (e) => e.commission.toFixed(2) },
   {
    key: 'netChange',
    header: t('net_change'),
    isNum: true,
    cell: (e) => `<span class="${e.netChange >= 0 ? 'pos' : 'neg'}">${e.netChange.toLocaleString(language, { maximumFractionDigits: 2 })}</span>`,
   },
   {
    key: 'runningBalance',
    header: t('running_balance'),
    isNum: true,
    cell: (_e, runBal) => `<span class="${runBal >= 0 ? 'pos' : 'neg'}">${runBal.toLocaleString(language, { maximumFractionDigits: 2 })}</span>`,
   },
   { key: 'description', header: t('transaction_description'), cell: (e) => e.description ?? '' },
  ];
  const visibleCols = ledgerColumnOrder
   .map((key) => allCols.find((col) => col.key === key))
   .filter((col): col is ColDef => Boolean(col))
   .filter((col) => col.key === 'runningBalance' || ledgerColumnVisibility[col.key]);
  // Ensure runningBalance is always present (append if somehow missing from order)
  if (!visibleCols.some((col) => col.key === 'runningBalance')) {
   const rbCol = allCols.find((col) => col.key === 'runningBalance');
   if (rbCol) visibleCols.push(rbCol);
  }
  const colCount = visibleCols.length;

  let runningBal = preBalance;
  const rows = filteredEntries
   .map((e) => {
    runningBal += e.netChange;
    const cells = visibleCols.map((col) => `<td${col.isNum ? ' class="num"' : ''}>${col.cell(e, runningBal)}</td>`).join('');
    return `<tr>${cells}</tr>`;
   })
   .join('');

  const headerCells = visibleCols.map((col) => `<th${col.isNum ? ' class="num"' : ''}>${col.header}</th>`).join('');

  const dir = isRTL ? 'rtl' : 'ltr';
  const clientName = selectedClientForLedger?.name ?? '';
  const exportDate = new Date().toLocaleDateString(language);

  return `<!DOCTYPE html>
<html lang="${language}" dir="${dir}">
<head>
<meta charset="UTF-8">
<style>
 * { box-sizing: border-box; margin: 0; padding: 0; }
 body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #1e293b; padding: 32px; }
 .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e293b; padding-bottom: 12px; margin-bottom: 20px; }
 .header-left h1 { font-size: 20px; font-weight: bold; }
 .header-left p { font-size: 11px; color: #64748b; margin-top: 2px; }
 .header-right { text-align: ${isRTL ? 'left' : 'right'}; font-size: 11px; color: #64748b; }
 .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
 .meta-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; background: #f8fafc; }
 .meta-card .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
 .meta-card .value { font-size: 14px; font-weight: bold; margin-top: 4px; }
 .pos { color: #059669; }
 .neg { color: #dc2626; }
 table { width: 100%; border-collapse: collapse; margin-top: 8px; }
 thead tr { background: #f1f5f9; }
 th { padding: 8px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #475569; text-align: ${isRTL ? 'right' : 'left'}; border-bottom: 1px solid #cbd5e1; }
 td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }
 td.num { text-align: ${isRTL ? 'left' : 'right'}; font-variant-numeric: tabular-nums; }
 th.num { text-align: ${isRTL ? 'left' : 'right'}; }
 tr.pre-row td { background: #eff6ff; font-weight: 600; }
 tr:last-child td { border-bottom: none; }
 .footer { margin-top: 24px; font-size: 10px; color: #94a3b8; text-align: center; }
</style>
</head>
<body>
<div class="header">
 <div class="header-left">
  <h1>Arkam Exchange</h1>
  <p>${t('client_ledger_statement')}</p>
 </div>
 <div class="header-right">
  <div>${t('export_generated_on')}: ${exportDate}</div>
 </div>
</div>
<div class="meta">
 <div class="meta-card">
  <div class="label">${t('client')}</div>
  <div class="value">${clientName}</div>
 </div>
 <div class="meta-card">
  <div class="label">${t('currency')}</div>
  <div class="value">${ledger.currencyName} (${ledger.currencyCode})</div>
 </div>
 <div class="meta-card">
  <div class="label">${t('export_period')}</div>
  <div class="value" style="font-size:12px">${fromDate} â†’ ${toDate}</div>
 </div>
</div>
<table>
 <thead>
  <tr>${headerCells}</tr>
 </thead>
 <tbody>
  <tr class="pre-row">
   <td colspan="${colCount - 1}">${t('export_pre_balance')}</td>
   <td class="num ${preBalance >= 0 ? 'pos' : 'neg'}">${preBalance.toLocaleString(language, { maximumFractionDigits: 2 })}</td>
  </tr>
  ${rows}
 </tbody>
</table>
<div class="footer">Arkam Exchange &mdash; ${t('export_generated_on')} ${exportDate}</div>
</body>
</html>`;
 }

 async function onExportLedgerPdf(ledger: ClientAccountLedger, fromDate: string, toDate: string) {
  if (!accountingApi) return;
  try {
   const html = generateLedgerHtml(ledger, fromDate, toDate);
   const clientName = (selectedClientForLedger?.name ?? 'client').replace(/[^a-z0-9]/gi, '_');
   const defaultFileName = `${clientName}_${ledger.currencyCode}_${fromDate}_${toDate}.pdf`;
   const result = await accountingApi.exportLedgerPdf({ html, defaultFileName });
   if (result.ok) setPdfExportModal(null);
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  }
 }

 const navItems: Array<{ key: Section; label: string; icon: IconName }> = [
  { key: 'overview', label: t('nav_overview'), icon: 'home' },
  { key: 'organizations', label: t('nav_organizations'), icon: 'organizations' },
  { key: 'clients', label: t('nav_clients'), icon: 'clients' },
  { key: 'currencies', label: t('nav_currencies'), icon: 'currencies' },
  { key: 'transactions', label: t('nav_transactions'), icon: 'transactions' },
 ];

 const settingsTabs: Array<{ key: SettingsTab; label: string; icon: IconName }> = [
  { key: 'database', label: t('settings_database_title'), icon: 'database' },
  { key: 'language', label: t('settings_language_title'), icon: 'settings' },
  { key: 'clients', label: t('nav_clients'), icon: 'clients' },
  { key: 'organizations', label: t('nav_organizations'), icon: 'organizations' },
  { key: 'currencies', label: t('nav_currencies'), icon: 'currencies' },
  { key: 'danger', label: t('settings_danger_title'), icon: 'settings' },
 ];

 const getLocalizedCurrencyName = (currencyCode: string, fallbackName: string) => {
  try {
   if (typeof Intl.DisplayNames === 'function') {
    return new Intl.DisplayNames([language], { type: 'currency' }).of(currencyCode) || fallbackName || currencyCode;
   }
  } catch {
   // ignore and fall back to the stored name
  }

  return fallbackName || currencyCode;
 };

 const localizedCurrencies = useMemo(
  () =>
   currencies.map((currency) => ({
    ...currency,
    name: getLocalizedCurrencyName(currency.code, currency.name),
   })),
  [currencies, language],
 );
 const enabledCurrencies = useMemo(() => localizedCurrencies.filter((currency) => currency.isEnabled === 1), [localizedCurrencies]);
 const availableCurrencies = useMemo(() => localizedCurrencies.filter((currency) => currency.isEnabled !== 1), [localizedCurrencies]);
 const normalizedCatalogCurrencyQuery = catalogCurrencyQuery.trim().toLocaleLowerCase();
 const filteredAvailableCurrencies = useMemo(
  () =>
   availableCurrencies.filter((currency) => {
    if (!normalizedCatalogCurrencyQuery) {
     return true;
    }

    return currency.code.toLocaleLowerCase().includes(normalizedCatalogCurrencyQuery) || currency.name.toLocaleLowerCase().includes(normalizedCatalogCurrencyQuery);
   }),
  [availableCurrencies, normalizedCatalogCurrencyQuery],
 );
 const currencyMap = useMemo(() => new Map(localizedCurrencies.map((currency) => [currency.id, currency])), [localizedCurrencies]);
 const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
 const clientAccountMap = useMemo(() => new Map(clientAccounts.map((account) => [account.id, account])), [clientAccounts]);
 const transactionMap = useMemo(() => new Map(transactions.map((transaction) => [transaction.id, transaction])), [transactions]);
 const selectedOrganizationClients = useMemo(
  () => (selectedOrganizationForClients ? clients.filter((client) => client.organizationId === selectedOrganizationForClients.id) : []),
  [clients, selectedOrganizationForClients],
 );

 const transactionSelectedCurrencyCode = transactionForm.currencyId ? currencyMap.get(transactionForm.currencyId)?.code : undefined;
 const transactionAccountFromCurrencyCode = transactionForm.accountFromId ? clientAccountMap.get(transactionForm.accountFromId)?.currencyCode : undefined;
 const transactionAccountToCurrencyCode = transactionForm.accountToId ? clientAccountMap.get(transactionForm.accountToId)?.currencyCode : undefined;
 const showExchangeRateFrom = !(transactionSelectedCurrencyCode && transactionAccountFromCurrencyCode && transactionSelectedCurrencyCode === transactionAccountFromCurrencyCode);
 const showExchangeRateTo = !(transactionSelectedCurrencyCode && transactionAccountToCurrencyCode && transactionSelectedCurrencyCode === transactionAccountToCurrencyCode);

 const chargesCurrencyCode = transactionForm.chargesCurrencyId ? currencyMap.get(transactionForm.chargesCurrencyId)?.code : undefined;
 const chargesPayerAccountCurrencyCode =
  transactionForm.chargesPayer === 'from' ? transactionAccountFromCurrencyCode : transactionForm.chargesPayer === 'to' ? transactionAccountToCurrencyCode : undefined;
 const showChargesExchangeRate = !!(chargesCurrencyCode && chargesPayerAccountCurrencyCode && chargesCurrencyCode !== chargesPayerAccountCurrencyCode);

 const overviewCards = [
  { label: t('overview_currencies'), value: enabledCurrencies.length },
  { label: t('overview_organizations'), value: organizations.length },
  { label: t('overview_clients'), value: clients.length },
  { label: t('overview_transactions'), value: transactions.length },
 ];

 const selectedClientLedgers: ClientAccountLedger[] = useMemo(() => {
  // Skip expensive ledger computations unless the ledger view/modal is active.
  if (!selectedClientForLedger || (section !== 'client-ledger' && !pdfExportModal)) {
   return [];
  }

  return clientAccounts
   .filter((account) => account.clientId === selectedClientForLedger.id)
   .map((account) => {
    const entries = transactions
     .flatMap<ClientLedgerEntry>((transaction) => {
      if (transaction.accountFromId === account.id) {
       const counterparty = clientAccountMap.get(transaction.accountToId);
       return [
        {
         transactionId: transaction.id,
         createdAt: transaction.createdAt,
         counterpartyName: counterparty?.clientName || '-',
         counterpartyClientId: counterparty?.clientId ?? null,
         direction: 'outgoing' as const,
         type: transaction.type,
         amount: transaction.amount,
         currencyCode: transaction.currencyCode,
         currencySymbol: transaction.currencySymbol,
         exchangeRate: transaction.exchangeRateFrom,
         exchangeRateReversed: !!transaction.exchangeRateFromReversed,
         commission: transaction.commissionFrom,
         netChange: transaction.amount * transaction.exchangeRateFrom + getCommissionAmount(transaction.amount * transaction.exchangeRateFrom, transaction.commissionFrom),
         runningBalance: 0,
         description: transaction.description,
         charges: transaction.charges,
         chargesCurrencyCode: transaction.chargesCurrencyCode,
         chargesPayer: transaction.chargesPayer,
         chargesExchangeRate: transaction.chargesExchangeRate,
         chargesDescription: transaction.chargesDescription,
         isChargesPayerThisAccount: transaction.chargesPayer === 'from',
        },
       ];
      }

      if (transaction.accountToId === account.id) {
       const counterparty = clientAccountMap.get(transaction.accountFromId);
       return [
        {
         transactionId: transaction.id,
         createdAt: transaction.createdAt,
         counterpartyName: counterparty?.clientName || '-',
         counterpartyClientId: counterparty?.clientId ?? null,
         direction: 'incoming' as const,
         type: transaction.type,
         amount: transaction.amount,
         currencyCode: transaction.currencyCode,
         currencySymbol: transaction.currencySymbol,
         exchangeRate: transaction.exchangeRateTo,
         exchangeRateReversed: !!transaction.exchangeRateToReversed,
         commission: transaction.commissionTo,
         netChange: -(transaction.amount * transaction.exchangeRateTo - getCommissionAmount(transaction.amount * transaction.exchangeRateTo, transaction.commissionTo)),
         runningBalance: 0,
         description: transaction.description,
         charges: transaction.charges,
         chargesCurrencyCode: transaction.chargesCurrencyCode,
         chargesPayer: transaction.chargesPayer,
         chargesExchangeRate: transaction.chargesExchangeRate,
         chargesDescription: transaction.chargesDescription,
         isChargesPayerThisAccount: transaction.chargesPayer === 'to',
        },
       ];
      }

      return [];
     })
     .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

    let runningBalance = account.startingBalance ?? 0;
    const entriesWithBalance = entries.map((entry) => {
     runningBalance += entry.netChange;
     return {
      ...entry,
      runningBalance,
     };
    });

    return {
     accountId: account.id,
     currencyName: currencyMap.get(account.currencyId)?.name || account.currencyCode,
     currencyCode: account.currencyCode,
     currencySymbol: account.currencySymbol,
     startingBalance: account.startingBalance ?? 0,
     currentBalance: runningBalance,
     transactionCount: entriesWithBalance.length,
     entries: entriesWithBalance,
    };
   })
   .sort((left, right) => left.currencyCode.localeCompare(right.currencyCode));
 }, [clientAccounts, clientAccountMap, currencyMap, pdfExportModal, section, selectedClientForLedger, transactions]);

 const renderLedgerCurrencySuffix = (currencySymbol: string, currencyCode: string) => {
  if (!showLedgerCurrencySymbol) {
   return '';
  }

  return ` ${currencySymbol || currencyCode}`;
 };

 const selectedClientTransactionCount = useMemo(() => selectedClientLedgers.reduce((sum, ledger) => sum + ledger.transactionCount, 0), [selectedClientLedgers]);

 const ledgerColumnOptions: Array<{ key: LedgerColumnKey; label: string }> = [
  { key: 'created', label: t('created') },
  { key: 'counterparty', label: t('counterparty') },
  { key: 'direction', label: t('direction') },
  { key: 'type', label: t('transaction_type') },
  { key: 'amount', label: t('transaction_amount') },
  { key: 'exchangeRate', label: t('transaction_exchange_rate') },
  { key: 'commission', label: t('commission') },
  { key: 'netChange', label: t('net_change') },
  { key: 'runningBalance', label: t('running_balance') },
  { key: 'description', label: t('transaction_description') },
 ];
 const orderedLedgerColumnOptions = ledgerColumnOrder
  .map((key) => ledgerColumnOptions.find((column) => column.key === key))
  .filter((column): column is { key: LedgerColumnKey; label: string } => Boolean(column));

 const panelClassName = 'border border-gray-200 bg-white p-5 shadow-sm';
 const mutedPanelClassName = 'border border-gray-200 bg-gray-50 p-4';
 const tableWrapClassName = 'mt-3 overflow-x-auto border border-gray-200 bg-white';
 const transactionsPager =
  transactions.length > 0 ? (
   <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
    <div className="text-sm text-slate-600">
     Showing {(transactionsPage - 1) * transactionsPageSize + 1} - {Math.min(transactionsPage * transactionsPageSize, transactions.length)} of {transactions.length}
    </div>
    <div className="flex items-center gap-2">
     <select
      value={transactionsPageSize}
      onChange={(event) => {
       const nextSize = Number(event.target.value);
       setTransactionsPageSize(nextSize);
       setTransactionsPage(1);
      }}
      className="rounded border border-slate-300 px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
     >
      <option value={50}>50/page</option>
      <option value={100}>100/page</option>
      <option value={250}>250/page</option>
     </select>
     <button
      type="button"
      onClick={() => setTransactionsPage((current) => Math.max(1, current - 1))}
      disabled={transactionsPage <= 1}
      className="rounded border border-slate-300 px-3 py-1 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
     >
      Prev
     </button>
     <span className="min-w-20 text-center text-sm font-semibold text-slate-700">
      {transactionsPage} / {totalTransactionPages}
     </span>
     <button
      type="button"
      onClick={() => setTransactionsPage((current) => Math.min(totalTransactionPages, current + 1))}
      disabled={transactionsPage >= totalTransactionPages}
      className="rounded border border-slate-300 px-3 py-1 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
     >
      Next
     </button>
    </div>
   </div>
  ) : null;
 const databaseSection = (
  <section className="flex flex-col gap-6">
   <div className={panelClassName}>
    <h2 className="text-2xl font-semibold">{t('settings_database_title')}</h2>
    <p className="mt-2 text-sm text-slate-600">{t('settings_database_description')}</p>

    <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
     <div className={mutedPanelClassName}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('settings_database_provider_label')}</p>
      <p className="mt-3 break-all font-mono text-sm text-slate-900">{dbInfo?.provider ?? t('loading')}</p>
     </div>
     <div className={mutedPanelClassName}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('settings_database_host_label')}</p>
      <p className="mt-3 break-all font-mono text-sm text-slate-900">{dbInfo ? `${dbInfo.host}:${dbInfo.port}` : t('loading')}</p>
     </div>
     <div className={mutedPanelClassName}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('settings_database_name_label')}</p>
      <p className="mt-3 break-all font-mono text-sm text-slate-900">{dbInfo?.database ?? t('loading')}</p>
     </div>
     <div className={mutedPanelClassName}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('settings_database_schema_label')}</p>
      <p className="mt-3 break-all font-mono text-sm text-slate-900">{dbInfo?.schema ?? t('loading')}</p>
     </div>
    </div>

    <div className="mt-4 rounded border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">{t('settings_database_hint')}</div>
   </div>
  </section>
 );
 const sectionMeta: Record<Section, { title: string; description: string; accent: string }> = {
  overview: {
   title: t('nav_overview'),
   description: t('overview_description'),
   accent: `${enabledCurrencies.length} ${t('overview_currencies')}`,
  },
  settings: {
   title: t('settings_title'),
   description: t('settings_description'),
   accent: settingsTabs.find((item) => item.key === settingsTab)?.label ?? t('settings_title'),
  },
  organizations: {
   title: t('organizations_title'),
   description: t('organizations_description'),
   accent: `${organizations.length} ${t('nav_organizations')}`,
  },
  'organization-clients': {
   title: selectedOrganizationForClients?.name ?? t('organization_page_title'),
   description: selectedOrganizationForClients ? t('organization_page_description') : t('organization_page_no_organization'),
   accent: `${selectedOrganizationClients.length} ${t('overview_clients')}`,
  },
  clients: {
   title: t('clients_title'),
   description: t('clients_description'),
   accent: `${clients.length} ${t('nav_clients')}`,
  },
  'client-ledger': {
   title: selectedClientForLedger?.name ?? t('client_page_title'),
   description: selectedClientForLedger ? t('client_page_description') : t('client_page_no_client'),
   accent: `${selectedClientTransactionCount} ${t('client_page_transaction_count')}`,
  },
  currencies: {
   title: t('currencies_title'),
   description: t('currencies_description'),
   accent: `${enabledCurrencies.length} ${t('nav_currencies')}`,
  },
  transactions: {
   title: t('transactions_title'),
   description: t('transactions_description'),
   accent: `${transactions.length} ${t('nav_transactions')}`,
  },
 };

 const activeSectionMeta = sectionMeta[section];

 const shellMetrics = [
  { label: t('overview_clients'), value: clients.length },
  { label: t('overview_transactions'), value: transactions.length },
  { label: t('overview_currencies'), value: enabledCurrencies.length },
 ];

 const sidebarItems: Array<{ id: string; label: string; icon: IconName; isActive: boolean; onClick: () => void }> =
  section === 'settings'
   ? [
      {
       id: 'home',
       label: t('nav_home'),
       icon: 'home',
       isActive: false,
       onClick: () => navigateToSection('overview'),
      },
      ...settingsTabs.map((item) => ({
       id: `settings-${item.key}`,
       label: item.label,
       icon: item.icon,
       isActive: settingsTab === item.key,
       onClick: () => setSettingsTab(item.key),
      })),
     ]
   : navItems.map((item) => ({
      id: item.key,
      label: item.label,
      icon: item.icon,
      isActive: section === item.key || (section === 'organization-clients' && item.key === 'organizations') || (section === 'client-ledger' && item.key === 'clients'),
      onClick: () => navigateToSection(item.key),
     }));

 const activeSidebarItem = sidebarItems.find((item) => item.isActive) ?? sidebarItems[0];

 const organizationsSection = (
  <section className="grid gap-6 xl:grid-cols-[380px_1fr]">
   <form
    onSubmit={onOrganizationSubmit}
    className={panelClassName}
   >
    <div className="flex items-center justify-between gap-3">
     <div>
      <h2 className="text-xl font-semibold">{organizationForm.id ? t('update_organization') : t('new_organization')}</h2>
      <p className="mt-1 text-sm text-slate-600">{t('organizations_description')}</p>
     </div>
     {organizationForm.id ? (
      <button
       type="button"
       onClick={() => setOrganizationForm(emptyOrganizationForm())}
       className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
       {t('cancel')}
      </button>
     ) : null}
    </div>

    <label className="mt-5 block text-sm font-medium">{t('organization_name')}</label>
    <input
     value={organizationForm.name}
     onChange={(event) => setOrganizationForm((current) => ({ ...current, name: event.target.value }))}
     className="mt-2 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
     placeholder={t('organization_name_placeholder')}
     required
    />

    <button
     type="submit"
     className="mt-6 w-full rounded bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800"
    >
     {organizationForm.id ? t('update_organization') : t('save_organization')}
    </button>
   </form>

   <div className={panelClassName}>
    <h2 className="text-xl font-semibold">{t('organizations_title')}</h2>
    <div className={tableWrapClassName}>
     <table className="w-full text-sm">
      <thead className="bg-slate-100 text-slate-700">
       <tr>
        <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('name')}</th>
        <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('actions')}</th>
       </tr>
      </thead>
      <tbody>
       {organizations.map((organization) => (
        <tr
         key={organization.id}
         className="border-t border-slate-200 align-top"
        >
         <td className="px-4 py-3 font-medium text-slate-900">
          <button
           type="button"
           onClick={() => openOrganizationClientsPage(organization)}
           className="cursor-pointer text-left text-slate-900 transition hover:text-blue-700"
          >
           {organization.name}
          </button>
         </td>
         <td className="px-4 py-3">
          <div className="flex flex-wrap gap-2">
           <button
            type="button"
            onClick={() => openOrganizationClientsPage(organization)}
            className="cursor-pointer rounded border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
           >
            {t('organization_page_open')}
           </button>
           <button
            type="button"
            onClick={() =>
             setOrganizationForm({
              id: organization.id,
              name: organization.name,
             })
            }
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
           >
            {t('edit')}
           </button>
           <button
            type="button"
            onClick={() => onDeleteOrganization(organization.id)}
            className="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
           >
            {t('delete')}
           </button>
          </div>
         </td>
        </tr>
       ))}
       {organizations.length === 0 ? (
        <tr>
         <td
          className="px-4 py-6 text-slate-500"
          colSpan={2}
         >
          {t('no_organizations')}
         </td>
        </tr>
       ) : null}
      </tbody>
     </table>
    </div>
   </div>
  </section>
 );

 const languageSection = (
  <section className="flex flex-col gap-6">
   <div className={panelClassName}>
    <h2 className="text-2xl font-semibold">{t('settings_language_title')}</h2>
    <p className="mt-2 text-sm text-slate-600">{t('settings_language_description')}</p>

    <div className="mt-6 max-w-md">
     <label className="block text-sm font-medium text-slate-700">{t('select_language')}</label>
     <select
      value={language}
      onChange={(e) => setLanguage(e.target.value as 'en' | 'ar' | 'fr')}
      className="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
     >
      <option value="en">{t('english')}</option>
      <option value="ar">{t('arabic')}</option>
      <option value="fr">{t('french')}</option>
     </select>
    </div>
   </div>
  </section>
 );

 const dangerSection = (
  <section className="flex flex-col gap-6">
   <div className={`${panelClassName} border-red-300/80`}>
    <h2 className="text-2xl font-semibold text-red-800">{t('settings_danger_title')}</h2>
    <p className="mt-2 text-sm text-slate-700">{t('settings_danger_description')}</p>

    <div className="mt-5 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
     <p className="font-semibold">{t('danger_zone_warning_title')}</p>
     <p className="mt-1">{t('danger_zone_warning_body')}</p>
    </div>

    <div className="mt-6 grid gap-4 md:grid-cols-2">
     <div className="rounded border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{t('danger_delete_all_transactions')}</h3>
      <p className="mt-1 text-sm text-slate-600">{t('danger_delete_all_transactions_hint')}</p>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
       {t('overview_transactions')}: {transactions.length}
      </p>
      <button
       type="button"
       onClick={() => void onDeleteAllTransactions()}
       disabled={!transactions.length}
       className="mt-4 rounded border border-red-300 bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
       {t('danger_delete_all_transactions')}
      </button>
     </div>

     <div className="rounded border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{t('danger_delete_all_clients')}</h3>
      <p className="mt-1 text-sm text-slate-600">{t('danger_delete_all_clients_hint')}</p>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
       {t('overview_clients')}: {clients.length}
      </p>
      <button
       type="button"
       onClick={() => void onDeleteAllClients()}
       disabled={!clients.length}
       className="mt-4 rounded border border-red-300 bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
       {t('danger_delete_all_clients')}
      </button>
     </div>
    </div>
   </div>
  </section>
 );

 const clientsSection = (
  <section className="grid gap-6 xl:grid-cols-[380px_1fr]">
   <form
    onSubmit={onClientSubmit}
    className={panelClassName}
   >
    <div className="flex items-center justify-between gap-3">
     <div>
      <h2 className="text-xl font-semibold">{clientForm.id ? t('update_client') : t('new_client')}</h2>
      <p className="mt-1 text-sm text-slate-600">{t('clients_description')}</p>
     </div>
     {clientForm.id ? (
      <button
       type="button"
       onClick={() => {
        setClientForm(emptyClientForm());
        setOpenAccountOnCreate(false);
        setNewClientAccountDrafts([createNewClientAccountDraft()]);
       }}
       className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
       {t('cancel')}
      </button>
     ) : null}
    </div>

    <label className="mt-5 block text-sm font-medium">{t('client_name')}</label>
    <input
     value={clientForm.name}
     onChange={(event) => setClientForm((current) => ({ ...current, name: event.target.value }))}
     className="mt-2 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
     placeholder={t('client_name_placeholder')}
     required
    />

    <label className="mt-4 block text-sm font-medium">{t('client_organization')}</label>
    <select
     value={clientForm.organizationId ?? ''}
     onChange={(event) =>
      setClientForm((current) => ({
       ...current,
       organizationId: event.target.value ? Number(event.target.value) : null,
      }))
     }
     className="mt-2 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
    >
     <option value="">{t('client_organization_placeholder')}</option>
     {organizations.map((organization) => (
      <option
       key={organization.id}
       value={organization.id}
      >
       {organization.name}
      </option>
     ))}
    </select>

    <label className="mt-4 block text-sm font-medium">{t('client_email')}</label>
    <input
     value={clientForm.email}
     onChange={(event) => setClientForm((current) => ({ ...current, email: event.target.value }))}
     className="mt-2 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
     placeholder={t('client_email_placeholder')}
    />

    <label className="mt-4 block text-sm font-medium">{t('client_phone')}</label>
    <input
     value={clientForm.phone}
     onChange={(event) => setClientForm((current) => ({ ...current, phone: event.target.value }))}
     className="mt-2 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
     placeholder={t('client_phone_placeholder')}
    />

    <label className="mt-4 block text-sm font-medium">{t('client_address')}</label>
    <textarea
     value={clientForm.address}
     onChange={(event) => setClientForm((current) => ({ ...current, address: event.target.value }))}
     className="mt-2 min-h-28 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
     placeholder={t('client_address_placeholder')}
    />

    {!clientForm.id ? (
     <div className="mt-4 rounded border border-slate-200/70 bg-slate-50/85 p-4">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
       <input
        type="checkbox"
        checked={openAccountOnCreate}
        onChange={(event) => {
         const checked = event.target.checked;
         setOpenAccountOnCreate(checked);
         if (!checked) {
          setNewClientAccountDrafts([createNewClientAccountDraft()]);
         }
        }}
        className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-400"
       />
       {t('client_account_open')}
      </label>

      {openAccountOnCreate ? (
       <div className="mt-3 space-y-2">
        {newClientAccountDrafts.map((draft, index) => (
         <div
          key={`new-client-account-${index}`}
          className="rounded border border-slate-200/70 bg-white/90 p-3"
         >
          <div className="flex flex-col gap-2 sm:flex-row">
           <select
            value={draft.currencyId ?? ''}
            onChange={(event) => {
             const currencyId = event.target.value ? Number(event.target.value) : null;
             setNewClientAccountDrafts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, currencyId } : row)));
            }}
            className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
           >
            <option value="">{t('client_account_currency_placeholder')}</option>
            {enabledCurrencies
             .filter((currency) => !newClientAccountDrafts.some((row, rowIndex) => rowIndex !== index && row.currencyId === currency.id))
             .map((currency) => (
              <option
               key={currency.id}
               value={currency.id}
              >
               {currency.code} - {currency.name}
              </option>
             ))}
           </select>
           <input
            type="number"
            value={draft.startingBalance}
            onChange={(event) => {
             const nextBalance = event.target.value;
             setNewClientAccountDrafts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, startingBalance: nextBalance } : row)));
            }}
            placeholder={t('starting_balance')}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring sm:w-40"
           />
          </div>
          {newClientAccountDrafts.length > 1 ? (
           <button
            type="button"
            onClick={() => setNewClientAccountDrafts((current) => current.filter((_, rowIndex) => rowIndex !== index))}
            className="mt-2 inline-flex rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
           >
            Remove account
           </button>
          ) : null}
         </div>
        ))}

        <button
         type="button"
         onClick={() => setNewClientAccountDrafts((current) => [...current, createNewClientAccountDraft()])}
         className="inline-flex rounded border border-blue-100 bg-blue-50/60 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
        >
         Open another account
        </button>
       </div>
      ) : null}
     </div>
    ) : null}

    <button
     type="submit"
     className="mt-6 w-full rounded bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800"
    >
     {clientForm.id ? t('update_client') : t('save_client')}
    </button>
   </form>

   <div className="flex flex-col gap-4">
    <div className={panelClassName}>
     <h2 className="text-xl font-semibold">{t('clients_title')}</h2>
     <div className={tableWrapClassName}>
      <table className="w-full text-sm">
       <thead className="bg-slate-100 text-slate-700">
        <tr>
         <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('name')}</th>
         <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_organization')}</th>
         <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_accounts')}</th>
        </tr>
       </thead>
       <tbody>
        {clients.map((client) => (
         <tr
          key={client.id}
          className="border-t border-slate-200 align-top"
         >
          <td className="px-4 py-3 font-medium text-slate-900">
           <button
            type="button"
            onClick={() => openClientLedger(client, 'clients')}
            className="cursor-pointer text-left text-slate-900 transition hover:text-blue-700"
           >
            {client.name}
           </button>
           <div className="mt-2 flex flex-wrap gap-2">
            <button
             type="button"
             onClick={() => {
              setClientForm({
               id: client.id,
               organizationId: client.organizationId,
               name: client.name,
               email: client.email,
               phone: client.phone,
               address: client.address,
              });
              setOpenAccountOnCreate(false);
              setNewClientAccountDrafts([createNewClientAccountDraft()]);
             }}
             className="cursor-pointer rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
             {t('edit')}
            </button>
            <button
             type="button"
             onClick={() => onDeleteClient(client.id)}
             className="cursor-pointer rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
            >
             {t('delete')}
            </button>
           </div>
          </td>
          <td className="px-4 py-3 text-slate-600">{client.organizationName || t('unassigned')}</td>
          <td className="px-4 py-3">
           <button
            type="button"
            onClick={() => setSelectedClientForAccounts(selectedClientForAccounts?.id === client.id ? null : client)}
            className={`cursor-pointer rounded border px-3 py-1.5 text-xs font-semibold transition ${
             selectedClientForAccounts?.id === client.id ? 'border-blue-600 bg-blue-700 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
           >
            {t('client_accounts')} ({client.accountCount})
           </button>
          </td>
         </tr>
        ))}
        {clients.length === 0 ? (
         <tr>
          <td
           className="px-4 py-6 text-slate-500"
           colSpan={3}
          >
           {t('no_clients')}
          </td>
         </tr>
        ) : null}
       </tbody>
      </table>
     </div>
    </div>

    {selectedClientForAccounts ? (
     <div className={panelClassName}>
      <div className="flex items-center justify-between gap-3">
       <h2 className="text-lg font-semibold">
        {t('client_accounts_for')}: <span className="text-blue-700">{selectedClientForAccounts.name}</span>
       </h2>
       <button
        type="button"
        onClick={() => setSelectedClientForAccounts(null)}
        className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
       >
        {t('cancel')}
       </button>
      </div>

      <div className="mt-4 space-y-2">
       {clientAccounts
        .filter((a) => a.clientId === selectedClientForAccounts.id)
        .map((account) => (
         <div
          key={account.id}
          className="flex items-center justify-between rounded border border-slate-200 px-4 py-3"
         >
          <span className="font-mono font-semibold text-slate-800">{account.currencySymbol || account.currencyCode}</span>
          <button
           type="button"
           onClick={() => onDeleteClientAccount(account.id)}
           className="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
          >
           {t('delete')}
          </button>
         </div>
        ))}
       {clientAccounts.filter((a) => a.clientId === selectedClientForAccounts.id).length === 0 ? <p className="text-sm text-slate-500">{t('no_client_accounts')}</p> : null}
      </div>

      <div className="mt-4 flex flex-col gap-2">
       <div className="flex gap-2">
        <select
         value={newAccountCurrencyId ?? ''}
         onChange={(event) => setNewAccountCurrencyId(event.target.value ? Number(event.target.value) : null)}
         className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
        >
         <option value="">{t('client_account_currency_placeholder')}</option>
         {enabledCurrencies
          .filter((cur) => !clientAccounts.some((a) => a.clientId === selectedClientForAccounts.id && a.currencyId === cur.id))
          .map((cur) => (
           <option
            key={cur.id}
            value={cur.id}
           >
            {cur.code} â€“ {cur.name}
           </option>
          ))}
        </select>
        <input
         type="number"
         value={newAccountStartingBalance}
         onChange={(event) => setNewAccountStartingBalance(event.target.value)}
         placeholder={t('starting_balance')}
         className="w-36 rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
        />
       </div>
       <button
        type="button"
        onClick={() => onAddClientAccount(selectedClientForAccounts.id)}
        disabled={!newAccountCurrencyId}
        className="self-start rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
       >
        {t('client_account_open')}
       </button>
      </div>
     </div>
    ) : null}
   </div>
  </section>
 );

 const currenciesSection = (
  <section className="flex flex-col gap-6">
   <div className={panelClassName}>
    <div className="flex items-start justify-between gap-4">
     <div>
      <h2 className="text-xl font-semibold">{t('currencies_title')}</h2>
      <p className="mt-1 text-sm text-slate-600">{t('currencies_description')}</p>
     </div>
     <div className="rounded border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">{t('currencies_seeded_hint')}</div>
    </div>

    <div className="mt-4 rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">{t('currencies_seeded_description')}</div>

    <div className="mt-4 rounded border border-slate-200 bg-white px-4 py-4">
     <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
      <div className="flex-1">
       <label className="block text-sm font-medium text-slate-700">{t('currency_catalog_title')}</label>
       <input
        value={catalogCurrencyQuery}
        onChange={(event) => {
         setCatalogCurrencyQuery(event.target.value);
         setSelectedCatalogCurrencyId(null);
        }}
        className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
        placeholder={t('currency_catalog_search_placeholder')}
       />
       <div className="mt-2 max-h-64 overflow-y-auto rounded border border-slate-200 bg-slate-50">
        {filteredAvailableCurrencies.length > 0 ? (
         filteredAvailableCurrencies.map((currency) => (
          <button
           key={currency.id}
           type="button"
           onClick={() => {
            setSelectedCatalogCurrencyId(currency.id);
            setCatalogCurrencyQuery(`${currency.code} - ${currency.name}`);
           }}
           className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-sm transition ${
            selectedCatalogCurrencyId === currency.id ? 'bg-blue-100 text-blue-900' : 'text-slate-700 hover:bg-white'
           }`}
          >
           <span className="font-semibold">{currency.code}</span>
           <span className="flex-1 truncate text-slate-600">{currency.name}</span>
          </button>
         ))
        ) : (
         <p className="px-3 py-3 text-sm text-slate-500">{t('currency_catalog_no_match')}</p>
        )}
       </div>
      </div>
      <button
       type="button"
       onClick={() => (selectedCatalogCurrencyId ? void onEnableCurrency(selectedCatalogCurrencyId) : undefined)}
       disabled={!selectedCatalogCurrencyId}
       className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
       {t('currency_add_to_used')}
      </button>
     </div>
     {availableCurrencies.length === 0 ? <p className="mt-3 text-sm text-slate-500">{t('currency_catalog_empty')}</p> : null}
    </div>

    <div className={tableWrapClassName}>
     <table className="w-full text-sm">
      <thead className="bg-slate-100 text-slate-700">
       <tr>
        <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('currency_code')}</th>
        <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('currency_name')}</th>
        <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('currency_symbol')}</th>
        <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('main_currency')}</th>
        <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('actions')}</th>
       </tr>
      </thead>
      <tbody>
       {enabledCurrencies.map((currency) => (
        <tr
         key={currency.id}
         className="border-t border-slate-200 align-top"
        >
         <td className="px-4 py-3 font-mono font-semibold text-slate-900">{currency.code}</td>
         <td className="px-4 py-3 text-slate-700">{currency.name}</td>
         <td className="px-4 py-3 text-slate-600">{currency.symbol || '-'}</td>
         <td className="px-4 py-3">
          {currency.isMain === 1 ? (
           <span className="inline-flex items-center rounded bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">{t('main_currency')}</span>
          ) : (
           <span className="text-slate-400">â€”</span>
          )}
         </td>
         <td className="px-4 py-3">
          <div className="flex flex-wrap gap-2">
           <button
            type="button"
            onClick={() => onDisableCurrency(currency.id)}
            className="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
           >
            {t('currency_remove_from_used')}
           </button>
           {currency.isMain !== 1 ? (
            <button
             type="button"
             onClick={() => onSetMainCurrency(currency.id)}
             className="rounded border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
            >
             {t('set_as_main')}
            </button>
           ) : null}
          </div>
         </td>
        </tr>
       ))}
       {enabledCurrencies.length === 0 ? (
        <tr>
         <td
          className="px-4 py-6 text-slate-500"
          colSpan={5}
         >
          {t('no_used_currencies')}
         </td>
        </tr>
       ) : null}
      </tbody>
     </table>
    </div>
   </div>
  </section>
 );

 const organizationsReadOnlySection = (
  <section className={panelClassName}>
   <div className="flex items-start justify-between gap-4">
    <div>
     <h2 className="text-xl font-semibold">{t('organizations_title')}</h2>
    </div>
    <button
     type="button"
     onClick={() => {
      setSettingsTab('organizations');
      navigateToSection('settings');
     }}
     className="rounded border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
    >
     {t('open_in_settings')}
    </button>
   </div>

   <div className={tableWrapClassName}>
    <table className="w-full text-sm">
     <thead className="bg-slate-100 text-slate-700">
      <tr>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('name')}</th>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('overview_clients')}</th>
      </tr>
     </thead>
     <tbody>
      {organizations.map((organization) => (
       <tr
        key={organization.id}
        className="border-t border-slate-200 align-top"
       >
        <td className="px-4 py-3 font-medium text-slate-900">
         <button
          type="button"
          onClick={() => openOrganizationClientsPage(organization)}
          className="cursor-pointer text-left text-slate-900 transition hover:text-blue-700"
         >
          {organization.name}
         </button>
        </td>
        <td className="px-4 py-3 text-slate-600">{clients.filter((client) => client.organizationId === organization.id).length}</td>
       </tr>
      ))}
      {organizations.length === 0 ? (
       <tr>
        <td
         className="px-4 py-6 text-slate-500"
         colSpan={2}
        >
         {t('no_organizations')}
        </td>
       </tr>
      ) : null}
     </tbody>
    </table>
   </div>
  </section>
 );

 const clientsReadOnlySection = (
  <section className="flex flex-col gap-4">
   <div className={panelClassName}>
    <div className="flex items-start justify-between gap-4">
     <div>
      <h2 className="text-xl font-semibold">{t('clients_title')}</h2>
     </div>
     <button
      type="button"
      onClick={() => {
       setSettingsTab('clients');
       navigateToSection('settings');
      }}
      className="rounded border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
     >
      {t('open_in_settings')}
     </button>
    </div>

    <div className={tableWrapClassName}>
     <table className="w-full text-sm">
      <thead className="bg-slate-100 text-slate-700">
       <tr>
        <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('name')}</th>
        <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_organization')}</th>
        <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_accounts')}</th>
       </tr>
      </thead>
      <tbody>
       {clients.map((client) => (
        <tr
         key={client.id}
         className="border-t border-slate-200 align-top"
        >
         <td className="px-4 py-3 font-medium text-slate-900">
          <button
           type="button"
           onClick={() => openClientLedger(client, 'clients')}
           className="cursor-pointer text-left text-slate-900 transition hover:text-blue-700"
          >
           {client.name}
          </button>
         </td>
         <td className="px-4 py-3 text-slate-600">{client.organizationName || t('unassigned')}</td>
         <td className="px-4 py-3 text-slate-600">{client.accountCount}</td>
        </tr>
       ))}
       {clients.length === 0 ? (
        <tr>
         <td
          className="px-4 py-6 text-slate-500"
          colSpan={3}
         >
          {t('no_clients')}
         </td>
        </tr>
       ) : null}
      </tbody>
     </table>
    </div>
   </div>

   {selectedClientForAccounts ? (
    <div className={panelClassName}>
     <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">
       {t('client_accounts_for')}: <span className="text-blue-700">{selectedClientForAccounts.name}</span>
      </h2>
      <button
       type="button"
       onClick={() => setSelectedClientForAccounts(null)}
       className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
      >
       {t('cancel')}
      </button>
     </div>

     <div className="mt-4 space-y-2">
      {clientAccounts
       .filter((a) => a.clientId === selectedClientForAccounts.id)
       .map((account) => (
        <div
         key={account.id}
         className="flex items-center justify-between rounded border border-slate-200 px-4 py-3"
        >
         <span className="font-mono font-semibold text-slate-800">{account.currencySymbol || account.currencyCode}</span>
        </div>
       ))}
      {clientAccounts.filter((a) => a.clientId === selectedClientForAccounts.id).length === 0 ? <p className="text-sm text-slate-500">{t('no_client_accounts')}</p> : null}
     </div>
    </div>
   ) : null}
  </section>
 );

 const currenciesReadOnlySection = (
  <section className={panelClassName}>
   <div className="flex items-start justify-between gap-4">
    <div>
     <h2 className="text-xl font-semibold">{t('currencies_title')}</h2>
    </div>
    <button
     type="button"
     onClick={() => {
      setSettingsTab('currencies');
      navigateToSection('settings');
     }}
     className="rounded border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
    >
     {t('open_in_settings')}
    </button>
   </div>

   <div className={tableWrapClassName}>
    <table className="w-full text-sm">
     <thead className="bg-slate-100 text-slate-700">
      <tr>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('currency_code')}</th>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('currency_name')}</th>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('currency_symbol')}</th>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('main_currency')}</th>
      </tr>
     </thead>
     <tbody>
      {enabledCurrencies.map((currency) => (
       <tr
        key={currency.id}
        className="border-t border-slate-200 align-top"
       >
        <td className="px-4 py-3 font-mono font-semibold text-slate-900">{currency.code}</td>
        <td className="px-4 py-3 text-slate-700">{currency.name}</td>
        <td className="px-4 py-3 text-slate-600">{currency.symbol || '-'}</td>
        <td className="px-4 py-3">
         {currency.isMain === 1 ? (
          <span className="inline-flex items-center rounded bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">{t('main_currency')}</span>
         ) : (
          <span className="text-slate-400">â€”</span>
         )}
        </td>
       </tr>
      ))}
      {enabledCurrencies.length === 0 ? (
       <tr>
        <td
         className="px-4 py-6 text-slate-500"
         colSpan={4}
        >
         {t('no_used_currencies')}
        </td>
       </tr>
      ) : null}
     </tbody>
    </table>
   </div>
  </section>
 );

 const settingsSection = (
  <section className="flex flex-col gap-0">
   {/* Settings section header */}
   <div className="border-b-2 border-blue-800 bg-white px-5 py-4">
    <div className="flex items-center gap-3">
     <span className="inline-flex h-8 w-8 items-center justify-center rounded bg-blue-800 text-white">{renderIcon('settings', 'h-4 w-4')}</span>
     <div>
      <h2 className="text-base font-bold text-gray-900">{t('settings_title')}</h2>
      <p className="text-xs text-gray-500">{t('settings_description')}</p>
     </div>
    </div>
    {/* Tab strip */}
    <div className="mt-4 flex flex-wrap gap-0 border-b border-gray-200 -mb-px">
     {settingsTabs.map((tab) => {
      const isActive = settingsTab === tab.key;
      return (
       <button
        key={tab.key}
        type="button"
        onClick={() => setSettingsTab(tab.key)}
        className={`inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition ${
         isActive ? 'border-blue-700 text-blue-700' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
        }`}
       >
        {renderIcon(tab.icon, 'h-4 w-4')}
        {tab.label}
       </button>
      );
     })}
    </div>
   </div>
   {/* Active tab content */}
   <div className="flex flex-col gap-4 p-4">
    {error ? <div className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div> : null}
    {importSummary ? <div className="rounded border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">{importSummary}</div> : null}
    {settingsTab === 'database' ? databaseSection : null}
    {settingsTab === 'language' ? languageSection : null}
    {settingsTab === 'danger' ? dangerSection : null}
    {settingsTab === 'clients' ? clientsSection : null}
    {settingsTab === 'organizations' ? organizationsSection : null}
    {settingsTab === 'currencies' ? currenciesSection : null}
   </div>
  </section>
 );

 return (
  <div className={`min-h-screen flex bg-gray-100 text-gray-900 ${isRTL ? 'rtl' : 'ltr'}`}>
   <main className="flex w-full">
    {/* Classic sidebar - desktop only */}
    <aside
     className={`hidden lg:flex flex-col bg-[#1e3a5f] text-white border-r border-[#15304f] shrink-0 transition-[width] duration-200 ${isSidebarCollapsed ? 'w-16' : 'w-56'}`}
     style={{ position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}
    >
     {/* Brand */}
     <div className={`flex items-center border-b border-white/10 px-3 py-3 ${isSidebarCollapsed ? 'justify-center' : 'justify-between gap-2'}`}>
      {!isSidebarCollapsed && (
       <div className="min-w-0">
        <span className="block text-xs font-bold tracking-widest text-white">ARKAM</span>
        <span className="block truncate text-xs leading-tight text-blue-300">{t('app_description')}</span>
       </div>
      )}
      <button
       type="button"
       onClick={() => setIsSidebarCollapsed((current) => !current)}
       aria-label={isSidebarCollapsed ? t('sidebar_expand') : t('sidebar_collapse')}
       title={isSidebarCollapsed ? t('sidebar_expand') : t('sidebar_collapse')}
       className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-white/20 text-blue-200 transition hover:bg-white/10 hover:text-white"
      >
       {isSidebarCollapsed ? (isRTL ? '<' : '>') : isRTL ? '>' : '<'}
      </button>
     </div>
     {/* Navigation */}
     <nav className="flex-1 py-1">
      {sidebarItems.map((item) => {
       const isActive = item.isActive;
       return (
        <button
         key={item.id}
         type="button"
         onClick={item.onClick}
         aria-pressed={isActive}
         aria-label={item.label}
         title={item.label}
         className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition ${
          isActive ? 'bg-blue-600 text-white' : 'text-blue-100 hover:bg-white/10 hover:text-white'
         } ${isSidebarCollapsed ? 'justify-center' : ''}`}
        >
         <span className="shrink-0">{renderIcon(item.icon, 'h-4 w-4')}</span>
         {isSidebarCollapsed ? null : <span className="truncate">{item.label}</span>}
        </button>
       );
      })}
     </nav>
     {/* Footer */}
     <div className="border-t border-white/10 py-1">
      {section !== 'settings' ? (
       <button
        type="button"
        onClick={() => navigateToSection('settings')}
        aria-label={t('settings_title')}
        title={t('settings_title')}
        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-blue-100 transition hover:bg-white/10 hover:text-white ${
         isSidebarCollapsed ? 'justify-center' : ''
        }`}
       >
        <span className="shrink-0">{renderIcon('settings', 'h-4 w-4')}</span>
        {isSidebarCollapsed ? null : <span>{t('settings_title')}</span>}
       </button>
      ) : null}
      <button
       type="button"
       onClick={() => {
        accountingApi.setActiveWorkspaceId(null);
        void signOut({ callbackUrl: '/login' });
       }}
       aria-label={t('sign_out')}
       title={t('sign_out')}
       className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-blue-100 transition hover:bg-white/10 hover:text-white ${
        isSidebarCollapsed ? 'justify-center' : ''
       }`}
      >
       <span className="shrink-0">{renderIcon('auth', 'h-4 w-4')}</span>
       {isSidebarCollapsed ? null : <span>{t('sign_out')}</span>}
      </button>
      {isSidebarCollapsed ? null : (
       <div className="px-3 pb-2 pt-1">
        <select
         value={language}
         onChange={(event) => setLanguage(event.target.value as 'en' | 'ar' | 'fr')}
         className="w-full rounded border border-white/20 bg-white/10 px-2 py-1 text-xs text-blue-100 outline-none transition focus:border-blue-300"
        >
         <option value="en">{t('english')}</option>
         <option value="ar">{t('arabic')}</option>
         <option value="fr">{t('french')}</option>
        </select>
       </div>
      )}
     </div>
    </aside>

    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
     {/* Top bar - mobile navigation */}
     <div className="border-b border-[#15304f] bg-[#1e3a5f] px-4 py-2 lg:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
       <span className="text-sm font-bold tracking-widest text-white">ARKAM</span>
       <div className="flex flex-wrap items-center gap-1">
        {sidebarItems.map((item) => {
         const isActive = item.isActive;
         return (
          <button
           key={item.id}
           type="button"
           onClick={item.onClick}
           aria-pressed={isActive}
           title={item.label}
           className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium transition ${
            isActive ? 'border-blue-400 bg-blue-600 text-white' : 'border-white/20 text-blue-100 hover:bg-white/10 hover:text-white'
           }`}
          >
           {renderIcon(item.icon, 'h-4 w-4')}
           <span className="hidden sm:inline">{item.label}</span>
          </button>
         );
        })}
        <button
         type="button"
         onClick={() => navigateToSection('settings')}
         title={t('settings_title')}
         className="inline-flex items-center gap-1.5 rounded border border-white/20 px-2 py-1 text-xs text-blue-100 transition hover:bg-white/10 hover:text-white"
        >
         {renderIcon('settings', 'h-4 w-4')}
        </button>
        <button
         type="button"
         onClick={() => {
          accountingApi.setActiveWorkspaceId(null);
          void signOut({ callbackUrl: '/login' });
         }}
         title={t('sign_out')}
         className="inline-flex items-center gap-1.5 rounded border border-white/20 px-2 py-1 text-xs text-blue-100 transition hover:bg-white/10 hover:text-white"
        >
         {renderIcon('auth', 'h-4 w-4')}
        </button>
        <select
         value={language}
         onChange={(event) => setLanguage(event.target.value as 'en' | 'ar' | 'fr')}
         className="rounded border border-white/20 bg-white/10 px-1.5 py-1 text-xs text-blue-100 outline-none"
        >
         <option value="en">EN</option>
         <option value="ar">Ø¹Ø±</option>
         <option value="fr">FR</option>
        </select>
       </div>
      </div>
     </div>

     {/* Page title bar — hidden when in settings (settings has its own header) */}
     {section !== 'client-ledger' && section !== 'settings' ? (
      <div className="border-b border-gray-200 bg-white px-5 py-3">
       <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
         <h1 className="text-sm font-semibold text-gray-800">{activeSectionMeta.title}</h1>
         <p className="mt-0.5 text-xs text-gray-500">{activeSectionMeta.description}</p>
        </div>
        <div className="flex items-center gap-6">
         {shellMetrics.map((metric) => (
          <div
           key={metric.label}
           className="text-right"
          >
           <p className="text-xs text-gray-500">{metric.label}</p>
           <p className="text-sm font-semibold text-gray-800">{metric.value}</p>
          </div>
         ))}
        </div>
       </div>
      </div>
     ) : null}

     {/* Settings: full-width, no outer padding */}
     {section === 'settings' ? settingsSection : null}

     {section !== 'settings' ? (
      <div className="flex flex-col gap-4 p-4">
       {error ? <div className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div> : null}
       {importSummary ? <div className="rounded border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">{importSummary}</div> : null}

       {section === 'overview' ? (
        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
         <div className={panelClassName}>
          <h2 className="text-2xl font-semibold">{t('overview_title')}</h2>
          <p className="mt-2 text-sm text-slate-600">{t('overview_description')}</p>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
           {overviewCards.map((card) => (
            <div
             key={card.label}
             className={mutedPanelClassName}
            >
             <p className="text-sm text-slate-500">{card.label}</p>
             <p className="mt-3 text-3xl font-bold text-slate-900">{card.value}</p>
            </div>
           ))}
          </div>
         </div>

         <div className={panelClassName}>
          <h2 className="text-xl font-semibold">{t('organizations_title')}</h2>
          <div className="mt-4 space-y-3 text-sm text-slate-600">
           {organizations.slice(0, 5).map((organization) => (
            <div
             key={organization.id}
             className="rounded border border-slate-200 px-4 py-3"
            >
             <button
              type="button"
              onClick={() => openOrganizationClientsPage(organization)}
              className="cursor-pointer font-semibold text-slate-900 transition hover:text-blue-700"
             >
              {organization.name}
             </button>
             <p>
              {clients.filter((client) => client.organizationId === organization.id).length} {t('overview_clients')}
             </p>
            </div>
           ))}
           {organizations.length === 0 ? <p>{t('no_organizations')}</p> : null}
          </div>
         </div>
        </section>
       ) : null}

       {section === 'organizations' ? organizationsReadOnlySection : null}

       {section === 'organization-clients' ? (
        <section className="flex flex-col gap-6">
         <div className={panelClassName}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
           <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">{t('organization_page_title')}</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{selectedOrganizationForClients?.name ?? t('organizations_title')}</h2>
            <p className="mt-2 text-sm text-slate-600">{selectedOrganizationForClients ? t('organization_page_description') : t('organization_page_no_organization')}</p>
           </div>

           <button
            type="button"
            onClick={() => navigateToSection('organizations')}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
           >
            {t('organization_page_back')}
           </button>
          </div>

          {selectedOrganizationForClients ? (
           <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className={mutedPanelClassName}>
             <p className="text-sm text-slate-500">{t('organizations_title')}</p>
             <p className="mt-2 text-lg font-semibold text-slate-900">{selectedOrganizationForClients.name}</p>
            </div>
            <div className={mutedPanelClassName}>
             <p className="text-sm text-slate-500">{t('overview_clients')}</p>
             <p className="mt-2 text-lg font-semibold text-slate-900">{selectedOrganizationClients.length}</p>
            </div>
            <div className={mutedPanelClassName}>
             <p className="text-sm text-slate-500">{t('client_accounts')}</p>
             <p className="mt-2 text-lg font-semibold text-slate-900">{selectedOrganizationClients.reduce((sum, client) => sum + client.accountCount, 0)}</p>
            </div>
           </div>
          ) : null}
         </div>

         {!selectedOrganizationForClients ? (
          <div className={`${panelClassName} text-sm text-slate-600`}>{t('organization_page_no_organization')}</div>
         ) : selectedOrganizationClients.length === 0 ? (
          <div className={`${panelClassName} text-sm text-slate-600`}>{t('organization_page_no_clients')}</div>
         ) : (
          <div className={panelClassName}>
           <h3 className="text-xl font-semibold text-slate-900">{t('organization_clients_title')}</h3>
           <div className={tableWrapClassName}>
            <table className="w-full text-sm">
             <thead className="bg-slate-100 text-slate-700">
              <tr>
               <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('name')}</th>
               <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_accounts')}</th>
              </tr>
             </thead>
             <tbody>
              {selectedOrganizationClients.map((client) => (
               <tr
                key={client.id}
                className="border-t border-slate-200 align-top"
               >
                <td className="px-4 py-3 font-medium text-slate-900">
                 <button
                  type="button"
                  onClick={() => openClientLedger(client, 'organization-clients')}
                  className="cursor-pointer text-left text-slate-900 transition hover:text-blue-700"
                 >
                  {client.name}
                 </button>
                </td>
                <td className="px-4 py-3 text-slate-600">{client.accountCount}</td>
               </tr>
              ))}
             </tbody>
            </table>
           </div>
          </div>
         )}
        </section>
       ) : null}

       {section === 'clients' ? clientsReadOnlySection : null}

       {section === 'client-ledger' ? (
        <section className="flex flex-col gap-6">
         <div className={panelClassName}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
           <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">{t('client_page_title')}</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{selectedClientForLedger?.name ?? t('clients_title')}</h2>
            <p className="mt-2 text-sm text-slate-600">{selectedClientForLedger ? t('client_page_description') : t('client_page_no_client')}</p>
           </div>

           <button
            type="button"
            onClick={() => navigateToSection(clientLedgerBackSection)}
            className="cursor-pointer rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
           >
            {clientLedgerBackSection === 'organization-clients' ? t('organization_page_back') : t('client_page_back')}
           </button>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
           {selectedClientForLedger && selectedClientLedgers.length > 1
            ? selectedClientLedgers.map((ledger) => (
               <button
                key={ledger.accountId}
                type="button"
                onClick={() => setSelectedLedgerAccountId(ledger.accountId)}
                className={`cursor-pointer rounded border px-4 py-2 text-sm font-semibold transition ${
                 selectedLedgerAccountId === ledger.accountId ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
               >
                {ledger.currencyName}
               </button>
              ))
            : null}
           {selectedClientForLedger ? (
            <>
             {isClientLedgerEditMode ? (
              <>
               <button
                type="button"
                onClick={() => void onSaveAllLedgerTransactions()}
                className="cursor-pointer rounded border border-emerald-500 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
               >
                {t('save_changes')}
               </button>
               <button
                type="button"
                onClick={cancelClientLedgerEditMode}
                className="cursor-pointer rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
               >
                {t('cancel')}
               </button>
              </>
             ) : null}
             <button
              type="button"
              onClick={() => (isClientLedgerEditMode ? cancelClientLedgerEditMode() : beginClientLedgerEditMode())}
              className={`cursor-pointer rounded border px-4 py-2 text-sm font-semibold transition ${
               isClientLedgerEditMode ? 'border-amber-500 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'border-blue-600 bg-blue-700 text-white hover:bg-blue-800'
              }`}
             >
              {isClientLedgerEditMode ? t('client_ledger_done_editing') : t('client_ledger_edit_mode')}
             </button>
             {!isClientLedgerEditMode ? (
              <button
               type="button"
               onClick={() => {
                const targetLedger =
                 selectedClientLedgers.length === 1
                  ? selectedClientLedgers[0]
                  : (selectedClientLedgers.find((l) => l.accountId === selectedLedgerAccountId) ?? selectedClientLedgers[0]);
                if (!targetLedger) return;
                const today = new Date().toISOString().slice(0, 10);
                const firstEntry = targetLedger.entries[0]?.createdAt.slice(0, 10) ?? today;
                setPdfExportModal({ accountId: targetLedger.accountId, fromDate: firstEntry, toDate: today });
               }}
               className="cursor-pointer rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
               {t('export_pdf')}
              </button>
             ) : null}
            </>
           ) : null}
          </div>
         </div>

         {!selectedClientForLedger ? (
          <div className={`${panelClassName} text-sm text-slate-600`}>{t('client_page_no_client')}</div>
         ) : selectedClientLedgers.length === 0 ? (
          <div className={`${panelClassName} text-sm text-slate-600`}>{t('no_client_accounts')}</div>
         ) : (
          selectedClientLedgers
           .filter((ledger) => selectedClientLedgers.length === 1 || ledger.accountId === selectedLedgerAccountId)
           .map((ledger) => (
            <div
             key={ledger.accountId}
             className={panelClassName}
            >
             <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
               <h3 className="text-xl font-semibold text-slate-900">{ledger.currencyName}</h3>
               <p className="mt-1 text-sm text-slate-600">{t('client_page_account_summary')}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
               <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('starting_balance')}</p>
                {isClientLedgerEditMode ? (
                 <div className="mt-2">
                  <input
                   type="number"
                   value={ledgerStartingBalanceDrafts[ledger.accountId] ?? String(ledger.startingBalance)}
                   onChange={(event) => setLedgerStartingBalanceDrafts((prev) => ({ ...prev, [ledger.accountId]: event.target.value }))}
                   className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                  />
                 </div>
                ) : (
                 <p className={`mt-2 text-xl font-bold ${ledger.startingBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {ledger.startingBalance.toLocaleString(language, { maximumFractionDigits: 2 })}
                 </p>
                )}
               </div>
               <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('client_page_current_balance')}</p>
                <p className={`mt-2 text-xl font-bold ${ledger.currentBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                 {ledger.currentBalance.toLocaleString(language, { maximumFractionDigits: 2 })}
                </p>
               </div>
               <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('client_page_transaction_count')}</p>
                <p className="mt-2 text-xl font-bold text-slate-900">{ledger.transactionCount}</p>
               </div>
              </div>
             </div>

             {ledger.entries.length === 0 ? (
              <p className="mt-5 text-sm text-slate-500">{t('client_page_no_transactions')}</p>
             ) : (
              <div className={tableWrapClassName}>
               {isClientLedgerEditMode ? (
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                 <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('client_ledger_columns')}</span>
                  {orderedLedgerColumnOptions.map((column) => {
                   const isVisible = ledgerColumnVisibility[column.key];

                   return (
                    <button
                     key={column.key}
                     type="button"
                     onClick={() => toggleLedgerColumn(column.key)}
                     aria-pressed={isVisible}
                     className={`cursor-pointer rounded border px-3 py-1.5 text-xs font-semibold transition ${
                      isVisible ? 'border-blue-600 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                     }`}
                    >
                     {column.label}
                    </button>
                   );
                  })}
                  <button
                   type="button"
                   onClick={() => setShowLedgerCurrencySymbol((current) => !current)}
                   aria-pressed={showLedgerCurrencySymbol}
                   className={`cursor-pointer rounded border px-3 py-1.5 text-xs font-semibold transition ${
                    showLedgerCurrencySymbol ? 'border-blue-600 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                   }`}
                  >
                   {t('currency_symbol')}
                  </button>
                 </div>
                </div>
               ) : null}
               <table className="w-full text-sm">
                <thead className="bg-slate-100 text-slate-700">
                 <tr>
                  {orderedLedgerColumnOptions.map((column) => {
                   if (!ledgerColumnVisibility[column.key]) {
                    return null;
                   }

                   const headerClassName = `px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'} ${isClientLedgerEditMode ? 'cursor-move select-none' : ''}`;

                   const headerContent = (
                    <span className="inline-flex items-center gap-2">
                     {isClientLedgerEditMode ? <span className={`text-[10px] ${draggedLedgerColumn === column.key ? 'opacity-60' : 'opacity-80'}`}>::</span> : null}
                     <span>{column.label}</span>
                    </span>
                   );

                   switch (column.key) {
                    case 'created':
                     return (
                      <th
                       key={column.key}
                       draggable={isClientLedgerEditMode}
                       onDragStart={isClientLedgerEditMode ? (event) => onLedgerColumnDragStart(event, column.key) : undefined}
                       onDragOver={isClientLedgerEditMode ? (event) => event.preventDefault() : undefined}
                       onDrop={isClientLedgerEditMode ? () => onLedgerColumnDrop(column.key) : undefined}
                       onDragEnd={isClientLedgerEditMode ? () => setDraggedLedgerColumn(null) : undefined}
                       className={headerClassName}
                      >
                       {headerContent}
                      </th>
                     );
                    case 'counterparty':
                     return (
                      <th
                       key={column.key}
                       draggable={isClientLedgerEditMode}
                       onDragStart={isClientLedgerEditMode ? (event) => onLedgerColumnDragStart(event, column.key) : undefined}
                       onDragOver={isClientLedgerEditMode ? (event) => event.preventDefault() : undefined}
                       onDrop={isClientLedgerEditMode ? () => onLedgerColumnDrop(column.key) : undefined}
                       onDragEnd={isClientLedgerEditMode ? () => setDraggedLedgerColumn(null) : undefined}
                       className={headerClassName}
                      >
                       {headerContent}
                      </th>
                     );
                    case 'direction':
                     return (
                      <th
                       key={column.key}
                       draggable={isClientLedgerEditMode}
                       onDragStart={isClientLedgerEditMode ? (event) => onLedgerColumnDragStart(event, column.key) : undefined}
                       onDragOver={isClientLedgerEditMode ? (event) => event.preventDefault() : undefined}
                       onDrop={isClientLedgerEditMode ? () => onLedgerColumnDrop(column.key) : undefined}
                       onDragEnd={isClientLedgerEditMode ? () => setDraggedLedgerColumn(null) : undefined}
                       className={headerClassName}
                      >
                       {headerContent}
                      </th>
                     );
                    case 'type':
                     return (
                      <th
                       key={column.key}
                       draggable={isClientLedgerEditMode}
                       onDragStart={isClientLedgerEditMode ? (event) => onLedgerColumnDragStart(event, column.key) : undefined}
                       onDragOver={isClientLedgerEditMode ? (event) => event.preventDefault() : undefined}
                       onDrop={isClientLedgerEditMode ? () => onLedgerColumnDrop(column.key) : undefined}
                       onDragEnd={isClientLedgerEditMode ? () => setDraggedLedgerColumn(null) : undefined}
                       className={headerClassName}
                      >
                       {headerContent}
                      </th>
                     );
                    case 'amount':
                     return (
                      <th
                       key={column.key}
                       draggable={isClientLedgerEditMode}
                       onDragStart={isClientLedgerEditMode ? (event) => onLedgerColumnDragStart(event, column.key) : undefined}
                       onDragOver={isClientLedgerEditMode ? (event) => event.preventDefault() : undefined}
                       onDrop={isClientLedgerEditMode ? () => onLedgerColumnDrop(column.key) : undefined}
                       onDragEnd={isClientLedgerEditMode ? () => setDraggedLedgerColumn(null) : undefined}
                       className={headerClassName}
                      >
                       {headerContent}
                      </th>
                     );
                    case 'exchangeRate':
                     return (
                      <th
                       key={column.key}
                       draggable={isClientLedgerEditMode}
                       onDragStart={isClientLedgerEditMode ? (event) => onLedgerColumnDragStart(event, column.key) : undefined}
                       onDragOver={isClientLedgerEditMode ? (event) => event.preventDefault() : undefined}
                       onDrop={isClientLedgerEditMode ? () => onLedgerColumnDrop(column.key) : undefined}
                       onDragEnd={isClientLedgerEditMode ? () => setDraggedLedgerColumn(null) : undefined}
                       className={headerClassName}
                      >
                       {headerContent}
                      </th>
                     );
                    case 'commission':
                     return (
                      <th
                       key={column.key}
                       draggable={isClientLedgerEditMode}
                       onDragStart={isClientLedgerEditMode ? (event) => onLedgerColumnDragStart(event, column.key) : undefined}
                       onDragOver={isClientLedgerEditMode ? (event) => event.preventDefault() : undefined}
                       onDrop={isClientLedgerEditMode ? () => onLedgerColumnDrop(column.key) : undefined}
                       onDragEnd={isClientLedgerEditMode ? () => setDraggedLedgerColumn(null) : undefined}
                       className={headerClassName}
                      >
                       {headerContent}
                      </th>
                     );
                    case 'netChange':
                     return (
                      <th
                       key={column.key}
                       draggable={isClientLedgerEditMode}
                       onDragStart={isClientLedgerEditMode ? (event) => onLedgerColumnDragStart(event, column.key) : undefined}
                       onDragOver={isClientLedgerEditMode ? (event) => event.preventDefault() : undefined}
                       onDrop={isClientLedgerEditMode ? () => onLedgerColumnDrop(column.key) : undefined}
                       onDragEnd={isClientLedgerEditMode ? () => setDraggedLedgerColumn(null) : undefined}
                       className={headerClassName}
                      >
                       {headerContent}
                      </th>
                     );
                    case 'runningBalance':
                     return (
                      <th
                       key={column.key}
                       draggable={isClientLedgerEditMode}
                       onDragStart={isClientLedgerEditMode ? (event) => onLedgerColumnDragStart(event, column.key) : undefined}
                       onDragOver={isClientLedgerEditMode ? (event) => event.preventDefault() : undefined}
                       onDrop={isClientLedgerEditMode ? () => onLedgerColumnDrop(column.key) : undefined}
                       onDragEnd={isClientLedgerEditMode ? () => setDraggedLedgerColumn(null) : undefined}
                       className={headerClassName}
                      >
                       {headerContent}
                      </th>
                     );
                    case 'description':
                     return (
                      <th
                       key={column.key}
                       draggable={isClientLedgerEditMode}
                       onDragStart={isClientLedgerEditMode ? (event) => onLedgerColumnDragStart(event, column.key) : undefined}
                       onDragOver={isClientLedgerEditMode ? (event) => event.preventDefault() : undefined}
                       onDrop={isClientLedgerEditMode ? () => onLedgerColumnDrop(column.key) : undefined}
                       onDragEnd={isClientLedgerEditMode ? () => setDraggedLedgerColumn(null) : undefined}
                       className={headerClassName}
                      >
                       {headerContent}
                      </th>
                     );
                   }
                  })}
                 </tr>
                </thead>
                <tbody>
                 {ledger.entries.map((entry) => (
                  <Fragment key={`${ledger.accountId}-${entry.transactionId}-${entry.direction}`}>
                   <tr className="border-t border-slate-200 align-top">
                    {(() => {
                     const draft = isClientLedgerEditMode ? getClientLedgerDraft(entry.transactionId, ledger.accountId) : null;

                     return orderedLedgerColumnOptions.map((column) => {
                      if (!ledgerColumnVisibility[column.key]) {
                       return null;
                      }

                      switch (column.key) {
                       case 'created':
                        return (
                         <td
                          key={column.key}
                          className="px-4 py-3 text-slate-500"
                         >
                          {isClientLedgerEditMode && draft ? (
                           <input
                            type="date"
                            value={draft.createdDate}
                            onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { createdDate: event.target.value })}
                            className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                           />
                          ) : (
                           new Date(entry.createdAt).toLocaleDateString(language)
                          )}
                         </td>
                        );
                       case 'counterparty':
                        return (
                         <td
                          key={column.key}
                          className="px-4 py-3 font-medium text-slate-900"
                         >
                          {isClientLedgerEditMode && draft ? (
                           <select
                            value={draft.counterpartyAccountId ?? ''}
                            onChange={(event) =>
                             updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { counterpartyAccountId: event.target.value ? Number(event.target.value) : null })
                            }
                            className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                           >
                            <option value="">{t('transaction_account_placeholder')}</option>
                            {clientAccounts
                             .filter((account) => account.id !== ledger.accountId)
                             .map((account) => (
                              <option
                               key={account.id}
                               value={account.id}
                              >
                               {account.clientName} - {account.currencySymbol || account.currencyCode}
                              </option>
                             ))}
                           </select>
                          ) : entry.counterpartyClientId ? (
                           <button
                            type="button"
                            onClick={() => {
                             const client = clients.find((c) => c.id === entry.counterpartyClientId);
                             if (client) openClientLedger(client, clientLedgerBackSection);
                            }}
                            className="font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 transition hover:text-blue-900"
                           >
                            {entry.counterpartyName}
                           </button>
                          ) : (
                           entry.counterpartyName
                          )}
                         </td>
                        );
                       case 'direction':
                        return (
                         <td
                          key={column.key}
                          className="px-4 py-3"
                         >
                          {isClientLedgerEditMode && draft ? (
                           <select
                            value={draft.direction}
                            onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { direction: event.target.value as 'incoming' | 'outgoing' })}
                            className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                           >
                            <option value="incoming">{t('incoming')}</option>
                            <option value="outgoing">{t('outgoing')}</option>
                           </select>
                          ) : (
                           <span
                            className={`inline-flex rounded px-2.5 py-1 text-xs font-semibold ${entry.direction === 'incoming' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}
                           >
                            {entry.direction === 'incoming' ? t('incoming') : t('outgoing')}
                           </span>
                          )}
                         </td>
                        );
                       case 'type':
                        return (
                         <td
                          key={column.key}
                          className="px-4 py-3 text-slate-600"
                         >
                          {isClientLedgerEditMode && draft ? (
                           <select
                            value={draft.type}
                            onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { type: event.target.value })}
                            className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                           >
                            <option value="exchange">{t('transaction_type_exchange')}</option>
                            <option value="transfer">{t('transaction_type_transfer')}</option>
                           </select>
                          ) : (
                           t(entry.type === 'transfer' ? 'transaction_type_transfer' : 'transaction_type_exchange')
                          )}
                         </td>
                        );
                       case 'amount':
                        return (
                         <td
                          key={column.key}
                          className="px-4 py-3 text-slate-700"
                         >
                          {isClientLedgerEditMode && draft ? (
                           <input
                            type="text"
                            inputMode="decimal"
                            dir="ltr"
                            value={draft.amount}
                            onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { amount: normalizeDecimalInput(event.target.value) })}
                            className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                           />
                          ) : (
                           <>
                            {entry.amount.toLocaleString(language, { maximumFractionDigits: 2 })}
                            {renderLedgerCurrencySuffix(entry.currencySymbol, entry.currencyCode)}
                           </>
                          )}
                         </td>
                        );
                       case 'exchangeRate':
                        return (
                         <td
                          key={column.key}
                          className="px-4 py-3 text-slate-600"
                         >
                          {isClientLedgerEditMode && draft
                           ? (() => {
                              const ledgerRateKey = `${entry.transactionId}:${ledger.accountId}`;
                              const isLedgerRateReversed = ledgerRateReversed[ledgerRateKey] ?? false;
                              const txCurr = entry.currencyCode;
                              const accCurr = ledger.currencyCode;
                              return (
                               <div>
                                {txCurr && accCurr && txCurr !== accCurr && (
                                 <div className="mb-1 flex items-center justify-between">
                                  <span className="text-xs text-slate-400">{isLedgerRateReversed ? `1 ${accCurr} = ? ${txCurr}` : `1 ${txCurr} = ? ${accCurr}`}</span>
                                  <button
                                   type="button"
                                   title="Reverse rate direction"
                                   onClick={() => {
                                    const val = parseFloat(draft.exchangeRate) || 1;
                                    updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { exchangeRate: (1 / val).toFixed(6).replace(/\.?0+$/, '') });
                                    setLedgerRateReversed((prev) => ({ ...prev, [ledgerRateKey]: !isLedgerRateReversed }));
                                   }}
                                   className="ml-1 rounded p-0.5 text-slate-400 hover:text-slate-700"
                                  >
                                   <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden
                                    width="14"
                                    height="14"
                                   >
                                    <path d="M7 4 3 8l4 4M3 8h13.5" />
                                    <path d="M17 20l4-4-4-4m4 4H7.5" />
                                   </svg>
                                  </button>
                                 </div>
                                )}
                                <input
                                 type="text"
                                 inputMode="decimal"
                                 dir="ltr"
                                 value={draft.exchangeRate}
                                 onChange={(event) =>
                                  updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { exchangeRate: normalizeDecimalInput(event.target.value) })
                                 }
                                 className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                                />
                               </div>
                              );
                             })()
                           : (() => {
                              const displayRateKey = `${entry.transactionId}:${ledger.accountId}`;
                              const txCurr = entry.currencyCode;
                              const accCurr = ledger.currencyCode;
                              const defaultReversed = entry.exchangeRateReversed;
                              const isReversed = ledgerDisplayRateReversed[displayRateKey] ?? defaultReversed;
                              if (!txCurr || !accCurr || txCurr === accCurr || entry.exchangeRate === 1) {
                               return entry.exchangeRate.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
                              }
                              const rateNumber = isReversed ? formatRateValue(1 / entry.exchangeRate) : formatRateValue(entry.exchangeRate);
                              const rateLabel = `\u202A${isReversed ? `1 ${accCurr} = ${rateNumber} ${txCurr}` : `1 ${txCurr} = ${rateNumber} ${accCurr}`}\u202C`;
                              return (
                               <div className="flex items-center gap-1">
                                <span title={rateLabel}>{rateNumber}</span>
                                <button
                                 type="button"
                                 title="Reverse rate direction"
                                 onClick={() => setLedgerDisplayRateReversed((prev) => ({ ...prev, [displayRateKey]: !isReversed }))}
                                 className="rounded p-0.5 text-slate-400 hover:text-slate-700"
                                >
                                 <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden
                                  width="14"
                                  height="14"
                                 >
                                  <path d="M7 4 3 8l4 4M3 8h13.5" />
                                  <path d="M17 20l4-4-4-4m4 4H7.5" />
                                 </svg>
                                </button>
                               </div>
                              );
                             })()}
                         </td>
                        );
                       case 'commission':
                        return (
                         <td
                          key={column.key}
                          className="px-4 py-3 text-slate-600"
                         >
                          {isClientLedgerEditMode && draft ? (
                           (() => {
                            const entryKey = `${entry.transactionId}:${ledger.accountId}`;
                            const isZero = parseFloat(draft.commission) === 0;
                            const expanded = ledgerCommissionExpandedEntries.has(entryKey);
                            if (isZero && !expanded) {
                             return (
                              <button
                               type="button"
                               onClick={() => setLedgerCommissionExpandedEntries((prev) => new Set([...prev, entryKey]))}
                               className="text-sm text-blue-600 hover:underline"
                              >
                               + {t('add_commission')}
                              </button>
                             );
                            }
                            return (
                             <input
                              type="text"
                              inputMode="decimal"
                              dir="ltr"
                              value={draft.commission}
                              onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { commission: normalizeDecimalInput(event.target.value) })}
                              className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                              placeholder="0"
                             />
                            );
                           })()
                          ) : entry.commission ? (
                           <>{entry.commission.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</>
                          ) : (
                           <span className="text-slate-400">â€”</span>
                          )}
                         </td>
                        );
                       case 'netChange':
                        return (
                         <td
                          key={column.key}
                          className={`px-4 py-3 font-semibold ${entry.netChange >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                         >
                          {entry.netChange.toLocaleString(language, { maximumFractionDigits: 2 })}
                          {renderLedgerCurrencySuffix(ledger.currencySymbol, ledger.currencyCode)}
                         </td>
                        );
                       case 'runningBalance':
                        return (
                         <td
                          key={column.key}
                          className={`px-4 py-3 font-semibold ${entry.runningBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                         >
                          {entry.runningBalance.toLocaleString(language, { maximumFractionDigits: 2 })}
                          {renderLedgerCurrencySuffix(ledger.currencySymbol, ledger.currencyCode)}
                         </td>
                        );
                       case 'description':
                        return (
                         <td
                          key={column.key}
                          className="px-4 py-3 text-slate-500"
                         >
                          {isClientLedgerEditMode && draft ? (
                           <input
                            type="text"
                            value={draft.description}
                            onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { description: event.target.value })}
                            className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                           />
                          ) : (
                           entry.description || '-'
                          )}
                         </td>
                        );
                      }
                     });
                    })()}
                   </tr>
                   {entry.charges > 0 && (
                    <tr
                     key={`${ledger.accountId}-${entry.transactionId}-${entry.direction}-charges`}
                     className="border-t border-dashed border-slate-200 bg-amber-50/60"
                    >
                     <td
                      colSpan={orderedLedgerColumnOptions.filter((c) => ledgerColumnVisibility[c.key]).length + 1}
                      className="px-4 py-2"
                     >
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                       <span className="font-medium text-amber-700">{t('charges')}</span>
                       <span className="font-semibold">
                        {entry.charges.toLocaleString(language, { maximumFractionDigits: 2 })}
                        {entry.chargesCurrencyCode ? ` ${entry.chargesCurrencyCode}` : ''}
                       </span>
                       {entry.chargesExchangeRate !== 1 && entry.chargesCurrencyCode && (
                        <span className="text-slate-400">@ {entry.chargesExchangeRate.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                       )}
                       {entry.chargesPayer && (
                        <span className="text-slate-500">
                         â€” {t('charges_payer_placeholder')}:{' '}
                         {entry.isChargesPayerThisAccount ? <strong className="text-amber-700">{ledger.currencyCode}</strong> : entry.counterpartyName}
                        </span>
                       )}
                       {entry.chargesDescription && <span className="italic text-slate-500">"{entry.chargesDescription}"</span>}
                      </div>
                     </td>
                    </tr>
                   )}
                  </Fragment>
                 ))}
                </tbody>
               </table>
              </div>
             )}
            </div>
           ))
         )}
        </section>
       ) : null}

       {section === 'currencies' ? currenciesReadOnlySection : null}

       {section === 'transactions' ? (
        <section className="flex flex-col gap-6 xl:flex-row xl:items-start">
         {isNewTransactionSectionOpen ? (
          <div className={`${panelClassName} xl:w-96 xl:shrink-0`}>
           <h2 className="text-xl font-semibold">{t('new_transaction')}</h2>
           <p className="mt-1 text-sm text-slate-600">{t('transactions_description')}</p>

           {pendingImportData ? (
            <div className="mt-5 rounded border border-blue-200 bg-blue-50/60 p-4">
             <p className="text-sm font-semibold text-blue-900">Import Setup: {pendingImportData.fileName}</p>
             <p className="mt-1 text-xs text-blue-700">Answer these questions before importing.</p>

             <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-sm text-slate-700">
               <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Where is the date column? (optional)</span>
               <select
                value={importMapping.dateColumn ?? ''}
                onChange={(event) =>
                 setImportMapping((current) => ({
                  ...current,
                  dateColumn: event.target.value === '' ? null : Number(event.target.value),
                 }))
                }
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
               >
                <option value="">No date column</option>
                {pendingImportData.columnOptions.map((option) => (
                 <option
                  key={option.index}
                  value={option.index}
                 >
                  {option.label}
                 </option>
                ))}
               </select>
              </label>

              <label className="text-sm text-slate-700">
               <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Where is the from column?</span>
               <select
                value={importMapping.fromColumn ?? ''}
                onChange={(event) =>
                 setImportMapping((current) => ({
                  ...current,
                  fromColumn: event.target.value === '' ? null : Number(event.target.value),
                 }))
                }
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
               >
                <option value="">Select from column</option>
                {pendingImportData.columnOptions.map((option) => (
                 <option
                  key={option.index}
                  value={option.index}
                 >
                  {option.label}
                 </option>
                ))}
               </select>
              </label>

              <label className="text-sm text-slate-700">
               <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Where is the to column?</span>
               <select
                value={importMapping.toColumn ?? ''}
                onChange={(event) =>
                 setImportMapping((current) => ({
                  ...current,
                  toColumn: event.target.value === '' ? null : Number(event.target.value),
                 }))
                }
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
               >
                <option value="">Select to column</option>
                {pendingImportData.columnOptions.map((option) => (
                 <option
                  key={option.index}
                  value={option.index}
                 >
                  {option.label}
                 </option>
                ))}
               </select>
              </label>

              <label className="text-sm text-slate-700">
               <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Where is the amount column?</span>
               <select
                value={importMapping.amountColumn ?? ''}
                onChange={(event) =>
                 setImportMapping((current) => ({
                  ...current,
                  amountColumn: event.target.value === '' ? null : Number(event.target.value),
                 }))
                }
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
               >
                <option value="">Select amount column</option>
                {pendingImportData.columnOptions.map((option) => (
                 <option
                  key={option.index}
                  value={option.index}
                 >
                  {option.label}
                 </option>
                ))}
               </select>
              </label>

              <label className="text-sm text-slate-700">
               <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Where is the description column? (optional)</span>
               <select
                value={importMapping.descriptionColumn ?? ''}
                onChange={(event) =>
                 setImportMapping((current) => ({
                  ...current,
                  descriptionColumn: event.target.value === '' ? null : Number(event.target.value),
                 }))
                }
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
               >
                <option value="">No description column</option>
                {pendingImportData.columnOptions.map((option) => (
                 <option
                  key={option.index}
                  value={option.index}
                 >
                  {option.label}
                 </option>
                ))}
               </select>
              </label>

              <label className="text-sm text-slate-700">
               <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Currency for all imported rows</span>
               <select
                value={importMapping.currencyId ?? ''}
                onChange={(event) =>
                 setImportMapping((current) => ({
                  ...current,
                  currencyId: event.target.value === '' ? null : Number(event.target.value),
                 }))
                }
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
               >
                <option value="">Select currency</option>
                {currencies.map((currency) => (
                 <option
                  key={currency.id}
                  value={currency.id}
                 >
                  {currency.code} - {currency.name}
                 </option>
                ))}
               </select>
              </label>
             </div>

             <div className="mt-4 flex flex-wrap gap-2">
              <button
               type="button"
               onClick={() => void onConfirmImportTransactions()}
               disabled={isImportingTransactions}
               className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
               {isImportingTransactions ? 'Importing...' : 'Import Now'}
              </button>
              <button
               type="button"
               onClick={onCancelImportTransactions}
               disabled={isImportingTransactions}
               className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
               Cancel Import
              </button>
             </div>
            </div>
           ) : null}

           <form
            onSubmit={onTransactionSubmit}
            className="mt-5 max-w-md"
           >
            <label className="block text-sm font-medium">
             {t('transaction_account_from')} <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-2">
             <input
              type="text"
              value={
               txFromOpen
                ? txFromQuery
                : transactionForm.accountFromId
                  ? (clientAccounts.find((a) => a.id === transactionForm.accountFromId)?.clientName ?? '') +
                    ' â€” ' +
                    (clientAccounts.find((a) => a.id === transactionForm.accountFromId)?.currencyCode ?? '')
                  : ''
              }
              onChange={(event) => {
               setTxFromQuery(event.target.value);
               setTxFromOpen(true);
              }}
              onFocus={() => {
               setTxFromQuery('');
               setTxFromOpen(true);
              }}
              onBlur={() => setTimeout(() => setTxFromOpen(false), 150)}
              placeholder={t('transaction_account_placeholder')}
              className="w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
              autoComplete="off"
             />
             {txFromOpen && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-slate-200 bg-white shadow-lg">
               {clientAccounts
                .filter((a) => !txFromQuery.trim() || `${a.clientName} ${a.currencyCode}`.toLowerCase().includes(txFromQuery.trim().toLowerCase()))
                .map((account) => (
                 <li
                  key={account.id}
                  onMouseDown={() => {
                   setTransactionForm((current) => ({ ...current, accountFromId: account.id }));
                   setTxFromQuery('');
                   setTxFromOpen(false);
                  }}
                  className={`cursor-pointer px-3 py-2 text-sm hover:bg-blue-50 ${transactionForm.accountFromId === account.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-800'}`}
                 >
                  {account.clientName} â€” {account.currencyCode}
                 </li>
                ))}
               {clientAccounts.filter((a) => !txFromQuery.trim() || `${a.clientName} ${a.currencyCode}`.toLowerCase().includes(txFromQuery.trim().toLowerCase())).length === 0 && (
                <li className="px-3 py-2 text-sm text-slate-400">{t('transaction_account_placeholder')}</li>
               )}
              </ul>
             )}
            </div>

            <label className="mt-4 block text-sm font-medium">
             {t('transaction_account_to')} <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-2">
             <input
              type="text"
              value={
               txToOpen
                ? txToQuery
                : transactionForm.accountToId
                  ? (clientAccounts.find((a) => a.id === transactionForm.accountToId)?.clientName ?? '') +
                    ' â€” ' +
                    (clientAccounts.find((a) => a.id === transactionForm.accountToId)?.currencyCode ?? '')
                  : ''
              }
              onChange={(event) => {
               setTxToQuery(event.target.value);
               setTxToOpen(true);
              }}
              onFocus={() => {
               setTxToQuery('');
               setTxToOpen(true);
              }}
              onBlur={() => setTimeout(() => setTxToOpen(false), 150)}
              placeholder={t('transaction_account_placeholder')}
              className="w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
              autoComplete="off"
             />
             {txToOpen && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-slate-200 bg-white shadow-lg">
               {clientAccounts
                .filter((a) => !txToQuery.trim() || `${a.clientName} ${a.currencyCode}`.toLowerCase().includes(txToQuery.trim().toLowerCase()))
                .map((account) => (
                 <li
                  key={account.id}
                  onMouseDown={() => {
                   setTransactionForm((current) => ({ ...current, accountToId: account.id }));
                   setTxToQuery('');
                   setTxToOpen(false);
                  }}
                  className={`cursor-pointer px-3 py-2 text-sm hover:bg-blue-50 ${transactionForm.accountToId === account.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-800'}`}
                 >
                  {account.clientName} â€” {account.currencyCode}
                 </li>
                ))}
               {clientAccounts.filter((a) => !txToQuery.trim() || `${a.clientName} ${a.currencyCode}`.toLowerCase().includes(txToQuery.trim().toLowerCase())).length === 0 && (
                <li className="px-3 py-2 text-sm text-slate-400">{t('transaction_account_placeholder')}</li>
               )}
              </ul>
             )}
            </div>

            <label className="mt-4 block text-sm font-medium">{t('transaction_type')}</label>
            <select
             value={transactionForm.type}
             onChange={(event) => setTransactionForm((current) => ({ ...current, type: event.target.value }))}
             className="mt-2 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
            >
             <option value="exchange">{t('transaction_type_exchange')}</option>
             <option value="transfer">{t('transaction_type_transfer')}</option>
            </select>

            <label className="mt-4 block text-sm font-medium">
             {t('transaction_amount')} <span className="text-red-500">*</span>
            </label>
            <div className="mt-2 flex gap-2">
             <input
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={transactionForm.amount}
              onChange={(event) => setTransactionForm((current) => ({ ...current, amount: normalizeDecimalInput(event.target.value) }))}
              className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
              placeholder="0.00"
              required
             />
             <select
              value={transactionForm.currencyId ?? ''}
              onChange={(event) =>
               setTransactionForm((current) => ({
                ...current,
                currencyId: event.target.value ? Number(event.target.value) : null,
               }))
              }
              className="w-28 rounded border border-slate-300 px-2 py-2 text-sm outline-none ring-blue-300 focus:ring"
              required
             >
              <option value="">{t('transaction_currency_placeholder')}</option>
              {enabledCurrencies.map((cur) => (
               <option
                key={cur.id}
                value={cur.id}
               >
                {cur.code}
               </option>
              ))}
             </select>
            </div>

            <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-4">
             <h3 className="text-sm font-semibold text-slate-700">{t('transaction_account_from')}</h3>
             <div className={`mt-2 grid gap-2 ${showExchangeRateFrom ? 'sm:grid-cols-2' : ''}`}>
              {showExchangeRateFrom && (
               <div>
                <div className="flex items-center justify-between">
                 <label className="block text-xs font-medium text-slate-500">
                  {transactionSelectedCurrencyCode && transactionAccountFromCurrencyCode
                   ? txFromRateReversed
                     ? `1 ${transactionAccountFromCurrencyCode} = ? ${transactionSelectedCurrencyCode}`
                     : `1 ${transactionSelectedCurrencyCode} = ? ${transactionAccountFromCurrencyCode}`
                   : t('transaction_exchange_rate_from')}
                 </label>
                 {transactionSelectedCurrencyCode && transactionAccountFromCurrencyCode && transactionSelectedCurrencyCode !== transactionAccountFromCurrencyCode && (
                  <button
                   type="button"
                   title="Reverse rate direction"
                   onClick={() => {
                    const val = parseFloat(transactionForm.exchangeRateFrom) || 1;
                    setTransactionForm((c) => ({ ...c, exchangeRateFrom: (1 / val).toFixed(6).replace(/\.?0+$/, '') }));
                    setTxFromRateReversed((r) => !r);
                   }}
                   className="ml-1 rounded p-0.5 text-slate-400 hover:text-slate-700"
                  >
                   <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    width="14"
                    height="14"
                   >
                    <path d="M7 4 3 8l4 4M3 8h13.5" />
                    <path d="M17 20l4-4-4-4m4 4H7.5" />
                   </svg>
                  </button>
                 )}
                </div>
                <input
                 type="text"
                 inputMode="decimal"
                 dir="ltr"
                 value={transactionForm.exchangeRateFrom}
                 onChange={(event) => setTransactionForm((current) => ({ ...current, exchangeRateFrom: normalizeDecimalInput(event.target.value) }))}
                 className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 placeholder="1"
                />
               </div>
              )}
              <div>
               <label className="block text-xs font-medium text-slate-500">{t('transaction_commission_from')} (%)</label>
               <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                value={transactionForm.commissionFrom}
                onChange={(event) => setTransactionForm((current) => ({ ...current, commissionFrom: normalizeDecimalInput(event.target.value) }))}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                placeholder="0"
               />
              </div>
             </div>
            </div>

            <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-4">
             <h3 className="text-sm font-semibold text-slate-700">{t('transaction_account_to')}</h3>
             <div className={`mt-2 grid gap-2 ${showExchangeRateTo ? 'sm:grid-cols-2' : ''}`}>
              {showExchangeRateTo && (
               <div>
                <div className="flex items-center justify-between">
                 <label className="block text-xs font-medium text-slate-500">
                  {transactionSelectedCurrencyCode && transactionAccountToCurrencyCode
                   ? txToRateReversed
                     ? `1 ${transactionAccountToCurrencyCode} = ? ${transactionSelectedCurrencyCode}`
                     : `1 ${transactionSelectedCurrencyCode} = ? ${transactionAccountToCurrencyCode}`
                   : t('transaction_exchange_rate_to')}
                 </label>
                 {transactionSelectedCurrencyCode && transactionAccountToCurrencyCode && transactionSelectedCurrencyCode !== transactionAccountToCurrencyCode && (
                  <button
                   type="button"
                   title="Reverse rate direction"
                   onClick={() => {
                    const val = parseFloat(transactionForm.exchangeRateTo) || 1;
                    setTransactionForm((c) => ({ ...c, exchangeRateTo: (1 / val).toFixed(6).replace(/\.?0+$/, '') }));
                    setTxToRateReversed((r) => !r);
                   }}
                   className="ml-1 rounded p-0.5 text-slate-400 hover:text-slate-700"
                  >
                   <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    width="14"
                    height="14"
                   >
                    <path d="M7 4 3 8l4 4M3 8h13.5" />
                    <path d="M17 20l4-4-4-4m4 4H7.5" />
                   </svg>
                  </button>
                 )}
                </div>
                <input
                 type="text"
                 inputMode="decimal"
                 dir="ltr"
                 value={transactionForm.exchangeRateTo}
                 onChange={(event) => setTransactionForm((current) => ({ ...current, exchangeRateTo: normalizeDecimalInput(event.target.value) }))}
                 className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 placeholder="1"
                />
               </div>
              )}
              <div>
               <label className="block text-xs font-medium text-slate-500">{t('transaction_commission_to')} (%)</label>
               <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                value={transactionForm.commissionTo}
                onChange={(event) => setTransactionForm((current) => ({ ...current, commissionTo: normalizeDecimalInput(event.target.value) }))}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                placeholder="0"
               />
              </div>
             </div>
            </div>

            <div className="mt-4">
             <button
              type="button"
              onClick={() => setIsNewTransactionExpensesOpen((prev) => !prev)}
              className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
             >
              <span>{isNewTransactionExpensesOpen ? 'â–¾' : 'â–¸'}</span>
              {t('extra_expenses')}
             </button>
             {isNewTransactionExpensesOpen && (
              <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-4">
               <div className="grid gap-2 sm:grid-cols-3">
                <input
                 type="text"
                 inputMode="decimal"
                 dir="ltr"
                 value={transactionForm.charges}
                 onChange={(event) => setTransactionForm((current) => ({ ...current, charges: normalizeDecimalInput(event.target.value) }))}
                 className="rounded border border-slate-300 bg-white px-3 py-2 outline-none ring-blue-300 focus:ring"
                 placeholder="0"
                />
                <select
                 value={transactionForm.chargesCurrencyId ?? ''}
                 onChange={(event) => setTransactionForm((current) => ({ ...current, chargesCurrencyId: event.target.value ? Number(event.target.value) : null }))}
                 className="rounded border border-slate-300 bg-white px-2 py-2 text-sm outline-none ring-blue-300 focus:ring"
                >
                 <option value="">{t('currency')}</option>
                 {enabledCurrencies.map((cur) => (
                  <option
                   key={cur.id}
                   value={cur.id}
                  >
                   {cur.code}
                  </option>
                 ))}
                </select>
                <select
                 value={transactionForm.chargesPayer}
                 onChange={(event) => setTransactionForm((current) => ({ ...current, chargesPayer: event.target.value }))}
                 className="rounded border border-slate-300 bg-white px-2 py-2 text-sm outline-none ring-blue-300 focus:ring"
                >
                 <option value="">{t('charges_payer_placeholder')}</option>
                 <option value="from">
                  {transactionForm.accountFromId
                   ? (clientAccountMap.get(transactionForm.accountFromId)?.clientName ?? t('transaction_account_from'))
                   : t('transaction_account_from')}
                 </option>
                 <option value="to">
                  {transactionForm.accountToId ? (clientAccountMap.get(transactionForm.accountToId)?.clientName ?? t('transaction_account_to')) : t('transaction_account_to')}
                 </option>
                </select>
               </div>
               {showChargesExchangeRate && (
                <div className="mt-2">
                 <label className="block text-xs font-medium text-slate-500">
                  {t('charges_exchange_rate')} ({chargesCurrencyCode} â†’ {chargesPayerAccountCurrencyCode})
                 </label>
                 <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={transactionForm.chargesExchangeRate}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, chargesExchangeRate: normalizeDecimalInput(event.target.value) }))}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 outline-none ring-blue-300 focus:ring"
                  placeholder="1"
                 />
                </div>
               )}
               <div className="mt-2">
                <label className="block text-xs font-medium text-slate-500">{t('charges_description')}</label>
                <input
                 type="text"
                 value={transactionForm.chargesDescription}
                 onChange={(event) => setTransactionForm((current) => ({ ...current, chargesDescription: event.target.value }))}
                 className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 placeholder={t('charges_description_placeholder')}
                />
               </div>
              </div>
             )}
            </div>

            <label className="mt-4 block text-sm font-medium">{t('transaction_description')}</label>
            <textarea
             value={transactionForm.description}
             onChange={(event) => setTransactionForm((current) => ({ ...current, description: event.target.value }))}
             className="mt-2 min-h-20 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
             placeholder={t('transaction_description_placeholder')}
            />

            <button
             type="submit"
             className="mt-6 w-full rounded bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800"
            >
             {t('save_transaction')}
            </button>
           </form>
          </div>
         ) : null}

         <div className={`${panelClassName} min-w-0 xl:flex-1`}>
          <div className="flex items-start justify-between gap-4">
           <h2 className="text-xl font-semibold">{t('transactions_title')}</h2>
           <div className="flex flex-wrap items-center gap-2">
            <input
             ref={transactionsImportInputRef}
             type="file"
             accept=".xlsx,.xls,.csv"
             onChange={onImportTransactionsFile}
             className="hidden"
            />
            <button
             type="button"
             onClick={() => transactionsImportInputRef.current?.click()}
             disabled={isImportingTransactions}
             className="cursor-pointer rounded border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
             {isImportingTransactions ? 'Importing...' : 'Import Sheet'}
            </button>
            {isTransactionsEditMode ? (
             <>
              <button
               type="button"
               onClick={() => void onSaveAllTransactionDrafts()}
               className="cursor-pointer rounded border border-emerald-500 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
              >
               {t('save_changes')}
              </button>
              <button
               type="button"
               onClick={cancelTransactionsEditMode}
               className="cursor-pointer rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
               {t('cancel')}
              </button>
             </>
            ) : null}
            <button
             type="button"
             onClick={() => (isTransactionsEditMode ? cancelTransactionsEditMode() : beginTransactionsEditMode())}
             className={`cursor-pointer rounded border px-4 py-2 text-sm font-semibold transition ${
              isTransactionsEditMode ? 'border-amber-500 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
             }`}
            >
             {isTransactionsEditMode ? t('transactions_done_editing') : t('transactions_edit_mode')}
            </button>
            {isTransactionsEditMode ? (
             <button
              type="button"
              onClick={() => void onDeleteSelectedTransactions()}
              className="cursor-pointer rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
             >
              Delete Selected
             </button>
            ) : null}
            <button
             type="button"
             onClick={() => setIsNewTransactionSectionOpen((current) => !current)}
             aria-expanded={isNewTransactionSectionOpen}
             title={isNewTransactionSectionOpen ? t('transactions_hide_new') : t('transactions_show_new')}
             className={`cursor-pointer rounded border p-2 transition ${
              isNewTransactionSectionOpen ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50' : 'border-blue-600 bg-blue-700 text-white hover:bg-blue-800'
             }`}
            >
             <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className="h-4 w-4"
              aria-hidden="true"
             >
              {isNewTransactionSectionOpen ? (
               <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
               />
              ) : (
               <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4v16M4 12h16"
               />
              )}
             </svg>
            </button>
           </div>
          </div>
          {transactionsPager}
          <div className={tableWrapClassName}>
           <table className="w-full text-sm">
            <colgroup>
             {isTransactionsEditMode ? <col className="w-[5%]" /> : null}
             <col className="w-[10%]" />
             <col className="w-[15%]" />
             <col className="w-[17%]" />
             <col className="w-[17%]" />
             <col className="w-[13%]" />
             <col className="w-[13%]" />
             <col className="w-[15%]" />
            </colgroup>
            <thead className="bg-slate-100 text-slate-700">
             <tr>
              {isTransactionsEditMode ? (
               <th className="px-4 py-3">
                <input
                 type="checkbox"
                 checked={paginatedTransactions.length > 0 && paginatedTransactions.every((transaction) => selectedTransactionIds.has(transaction.id))}
                 onChange={onToggleSelectAllTransactions}
                 aria-label="Select all transactions"
                 className="h-4 w-4 cursor-pointer rounded border-slate-300 text-blue-700 focus:ring-blue-500"
                />
               </th>
              ) : null}
              <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('date')}</th>
              <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_description')}</th>
              <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_account_from')}</th>
              <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_account_to')}</th>
              <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_amount')}</th>
              <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('charges')}</th>
              <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('commission')}</th>
             </tr>
            </thead>
            <tbody>
             {paginatedTransactions.map((txn) => (
              <tr
               key={txn.id}
               className="border-t border-slate-200 align-top"
              >
               {(() => {
                const draft = isTransactionsEditMode ? getTransactionTableDraft(txn.id) : null;

                return (
                 <>
                  {isTransactionsEditMode ? (
                   <td className="px-4 py-3 align-top">
                    <input
                     type="checkbox"
                     checked={selectedTransactionIds.has(txn.id)}
                     onChange={() => onToggleTransactionSelection(txn.id)}
                     aria-label={`Select transaction ${txn.id}`}
                     className="mt-1 h-4 w-4 cursor-pointer rounded border-slate-300 text-blue-700 focus:ring-blue-500"
                    />
                   </td>
                  ) : null}
                  <td className="px-4 py-3 text-slate-500">
                   {isTransactionsEditMode && draft ? (
                    <input
                     type="date"
                     value={draft.createdDate}
                     onChange={(event) => updateTransactionTableDraft(txn.id, { createdDate: event.target.value })}
                     className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                    />
                   ) : (
                    new Date(txn.createdAt).toLocaleDateString(language)
                   )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                   {isTransactionsEditMode && draft ? (
                    <input
                     type="text"
                     value={draft.description}
                     onChange={(event) => updateTransactionTableDraft(txn.id, { description: event.target.value })}
                     className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                     placeholder={t('transaction_description_placeholder')}
                    />
                   ) : (
                    txn.description || <span className="text-slate-400">â€”</span>
                   )}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                   {isTransactionsEditMode && draft ? (
                    <div className="space-y-2">
                     <select
                      value={draft.accountFromId ?? ''}
                      onChange={(event) => updateTransactionTableDraft(txn.id, { accountFromId: event.target.value ? Number(event.target.value) : null })}
                      className="min-w-40 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                     >
                      <option value="">{t('transaction_account_placeholder')}</option>
                      {clientAccounts.map((account) => (
                       <option
                        key={account.id}
                        value={account.id}
                       >
                        {account.clientName} - {account.currencySymbol || account.currencyCode}
                       </option>
                      ))}
                     </select>
                     {txn.currencyCode && txn.accountFromCurrencyCode && txn.currencyCode !== txn.accountFromCurrencyCode && (
                      <div className="flex items-center justify-between">
                       <span className="text-xs text-slate-400">
                        {tableRateFromReversed[txn.id] ? `1 ${txn.accountFromCurrencyCode} = ? ${txn.currencyCode}` : `1 ${txn.currencyCode} = ? ${txn.accountFromCurrencyCode}`}
                       </span>
                       <button
                        type="button"
                        title="Reverse rate direction"
                        onClick={() => {
                         const val = parseFloat(draft.exchangeRateFrom) || 1;
                         updateTransactionTableDraft(txn.id, { exchangeRateFrom: (1 / val).toFixed(6).replace(/\.?0+$/, '') });
                         setTableRateFromReversed((prev) => ({ ...prev, [txn.id]: !prev[txn.id] }));
                        }}
                        className="ml-1 rounded p-0.5 text-slate-400 hover:text-slate-700"
                       >
                        <svg
                         width="14"
                         height="14"
                         viewBox="0 0 24 24"
                         fill="none"
                         stroke="currentColor"
                         strokeWidth="1.8"
                         strokeLinecap="round"
                         strokeLinejoin="round"
                         aria-hidden
                         width="14"
                         height="14"
                        >
                         <path d="M7 4 3 8l4 4M3 8h13.5" />
                         <path d="M17 20l4-4-4-4m4 4H7.5" />
                        </svg>
                       </button>
                      </div>
                     )}
                     <input
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      value={draft.exchangeRateFrom}
                      onChange={(event) => updateTransactionTableDraft(txn.id, { exchangeRateFrom: normalizeDecimalInput(event.target.value) })}
                      className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                      placeholder={t('transaction_exchange_rate')}
                     />
                    </div>
                   ) : (
                    <>
                     {(() => {
                      const fromAccount = clientAccountMap.get(txn.accountFromId);
                      const fromClient = fromAccount ? clientMap.get(fromAccount.clientId) : null;

                      return fromClient ? (
                       <button
                        type="button"
                        onClick={() => openClientLedger(fromClient, 'clients')}
                        className="cursor-pointer text-left hover:text-blue-700 hover:underline"
                       >
                        {txn.clientFromName} <span className="text-xs font-normal text-slate-500">{txn.accountFromCurrencySymbol || txn.accountFromCurrencyCode}</span>
                       </button>
                      ) : (
                       <div>
                        {txn.clientFromName} <span className="text-xs font-normal text-slate-500">{txn.accountFromCurrencySymbol || txn.accountFromCurrencyCode}</span>
                       </div>
                      );
                     })()}
                     {txn.exchangeRateFrom !== 1 ? (
                      <div className="text-xs text-slate-500">
                       {t('transaction_exchange_rate')}:{' '}
                       {txn.exchangeRateFromReversed
                        ? `1 ${txn.accountFromCurrencyCode} = ${formatRateValue(1 / txn.exchangeRateFrom)} ${txn.currencyCode}`
                        : `1 ${txn.currencyCode} = ${formatRateValue(txn.exchangeRateFrom)} ${txn.accountFromCurrencyCode}`}
                      </div>
                     ) : null}
                    </>
                   )}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                   {isTransactionsEditMode && draft ? (
                    <div className="space-y-2">
                     <select
                      value={draft.accountToId ?? ''}
                      onChange={(event) => updateTransactionTableDraft(txn.id, { accountToId: event.target.value ? Number(event.target.value) : null })}
                      className="min-w-40 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                     >
                      <option value="">{t('transaction_account_placeholder')}</option>
                      {clientAccounts.map((account) => (
                       <option
                        key={account.id}
                        value={account.id}
                       >
                        {account.clientName} - {account.currencySymbol || account.currencyCode}
                       </option>
                      ))}
                     </select>
                     {txn.currencyCode && txn.accountToCurrencyCode && txn.currencyCode !== txn.accountToCurrencyCode && (
                      <div className="flex items-center justify-between">
                       <span className="text-xs text-slate-400">
                        {tableRateToReversed[txn.id] ? `1 ${txn.accountToCurrencyCode} = ? ${txn.currencyCode}` : `1 ${txn.currencyCode} = ? ${txn.accountToCurrencyCode}`}
                       </span>
                       <button
                        type="button"
                        title="Reverse rate direction"
                        onClick={() => {
                         const val = parseFloat(draft.exchangeRateTo) || 1;
                         updateTransactionTableDraft(txn.id, { exchangeRateTo: (1 / val).toFixed(6).replace(/\.?0+$/, '') });
                         setTableRateToReversed((prev) => ({ ...prev, [txn.id]: !prev[txn.id] }));
                        }}
                        className="ml-1 rounded p-0.5 text-slate-400 hover:text-slate-700"
                       >
                        <svg
                         width="14"
                         height="14"
                         viewBox="0 0 24 24"
                         fill="none"
                         stroke="currentColor"
                         strokeWidth="1.8"
                         strokeLinecap="round"
                         strokeLinejoin="round"
                         aria-hidden
                         width="14"
                         height="14"
                        >
                         <path d="M7 4 3 8l4 4M3 8h13.5" />
                         <path d="M17 20l4-4-4-4m4 4H7.5" />
                        </svg>
                       </button>
                      </div>
                     )}
                     <input
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      value={draft.exchangeRateTo}
                      onChange={(event) => updateTransactionTableDraft(txn.id, { exchangeRateTo: normalizeDecimalInput(event.target.value) })}
                      className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                      placeholder={t('transaction_exchange_rate')}
                     />
                    </div>
                   ) : (
                    <>
                     {(() => {
                      const toAccount = clientAccountMap.get(txn.accountToId);
                      const toClient = toAccount ? clientMap.get(toAccount.clientId) : null;

                      return toClient ? (
                       <button
                        type="button"
                        onClick={() => openClientLedger(toClient, 'clients')}
                        className="cursor-pointer text-left hover:text-blue-700 hover:underline"
                       >
                        {txn.clientToName} <span className="text-xs font-normal text-slate-500">{txn.accountToCurrencySymbol || txn.accountToCurrencyCode}</span>
                       </button>
                      ) : (
                       <div>
                        {txn.clientToName} <span className="text-xs font-normal text-slate-500">{txn.accountToCurrencySymbol || txn.accountToCurrencyCode}</span>
                       </div>
                      );
                     })()}
                     {txn.exchangeRateTo !== 1 ? (
                      <div className="text-xs text-slate-500">
                       {t('transaction_exchange_rate')}:{' '}
                       {txn.exchangeRateToReversed
                        ? `1 ${txn.accountToCurrencyCode} = ${formatRateValue(1 / txn.exchangeRateTo)} ${txn.currencyCode}`
                        : `1 ${txn.currencyCode} = ${formatRateValue(txn.exchangeRateTo)} ${txn.accountToCurrencyCode}`}
                      </div>
                     ) : null}
                    </>
                   )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                   {isTransactionsEditMode && draft ? (
                    <div className="flex gap-2">
                     <input
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      value={draft.amount}
                      onChange={(event) => updateTransactionTableDraft(txn.id, { amount: normalizeDecimalInput(event.target.value) })}
                      className="min-w-0 w-28 rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                     />
                     <select
                      value={draft.currencyId ?? ''}
                      onChange={(event) => updateTransactionTableDraft(txn.id, { currencyId: event.target.value ? Number(event.target.value) : null })}
                      className="w-20 rounded border border-slate-300 px-2 py-2 text-sm outline-none ring-blue-300 focus:ring"
                     >
                      <option value="">{t('transaction_currency_placeholder')}</option>
                      {enabledCurrencies.map((currency) => (
                       <option
                        key={currency.id}
                        value={currency.id}
                       >
                        {currency.code}
                       </option>
                      ))}
                     </select>
                    </div>
                   ) : (
                    <>
                     <span className="font-semibold">{txn.amount.toLocaleString()}</span> <span className="text-slate-500">{txn.currencySymbol || txn.currencyCode}</span>
                    </>
                   )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                   {isTransactionsEditMode && draft ? (
                    (() => {
                     const isZero = parseFloat(draft.charges) === 0;
                     const expanded = expensesExpandedTxns.has(txn.id);
                     if (isZero && !expanded) {
                      return (
                       <button
                        type="button"
                        onClick={() => setExpensesExpandedTxns((prev) => new Set([...prev, txn.id]))}
                        className="text-sm text-blue-600 hover:underline"
                       >
                        + {t('add_expenses')}
                       </button>
                      );
                     }
                     return (
                      <div className="space-y-1">
                       <input
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        value={draft.charges}
                        onChange={(event) => updateTransactionTableDraft(txn.id, { charges: normalizeDecimalInput(event.target.value) })}
                        className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                        placeholder="0"
                       />
                       <select
                        value={draft.chargesCurrencyId ?? ''}
                        onChange={(event) => updateTransactionTableDraft(txn.id, { chargesCurrencyId: event.target.value ? Number(event.target.value) : null })}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                       >
                        <option value="">{t('currency')}</option>
                        {enabledCurrencies.map((cur) => (
                         <option
                          key={cur.id}
                          value={cur.id}
                         >
                          {cur.code}
                         </option>
                        ))}
                       </select>
                       <select
                        value={draft.chargesPayer}
                        onChange={(event) => updateTransactionTableDraft(txn.id, { chargesPayer: event.target.value })}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                       >
                        <option value="">{t('charges_payer_placeholder')}</option>
                        <option value="from">{txn.clientFromName}</option>
                        <option value="to">{txn.clientToName}</option>
                       </select>
                       {(() => {
                        const draftChargesCurrencyCode = draft.chargesCurrencyId ? currencyMap.get(draft.chargesCurrencyId)?.code : undefined;
                        const draftPayerAccountCurrencyCode =
                         draft.chargesPayer === 'from' ? txn.accountFromCurrencyCode : draft.chargesPayer === 'to' ? txn.accountToCurrencyCode : undefined;
                        if (!draftChargesCurrencyCode || !draftPayerAccountCurrencyCode || draftChargesCurrencyCode === draftPayerAccountCurrencyCode) return null;
                        return (
                         <div>
                          <span className="text-xs text-slate-500">
                           {draftChargesCurrencyCode} â†’ {draftPayerAccountCurrencyCode}
                          </span>
                          <input
                           type="text"
                           inputMode="decimal"
                           dir="ltr"
                           value={draft.chargesExchangeRate}
                           onChange={(event) => updateTransactionTableDraft(txn.id, { chargesExchangeRate: normalizeDecimalInput(event.target.value) })}
                           className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                           placeholder="1"
                          />
                         </div>
                        );
                       })()}
                       <div className="mt-1">
                        <input
                         type="text"
                         value={draft.chargesDescription}
                         onChange={(event) => updateTransactionTableDraft(txn.id, { chargesDescription: event.target.value })}
                         className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                         placeholder={t('charges_description_placeholder')}
                        />
                       </div>
                      </div>
                     );
                    })()
                   ) : txn.charges ? (
                    <div>
                     <span>{txn.charges.toLocaleString()}</span>
                     {txn.chargesCurrencyCode && <span className="text-slate-500"> {txn.chargesCurrencyCode}</span>}
                     {txn.chargesExchangeRate !== 1 && txn.chargesCurrencyCode && <div className="text-xs text-slate-400">@ {txn.chargesExchangeRate.toFixed(4)}</div>}
                     {txn.chargesPayer && (
                      <div className="text-xs text-slate-500">{txn.chargesPayer === 'from' ? txn.clientFromName : txn.chargesPayer === 'to' ? txn.clientToName : ''}</div>
                     )}
                     {txn.chargesDescription && <div className="text-xs italic text-slate-400">{txn.chargesDescription}</div>}
                    </div>
                   ) : (
                    <span className="text-slate-400">â€”</span>
                   )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                   {isTransactionsEditMode && draft
                    ? (() => {
                       const bothZero = parseFloat(draft.commissionFrom) === 0 && parseFloat(draft.commissionTo) === 0;
                       const expanded = commissionExpandedTxns.has(txn.id);
                       if (bothZero && !expanded) {
                        return (
                         <div className="flex items-center gap-2">
                          <button
                           type="button"
                           onClick={() => setCommissionExpandedTxns((prev) => new Set([...prev, txn.id]))}
                           className="text-sm text-blue-600 hover:underline"
                          >
                           + {t('add_commission')}
                          </button>
                          <button
                           type="button"
                           onClick={() => onDeleteTransaction(txn.id)}
                           className="inline-flex shrink-0 items-center gap-1 rounded border-2 border-red-700 bg-red-700 px-2.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-red-800"
                           title={t('delete')}
                          >
                           <svg
                            className="h-4 w-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.8}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                           >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4h6v2" />
                           </svg>
                           <span className="text-xs font-semibold">{t('delete')}</span>
                          </button>
                         </div>
                        );
                       }
                       return (
                        <div className="space-y-2">
                         <div className="flex items-center gap-2">
                          <span className="shrink-0 text-xs text-slate-500">{txn.clientFromName}:</span>
                          <input
                           type="text"
                           inputMode="decimal"
                           dir="ltr"
                           value={draft.commissionFrom}
                           onChange={(event) => updateTransactionTableDraft(txn.id, { commissionFrom: normalizeDecimalInput(event.target.value) })}
                           className="min-w-0 w-20 rounded border border-slate-300 px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                           placeholder="0"
                          />
                          <span className="text-xs text-slate-400">%</span>
                         </div>
                         <div className="flex items-center gap-2">
                          <span className="shrink-0 text-xs text-slate-500">{txn.clientToName}:</span>
                          <input
                           type="text"
                           inputMode="decimal"
                           dir="ltr"
                           value={draft.commissionTo}
                           onChange={(event) => updateTransactionTableDraft(txn.id, { commissionTo: normalizeDecimalInput(event.target.value) })}
                           className="min-w-0 w-20 rounded border border-slate-300 px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                           placeholder="0"
                          />
                          <span className="text-xs text-slate-400">%</span>
                         </div>
                         <div className="flex items-center gap-2">
                          <button
                           type="button"
                           onClick={() => onDeleteTransaction(txn.id)}
                           className="inline-flex shrink-0 items-center gap-1 rounded border-2 border-red-700 bg-red-700 px-2.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-red-800"
                           title={t('delete')}
                          >
                           <svg
                            className="h-4 w-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.8}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                           >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4h6v2" />
                           </svg>
                           <span className="text-xs font-semibold">{t('delete')}</span>
                          </button>
                         </div>
                        </div>
                       );
                      })()
                    : (() => {
                       const parts: string[] = [];
                       if (txn.commissionFrom) parts.push(`${txn.clientFromName}: ${txn.commissionFrom.toFixed(2)}%`);
                       if (txn.commissionTo) parts.push(`${txn.clientToName}: ${txn.commissionTo.toFixed(2)}%`);
                       return parts.length > 0 ? (
                        <div className="space-y-0.5 text-xs">
                         {parts.map((p, i) => (
                          <div key={i}>{p}</div>
                         ))}
                        </div>
                       ) : (
                        <span className="text-slate-400">â€”</span>
                       );
                      })()}
                  </td>
                 </>
                );
               })()}
              </tr>
             ))}
             {transactions.length === 0 ? (
              <tr>
               <td
                className="px-4 py-6 text-slate-500"
                colSpan={isTransactionsEditMode ? 8 : 7}
               >
                {t('no_transactions')}
               </td>
              </tr>
             ) : null}
            </tbody>
           </table>
          </div>
          {transactionsPager}
         </div>
        </section>
       ) : null}
      </div>
     ) : null}
    </div>
   </main>

   {pdfExportModal
    ? (() => {
       const ledger = selectedClientLedgers.find((l) => l.accountId === pdfExportModal.accountId);
       if (!ledger) return null;
       return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
         <div className="w-full max-w-md rounded bg-white p-6 shadow-2xl">
          <h3 className="text-lg font-semibold text-slate-900">{t('export_pdf_title')}</h3>
          <p className="mt-1 text-sm text-slate-500">
           {selectedClientForLedger?.name} &mdash; {ledger.currencyName}
          </p>

          <div className="mt-5 flex flex-col gap-4">
           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('export_date_from')}</label>
            <input
             type="date"
             value={pdfExportModal.fromDate}
             onChange={(e) => setPdfExportModal((prev) => (prev ? { ...prev, fromDate: e.target.value } : prev))}
             className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
           </div>
           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('export_date_to')}</label>
            <input
             type="date"
             value={pdfExportModal.toDate}
             onChange={(e) => setPdfExportModal((prev) => (prev ? { ...prev, toDate: e.target.value } : prev))}
             className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
           </div>

           {(() => {
            const preBalance = ledger.startingBalance + ledger.entries.filter((e) => e.createdAt.slice(0, 10) < pdfExportModal.fromDate).reduce((sum, e) => sum + e.netChange, 0);
            const count = ledger.entries.filter((e) => {
             const d = e.createdAt.slice(0, 10);
             return d >= pdfExportModal.fromDate && d <= pdfExportModal.toDate;
            }).length;
            return (
             <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <div className="flex justify-between">
               <span className="text-slate-500">{t('export_pre_balance')}</span>
               <span className={`font-semibold ${preBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {preBalance.toLocaleString(language, { maximumFractionDigits: 2 })} {ledger.currencySymbol || ledger.currencyCode}
               </span>
              </div>
              <div className="mt-1 flex justify-between">
               <span className="text-slate-500">{t('client_page_transaction_count')}</span>
               <span className="font-semibold text-slate-900">{count}</span>
              </div>
             </div>
            );
           })()}
          </div>

          <div className="mt-5 flex justify-end gap-2">
           <button
            type="button"
            onClick={() => setPdfExportModal(null)}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
           >
            {t('cancel')}
           </button>
           <button
            type="button"
            onClick={() => void onExportLedgerPdf(ledger, pdfExportModal.fromDate, pdfExportModal.toDate)}
            disabled={!pdfExportModal.fromDate || !pdfExportModal.toDate || pdfExportModal.fromDate > pdfExportModal.toDate}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
           >
            {t('export_pdf')}
           </button>
          </div>
         </div>
        </div>
       );
      })()
    : null}
  </div>
 );
}

export default function Home() {
 const { status } = useSession();

 if (status === 'loading') {
  return null;
 }

 if (status !== 'authenticated') {
  return <LoginPage />;
 }

 return <AuthenticatedHome />;
}
