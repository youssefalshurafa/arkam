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

## Authentication and Workspaces

- Signup page: `/signup`
- Credentials signup (email/password) and Google sign-in are supported.
- Set `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` in your environment.
- Example environment variables are in `.env.example`.

## Local database location

- User/account metadata is stored in `database/auth/accounts.sqlite`.
- Accounting data is workspace-isolated and stored per workspace in `database/data/workspaces/<workspaceId>/accounting.sqlite`.

## Workspace roles

Each workspace supports these roles:

- `owner`: full access and member management
- `admin`: full data access and member management
- `member`: full data access
- `viewer`: read-only access

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
