import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Fluid (inertial, lerp-based) wheel scrolling on a scroll container.
 * Falls back to native scroll on touch devices and when the user prefers
 * reduced motion. Nested `.doc` scroll regions keep their own scroll.
 * Pass a `dep` that changes on tab switch so it re-inits and resets to top.
 */
export function useSmoothScroll(ref: RefObject<HTMLElement>, dep: unknown) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = 0;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (reduce || coarse) return;

    let target = el.scrollTop;
    let current = el.scrollTop;
    let raf = 0;
    let animating = false;

    const clamp = (v: number) => Math.max(0, Math.min(el.scrollHeight - el.clientHeight, v));

    const step = () => {
      current += (target - current) * 0.16;
      if (Math.abs(target - current) < 0.4) {
        current = target;
        el.scrollTop = current;
        animating = false;
        return;
      }
      el.scrollTop = current;
      raf = requestAnimationFrame(step);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      // Carve out nested scroll containers (.doc, .diff-container, .sdiff).
      // When the nested container still has room to scroll: return early so the
      // browser handles it natively. When it's at its boundary: call
      // preventDefault() to prevent scroll chaining up to the page.
      const nested = (e.target as HTMLElement)?.closest?.('.doc, .diff-container, .sdiff') as HTMLElement | null;
      if (nested) {
        const m = nested.scrollHeight - nested.clientHeight;
        if (m > 1) {
          if ((e.deltaY < 0 && nested.scrollTop > 0) || (e.deltaY > 0 && nested.scrollTop < m - 1)) return;
          e.preventDefault();
          return;
        }
      }
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      let d = e.deltaY;
      if (e.deltaMode === 1) d *= 16;
      else if (e.deltaMode === 2) d *= el.clientHeight;
      if (!animating) target = el.scrollTop;
      const next = clamp(target + d);
      if (next === target) {
        // At scroll boundary — consume the event to block OS overscroll bounce
        if ((target === 0 && d < 0) || (target === max && d > 0)) e.preventDefault();
        return;
      }
      target = next;
      e.preventDefault();
      if (!animating) {
        animating = true;
        current = el.scrollTop;
        raf = requestAnimationFrame(step);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);
}
