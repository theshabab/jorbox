import { useEffect } from 'react';

// Keeps the phone screen on while a deck is open, so it does not dim between
// turns. Browsers release the lock when the tab is hidden; take it again on return.
export function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock = null;
    let active = true;
    let pending = false;
    async function acquire() {
      if (
        !active ||
        pending ||
        document.visibilityState !== 'visible' ||
        (lock && !lock.released)
      )
        return;
      pending = true;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (active && document.visibilityState === 'visible') lock = next;
        else next.release().catch(() => {});
      } catch {
        // Denied (battery saver, permissions policy): the screen may dim as usual.
      } finally {
        pending = false;
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
