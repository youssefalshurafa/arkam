import type { Section } from '@/shared/types';

export const mainSections: Section[] = ['overview', 'settings', 'organizations', 'clients', 'currencies', 'transactions', 'archive', 'live-rates', 'treasury'];

export function getSectionFromPath(pathname: string): { section: Section; subId?: string } {
 const parts = pathname.split('/').filter(Boolean);
 const first = parts[0] ?? '';
 const second = parts[1];
 if (first === 'clients' && second) return { section: 'client-ledger', subId: second };
 if (first === 'organizations' && second) return { section: 'organization-clients', subId: second };
 const section = mainSections.includes(first as Section) ? (first as Section) : 'overview';
 return { section };
}
