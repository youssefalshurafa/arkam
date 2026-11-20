'use client';

import { useParams } from 'next/navigation';
import PasswordTokenForm from '@/components/auth/PasswordTokenForm';

// One-time account setup link (/setup/[token]) minted for a super admin or workspace owner
// to hand over out-of-band: new admin-created accounts, admin password resets, approved
// support reset requests, and username-only invitees.
export default function SetupPasswordPage() {
 const params = useParams<{ token: string }>();
 return <PasswordTokenForm token={params?.token || ''} purpose="setup" />;
}
