import type { Stats } from '../api';

interface SidebarProps {
  activeTab: string;
  onChange: (tab: string) => void;
  stats: Stats | null;
  statsScope: 'total' | 'today';
  onToggleScope: () => void;
}

interface NavItem {
  id: string;
  label: string;
  shortcut: string;
  icon: JSX.Element;
  count: number | null;
}

function BriefcaseIcon() {
  return (
    <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function MinusCircleIcon() {
  return (
    <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function CalendarCheckIcon() {
  return (
    <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <polyline points="9 16 11 18 15 14" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function Sidebar({ activeTab, onChange, stats, statsScope, onToggleScope }: SidebarProps) {
  const navItems: NavItem[] = [
    {
      id: 'apply',
      label: 'Apply Queue',
      shortcut: '1',
      icon: <BriefcaseIcon />,
      count: stats?.pending ?? null,
    },
    {
      id: 'hard',
      label: 'Hard Rejections',
      shortcut: '2',
      icon: <XCircleIcon />,
      count: stats?.hardRejectionsUnreviewed ?? null,
    },
    {
      id: 'soft',
      label: 'Soft Rejections',
      shortcut: '3',
      icon: <MinusCircleIcon />,
      count: stats?.softRejectionsUnreviewed ?? null,
    },
    {
      id: 'calendar',
      label: 'Applied',
      shortcut: '4',
      icon: <CalendarCheckIcon />,
      count: stats?.applied ?? null,
    },
    {
      id: 'history',
      label: 'Run History',
      shortcut: '5',
      icon: <ClockIcon />,
      count: null,
    },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">&#9670; Wero</div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`sidebar-nav-item${activeTab === item.id ? ' active' : ''}`}
            onClick={() => onChange(item.id)}
            title={`${item.label} [${item.shortcut}]`}
          >
            {item.icon}
            <span className="sidebar-nav-label">{item.label}</span>
            {item.count !== null && (
              <span className="sidebar-nav-badge">{item.count}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-divider" />

      {stats && (
        <div className="sidebar-stats">
          <div className="sidebar-stat-row">
            <span className="sidebar-stat-label">Pending</span>
            <span className="sidebar-stat-value">{stats.pending}</span>
          </div>
          <div className="sidebar-stat-row">
            <span className="sidebar-stat-label">Applied</span>
            <span className="sidebar-stat-value">{stats.applied}</span>
          </div>
          <button
            type="button"
            className="sidebar-scope-toggle"
            onClick={onToggleScope}
            title={statsScope === 'today' ? 'Showing today. Click for total.' : 'Showing total. Click for today.'}
          >
            {statsScope === 'today' ? 'Show Total' : 'Show Today'}
          </button>
        </div>
      )}
    </aside>
  );
}
