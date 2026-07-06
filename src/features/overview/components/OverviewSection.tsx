'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { Spinner } from '@/components/ui/Spinner';
import { SkBar } from '@/shared/components/skeletons/Skeletons';
import { panelClassName, mutedPanelClassName } from '@/shared/styles';
import { renderIcon } from '@/shared/utils/icons';
import { normalizeDecimalInput } from '@/shared/utils/decimal';
import type {
 Client,
 ClientAccount,
 ClientAdjustment,
 Currency,
 Organization,
 OverviewBalanceGroup,
 Section,
 Transaction,
} from '@/shared/types';
import type { OverviewPdfCard } from '@/features/pdf/pdfExport';
import { useOverviewStore } from '../store/overviewStore';
import { computeOverviewBalances } from '../utils/overviewBalances';

type OverviewSectionProps = {
 organizations: Organization[];
 clients: Client[];
 clientAccounts: ClientAccount[];
 currencies: Currency[];
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
 isLoading: boolean;
 navigateToSection: (section: Section) => void;
 onExportOverviewPdf: (cards: OverviewPdfCard[], mainCode: string, mainSymbol: string) => void;
};

export default function OverviewSection({ organizations, clients, clientAccounts, currencies, transactions, adjustments, isLoading, navigateToSection, onExportOverviewPdf }: OverviewSectionProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const numLocale = language === 'fr' ? 'fr-FR' : language;

 const { overviewRates, overviewFlipAll, overviewFlipped, setOverviewFlipAll, setOverviewFlipped, updateOverviewRate } = useOverviewStore();

 // Organisation search box: typing filters a dropdown of matching org names; picking one
 // (or pressing Enter with a single match) smooth-scrolls that org's section into view.
 const [orgSearchQuery, setOrgSearchQuery] = useState('');
 const [orgSearchOpen, setOrgSearchOpen] = useState(false);

 // Cards the user has ticked for printing, keyed by group.key. Ephemeral (not persisted).
 const [selectedCardKeys, setSelectedCardKeys] = useState<Set<string>>(new Set());
 const toggleCardSelected = (key: string) =>
  setSelectedCardKeys((prev) => {
   const next = new Set(prev);
   if (next.has(key)) next.delete(key);
   else next.add(key);
   return next;
  });

 const mainCurrency = useMemo(() => currencies.find((currency) => currency.isMain === 1) ?? null, [currencies]);

 const overviewOrgBalances = useMemo(
  () => computeOverviewBalances({ transactions, adjustments, clientAccounts, clients, currencies, language }),
  [transactions, adjustments, clientAccounts, clients, currencies, language],
 );

 // Flat {key, name} list for the organisation search box, derived from the same grouping
 // used for the balance sections below (so a match always corresponds to a real section).
 const orgSearchList = useMemo(
  () =>
   Array.from(overviewOrgBalances.byOrg.entries()).map(([key, groups]) => ({
    key,
    name: groups[0].organizationName ?? t('overview_no_organization'),
   })),
  [overviewOrgBalances, t],
 );
 const orgSearchMatches = orgSearchQuery.trim() ? orgSearchList.filter((org) => org.name.toLowerCase().includes(orgSearchQuery.trim().toLowerCase())) : [];

 // Smooth-scrolls the given org's balance section into view and closes the dropdown.
 const jumpToOrgSection = (orgKey: string) => {
  document.getElementById(`overview-org-${orgKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setOrgSearchOpen(false);
 };

 // Localized currency display name (depends only on language).
 const getLocalizedCurrencyName = (currencyCode: string, fallbackName: string) => {
  try {
   if (typeof Intl.DisplayNames === 'function') {
    return new Intl.DisplayNames([language], { type: 'currency' }).of(currencyCode) || fallbackName || currencyCode;
   }
  } catch {
   // ignore and fall back to the stored name
  }
  return fallbackName || currencyCode;
 };

 const overviewCards = [
  { label: t('overview_currencies'), value: currencies.filter((currency) => currency.isEnabled === 1).length },
  { label: t('overview_organizations'), value: organizations.length },
  { label: t('overview_clients'), value: clients.length },
  { label: t('overview_transactions'), value: transactions.length + adjustments.length },
 ];

 if (isLoading) {
  return (
        <section className="flex flex-col gap-6">
         <div className={panelClassName}>
          <div className="flex items-start justify-between gap-4">
           <div className="flex flex-col gap-2">
            <SkBar
             w="w-48"
             h="h-7"
            />
            <SkBar
             w="w-72"
             h="h-3.5"
            />
           </div>
           <SkBar
            w="w-40"
            h="h-9"
           />
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-4">
           {Array.from({ length: 4 }, (_, i) => (
            <div
             key={i}
             className="rounded border border-slate-200 bg-slate-50 p-4 flex flex-col gap-2"
            >
             <SkBar
              w="w-24"
              h="h-3"
             />
             <SkBar
              w="w-16"
              h="h-7"
             />
            </div>
           ))}
          </div>
         </div>
         <div className={panelClassName}>
          <SkBar
           w="w-56"
           h="h-6"
          />
          <div className="mt-4 flex flex-col gap-3">
           {Array.from({ length: 3 }, (_, i) => (
            <div
             key={i}
             className="rounded border border-slate-200 p-4 flex flex-col gap-2"
            >
             <SkBar
              w="w-40"
              h="h-4"
             />
             <SkBar
              w="w-64"
              h="h-3"
             />
            </div>
           ))}
          </div>
         </div>
        </section>
  );
 }

 return (
        <section className="flex flex-col gap-6">
         <div className={panelClassName}>
          <div className="flex items-start justify-between gap-4">
           <div>
            <h2 className="text-2xl font-semibold">{t('overview_title')}</h2>
            <p className="mt-2 text-sm text-slate-600">{t('overview_description')}</p>
           </div>
           <button
            type="button"
            onClick={() => navigateToSection('transactions')}
            className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800"
           >
            {renderIcon('transactions', 'h-4 w-4')}
            {t('overview_go_to_transactions')}
           </button>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-4">
           {overviewCards.map((card) => (
            <div
             key={card.label}
             className={mutedPanelClassName}
            >
             <p className="text-sm text-slate-500">{card.label}</p>
             <p className="mt-3 text-3xl font-bold text-slate-900">{isLoading ? <Spinner className="text-2xl text-slate-400" /> : card.value}</p>
            </div>
           ))}
          </div>
         </div>

         {(() => {
          const mainCode = mainCurrency?.code ?? '';
          const mainSymbol = mainCurrency?.symbol || mainCode;
          const fmt = (n: number) => n.toLocaleString(numLocale, { maximumFractionDigits: 0 });
          const balanceColor = (n: number) => (n >= 0 ? 'text-emerald-600' : 'text-red-600');

          // The user-entered rate string for a card, keyed per card (orgId:currencyId)
          // so each organization's card keeps its own rate. Falls back to any legacy
          // entry keyed by bare currency code so previously saved rates still apply.
          const rateStringOf = (group: OverviewBalanceGroup) => overviewRates[group.key] ?? overviewRates[group.currencyCode];

          // Resolve a group's FX rate. Main currency is always 1; others use the
          // user-entered rate, or NaN when unset/invalid (excluded from conversions).
          const rateOf = (group: OverviewBalanceGroup) => {
           if (group.isMain) return 1;
           const raw = rateStringOf(group);
           const value = raw != null ? Number(raw) : NaN;
           return value > 0 ? value : NaN;
          };
          const isFlipped = (group: OverviewBalanceGroup) => !group.isMain && (overviewFlipAll || overviewFlipped.has(group.key));

          // Flatten a card (org + currency group) to the plain shape the PDF builder expects.
          // `flipped` requests the converted (main-currency) face; it only applies when a valid
          // rate exists, matching the on-screen flip.
          const cardFromGroup = (group: OverviewBalanceGroup, orgName: string, flipped = false): OverviewPdfCard => {
           const rate = rateOf(group);
           const rateNum = Number.isNaN(rate) ? null : rate;
           return {
            orgName,
            currencyCode: group.currencyCode,
            currencySymbol: group.currencySymbol || group.currencyCode,
            isMain: group.isMain,
            total: group.total,
            rate: rateNum,
            flipped: flipped && rateNum != null,
            clients: group.clients.map((c) => ({ clientName: c.clientName, balance: c.balance })),
           };
          };
          const printCards = (cards: OverviewPdfCard[]) => onExportOverviewPdf(cards, mainCode, mainSymbol);
          const printIcon = (
           <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
           >
            <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" />
           </svg>
          );
          // Collect the ticked cards across every org (only those still shown, i.e. total !== 0).
          const printSelected = () => {
           const cards: OverviewPdfCard[] = [];
           for (const [, orgGroups] of overviewOrgBalances.byOrg) {
            const orgName = orgGroups[0].organizationName ?? t('overview_no_organization');
            for (const group of orgGroups) {
             if (group.total !== 0 && selectedCardKeys.has(group.key)) cards.push(cardFromGroup(group, orgName, isFlipped(group) && !Number.isNaN(rateOf(group))));
            }
           }
           printCards(cards);
          };
          const selectedShownCount = overviewOrgBalances.groups.filter((g) => g.total !== 0 && selectedCardKeys.has(g.key)).length;

          // Grand total across every group, always in the main currency.
          let grandTotal = 0;
          let anyRateMissing = false;
          for (const group of overviewOrgBalances.groups) {
           const rate = rateOf(group);
           if (Number.isNaN(rate)) {
            anyRateMissing = true;
            continue;
           }
           grandTotal += group.total * rate;
          }

          // Render orgs in their own labelled subsections: orgs that have a main-
          // currency card first, then alphabetically, with "no organization" last.
          const orgEntries = Array.from(overviewOrgBalances.byOrg.entries());
          orgEntries.sort(([aKey, aGroups], [bKey, bGroups]) => {
           const aMain = aGroups.some((g) => g.isMain);
           const bMain = bGroups.some((g) => g.isMain);
           if (aMain !== bMain) return aMain ? -1 : 1;
           if (aKey === 'none') return 1;
           if (bKey === 'none') return -1;
           return (aGroups[0].organizationName ?? '').localeCompare(bGroups[0].organizationName ?? '', language, { sensitivity: 'base' });
          });

          return (
           <>
           <div className={panelClassName}>
            <div className="flex flex-wrap items-center justify-between gap-3">
             <h2 className="text-xl font-semibold">{t('overview_balances_title')}</h2>
             <div className="flex flex-wrap items-center gap-4">
              <div className="relative">
               <input
                type="text"
                value={orgSearchQuery}
                onChange={(event) => {
                 setOrgSearchQuery(event.target.value);
                 setOrgSearchOpen(true);
                }}
                onFocus={() => setOrgSearchOpen(true)}
                onBlur={() => setTimeout(() => setOrgSearchOpen(false), 150)}
                onKeyDown={(event) => {
                 if (event.key === 'Enter' && orgSearchMatches.length > 0) {
                  event.preventDefault();
                  jumpToOrgSection(orgSearchMatches[0].key);
                 }
                }}
                placeholder={t('overview_search_org_placeholder')}
                className="w-52 rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
               />
               {orgSearchOpen && orgSearchQuery.trim() ? (
                <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded border border-slate-200 bg-white shadow-lg">
                 {orgSearchMatches.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-slate-500">{t('overview_search_no_results')}</p>
                 ) : (
                  orgSearchMatches.map((org) => (
                   <button
                    key={org.key}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => jumpToOrgSection(org.key)}
                    className="block w-full truncate px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                   >
                    {org.name}
                   </button>
                  ))
                 )}
                </div>
               ) : null}
              </div>
              <div className={`text-right ${balanceColor(grandTotal)}`}>
               <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('overview_grand_total')}</p>
               <p
                className="text-lg font-bold"
                dir="ltr"
               >
                {fmt(grandTotal)} {mainSymbol}
               </p>
              </div>
              {selectedShownCount > 0 ? (
               // Sticky so the action stays reachable while scrolling through a long list of
               // organization cards to pick more of them, instead of scrolling away with the header.
               <button
                type="button"
                onClick={printSelected}
                className="sticky top-4 z-20 shrink-0 inline-flex items-center gap-1.5 rounded border border-emerald-700 bg-emerald-700 px-3 py-2 text-sm font-semibold text-white shadow-lg transition hover:bg-emerald-800"
               >
                {printIcon}
                {t('overview_print_selected', { count: selectedShownCount })}
               </button>
              ) : null}
              <button
               type="button"
               onClick={() => {
                setOverviewFlipAll((value) => !value);
                setOverviewFlipped(new Set());
               }}
               className="shrink-0 rounded border border-blue-700 bg-blue-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
              >
               {overviewFlipAll ? t('overview_show_original') : t('overview_show_in_main', { currency: mainCode })}
              </button>
             </div>
            </div>

            {anyRateMissing ? <p className="mt-2 text-xs text-amber-600">{t('overview_set_rate')}</p> : null}

            {!overviewOrgBalances.hasAccounts ? (
             <p className="mt-4 text-sm text-slate-600">{t('overview_no_balances')}</p>
            ) : (
             <div className="mt-5 divide-y-2 divide-slate-300">
              {orgEntries.map(([orgKey, orgGroups], orgIndex) => {
               const orgName = orgGroups[0].organizationName ?? t('overview_no_organization');
               const showMerged = orgGroups.length >= 2;
               // Merged main-currency total for this org (sum of its currency cards).
               // Also build per-client converted balances across all currencies.
               let mergedTotal = 0;
               let mergedReady = true;
               const mergedClientMap = new Map<number, { clientId: number; clientName: string; balance: number }>();
               for (const group of orgGroups) {
                const rate = rateOf(group);
                if (Number.isNaN(rate)) {
                 mergedReady = false;
                 break;
                }
                mergedTotal += group.total * rate;
                for (const client of group.clients) {
                 const existing = mergedClientMap.get(client.clientId);
                 if (existing) {
                  existing.balance += client.balance * rate;
                 } else {
                  mergedClientMap.set(client.clientId, { clientId: client.clientId, clientName: client.clientName, balance: client.balance * rate });
                 }
                }
               }
               const mergedClients = Array.from(mergedClientMap.values())
                .filter((c) => c.balance !== 0)
                .sort((a, b) => a.clientName.localeCompare(b.clientName, language, { sensitivity: 'base' }));

               return (
                <div
                 key={orgKey}
                 id={`overview-org-${orgKey}`}
                 className={`-mx-5 px-5 pb-6 pt-6 last:pb-0 first:pt-0 ${orgIndex % 2 === 1 ? 'bg-slate-50' : 'bg-white'}`}
                >
                 <h3 className="mb-3 text-lg font-bold uppercase tracking-wide text-slate-700">{orgName}</h3>
                 <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {orgGroups
                   .filter((group) => group.total !== 0)
                   .map((group) => {
                    const rate = rateOf(group);
                    const rateValid = !Number.isNaN(rate);
                    // A card only shows its converted (back) face when flipped AND a valid rate exists.
                    const flipped = isFlipped(group) && rateValid;
                    const converted = group.total * rate;
                    const toggleFlip = () =>
                     setOverviewFlipped((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                     });
                    const flipIcon = (
                     <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                     >
                      <path d="M7 4 3 8l4 4M3 8h13.5" />
                      <path d="M17 20l4-4-4-4m4 4H7.5" />
                     </svg>
                    );
                    return (
                     <div
                      key={group.key}
                      className="[perspective:1200px]"
                     >
                      <div className={`relative transition-transform duration-500 [transform-style:preserve-3d] ${flipped ? '[transform:rotateY(180deg)]' : ''}`}>
                       {/* FRONT — original currency */}
                       <div className="flex flex-col rounded border border-slate-200 bg-white [backface-visibility:hidden]">
                        <div className="flex flex-col gap-1 border-b border-slate-100 bg-slate-50 px-3 py-2">
                         <div className="flex items-center justify-between gap-2">
                          <label className="flex min-w-0 items-center gap-1.5">
                           <input
                            type="checkbox"
                            checked={selectedCardKeys.has(group.key)}
                            onChange={() => toggleCardSelected(group.key)}
                            aria-label={t('overview_select_card')}
                            className="shrink-0"
                           />
                           <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">{orgName}</span>
                          </label>
                          <button
                           type="button"
                           title={t('overview_print_card')}
                           aria-label={t('overview_print_card')}
                           onClick={() => printCards([cardFromGroup(group, orgName)])}
                           className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-emerald-600"
                          >
                           {printIcon}
                          </button>
                         </div>
                         <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-700">{group.currencySymbol || group.currencyCode}</span>
                          {!group.isMain ? (
                          <div className="flex items-center gap-2">
                           <label className="flex items-center gap-1 text-xs text-slate-500">
                            <span>{t('overview_rate_label', { currency: mainCode })}</span>
                            <input
                             type="text"
                             inputMode="decimal"
                             dir="ltr"
                             value={rateStringOf(group) ?? ''}
                             onChange={(event) => updateOverviewRate(group.key, normalizeDecimalInput(event.target.value))}
                             className="w-16 rounded border border-slate-300 px-1.5 py-1 text-xs outline-none ring-blue-300 focus:ring"
                            />
                           </label>
                           {rateValid ? (
                            <button
                             type="button"
                             title={t('overview_show_in_main', { currency: mainCode })}
                             onClick={toggleFlip}
                             className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-blue-600"
                            >
                             {flipIcon}
                            </button>
                           ) : null}
                          </div>
                          ) : null}
                         </div>
                        </div>

                        <div className="flex-1 divide-y divide-slate-100 px-3 py-1">
                         {group.clients.map((client) => (
                          <div
                           key={client.clientId}
                           className="flex items-center justify-between gap-3 py-1.5 text-sm"
                          >
                           <span className="truncate text-slate-700">{client.clientName}</span>
                           <span
                            className={`shrink-0 font-medium ${balanceColor(client.balance)}`}
                            dir="ltr"
                           >
                            {fmt(client.balance)}
                           </span>
                          </div>
                         ))}
                        </div>

                        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3 py-2">
                         <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('overview_card_total')}</span>
                         <span
                          className={`font-bold ${balanceColor(group.total)}`}
                          dir="ltr"
                         >
                          {fmt(group.total)} {group.currencySymbol || group.currencyCode}
                         </span>
                        </div>
                       </div>

                       {/* BACK — converted to main currency */}
                       {!group.isMain ? (
                        <div className="absolute inset-0 flex flex-col rounded border border-blue-200 bg-white [backface-visibility:hidden] [transform:rotateY(180deg)]">
                         <div className="flex flex-col gap-1 border-b border-blue-100 bg-blue-50 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                           <label className="flex min-w-0 items-center gap-1.5">
                            <input
                             type="checkbox"
                             checked={selectedCardKeys.has(group.key)}
                             onChange={() => toggleCardSelected(group.key)}
                             aria-label={t('overview_select_card')}
                             className="shrink-0"
                            />
                            <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-blue-400">{orgName}</span>
                           </label>
                           <button
                            type="button"
                            title={t('overview_print_card')}
                            aria-label={t('overview_print_card')}
                            onClick={() => printCards([cardFromGroup(group, orgName, true)])}
                            className="shrink-0 rounded p-1 text-blue-400 transition hover:bg-blue-100 hover:text-emerald-600"
                           >
                            {printIcon}
                           </button>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                           <span className="text-sm font-semibold text-blue-700">{mainSymbol}</span>
                           <div className="flex items-center gap-2">
                            <span
                             className="text-xs text-blue-600"
                             dir="ltr"
                            >
                             1 {group.currencyCode} = {rateStringOf(group) ?? rate} {mainCode}
                            </span>
                            <button
                             type="button"
                             title={t('overview_show_original')}
                             onClick={toggleFlip}
                             className="rounded p-1 text-blue-500 transition hover:bg-blue-100 hover:text-blue-700"
                            >
                             {flipIcon}
                            </button>
                           </div>
                          </div>
                         </div>

                         <div className="flex-1 divide-y divide-slate-100 px-3 py-1">
                          {group.clients.map((client) => (
                           <div
                            key={client.clientId}
                            className="flex items-center justify-between gap-3 py-1.5 text-sm"
                           >
                            <span className="truncate text-slate-700">{client.clientName}</span>
                            <span
                             className={`shrink-0 font-medium ${balanceColor(client.balance * rate)}`}
                             dir="ltr"
                            >
                             {fmt(client.balance * rate)}
                            </span>
                           </div>
                          ))}
                         </div>

                         <div className="flex items-center justify-between gap-3 border-t border-blue-200 bg-blue-50 px-3 py-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">{t('overview_card_total')}</span>
                          <span
                           className={`font-bold ${balanceColor(converted)}`}
                           dir="ltr"
                          >
                           {fmt(converted)} {mainSymbol}
                          </span>
                         </div>
                        </div>
                       ) : null}
                      </div>
                     </div>
                    );
                   })}

                  {showMerged ? (
                   <div className="flex flex-col rounded border-2 border-blue-200 bg-blue-50/50">
                    <div className="border-b border-blue-200 bg-blue-100/60 px-3 py-2">
                     <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                      {t('overview_merged_total', { org: orgName, currency: getLocalizedCurrencyName(mainCurrency?.code ?? mainCode, mainCurrency?.name ?? mainCode) })}
                     </p>
                    </div>
                    {mergedReady ? (
                     <>
                      <div className="flex-1 divide-y divide-blue-100 px-3 py-1">
                       {mergedClients.map((client) => (
                        <div
                         key={client.clientId}
                         className="flex items-center justify-between gap-3 py-1.5 text-sm"
                        >
                         <span className="truncate text-slate-700">{client.clientName}</span>
                         <span
                          className={`shrink-0 font-medium ${balanceColor(client.balance)}`}
                          dir="ltr"
                         >
                          {fmt(client.balance)}
                         </span>
                        </div>
                       ))}
                      </div>
                      <div className="flex items-center justify-between gap-3 border-t border-blue-200 bg-blue-100/60 px-3 py-2">
                       <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">{t('overview_card_total')}</span>
                       <span
                        className={`font-bold ${balanceColor(mergedTotal)}`}
                        dir="ltr"
                       >
                        {fmt(mergedTotal)} {mainSymbol}
                       </span>
                      </div>
                     </>
                    ) : (
                     <p className="px-3 py-3 text-xs text-amber-600">{t('overview_set_rate')}</p>
                    )}
                   </div>
                  ) : null}
                 </div>
                </div>
               );
              })}
             </div>
            )}
           </div>

           <div className={panelClassName}>
            <h2 className="text-xl font-semibold">{t('overview_general_balance')}</h2>

            <div className="mt-4 overflow-hidden rounded border border-slate-200">
             {orgEntries.map(([orgKey, orgGroups], orgIndex) => {
              const orgName = orgGroups[0].organizationName ?? t('overview_no_organization');
              // This org's balance in the main currency: sum of its currency groups
              // converted at their rates. Groups with a missing rate are skipped.
              let orgTotal = 0;
              let orgRateMissing = false;
              for (const group of orgGroups) {
               const rate = rateOf(group);
               if (Number.isNaN(rate)) {
                orgRateMissing = true;
                continue;
               }
               orgTotal += group.total * rate;
              }
              return (
               <div
                key={orgKey}
                className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm ${orgIndex % 2 === 1 ? 'bg-slate-50' : 'bg-white'}`}
               >
                <span className="truncate font-medium text-slate-700">{orgName}</span>
                <span
                 className={`shrink-0 font-semibold ${balanceColor(orgTotal)}`}
                 dir="ltr"
                >
                 {fmt(orgTotal)} {mainSymbol}
                 {orgRateMissing ? <span className="ml-1 text-amber-500">*</span> : null}
                </span>
               </div>
              );
             })}
             <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-100 px-4 py-3">
              <span className="text-sm font-bold uppercase tracking-wide text-slate-600">{t('overview_grand_total')}</span>
              <span
               className={`text-lg font-bold ${balanceColor(grandTotal)}`}
               dir="ltr"
              >
               {fmt(grandTotal)} {mainSymbol}
              </span>
             </div>
            </div>

            {anyRateMissing ? <p className="mt-2 text-xs text-amber-600">{t('overview_set_rate')}</p> : null}
           </div>
           </>
          );
         })()}
        </section>
 );
}
