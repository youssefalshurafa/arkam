# Arkam Accounting Web App

This starter project uses:

- Next.js + Tailwind CSS for UI
- SQLite (`better-sqlite3`) for local on-drive storage

## 1. Install dependencies

```bash
npm install
```

## 2. Run in development mode

```bash
npm run dev
```

This starts the Next.js dev server on `http://localhost:3000`.

## 3. Build production assets

```bash
npm run build
```

## Local database location

The app creates SQLite at first run in `database/data/accounting.sqlite`.

## Current starter scope

Implemented now:

- Next.js API bridge for data operations
- Local SQLite initialization and schema creation
- Basic accounting management UI

Suggested next modules:

1. Journal entries + journal lines
2. Ledger posting workflow with transaction validation
3. Customers, vendors, invoices, and payments
4. Backup/restore database actions
