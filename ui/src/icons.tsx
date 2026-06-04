// Stroke icon set. Each takes optional SVG props (className/style/width/height).
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const Briefcase = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><rect x="2" y="7" width="20" height="14" rx="2.5" /><path d="M16 7V5.5A2.5 2.5 0 0 0 13.5 3h-3A2.5 2.5 0 0 0 8 5.5V7" /><path d="M2 13h20" /></svg>
);
export const XCircle = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></svg>
);
export const Wave = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M3 12c2.5 0 2.5-4 5-4s2.5 8 5 8 2.5-4 5-4" /><circle cx="12" cy="12" r="9" /></svg>
);
export const Check = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><rect x="3" y="4.5" width="18" height="17" rx="2.5" /><path d="M8 2.5v4M16 2.5v4M3 10h18" /><path d="m9 15 2 2 4-4" /></svg>
);
export const Clock = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const Search = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={2} {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
);
export const Chevron = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={2} {...p}><path d="m6 9 6 6 6-6" /></svg>
);
export const Ext = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M15 3h6v6M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></svg>
);
export const Doc = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>
);
export const Spark = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /><circle cx="12" cy="12" r="3.2" /></svg>
);
export const Warn = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M10.3 3.8 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
);
export const Panel = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16" /></svg>
);
export const Inbox = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={1.6} {...p}><path d="M3 12h5l2 3h4l2-3h5" /><path d="M5.5 6h13l2.5 6v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6z" /></svg>
);
export const Cog = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
);
