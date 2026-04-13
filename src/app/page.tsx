'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

type Account = {
  id: number;
  code: string;
  name: string;
  createdAt: string;
};

type DbInfo = {
  dbPath: string;
};

export default function Home() {
  const { language, setLanguage, isRTL } = useLanguage();
  const { t } = useTranslation(language);
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  async function loadData() {
    if (!window.accountingApi) {
      setError(t('error_bridge'));
      return;
    }

    try {
      const [db, rows] = await Promise.all([
        window.accountingApi.getDbInfo(),
        window.accountingApi.listAccounts(),
      ]);

      setDbInfo(db);
      setAccounts(rows);
      setError('');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t('error_failed_load')
      );
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.accountingApi) {
      setError(t('error_bridge'));
      return;
    }

    if (!code.trim() || !name.trim()) {
      setError(t('error_required'));
      return;
    }

    try {
      await window.accountingApi.addAccount(code.trim(), name.trim());
      setCode('');
      setName('');
      await loadData();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t('error_failed_save')
      );
    }
  }

  return (
    <div className={`min-h-screen bg-slate-100 text-slate-900 ${isRTL ? 'rtl' : 'ltr'}`}>
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        {/* Language Switcher */}
        <div className="flex justify-end gap-2">
          <label className="text-xs font-medium text-slate-600">{t('select_language')}:</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as 'en' | 'ar' | 'fr')}
            className="rounded-lg border border-slate-300 px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="en">{t('english')}</option>
            <option value="ar">{t('arabic')}</option>
            <option value="fr">{t('french')}</option>
          </select>
        </div>

        <header className="rounded-2xl bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Arkam</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{t('app_title')}</h1>
          <p className="mt-2 text-sm text-slate-600">{t('app_description')}</p>
          <p className="mt-3 text-xs text-slate-500">
            {t('database_file')} <span className="font-mono">{dbInfo?.dbPath ?? t('loading')}</span>
          </p>
        </header>

        <section className={`grid gap-6 ${isRTL ? 'lg:grid-cols-[1fr_360px]' : 'lg:grid-cols-[360px_1fr]'}`}>
          <form
            onSubmit={onSubmit}
            className="rounded-2xl bg-white p-6 shadow-sm"
          >
            <h2 className="text-xl font-semibold">{t('add_chart_account')}</h2>
            <p className="mt-1 text-sm text-slate-600">{t('example')}</p>

            <label className="mt-5 block text-sm font-medium">{t('account_code')}</label>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
              placeholder={t('account_code_placeholder')}
              required
            />

            <label className="mt-4 block text-sm font-medium">{t('account_name')}</label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
              placeholder={t('account_name_placeholder')}
              required
            />

            <button
              type="submit"
              className="mt-6 w-full rounded-lg bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800"
            >
              {t('save_account')}
            </button>

            {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
          </form>

          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">{t('chart_of_accounts')}</h2>
            <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>
                      {t('code')}
                    </th>
                    <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>
                      {t('name')}
                    </th>
                    <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>
                      {t('created')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.id} className="border-t border-slate-200">
                      <td className="px-4 py-3 font-mono">{account.code}</td>
                      <td className="px-4 py-3">{account.name}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(account.createdAt).toLocaleString(language)}
                      </td>
                    </tr>
                  ))}
                  {accounts.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-slate-500 text-center" colSpan={3}>
                        {t('no_accounts')}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
