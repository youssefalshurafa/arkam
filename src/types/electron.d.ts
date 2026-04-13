export {};

declare global {
 interface Window {
  accountingApi?: {
   getDbInfo: () => Promise<{ dbPath: string }>;
   listAccounts: () => Promise<
    Array<{
     id: number;
     code: string;
     name: string;
     createdAt: string;
    }>
   >;
   addAccount: (code: string, name: string) => Promise<{ ok: true }>;
  };
 }
}
