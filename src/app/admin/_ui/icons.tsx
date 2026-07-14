import type { SVGProps } from 'react';

// Single stroke-icon component for the admin panel so every screen draws from the
// same visual set. Pass `name`; sizing/stroke come from CSS (width/height set by
// the parent class, currentColor for fill). Keep additions here, not inline.
export type IconName =
 | 'overview'
 | 'users'
 | 'user'
 | 'subscriptions'
 | 'requests'
 | 'resets'
 | 'images'
 | 'audit'
 | 'lock'
 | 'search'
 | 'sun'
 | 'moon'
 | 'chevron'
 | 'chevron-down'
 | 'plus'
 | 'download'
 | 'dots'
 | 'check'
 | 'check-bold'
 | 'trash'
 | 'refresh'
 | 'key'
 | 'warning'
 | 'info'
 | 'x'
 | 'back'
 | 'building'
 | 'activity'
 | 'login'
 | 'clock'
 | 'external';

const PATHS: Record<IconName, React.ReactNode> = {
 overview: (
  <>
   <rect x="3" y="3" width="7" height="9" rx="1.5" />
   <rect x="14" y="3" width="7" height="5" rx="1.5" />
   <rect x="14" y="12" width="7" height="9" rx="1.5" />
   <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </>
 ),
 users: (
  <>
   <circle cx="9" cy="8" r="3.2" />
   <path d="M3.5 20c.5-3.3 2.9-5 5.5-5s5 1.7 5.5 5" />
   <path d="M16 5.2A3 3 0 0 1 16 11M20.5 20c-.3-2.2-1.4-3.6-3-4.4" />
  </>
 ),
 user: (
  <>
   <circle cx="12" cy="8" r="3.4" />
   <path d="M5 20c.6-3.6 3.2-5.4 7-5.4s6.4 1.8 7 5.4" />
  </>
 ),
 subscriptions: (
  <>
   <rect x="3" y="5" width="18" height="14" rx="2" />
   <path d="M3 10h18" />
  </>
 ),
 requests: (
  <>
   <path d="M4 5h16v10H4z" />
   <path d="M2 19h20" />
   <path d="M9 9l2.5 2.5L16 7" />
  </>
 ),
 resets: (
  <>
   <circle cx="8" cy="14" r="4" />
   <path d="M11 11l7-7 2 2-2 2 2 2-3 1" />
  </>
 ),
 images: (
  <>
   <rect x="3" y="4" width="18" height="16" rx="2" />
   <circle cx="8.5" cy="9.5" r="1.8" />
   <path d="M4 17l4.5-4 3 2.5L16 11l4 4" />
  </>
 ),
 audit: (
  <>
   <path d="M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2z" />
   <path d="M9 9h6M9 13h4" />
  </>
 ),
 lock: (
  <>
   <rect x="5" y="11" width="14" height="9" rx="2" />
   <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>
 ),
 search: (
  <>
   <circle cx="11" cy="11" r="7" />
   <path d="M21 21l-4-4" />
  </>
 ),
 sun: (
  <>
   <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4" />
   <circle cx="12" cy="12" r="4" />
  </>
 ),
 moon: <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z" />,
 chevron: <path d="M9 6l6 6-6 6" />,
 'chevron-down': <path d="M6 9l6 6 6-6" />,
 plus: <path d="M12 5v14M5 12h14" />,
 download: <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />,
 dots: (
  <>
   <circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" />
   <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
   <circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" />
  </>
 ),
 check: <path d="M20 7L10 17l-5-5" />,
 'check-bold': <path d="M5 12l5 5 9-10" />,
 trash: <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />,
 refresh: <path d="M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5" />,
 key: (
  <>
   <circle cx="8" cy="14" r="4" />
   <path d="M11 11l7-7 2 2-2 2 2 2-3 1" />
  </>
 ),
 warning: (
  <>
   <path d="M12 3l9 16H3z" />
   <path d="M12 10v4" />
   <circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="none" />
  </>
 ),
 info: (
  <>
   <circle cx="12" cy="12" r="9" />
   <path d="M12 11v5" />
   <circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none" />
  </>
 ),
 x: <path d="M6 6l12 12M18 6L6 18" />,
 back: <path d="M15 6l-6 6 6 6" />,
 building: (
  <>
   <rect x="4" y="3" width="16" height="18" rx="1.5" />
   <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" />
  </>
 ),
 activity: <path d="M3 12h4l2 6 4-14 2 8h6" />,
 login: (
  <>
   <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
   <path d="M10 17l5-5-5-5M15 12H3" />
  </>
 ),
 clock: (
  <>
   <circle cx="12" cy="12" r="8.5" />
   <path d="M12 8v4.5l3 2" />
  </>
 ),
 external: (
  <>
   <path d="M14 4h6v6M20 4l-9 9" />
   <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </>
 ),
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
 return (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
   {PATHS[name]}
  </svg>
 );
}
