import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
 reactStrictMode: false,
 // Default (dynamic: 0) treats an already-visited dynamic route as stale immediately, forcing a
 // fresh server round-trip on every single navigation — including bouncing back to a section
 // opened seconds ago. That round-trip is what shows up as the URL lagging behind the clicked
 // section before snapping over. 30s matches the app's own React Query staleTime (queryClient.ts)
 // and only affects Next's router-level cache of the (nearly trivial, since every page here is
 // 'use client') RSC shell — actual data freshness is still governed by React Query's own rules.
 experimental: {
  staleTimes: { dynamic: 30 },
 },
};

export default nextConfig;
