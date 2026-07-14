'use client';

// Eye / eye-off toggle rendered inside a password field's `relative` wrapper. Shared by the
// login, set-password and reset-password screens so the show/hide affordance looks identical
// everywhere. The parent owns the shown/onToggle state; `showLabel`/`hideLabel` let callers
// pass translated aria labels.
export default function PasswordVisibilityToggle({
 shown,
 onToggle,
 showLabel = 'Show password',
 hideLabel = 'Hide password',
}: {
 shown: boolean;
 onToggle: () => void;
 showLabel?: string;
 hideLabel?: string;
}) {
 return (
  <button
   type="button"
   onClick={onToggle}
   aria-label={shown ? hideLabel : showLabel}
   className="absolute inset-y-0 right-0 inline-flex w-9 items-center justify-center text-fg-faint transition hover:text-fg-muted"
  >
   {shown ? (
    <svg
     xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 24 24"
     fill="none"
     stroke="currentColor"
     strokeWidth="2"
     width="16"
     height="16"
     aria-hidden="true"
    >
     <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 3l18 18"
     />
     <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M10.58 10.58a2 2 0 102.83 2.83"
     />
     <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9.88 5.09A9.77 9.77 0 0112 4.88c4.36 0 8.06 2.69 9.44 6.5a9.73 9.73 0 01-4.02 5.01"
     />
     <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6.61 6.61A9.75 9.75 0 002.56 11.38 10.75 10.75 0 006.5 16.2"
     />
    </svg>
   ) : (
    <svg
     xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 24 24"
     fill="none"
     stroke="currentColor"
     strokeWidth="2"
     width="16"
     height="16"
     aria-hidden="true"
    >
     <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.56 11.38C3.94 7.57 7.64 4.88 12 4.88s8.06 2.69 9.44 6.5c-1.38 3.81-5.08 6.5-9.44 6.5s-8.06-2.69-9.44-6.5z"
     />
     <circle
      cx="12"
      cy="11.38"
      r="3"
     />
    </svg>
   )}
  </button>
 );
}
