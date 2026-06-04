import { useState, useEffect, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import { getStats } from './api';
import type { Stats } from './api';
import { ThemeProvider, useTheme, SettingsMenu } from './theme';
import { useSmoothScroll } from './hooks';
import { Sidebar, TABS } from './components/Sidebar';
import { Search, Panel } from './icons';
import { ApplyQueue } from './tabs/ApplyQueue';
import { HardRejections } from './tabs/HardRejections';
import { SoftRejections } from './tabs/SoftRejections';
import { RunHistory } from './tabs/RunHistory';
import { AppliedCalendar } from './tabs/AppliedCalendar';

const TAB_IDS = TABS.map(t => t.id);

function Shell() {
  const { theme, accent, card } = useTheme();
  const [activeTab, setActiveTab] = useState('apply');
  const [stats, setStats] = useState<Stats | null>(null);
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({ apply: 0, hard: 0, soft: 0, applied: 0, history: 0 });
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'total' | 'today'>('total');
  const [collapsed, setCollapsed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const fetchStats = useCallback(() => { getStats(scope).then(setStats).catch(() => undefined); }, [scope]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleStatsUpdate = useCallback((fresh: Stats) => {
    if (scope === 'total') setStats(fresh); else fetchStats();
  }, [scope, fetchStats]);

  const changeTab = useCallback((tab: string) => {
    setActiveTab(tab);
    setRefreshKeys(k => ({ ...k, [tab]: (k[tab] ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= TAB_IDS.length) { e.preventDefault(); changeTab(TAB_IDS[n - 1]); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [changeTab]);

  useSmoothScroll(contentRef, activeTab);

  const meta = TABS.find(t => t.id === activeTab)!;
  const showSearch = activeTab === 'apply' || activeTab === 'hard' || activeTab === 'soft';

  return (
    <div className="app" data-theme={theme} data-card={card} data-density="calm" data-rail={collapsed ? 'collapsed' : 'open'}
      style={{ '--accent': accent } as CSSProperties}>

      <div className="app-bg"><div className="app-field"><i className="a" /><i className="b" /></div><div className="app-grain" /></div>

      <Sidebar activeTab={activeTab} onChange={changeTab} stats={stats} scope={scope} onToggleScope={setScope}
        collapsed={collapsed} onCollapse={() => setCollapsed(c => !c)} />

      <div className="main">
        <header className="topbar">
          {collapsed && (
            <button className="btn btn-icon btn-ghost" onClick={() => setCollapsed(false)} title="Expand sidebar"><Panel style={{ width: 16, height: 16 }} /></button>
          )}
          <div className="topbar-titles">
            <div className="topbar-h">{meta.title}</div>
            <div className="topbar-sub">{meta.sub}</div>
          </div>
          <div className="topbar-spacer" />
          {showSearch && (
            <div className="search">
              <Search />
              <input ref={searchRef} placeholder="Search title or company…" value={search} onChange={e => setSearch(e.target.value)} />
              {search && <button className="clear" onClick={() => setSearch('')} aria-label="Clear">×</button>}
            </div>
          )}
          <SettingsMenu />
        </header>

        <div className="content" ref={contentRef}>
          <div className="tab-swap" key={activeTab}>
            {activeTab === 'apply' && <ApplyQueue onStatsUpdate={handleStatsUpdate} refreshKey={refreshKeys.apply} searchQuery={search} />}
            {activeTab === 'hard' && <HardRejections onStatsUpdate={handleStatsUpdate} refreshKey={refreshKeys.hard} searchQuery={search} />}
            {activeTab === 'soft' && <SoftRejections onStatsUpdate={handleStatsUpdate} refreshKey={refreshKeys.soft} searchQuery={search} />}
            {activeTab === 'applied' && <AppliedCalendar onStatsUpdate={handleStatsUpdate} refreshKey={refreshKeys.applied} />}
            {activeTab === 'history' && <RunHistory refreshKey={refreshKeys.history} />}
          </div>
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  );
}
