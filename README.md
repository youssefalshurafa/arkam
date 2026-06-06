# Arkam Accounting Web App

This starter project uses:

- Next.js + Tailwind CSS for UI
- PostgreSQL (`pg`) for persistent storage

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment

Create `.env.local` from `.env.example` and set at least:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/arkam
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=replace-with-a-long-random-secret
```

Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` only if you want Google sign-in.

## 3. Run in development mode

```bash
npm run dev
```

This starts the Next.js dev server on `http://localhost:3000`.

## 4. Build production assets

```bash
npm run build
```

## Authentication and Workspaces

- Signup page: `/signup`
- Credentials signup (email/password) and Google sign-in are supported.
- Set `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` in your environment.
- Example environment variables are in `.env.example`.

## Database layout

- Authentication and workspace membership live in the default PostgreSQL schema.
- Accounting data is isolated per workspace in PostgreSQL schemas named `workspace_<workspaceId>`.
- Schemas and tables are created automatically on first use.

## Workspace roles

Each workspace supports these roles:

- `owner`: full access and member management
- `admin`: full data access and member management
- `member`: full data access
- `viewer`: read-only access

## Current starter scope

Implemented now:

- Next.js API bridge for data operations
- PostgreSQL initialization and workspace schema creation
- Basic accounting management UI

Suggested next modules:

1. Journal entries + journal lines
2. Ledger posting workflow with transaction validation
3. Customers, vendors, invoices, and payments
4. Backup/restore database actions
