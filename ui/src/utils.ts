// Small shared helpers.
export function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function fmtDuration(a: string, b: string | null): string {
  if (!b) return '—';
  const s = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}

export const pct = (n: number): number => Math.round(n * 100);

export function scoreColor(p: number): string {
  return p >= 85 ? 'var(--pos)' : p >= 70 ? 'var(--accent-line)' : p >= 55 ? 'var(--warn)' : 'var(--neg)';
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
