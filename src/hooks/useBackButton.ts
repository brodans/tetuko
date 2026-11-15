import { useEffect, useRef } from 'react';

// Global registry of active back handlers
if (typeof window !== 'undefined') {
  (window as any).customBackHandlers = (window as any).customBackHandlers || [];
}

/**
 * Unified back-button handler.
 * Supports both call styles:
 *  - BKD:  useBackButton(aktif: boolean, handler)
 *  - Ponorogo: useBackButton(handler, active: boolean)
 */
export function useBackButton(a: boolean | (() => boolean), b: ((...args: unknown[]) => boolean) | boolean) {
  let active: boolean;
  let handler: (...args: unknown[]) => boolean;
  if (typeof a === 'function') {
    handler = a as any;
    active = Boolean(b);
  } else {
    active = Boolean(a);
    handler = (b as any) || (() => false);
  }

  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active) return;
    const currentWrapper = (...args: unknown[]) => handlerRef.current(...args);
    const handlers = (window as any).customBackHandlers as any[];
    handlers.push(currentWrapper);
    return () => {
      const idx = handlers.indexOf(currentWrapper);
      if (idx !== -1) handlers.splice(idx, 1);
    };
  }, [active]);
}
