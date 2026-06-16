import { useState, useEffect, useRef, useMemo } from 'react';
import { postLabel, getStats } from '../api';
import type { ApplyQueueRow, HardRejectionRow, SoftRejectionRow, Stats } from '../api';
import { JobCard } from './JobCard';
import { Inbox } from '../icons';

type Mode = 'apply' | 'hard-reject' | 'soft-reject';
type Row = ApplyQueueRow | HardRejectionRow | SoftRejectionRow;

interface Props {
  rows: Row[];
  mode: Mode;
  searchQuery: string;
  onStatsUpdate: (s: Stats) => void;
  onDataChange?: () => void;
  /** Changes only on filter/tab change (not search) so the list replays its entrance. */
  swapKey?: string;
  emptyHint?: string;
}

export function CardList({ rows, mode, searchQuery, onStatsUpdate, onDataChange, swapKey, emptyHint }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [kb, setKb] = useState<number>(-1);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter(r => !q || r.title.toLowerCase().includes(q) || r.company.toLowerCase().includes(q));
  }, [rows, searchQuery]);

  useEffect(() => { setKb(filtered.length ? 0 : -1); refs.current = []; }, [filtered.length, searchQuery, swapKey]);

  useEffect(() => {
    async function labelFocused(l: 'yes' | 'maybe' | 'no', status?: 'applied' | 'skipped' | 'apply_later' | null) {
      const r = filtered[kb];
      if (!r) return;
      await postLabel({ job_id: r.job_id, run_id: r.run_id, label: l, application_status: status ?? null, notes: null });
      onStatsUpdate(await getStats());
      onDataChange?.();
    }
    function onKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!filtered.length) return;
      if (e.key === 'j') { e.preventDefault(); setKb(i => Math.min(i + 1, filtered.length - 1)); }
      else if (e.key === 'k') { e.preventDefault(); setKb(i => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter' && kb >= 0) { e.preventDefault(); const id = filtered[kb].job_id; setOpenId(p => p === id ? null : id); }
      else if (e.key === 'Escape') { setOpenId(null); }
      else if (mode === 'apply') {
        if (e.key === 'y') { e.preventDefault(); void labelFocused('yes'); }
        else if (e.key === 'm') { e.preventDefault(); void labelFocused('maybe'); }
        else if (e.key === 'n') { e.preventDefault(); void labelFocused('no', 'skipped'); }
        else if (e.key === 'a') { e.preventDefault(); void labelFocused('yes', 'applied'); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, kb, mode, onStatsUpdate, onDataChange]);

  useEffect(() => { refs.current[kb]?.scrollIntoView({ block: 'nearest' }); }, [kb]);

  if (!filtered.length) {
    return (
      <div className="empty">
        <div className="empty-mark"><Inbox /></div>
        <h4>Nothing here</h4>
        <p>{searchQuery ? 'No matches for your search.' : (emptyHint ?? 'This queue is empty.')}</p>
      </div>
    );
  }

  return (
    <div className="cards" key={swapKey}>
      {filtered.map((row, i) => (
        <JobCard
          key={`${row.job_id}-${row.run_id}`}
          row={row}
          mode={mode}
          index={i}
          expanded={openId === row.job_id}
          kbFocus={kb === i}
          onToggle={() => { setKb(i); setOpenId(p => p === row.job_id ? null : row.job_id); }}
          onStatsUpdate={onStatsUpdate}
          onDataChange={onDataChange}
          cardRef={el => { refs.current[i] = el; }}
        />
      ))}
    </div>
  );
}
