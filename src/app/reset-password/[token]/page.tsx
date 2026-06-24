'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function ResetPasswordPage() {
 const router = useRouter();
 const params = useParams<{ token: string }>();
 const token = params?.token || '';

 const [password, setPassword] = useState('');
 const [confirmPassword, setConfirmPassword] = useState('');
 const [error, setError] = useState('');
 const [success, setSuccess] = useState('');
 const [isTokenValid, setIsTokenValid] = useState(true);
 const [isValidating, setIsValidating] = useState(true);
 const [isSubmitting, setIsSubmitting] = useState(false);

 useEffect(() => {
  let isMounted = true;

  const validateToken = async () => {
   if (!token) {
    if (isMounted) {
     setIsTokenValid(false);
     setIsValidating(false);
    }
    return;
   }

   try {
    const response = await fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`);
    const payload = (await response.json()) as { valid?: boolean };

    if (!isMounted) {
     return;
    }

    setIsTokenValid(Boolean(payload.valid));
   } catch {
    if (isMounted) {
     setIsTokenValid(false);
    }
   } finally {
    if (isMounted) {
     setIsValidating(false);
    }
   }
  };

  void validateToken();

  return () => {
   isMounted = false;
  };
 }, [token]);

 const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  setError('');
  setSuccess('');

  if (password.length < 8) {
   setError('Password must be at least 8 characters.');
   return;
  }

  if (password !== confirmPassword) {
   setError('Passwords do not match.');
   return;
  }

  setIsSubmitting(true);

  try {
   const response = await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: {
     'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token, password }),
   });

   const payload = (await response.json()) as { ok?: boolean; error?: string };

   if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Failed to reset password.');
   }

   setSuccess('Password reset successful. Redirecting to sign in...');
   router.replace('/login');
   return;
  } catch (resetError) {
   setError(resetError instanceof Error ? resetError.message : 'Failed to reset password.');
  } finally {
   setIsSubmitting(false);
  }
 };

 return (
  <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
   <div className="w-full max-w-sm">
    <div className="mb-6 text-center">
     <div className="inline-flex items-center justify-center rounded bg-blue-800 px-4 py-2 mb-3">
      <span className="text-lg font-bold tracking-widest text-white">ARKAM</span>
     </div>
    </div>
    <section className="rounded border border-gray-300 bg-white shadow-md">
     <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
      <h2 className="text-sm font-semibold text-gray-700">Set a New Password</h2>
     </div>
     <div className="p-5">
      {isValidating ? <p className="text-sm text-gray-500">Validating reset link...</p> : null}

      {!isValidating && !isTokenValid ? (
       <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">This reset link is invalid or has expired.</div>
      ) : null}

      {!isValidating && isTokenValid ? (
       <form
        className="space-y-4"
        onSubmit={(event) => void onSubmit(event)}
       >
        <div>
         <label className="mb-1 block text-xs font-semibold text-gray-600">New password</label>
         <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="New password"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          minLength={8}
          required
         />
        </div>
        <div>
         <label className="mb-1 block text-xs font-semibold text-gray-600">Confirm password</label>
         <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="Confirm password"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          minLength={8}
          required
         />
        </div>

        {error ? <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        {success ? <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p> : null}

        <button
         type="submit"
         disabled={isSubmitting}
         className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
         {isSubmitting ? 'Resetting...' : 'Reset password'}
        </button>
       </form>
      ) : null}

      <div className="mt-4 border-t border-gray-200 pt-4 text-center">
       <button
        type="button"
        onClick={() => router.push('/login')}
        className="text-sm text-blue-700 transition hover:text-blue-900 hover:underline"
       >
        Back to sign in
       </button>
      </div>
     </div>
    </section>
   </div>
  </main>
 );
}
