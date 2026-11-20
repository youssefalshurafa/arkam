import { redirect } from 'next/navigation';

// The support-approval reset request was folded into /forgot-password, which now handles
// username-only accounts itself (and answers uniformly, so it can't be used to probe which
// usernames exist). Old links and bookmarks land there.
export default function ResetRequestPage() {
 redirect('/forgot-password');
}
