import type { NextConfig } from 'next';

// Security headers for every response.
//
// The CSP is split in two:
//   * ENFORCED — directives that can't break the app but close real holes: no framing by
//     other sites (clickjacking), no plugins, no <base> hijacking, and forms may only post to
//     us or Google's OAuth endpoint (Chrome applies form-action to the post-submit redirect,
//     which is why accounts.google.com is listed).
//   * REPORT-ONLY — the full script/style/connect policy. Next's inline hydration scripts and
//     the anti-flash theme script in app/layout.tsx need a nonce setup before script-src can be
//     enforced; until then violations are only reported in the browser console.
const enforcedCsp = [
 "frame-ancestors 'self'",
 "object-src 'none'",
 "base-uri 'self'",
 "form-action 'self' https://accounts.google.com",
].join('; ');

const reportOnlyCsp = [
 "default-src 'self'",
 "script-src 'self' 'unsafe-inline'",
 "style-src 'self' 'unsafe-inline'",
 "img-src 'self' data: blob: https://lh3.googleusercontent.com",
 "font-src 'self' data:",
 "connect-src 'self'",
 "frame-ancestors 'self'",
 "object-src 'none'",
 "base-uri 'self'",
 "form-action 'self' https://accounts.google.com",
].join('; ');

const securityHeaders = [
 { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
 { key: 'X-Content-Type-Options', value: 'nosniff' },
 { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
 { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
 { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
 { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
 { key: 'Content-Security-Policy', value: enforcedCsp },
 { key: 'Content-Security-Policy-Report-Only', value: reportOnlyCsp },
];

const nextConfig: NextConfig = {
 poweredByHeader: false,
 async headers() {
  return [
   {
    source: '/:path*',
    headers: securityHeaders,
   },
   {
    // Auth/account responses carry tokens, codes and personal data — never cache them.
    source: '/api/:group(auth|account|admin)/:path*',
    headers: [{ key: 'Cache-Control', value: 'no-store' }],
   },
  ];
 },
};

export default nextConfig;
