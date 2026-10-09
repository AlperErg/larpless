import { useEffect, useState } from 'react';
import { layout, space } from '../theme';
import { useViewport } from './viewport';

/** Content side padding: 48 px, or 32 px when the window is near its 900 px minimum. */
export function useGutter(): number {
  const width = useViewport((s) => s.w);
  return width < 1000 ? space.xxl : layout.contentPadding;
}

/** Date.now(), refreshed every `intervalMs` (only while mounted and `active`). */
export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return now;
}
