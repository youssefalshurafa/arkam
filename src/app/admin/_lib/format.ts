import type { Language } from '@/contexts/LanguageContext';

// Locale-aware date formatting for the admin panel. The panel used to hardcode
// 'en-GB'; now it follows the active app language — but digits stay Western
// (numberingSystem: 'latn') in every locale per the redesign decision, so Arabic
// shows "12 Jan 2026" with Latin numerals rather than Arabic-Indic ٢٠٢٦.
const LOCALE: Record<Language, string> = {
 en: 'en-GB',
 fr: 'fr-FR',
 ar: 'ar',
};

function fmt(iso: string | null, lang: Language, opts: Intl.DateTimeFormatOptions, fallback: string) {
 if (!iso) return fallback;
 const d = new Date(iso);
 if (Number.isNaN(d.getTime())) return fallback;
 try {
  return new Intl.DateTimeFormat(LOCALE[lang], { numberingSystem: 'latn', ...opts }).format(d);
 } catch {
  return new Intl.DateTimeFormat('en-GB', { numberingSystem: 'latn', ...opts }).format(d);
 }
}

export function formatDate(iso: string | null, lang: Language = 'en', fallback = '—') {
 return fmt(iso, lang, { day: '2-digit', month: 'short', year: 'numeric' }, fallback);
}

export function formatDateTime(iso: string | null, lang: Language = 'en', fallback = '—') {
 return fmt(iso, lang, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }, fallback);
}

export function getInitials(name: string) {
 const parts = (name || '').trim().split(/\s+/).filter(Boolean);
 if (parts.length === 0) return '?';
 return parts
  .map((w) => w[0])
  .join('')
  .toUpperCase()
  .slice(0, 2);
}

// Deterministic accent color for an avatar, derived from the user id/email so the
// same person keeps the same color between renders.
const AVATAR_COLORS = ['#4f46e5', '#0ea5a4', '#d97706', '#7c3aed', '#e11d48', '#2563eb', '#059669', '#c026d3'];
export function avatarColor(seed: string) {
 let h = 0;
 for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
 return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// Team roles are stored as owner/admin/member/viewer but surfaced with the app's
// product vocabulary (member = Editor, viewer = Reviewer). Pass `t` to localize;
// falls back to English labels when no translator is supplied.
const ROLE_KEY: Record<string, string> = {
 owner: 'admin_role_owner',
 admin: 'admin_role_admin',
 member: 'admin_role_editor',
 viewer: 'admin_role_reviewer',
};
const ROLE_EN: Record<string, string> = {
 owner: 'Owner',
 admin: 'Admin',
 member: 'Editor',
 viewer: 'Reviewer',
};
export function teamRoleLabel(role: string, t?: (k: string) => string) {
 if (t && ROLE_KEY[role]) return t(ROLE_KEY[role]);
 return ROLE_EN[role] || role;
}

export const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };
