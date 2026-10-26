import { useEffect, useRef } from 'react';

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
