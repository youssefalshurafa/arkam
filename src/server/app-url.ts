// Absolute base URL for links Arkam puts in emails or hands to admins (reset, setup, invite).
//
// Built from configuration, never from the incoming request: request.nextUrl.origin follows
// the Host header, so a forged Host on a forgot-password request would have produced a reset
// email pointing at an attacker's domain with a live token in it.
export function getAppBaseUrl(): string {
 const configured = process.env.NEXTAUTH_URL?.trim();
 if (configured) {
  return configured.replace(/\/+$/, '');
 }
 // Vercel system variable: the project's production domain (no scheme).
 const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
 if (vercelProduction) {
  return `https://${vercelProduction.replace(/\/+$/, '')}`;
 }
 if (process.env.NODE_ENV !== 'production') {
  return 'http://localhost:3000';
 }
 throw new Error('NEXTAUTH_URL is not configured.');
}
