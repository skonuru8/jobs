import { useState, useEffect, useCallback, useRef } from 'react';
import { getStats } from './api';
import type { Stats } from './api';
import { Sidebar } from './components/Sidebar';
import { ApplyQueue } from './tabs/ApplyQueue';
import { HardRejections } from './tabs/HardRejections';
import { SoftRejections } from './tabs/SoftRejections';
import { RunHistory } from './tabs/RunHistory';
import { AppliedCalendar } from './tabs/AppliedCalendar';

const TABS = [
  { id: 'apply', label: 'Apply Queue' },
  { id: 'hard', label: 'Hard Rejections' },
  { id: 'soft', label: 'Soft Rejections' },
  { id: 'history', label: 'Run History' },
  { id: 'calendar', label: 'Applied' },
];

const TAB_IDS = TABS.map(t => t.id);

export function App() {
  const [activeTab, setActiveTab] = useState('apply');
  const [stats, setStats] = useState<Stats | null>(null);
  const [tabRefreshKeys, setTabRefreshKeys] = useState({ apply: 0, hard: 0, soft: 0, history: 0, calendar: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [statsScope, setStatsScope] = useState<'total' | 'today'>('total');
  const searchRef = useRef<HTMLInputElement>(null);

  function handleTabChange(tab: string) {
    setActiveTab(tab);
    setTabRefreshKeys(k => ({ ...k, [tab]: (k as Record<string, number>)[tab] + 1 }));
  }

  const fetchStats = useCallback(() => {
    getStats(statsScope).then(setStats).catch(console.error);
  }, [statsScope]);

  const handleStatsUpdate = useCallback((fresh: Stats) => {
    if (statsScope === 'total') {
      setStats(fresh);
    } else {
      fetchStats();
    }
  }, [fetchStats, statsScope]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
        const idx = parseInt(e.key, 10);
        if (idx >= 1 && idx <= TAB_IDS.length) {
          e.preventDefault();
          handleTabChange(TAB_IDS[idx - 1]);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const showSearch = activeTab === 'apply' || activeTab === 'hard' || activeTab === 'soft';

  return (
    <div className="app">
      <Sidebar
        activeTab={activeTab}
        onChange={handleTabChange}
        stats={stats}
        statsScope={statsScope}
        onToggleScope={() => setStatsScope(scope => scope === 'today' ? 'total' : 'today')}
      />

      <div className="main">
        {showSearch && (
          <div className="search-bar">
            <input
              ref={searchRef}
              className="search-input"
              type="text"
              placeholder="Search by title or company..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery('')}>x</button>
            )}
            <span className="kbd-hint">
              <span className="kbd">j</span><span className="kbd">k</span> navigate
              <span className="kbd" style={{ marginLeft: 6 }}>y</span><span className="kbd">m</span><span className="kbd">n</span> label
              <span className="kbd" style={{ marginLeft: 6 }}>a</span> applied
              <span className="kbd" style={{ marginLeft: 6 }}>/</span> search
            </span>
          </div>
        )}

        <main className="tab-content">
          {activeTab === 'apply' && <ApplyQueue onStatsUpdate={handleStatsUpdate} refreshKey={tabRefreshKeys.apply} searchQuery={searchQuery} />}
          {activeTab === 'hard' && <HardRejections onStatsUpdate={handleStatsUpdate} refreshKey={tabRefreshKeys.hard} searchQuery={searchQuery} />}
          {activeTab === 'soft' && <SoftRejections onStatsUpdate={handleStatsUpdate} refreshKey={tabRefreshKeys.soft} searchQuery={searchQuery} />}
          {activeTab === 'history' && <RunHistory refreshKey={tabRefreshKeys.history} />}
          {activeTab === 'calendar' && <AppliedCalendar onStatsUpdate={handleStatsUpdate} refreshKey={tabRefreshKeys.calendar} />}
        </main>
      </div>
    </div>
  );
}
