import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('@/server/db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const appLike = {
 getPath(name: string) {
  const root = process.cwd();

  if (name === 'userData') {
   return path.join(root, 'database');
  }

  if (name === 'documents' || name === 'temp') {
   return root;
  }

  return root;
 },
};

type Body = {
 action?: string;
 payload?: unknown;
};

export async function POST(request: NextRequest) {
 try {
  const body = (await request.json()) as Body;
  const action = body.action;
  const payload = body.payload as never;

  if (!action) {
   return NextResponse.json({ error: 'Missing action.' }, { status: 400 });
  }

  switch (action) {
   case 'getDbInfo':
    return NextResponse.json(db.getDbInfo(appLike));
   case 'setDbDirectory':
    return NextResponse.json(db.setDbDirectory(appLike, payload));
   case 'listOrganizations':
    return NextResponse.json(db.listOrganizations(appLike));
   case 'createOrganization':
    db.createOrganization(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'updateOrganization':
    db.updateOrganization(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteOrganization':
    db.deleteOrganization(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'listClients':
    return NextResponse.json(db.listClients(appLike));
   case 'createClient':
    db.createClient(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'updateClient':
    db.updateClient(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteClient':
    db.deleteClient(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteAllClients':
    db.deleteAllClients(appLike);
    return NextResponse.json({ ok: true });
   case 'listAllClientAccounts':
    return NextResponse.json(db.listAllClientAccounts(appLike));
   case 'listClientAccounts':
    return NextResponse.json(db.listClientAccounts(appLike, payload));
   case 'createClientAccount':
    db.createClientAccount(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'updateClientAccountStartingBalance':
    db.updateClientAccountStartingBalance(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteClientAccount':
    db.deleteClientAccount(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'listCurrencies':
    return NextResponse.json(db.listCurrencies(appLike));
   case 'createCurrency':
    db.createCurrency(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'updateCurrency':
    db.updateCurrency(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteCurrency':
    db.deleteCurrency(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteAllCurrencies':
    db.deleteAllCurrencies(appLike);
    return NextResponse.json({ ok: true });
   case 'reseedCurrencies':
    db.reseedCurrencies(appLike);
    return NextResponse.json({ ok: true });
   case 'enableCurrency':
    db.enableCurrency(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'disableCurrency':
    db.disableCurrency(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'setMainCurrency':
    db.setMainCurrency(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'listTransactions':
    return NextResponse.json(db.listTransactions(appLike));
   case 'createTransaction':
    db.createTransaction(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'updateTransaction':
    db.updateTransaction(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteTransaction':
    db.deleteTransaction(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteAllTransactions':
    db.deleteAllTransactions(appLike);
    return NextResponse.json({ ok: true });
   default:
    return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
  }
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  return NextResponse.json({ error: message }, { status: 500 });
 }
}
