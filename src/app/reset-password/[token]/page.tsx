'use client';

import { useParams } from 'next/navigation';
import PasswordTokenForm from '@/components/auth/PasswordTokenForm';

// Emailed "Forgot password" link. Using it also marks the account's email as verified.
export default function ResetPasswordPage() {
 const params = useParams<{ token: string }>();
 return <PasswordTokenForm token={params?.token || ''} purpose="reset" />;
}
