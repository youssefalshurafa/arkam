import type { Metadata } from 'next';
import { Cairo } from 'next/font/google';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthSessionProvider } from '@/components/providers/AuthSessionProvider';
import { QueryProvider } from '@/components/providers/QueryProvider';
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
  // suppressHydrationWarning: the anti-FOUC script below intentionally sets the
  // `dark` class + color-scheme on <html> before hydration, so the server and
  // client markup legitimately differ on this one element.
  <html lang="ar" dir="rtl" suppressHydrationWarning className={`${cairo.variable} h-full antialiased`}>
   <head>
    {/*
      Anti-FOUC: apply the saved theme (or the OS preference for "system")
      before first paint, so a dark-mode user never sees a light flash.
      ThemeContext takes over after hydration.
    */}
    <script
     dangerouslySetInnerHTML={{
      __html: `(function(){try{var t=localStorage.getItem('arkam:theme');var d=t==='dark'||((t==='system'||!t)&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;if(d)r.classList.add('dark');r.style.colorScheme=d?'dark':'light';}catch(e){}})();`,
     }}
    />
   </head>
   <body className="min-h-full flex flex-col">
    <AuthSessionProvider>
     <QueryProvider>
      <ThemeProvider>
       <LanguageProvider>
        {children}
        <DialogHost />
        <GlobalLoadingBar />
       </LanguageProvider>
      </ThemeProvider>
     </QueryProvider>
    </AuthSessionProvider>
   </body>
  </html>
 );
}
