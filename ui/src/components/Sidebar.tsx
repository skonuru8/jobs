import type { Stats } from '../api';
import { Briefcase, XCircle, Wave, Check, Clock, Panel, Terminal, CloudUpload } from '../icons';
import type { SVGProps } from 'react';

export const BRAND = { mark: 'J', a: 'jo', b: 'bs', sub: 'job copilot', name: 'jobs' };

export interface NavTab {
  id: string;
  label: string;
  title: string;
  sub: string;
}

export const TABS: NavTab[] = [
  { id: 'apply', label: 'Apply Queue', title: 'Apply Queue', sub: 'Review AI-matched roles and queue your applications' },
  { id: 'hard', label: 'Hard Rejections', title: 'Hard Rejections', sub: 'Roles filtered out before scoring — audit for false negatives' },
  { id: 'soft', label: 'Soft Rejections', title: 'Soft Rejections', sub: 'Scored below threshold — second-look queue' },
  { id: 'applied', label: 'Applied', title: 'Applied', sub: 'Everything you have sent out, by day' },
  { id: 'archived', label: 'Archived', title: 'Archived', sub: 'Jobs backed up to Google Drive' },
  { id: 'history', label: 'Run History', title: 'Run History', sub: 'Scrape & score pipeline runs' },
  { id: 'pipeline', label: 'Run Pipeline', title: 'Pipeline Control', sub: 'Launch runs, toggle orchestrator, stream live output' },
];

const ICONS: Record<string, (p: SVGProps<SVGSVGElement>) => JSX.Element> = {
  apply: Briefcase, hard: XCircle, soft: Wave, applied: Check, archived: CloudUpload, history: Clock, pipeline: Terminal,
};

interface Props {
  activeTab: string;
  onChange: (tab: string) => void;
  stats: Stats | null;
  scope: 'total' | 'today';
  onToggleScope: (s: 'total' | 'today') => void;
  collapsed: boolean;
  onCollapse: () => void;
}

export function Sidebar({ activeTab, onChange, stats, scope, onToggleScope, collapsed, onCollapse }: Props) {
  const counts: Record<string, number | null> = {
    apply:    stats?.pending ?? null,
    hard:     stats?.hardRejectionsUnreviewed ?? null,
    soft:     stats?.softRejectionsUnreviewed ?? null,
    applied:  stats?.applied ?? null,
    archived: stats?.archived ?? null,
    history:  null,
    pipeline: null,
  };
  const spark = [5, 8, 6, 11, 7, 9, 14, 10, 12, 8];
  const mx = Math.max(...spark);

  return (
    <aside className="rail">
      <div className="rail-top">
        <div className="rail-mark">{BRAND.mark}</div>
        {!collapsed && (
          <div>
            <div className="rail-word">{BRAND.a}<b>{BRAND.b}</b></div>
            <div className="rail-sub">{BRAND.sub}</div>
          </div>
        )}
        {!collapsed && (
          <button className="rail-collapse" onClick={onCollapse} title="Collapse"><Panel style={{ width: 14, height: 14 }} /></button>
        )}
      </div>

      <nav className="nav">
        {TABS.map(t => {
          const Icon = ICONS[t.id];
          const c = counts[t.id];
          return (
            <button key={t.id} className={`nav-item${activeTab === t.id ? ' active' : ''}`} onClick={() => onChange(t.id)} title={t.label}>
              <Icon className="nav-ic" />
              <span className="nav-label">{t.label}</span>
              {c != null && <span className={`nav-count${(t.id === 'hard' || t.id === 'soft') && c > 0 ? ' hot' : ''}`}>{c}</span>}
            </button>
          );
        })}
      </nav>

      <div className="rail-spacer" />

      {stats && (
        <div className="rail-stats">
          <div className="rail-stats-head">
            <span className="rail-stats-title">Pipeline</span>
            <div className="scope-toggle">
              <button className={scope === 'today' ? 'on' : ''} onClick={() => onToggleScope('today')}>Today</button>
              <button className={scope === 'total' ? 'on' : ''} onClick={() => onToggleScope('total')}>Total</button>
            </div>
          </div>
          <div className="stat-bento">
            <div className="stat-bento-main">
              <div>
                <div className="stat-num">{stats.pending}</div>
                <div className="stat-lbl">Pending</div>
              </div>
              <div className="stat-spark">{spark.map((v, i) => <i key={i} style={{ height: `${(v / mx) * 100}%`, opacity: 0.3 + 0.6 * (i / spark.length) }} />)}</div>
            </div>
            <div className="stat-bento-sec">
              <div className="stat-num">{stats.applied}</div>
              <div className="stat-lbl">Applied</div>
            </div>
          </div>
        </div>
      )}

      <div className="rail-foot">
        <div className="rail-avatar">{BRAND.mark}</div>
        <div className="rail-foot-txt">
          <div className="rail-foot-name">{BRAND.name}</div>
          <div className="rail-foot-mail">local pipeline</div>
        </div>
      </div>
    </aside>
  );
}
