import { useEffect, useRef } from 'react';

// Subscribes to OS window events forwarded by the Electron main process.
// Uses a ref so the underlying IPC listener is registered exactly once, even
// though `handler` is recreated on renders.
export function useWindowEvents(handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!window.electronAPI) {
      console.warn('electronAPI not found — are you running inside Electron?');
      return undefined;
    }
    const unsubscribe = window.electronAPI.onWindowEvent((data) => {
      handlerRef.current(data);
    });
    return unsubscribe;
  }, []);
}
