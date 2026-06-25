'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function VerifyEmailPage() {
 const router = useRouter();
 const params = useParams();
 const token = params?.token as string;

 const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
 const [errorMessage, setErrorMessage] = useState('');

 useEffect(() => {
  if (!token) {
   setStatus('error');
   setErrorMessage('Invalid verification link.');
   return;
  }

  let isMounted = true;

  const verify = async () => {
   try {
    const res = await fetch(`/api/auth/signup/verify?token=${encodeURIComponent(token)}`);
    if (!isMounted) return;

    if (res.ok) {
     setStatus('success');
     // Brief success flash before redirecting
     setTimeout(() => {
      router.replace(`/signup/complete?token=${encodeURIComponent(token)}`);
     }, 800);
    } else {
     const data = (await res.json()) as { error?: string };
     setStatus('error');
     setErrorMessage(data.error || 'Verification failed.');
    }
   } catch {
    if (!isMounted) return;
    setStatus('error');
    setErrorMessage('Network error. Please try again.');
   }
  };

  void verify();

  return () => {
   isMounted = false;
  };
 }, [token, router]);

 return (
  <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
   <div className="w-full max-w-sm">
    <div className="mb-6 text-center">
     <div className="inline-flex items-center justify-center rounded bg-blue-800 px-4 py-2 mb-3">
      <span className="text-lg font-bold tracking-widest text-white">ARKAM</span>
     </div>
    </div>

    <section className="rounded border border-gray-300 bg-white p-8 shadow-md text-center">
     {status === 'loading' && (
      <>
       <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
       <p className="text-sm text-gray-600">Verifying your email…</p>
      </>
     )}

     {status === 'success' && (
      <>
       <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
        <svg
         width="24"
         height="24"
         viewBox="0 0 24 24"
         fill="none"
         stroke="#16a34a"
         strokeWidth="2.5"
         strokeLinecap="round"
         strokeLinejoin="round"
        >
         <polyline points="20 6 9 17 4 12" />
        </svg>
       </div>
       <p className="text-base font-semibold text-gray-900 mb-1">Email verified!</p>
       <p className="text-sm text-gray-500">Setting up your account…</p>
      </>
     )}

     {status === 'error' && (
      <>
       <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
        <svg
         width="24"
         height="24"
         viewBox="0 0 24 24"
         fill="none"
         stroke="#dc2626"
         strokeWidth="2.5"
         strokeLinecap="round"
         strokeLinejoin="round"
        >
         <line
          x1="18"
          y1="6"
          x2="6"
          y2="18"
         />
         <line
          x1="6"
          y1="6"
          x2="18"
          y2="18"
         />
        </svg>
       </div>
       <p className="text-base font-semibold text-gray-900 mb-1">Link expired or invalid</p>
       <p className="text-sm text-gray-500 mb-6">{errorMessage}</p>
       <button
        onClick={() => router.push('/signup')}
        className="rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
       >
        Back to sign up
       </button>
      </>
     )}
    </section>
   </div>
  </main>
 );
}
