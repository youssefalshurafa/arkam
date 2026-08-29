import type { Section } from '@/shared/types';

export const mainSections: Section[] = ['overview', 'settings', 'organizations', 'clients', 'currencies', 'transactions', 'archive', 'live-rates', 'treasury', 'harvest'];

export function getSectionFromPath(pathname: string): { section: Section; subId?: string } {
 const parts = pathname.split('/').filter(Boolean);
 const first = parts[0] ?? '';
 const second = parts[1];
 if (first === 'clients' && second) return { section: 'client-ledger', subId: second };
 if (first === 'organizations' && second) return { section: 'organization-clients', subId: second };
 const section = mainSections.includes(first as Section) ? (first as Section) : 'overview';
 return { section };
}

// The inverse of getSectionFromPath: points the address bar at a section, WITHOUT going through
// the Next router.
//
// Every section URL ('/', '/transactions', '/clients/123', ...) is served by the one
// [[...section]] route, whose page takes no params and is entirely 'use client' — so the server
// payload is identical for all of them. router.push/replace still treated each switch as a real
// navigation: it fetched that identical payload and only committed the URL once the request
// resolved. Since the content had already swapped synchronously via setSection(), the address bar
// sat on the OLD section for the length of that round-trip and then snapped over — the visible
// "opens, then reloads" desync.
//
// Next patches history.pushState/replaceState to keep usePathname() in sync (it dispatches an
// internal restore against the tree it already has, with no fetch), so this updates the URL
// synchronously in the same tick as the content. Do not "simplify" this back to router.push.
export function setSectionUrl(url: string, mode: 'push' | 'replace'): void {
 if (typeof window === 'undefined') return;
 // A repeat click on the section you're already in shouldn't stack a history entry.
 if (window.location.pathname === url) return;
 if (mode === 'replace') window.history.replaceState(null, '', url);
 else window.history.pushState(null, '', url);
}
