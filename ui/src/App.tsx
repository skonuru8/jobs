import { useState, useEffect, useCallback, useRef } from 'react';
import { getStats } from './api';
import type { Stats } from './api';
import { Tabs } from './components/Tabs';
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

export function App() {
  const [activeTab, setActiveTab] = useState('apply');
  const [stats, setStats] = useState<Stats | null>(null);
  const [tabRefreshKeys, setTabRefreshKeys] = useState({ apply: 0, hard: 0, soft: 0, history: 0, calendar: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  function handleTabChange(tab: string) {
    setActiveTab(tab);
    setTabRefreshKeys(k => ({ ...k, [tab]: (k as Record<string, number>)[tab] + 1 }));
  }

  const fetchStats = useCallback(() => {
    getStats().then(setStats).catch(console.error);
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">Job Hunter</span>
        {stats && (
          <div className="header-stats">
            <span className="stat">Pending <strong>{stats.pending}</strong></span>
            <span className="stat">Later <strong>{stats.applyLater}</strong></span>
            <span className="stat">Applied <strong>{stats.applied}</strong></span>
            <span className="stat">Reject <strong>{stats.hardRejectionsUnreviewed}</strong></span>
            <span className="stat">Soft <strong>{stats.softRejectionsUnreviewed}</strong></span>
          </div>
        )}
      </header>

      <Tabs tabs={TABS} active={activeTab} onChange={handleTabChange} />

      {(activeTab === 'apply' || activeTab === 'hard' || activeTab === 'soft') && (
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
        {activeTab === 'apply' && <ApplyQueue onStatsUpdate={setStats} refreshKey={tabRefreshKeys.apply} searchQuery={searchQuery} />}
        {activeTab === 'hard' && <HardRejections onStatsUpdate={setStats} refreshKey={tabRefreshKeys.hard} searchQuery={searchQuery} />}
        {activeTab === 'soft' && <SoftRejections onStatsUpdate={setStats} refreshKey={tabRefreshKeys.soft} searchQuery={searchQuery} />}
        {activeTab === 'history' && <RunHistory refreshKey={tabRefreshKeys.history} />}
        {activeTab === 'calendar' && <AppliedCalendar onStatsUpdate={setStats} refreshKey={tabRefreshKeys.calendar} />}
      </main>
    </div>
  );
}
