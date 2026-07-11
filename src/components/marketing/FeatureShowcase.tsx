'use client';

import { ReactNode } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { MarketingMockup } from '@/components/marketing/MarketingMockup';
import {
 LedgerMockup,
 TransactionsMockup,
 OverviewMockup,
 ExportsMockup,
 TeamMockup,
 RatesMockup,
 MobileMockup,
} from '@/components/marketing/Mockups';

type Row = {
 slot: string;
 mockup: ReactNode;
 titleKey: string;
 bodyKey: string;
 bulletKeys: string[];
};

const ROWS: Row[] = [
 {
  slot: 'mobile',
  mockup: <MobileMockup />,
  titleKey: 'home_show_mobile_title',
  bodyKey: 'home_show_mobile_body',
  bulletKeys: ['home_show_mobile_b1', 'home_show_mobile_b2', 'home_show_mobile_b3'],
 },
 {
  slot: 'ledgers',
  mockup: <LedgerMockup />,
  titleKey: 'home_show_ledgers_title',
  bodyKey: 'home_show_ledgers_body',
  bulletKeys: ['home_show_ledgers_b1', 'home_show_ledgers_b2', 'home_show_ledgers_b3'],
 },
 {
  slot: 'transactions',
  mockup: <TransactionsMockup />,
  titleKey: 'home_show_tx_title',
  bodyKey: 'home_show_tx_body',
  bulletKeys: ['home_show_tx_b1', 'home_show_tx_b2', 'home_show_tx_b3'],
 },
 {
  slot: 'overview',
  mockup: <OverviewMockup />,
  titleKey: 'home_show_overview_title',
  bodyKey: 'home_show_overview_body',
  bulletKeys: ['home_show_overview_b1', 'home_show_overview_b2', 'home_show_overview_b3'],
 },
 {
  slot: 'exports',
  mockup: <ExportsMockup />,
  titleKey: 'home_show_exports_title',
  bodyKey: 'home_show_exports_body',
  bulletKeys: ['home_show_exports_b1', 'home_show_exports_b2', 'home_show_exports_b3'],
 },
 {
  slot: 'workspaces',
  mockup: <TeamMockup />,
  titleKey: 'home_show_team_title',
  bodyKey: 'home_show_team_body',
  bulletKeys: ['home_show_team_b1', 'home_show_team_b2', 'home_show_team_b3'],
 },
 {
  slot: 'liverates',
  mockup: <RatesMockup />,
  titleKey: 'home_show_rates_title',
  bodyKey: 'home_show_rates_body',
  bulletKeys: ['home_show_rates_b1', 'home_show_rates_b2', 'home_show_rates_b3'],
 },
];

function CheckIcon() {
 return (
  <svg
   className="mt-0.5 h-4 w-4 shrink-0 text-blue-600"
   viewBox="0 0 24 24"
   fill="none"
   stroke="currentColor"
   strokeWidth="2.5"
   strokeLinecap="round"
   strokeLinejoin="round"
   aria-hidden
  >
   <polyline points="20 6 9 17 4 12" />
  </svg>
 );
}

export default function FeatureShowcase() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <section className="bg-white">
   <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-20">
    <div className="mx-auto max-w-2xl text-center">
     <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">{t('home_features_eyebrow')}</span>
     <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{t('home_features_title')}</h2>
     <p className="mt-3 text-base text-gray-600">{t('home_features_subtitle')}</p>
    </div>

    <div className="mt-14 space-y-16 sm:space-y-24">
     {ROWS.map((row, i) => {
      const reversed = i % 2 === 1;
      return (
       <div key={row.slot} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
        <div className={reversed ? 'lg:order-2' : ''}>
         <h3 className="text-2xl font-bold tracking-tight text-gray-900">{t(row.titleKey)}</h3>
         <p className="mt-3 text-base text-gray-600">{t(row.bodyKey)}</p>
         <ul className="mt-5 space-y-2.5">
          {row.bulletKeys.map((key) => (
           <li key={key} className="flex items-start gap-2.5 text-sm text-gray-700">
            <CheckIcon />
            <span>{t(key)}</span>
           </li>
          ))}
         </ul>
        </div>
        <MarketingMockup slot={row.slot} className={`w-full max-w-md ${reversed ? 'lg:order-1' : ''} mx-auto`}>
         {row.mockup}
        </MarketingMockup>
       </div>
      );
     })}
    </div>
   </div>
  </section>
 );
}
