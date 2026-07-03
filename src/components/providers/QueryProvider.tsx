'use client';

import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/queryClient';

/**
 * Provides the app-wide TanStack QueryClient. The client is created once per
 * mount via useState so it survives re-renders but is never shared across
 * requests (important under React 19 / Next App Router).
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
 const [queryClient] = useState(() => createQueryClient());

 return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
