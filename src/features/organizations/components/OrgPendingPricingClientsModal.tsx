'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

export type OrgPendingPricingClient = { id: number; name: string; pendingCount: number };

type OrgPendingPricingClientsModalProps = {
 organizationName: string | null;
 clients: OrgPendingPricingClient[];
 onSelectClient: (clientId: number) => void;
 onClose: () => void;
};

// First step of the organizations-list "awaiting pricing" flow: clicking an org's count opens
// this — the org's clients that have pending rows, each with its own count. Clicking a client
// closes this and opens PendingPricingModal scoped to just that client (the same view the
// organization-clients page's own per-client count already opens), so the two entry points end
// up at the identical place instead of duplicating the entries UI.
export default function OrgPendingPricingClientsModal({ organizationName, clients, onSelectClient, onClose }: OrgPendingPricingClientsModalProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <div
   className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
   onClick={onClose}
  >
   <div
    className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-xl border border-border bg-surface shadow-xl"
    onClick={(e) => e.stopPropagation()}
   >
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5 sm:py-4">
     <div>
      <h2 className="text-lg font-semibold text-fg">{t('pending_pricing_modal_title')}</h2>
      {organizationName ? <p className="mt-0.5 text-sm text-fg-faint">{organizationName}</p> : null}
     </div>
     <button
      type="button"
      onClick={onClose}
      className="shrink-0 rounded p-1 text-fg-faint transition hover:bg-surface-hover hover:text-fg-muted"
      aria-label={t('close')}
     >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
       <path d="M18 6 6 18M6 6l12 12" />
      </svg>
     </button>
    </div>
    <div className="overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
     {clients.length === 0 ? (
      <p className="text-sm text-fg-faint">{t('pending_pricing_no_clients')}</p>
     ) : (
      <ul className="space-y-1.5 text-sm">
       {clients.map((client) => (
        <li key={client.id}>
         <button
          type="button"
          onClick={() => onSelectClient(client.id)}
          className="flex w-full cursor-pointer items-center justify-between gap-3 rounded border border-border px-3 py-2 text-left transition hover:border-accent hover:bg-accent-weak"
         >
          <span className="font-medium text-fg">{client.name}</span>
          <span className="shrink-0 rounded bg-warn-bg px-1.5 py-0.5 font-mono text-xs font-semibold text-warn-text">{client.pendingCount}</span>
         </button>
        </li>
       ))}
      </ul>
     )}
    </div>
   </div>
  </div>
 );
}
