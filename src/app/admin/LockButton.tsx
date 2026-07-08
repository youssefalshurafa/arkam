'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Manually re-locks the admin panel (clears the unlock cookie set by AdminUnlockGate),
// so the admin can lock it before walking away instead of waiting out the 12h TTL.
export default function LockButton() {
 const router = useRouter();
 const [isLocking, setIsLocking] = useState(false);

 const handleLock = async () => {
  setIsLocking(true);
  try {
   await fetch('/api/admin/unlock', { method: 'DELETE' });
   router.refresh();
  } finally {
   setIsLocking(false);
  }
 };

 return (
  <button
   onClick={() => void handleLock()}
   disabled={isLocking}
   className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
  >
   {isLocking ? 'Locking…' : 'Lock'}
  </button>
 );
}
