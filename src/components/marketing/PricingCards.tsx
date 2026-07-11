'use client';

import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { PLAN_TIERS, PLAN_FEATURES } from '@/config/plan';

export default function PricingCards() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <div className="mx-auto grid w-full max-w-5xl gap-6 md:grid-cols-3">
   {PLAN_TIERS.map((tier) => {
    const saved = tier.originalUsdt ? tier.originalUsdt - tier.priceUsdt : 0;
    return (
     <div
      key={tier.id}
      className={`relative flex flex-col overflow-hidden rounded-2xl bg-white ${
       tier.highlight
        ? 'border-2 border-blue-600 shadow-xl md:-my-2 md:scale-[1.02]'
        : 'border border-gray-200 shadow-sm'
      }`}
     >
      {tier.highlight && (
       <div className="bg-blue-600 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-white">
        {t('home_best_value')}
       </div>
      )}
      <div className="px-6 pt-6 text-center">
       <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">{tier.name}</p>
       <div className="mt-3 flex items-baseline justify-center gap-2">
        <span className="text-5xl font-bold tracking-tight text-gray-900">{tier.priceUsdt}</span>
        <span className="text-lg font-semibold text-gray-500">USDT</span>
        {tier.originalUsdt && (
         <span className="text-base font-medium text-gray-400 line-through">{tier.originalUsdt}</span>
        )}
       </div>
       <p className="mt-1 text-xs text-gray-500">{tier.period}</p>
       {saved > 0 ? (
        <span className="mt-4 inline-block rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
         {t('home_save')} {saved} USDT
        </span>
       ) : (
        <span className="mt-4 inline-block h-[26px]" />
       )}
      </div>
      <div className="flex flex-1 flex-col px-6 pb-6 pt-5">
       <ul className="space-y-3">
        {PLAN_FEATURES.map((feature) => (
         <li key={feature} className="flex items-start gap-2.5 text-sm text-gray-700">
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
          <span>{feature}</span>
         </li>
        ))}
       </ul>
       <button
        type="button"
        onClick={() => router.push('/signup')}
        className={`mt-6 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
         tier.highlight
          ? 'bg-blue-700 text-white hover:bg-blue-800'
          : 'border border-blue-700 bg-white text-blue-700 hover:bg-blue-50'
        }`}
       >
        {t('home_get_started')}
       </button>
      </div>
     </div>
    );
   })}
  </div>
 );
}
