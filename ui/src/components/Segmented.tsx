import { useEffect, useRef, useState } from 'react';

export interface SegOption<T extends string> {
  value: T;
  label: string;
  count?: number | null;
}

interface Props<T extends string> {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
}

/** Segmented control with a sliding active indicator. */
export function Segmented<T extends string>({ value, options, onChange }: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const measure = () => {
      const wrap = ref.current;
      if (!wrap) return;
      const on = wrap.querySelector<HTMLElement>('.seg.on');
      if (on) setInd({ left: on.offsetLeft, top: on.offsetTop, width: on.offsetWidth, height: on.offsetHeight });
    };
    measure();
    const id = requestAnimationFrame(measure);
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(() => undefined);
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', onResize); };
  }, [value, options]);

  return (
    <div className="segmented" ref={ref}>
      {ind && <span className="seg-ind" style={{ left: ind.left, top: ind.top, width: ind.width, height: ind.height }} />}
      {options.map(o => (
        <button key={o.value} className={`seg${value === o.value ? ' on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}{o.count != null && <span className="c">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
