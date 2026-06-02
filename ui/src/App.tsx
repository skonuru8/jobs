import { useState, useEffect, useCallback } from 'react';
import { getStats } from './api';
import type { Stats } from './api';
import { Tabs } from './components/Tabs';
import { ApplyQueue } from './tabs/ApplyQueue';
import { HardRejections } from './tabs/HardRejections';
import { SoftRejections } from './tabs/SoftRejections';

const TABS = [
  { id: 'apply', label: 'Apply Queue' },
  { id: 'hard', label: 'Hard Rejections' },
  { id: 'soft', label: 'Soft Rejections' },
];

export function App() {
  const [activeTab, setActiveTab] = useState('apply');
  const [stats, setStats] = useState<Stats | null>(null);
  const [tabRefreshKeys, setTabRefreshKeys] = useState({ apply: 0, hard: 0, soft: 0 });

  function handleTabChange(tab: string) {
    setActiveTab(tab);
    setTabRefreshKeys(k => ({ ...k, [tab]: k[tab as keyof typeof k] + 1 }));
  }

  const fetchStats = useCallback(() => {
    getStats().then(setStats).catch(console.error);
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">Job Hunter</span>
        {stats && (
          <div className="header-stats">
            <span className="stat">Pending: <strong>{stats.pending}</strong></span>
            <span className="stat">Apply Later: <strong>{stats.applyLater}</strong></span>
            <span className="stat">Applied: <strong>{stats.applied}</strong></span>
            <span className="stat">Reject: <strong>{stats.hardRejectionsUnreviewed}</strong></span>
            <span className="stat">Soft: <strong>{stats.softRejectionsUnreviewed}</strong></span>
          </div>
        )}
      </header>

      <Tabs tabs={TABS} active={activeTab} onChange={handleTabChange} />

      <main className="tab-content">
        {activeTab === 'apply' && <ApplyQueue onStatsUpdate={setStats} refreshKey={tabRefreshKeys.apply} />}
        {activeTab === 'hard' && <HardRejections onStatsUpdate={setStats} refreshKey={tabRefreshKeys.hard} />}
        {activeTab === 'soft' && <SoftRejections onStatsUpdate={setStats} refreshKey={tabRefreshKeys.soft} />}
      </main>
    </div>
  );
}
