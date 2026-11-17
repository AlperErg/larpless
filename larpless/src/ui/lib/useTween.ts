import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export type Ease = (t: number) => number;

export const easeOut: Ease = (t) => 1 - (1 - t) ** 3;

/** CSS-style cubic-bezier(x1, y1, x2, y2) easing, solved for x by Newton steps then bisection. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const a = (p1: number, p2: number) => 1 - 3 * p2 + 3 * p1;
  const b = (p1: number, p2: number) => 3 * p2 - 6 * p1;
  const c = (p1: number) => 3 * p1;
  const at = (t: number, p1: number, p2: number) => ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t;
  const slope = (t: number, p1: number, p2: number) => 3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1);
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const s = slope(t, x1, x2);
      if (Math.abs(s) < 1e-6) break;
      t -= (at(t, x1, x2) - x) / s;
    }
    if (t < 0 || t > 1 || Math.abs(at(t, x1, x2) - x) > 1e-4) {
      let lo = 0;
      let hi = 1;
      t = x;
      for (let i = 0; i < 30; i++) {
        if (at(t, x1, x2) < x) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return at(t, y1, y2);
  };
}

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((v) => {
    reduceMotion = v;
  })
  .catch(() => {});

/**
 * A number that eases towards `target` over `ms`, re-rendering each frame. Used instead of Animated because
 * react-native-windows blanks Animated views (see ANIMATE in platform.ts): plain views with plain numbers animate
 * on both platforms. Keep it to small subtrees. Jumps straight to the target when the OS asks for reduced motion.
 */
export function useTween(target: number, ms = 280, delayMs = 0, ease: Ease = easeOut): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const valueRef = useRef(target);
  valueRef.current = value;

  useEffect(() => {
    if (reduceMotion || ms <= 0 || valueRef.current === target) {
      setValue(target);
      return undefined;
    }
    from.current = valueRef.current;
    let frame: ReturnType<typeof requestAnimationFrame> | null = null;
    let start: number | null = null;
    const step = (now: number) => {
      if (start == null) start = now;
      const t = Math.min(1, Math.max(0, (now - start - delayMs) / ms));
      setValue(from.current + (target - from.current) * ease(t));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [target, ms, delayMs]); // eslint-disable-line react-hooks/exhaustive-deps -- ease is a module constant

  return value;
}
