import type { Metadata } from 'next';
import { Cairo } from 'next/font/google';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { AuthSessionProvider } from '@/components/providers/AuthSessionProvider';
import { DialogHost } from '@/components/ui/AppDialog';
import { GlobalLoadingBar } from '@/components/ui/GlobalLoadingBar';
import './globals.css';

export const metadata: Metadata = {
 title: 'Arkam',
 description: 'Arkam — accounting & bookkeeping.',
};

// Cairo covers both Latin and Arabic, so it's the single app-wide font.
const cairo = Cairo({
 variable: '--font-cairo',
 subsets: ['latin', 'arabic'],
});

export default function RootLayout({
 children,
}: Readonly<{
 children: React.ReactNode;
}>) {
 return (
  <html className={`${cairo.variable} h-full antialiased`}>
   <body className="min-h-full flex flex-col">
    <AuthSessionProvider>
     <LanguageProvider>
      {children}
      <DialogHost />
      <GlobalLoadingBar />
     </LanguageProvider>
    </AuthSessionProvider>
   </body>
  </html>
 );
}
