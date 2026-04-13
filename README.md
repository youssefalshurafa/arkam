# Arkam Accounting Desktop App

This starter project uses:

- Next.js + Tailwind CSS for UI
- Electron for desktop runtime and `.exe` packaging
- SQLite (`better-sqlite3`) for local on-drive storage

## 1. Install dependencies

```bash
npm install
```

## 2. Run in desktop development mode

```bash
npm run dev
```

This starts:

- Next.js dev server on `http://localhost:3000`
- Electron window that loads the Next app

## 3. Build production web assets

```bash
npm run build
```

This generates static files in `out/`.

## 4. Build Windows installer (`.exe`)

```bash
npm run build:desktop
```

Output is generated in `release/`.

## Local database location

The app creates SQLite at first run:

- Default install mode: `%APPDATA%`/app-specific user data folder under `data/accounting.sqlite`
- Portable mode: if `PORTABLE_EXECUTABLE_DIR` exists, database is created near the executable under `data/accounting.sqlite`

## Current starter scope

Implemented now:

- Electron secure preload bridge
- Local SQLite initialization and schema creation
- Basic chart of accounts insert/list UI

Suggested next modules:

1. Journal entries + journal lines
2. Ledger posting workflow with transaction validation
3. Customers, vendors, invoices, and payments
4. Backup/restore database actions
