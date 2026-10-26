import { useEffect } from 'react';

// Keeps the phone screen on while a deck is open, so it does not dim between
// turns. Browsers release the lock when the tab is hidden; take it again on return.
export function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock = null;
    let active = true;
    async function acquire() {
      if (document.visibilityState !== 'visible' || (lock && !lock.released))
        return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (active) lock = next;
        else next.release().catch(() => {});
      } catch {
        // Denied (battery saver, permissions policy): the screen may dim as usual.
      }
    }
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', acquire);
      lock?.release().catch(() => {});
    };
  }, []);
}
