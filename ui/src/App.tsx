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

      <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />

      <main className="tab-content">
        {activeTab === 'apply' && <ApplyQueue onStatsUpdate={setStats} />}
        {activeTab === 'hard' && <HardRejections onStatsUpdate={setStats} />}
        {activeTab === 'soft' && <SoftRejections onStatsUpdate={setStats} />}
      </main>
    </div>
  );
}
