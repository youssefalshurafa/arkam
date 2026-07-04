'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName } from '@/shared/styles';

type DangerZoneProps = {
 transactionCount: number;
 clientCount: number;
 onDeleteAllTransactions: () => void;
 onDeleteAllClients: () => void;
};

export default function DangerZone({ transactionCount, clientCount, onDeleteAllTransactions, onDeleteAllClients }: DangerZoneProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 return (
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
       {t('overview_transactions')}: {transactionCount}
      </p>
      <button
       type="button"
       onClick={() => void onDeleteAllTransactions()}
       disabled={!transactionCount}
       className="mt-4 rounded border border-red-300 bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
       {t('danger_delete_all_transactions')}
      </button>
     </div>

     <div className="rounded border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{t('danger_delete_all_clients')}</h3>
      <p className="mt-1 text-sm text-slate-600">{t('danger_delete_all_clients_hint')}</p>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
       {t('overview_clients')}: {clientCount}
      </p>
      <button
       type="button"
       onClick={() => void onDeleteAllClients()}
       disabled={!clientCount}
       className="mt-4 rounded border border-red-300 bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
       {t('danger_delete_all_clients')}
      </button>
     </div>
    </div>
   </div>
  </section>
 );
}
