import type { Metadata } from 'next';
import { Geist, Geist_Mono, Noto_Sans_Arabic } from 'next/font/google';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { AuthSessionProvider } from '@/components/providers/AuthSessionProvider';
import './globals.css';

export const metadata: Metadata = {
 title: 'Arkam',
 description: 'Arkam — accounting & bookkeeping.',
};

const geistSans = Geist({
 variable: '--font-geist-sans',
 subsets: ['latin'],
});

const geistMono = Geist_Mono({
 variable: '--font-geist-mono',
 subsets: ['latin'],
});

const notoSansArabic = Noto_Sans_Arabic({
 variable: '--font-arabic-sans',
 subsets: ['arabic'],
});

export default function RootLayout({
 children,
}: Readonly<{
 children: React.ReactNode;
}>) {
 return (
  <html className={`${geistSans.variable} ${geistMono.variable} ${notoSansArabic.variable} h-full antialiased`}>
   <body className="min-h-full flex flex-col">
    <AuthSessionProvider>
     <LanguageProvider>{children}</LanguageProvider>
    </AuthSessionProvider>
   </body>
  </html>
 );
}
