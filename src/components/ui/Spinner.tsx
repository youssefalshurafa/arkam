// Reusable inline loading spinner. Sized in em so it inherits the surrounding
// font-size; pass a Tailwind text size / color via className to tweak it.
export function Spinner({ className = '' }: { className?: string }) {
 return (
  <svg
   className={`animate-spin ${className}`}
   width="1em"
   height="1em"
   viewBox="0 0 24 24"
   fill="none"
   aria-hidden
  >
   <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
   <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
  </svg>
 );
}
