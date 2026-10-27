import type { IconName } from '@/shared/types';

export function renderIcon(icon: IconName, className = 'h-5 w-5') {
 const commonProps = {
  className,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
 };

 switch (icon) {
  case 'home':
   return (
    <svg {...commonProps}>
     <path d="M3 10.5 12 3l9 7.5" />
     <path d="M5 9.5V21h14V9.5" />
     <path d="M9 21v-6h6v6" />
    </svg>
   );
  case 'organizations':
   return (
    <svg {...commonProps}>
     <path d="M4 21h16" />
     <path d="M6 21V7l6-3 6 3v14" />
     <path d="M9 10h.01M12 10h.01M15 10h.01M9 14h.01M12 14h.01M15 14h.01" />
    </svg>
   );
  case 'clients':
   return (
    <svg {...commonProps}>
     <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
     <circle
      cx="9.5"
      cy="7"
      r="3.5"
     />
     <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
     <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
   );
  case 'currencies':
   return (
    <svg {...commonProps}>
     <path d="M12 3v18" />
     <path d="M16.5 7.5c0-1.93-2.01-3.5-4.5-3.5S7.5 5.57 7.5 7.5 9.51 11 12 11s4.5 1.57 4.5 3.5S14.49 18 12 18s-4.5-1.57-4.5-3.5" />
    </svg>
   );
  case 'transactions':
   return (
    <svg {...commonProps}>
     <path d="M7 7h11" />
     <path d="m13 3 5 4-5 4" />
     <path d="M17 17H6" />
     <path d="m11 13-5 4 5 4" />
    </svg>
   );
  case 'settings':
   return (
    <svg {...commonProps}>
     <circle
      cx="12"
      cy="12"
      r="3"
     />
     <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01A1.65 1.65 0 0 0 20.91 10H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
   );
  case 'database':
   return (
    <svg {...commonProps}>
     <ellipse
      cx="12"
      cy="5"
      rx="7"
      ry="3"
     />
     <path d="M5 5v6c0 1.66 3.13 3 7 3s7-1.34 7-3V5" />
     <path d="M5 11v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" />
    </svg>
   );
  case 'auth':
   return (
    <svg {...commonProps}>
     <circle
      cx="12"
      cy="8"
      r="3"
     />
     <path d="M5 20v-1.2A5.8 5.8 0 0 1 10.8 13h2.4A5.8 5.8 0 0 1 19 18.8V20" />
     <path d="M15.5 10.5 17 12l1.5-1.5" />
     <path d="M17 12v-4" />
    </svg>
   );
  case 'archive':
   return (
    <svg {...commonProps}>
     <rect
      x="3"
      y="4"
      width="18"
      height="4"
      rx="1"
     />
     <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
     <path d="M10 12h4" />
    </svg>
   );
  case 'rates':
   return (
    <svg {...commonProps}>
     <path d="M3 17l6-6 4 4 8-8" />
     <path d="M17 7h4v4" />
    </svg>
   );
  case 'treasury':
   return (
    <svg {...commonProps}>
     <rect
      x="3"
      y="4"
      width="18"
      height="16"
      rx="2"
     />
     <circle
      cx="12"
      cy="12"
      r="3.5"
     />
     <path d="M12 12h3.5" />
     <path d="M7 20v1.5M17 20v1.5" />
    </svg>
   );
  case 'harvest':
   return (
    <svg {...commonProps}>
     <path d="M12 21V9" />
     <path d="M12 9c0-2.5-1.8-4.5-4-4.5C8 7 9.8 9 12 9Z" />
     <path d="M12 9c0-2.5 1.8-4.5 4-4.5C16 7 14.2 9 12 9Z" />
     <path d="M12 13c0-2.2-1.6-4-3.5-4C8.5 11.3 10.1 13 12 13Z" />
     <path d="M12 13c0-2.2 1.6-4 3.5-4C15.5 11.3 13.9 13 12 13Z" />
     <path d="M6 21h12" />
    </svg>
   );
  case 'edit':
   return (
    <svg {...commonProps}>
     <path d="M12 20h9" />
     <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
   );
  case 'info':
   return (
    <svg {...commonProps}>
     <circle
      cx="12"
      cy="12"
      r="9"
     />
     <path d="M12 16v-4" />
     <path d="M12 8h.01" />
    </svg>
   );
  case 'copy':
   return (
    <svg {...commonProps}>
     <rect
      x="9"
      y="9"
      width="12"
      height="12"
      rx="2"
     />
     <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
   );
  case 'eye':
   return (
    <svg {...commonProps}>
     <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
     <circle
      cx="12"
      cy="12"
      r="3"
     />
    </svg>
   );
  case 'eye-off':
   return (
    <svg {...commonProps}>
     <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a17.6 17.6 0 0 1-2.16 3.19" />
     <path d="M6.61 6.61C3.9 8.4 2 12 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.39-1.61" />
     <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
     <path d="m2 2 20 20" />
    </svg>
   );
  case 'trash':
   return (
    <svg {...commonProps}>
     <path d="M3 6h18" />
     <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
     <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
     <path d="M10 11v6M14 11v6" />
    </svg>
   );
 }
}
