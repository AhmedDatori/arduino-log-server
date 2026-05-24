import React, { useState, useEffect, useCallback } from 'react';
import Header      from './components/Header';
import DeviceBar   from './components/DeviceBar';
import StatusView  from './components/StatusView';
import HistoryView from './components/HistoryView';
import ReportsView from './components/ReportsView';
import PlantsView  from './components/PlantsView';
import ChatView    from './components/ChatView';
import AlertsView  from './components/AlertsView';
import { fetchLogs, fetchState, fetchNotifications, fetchPlants, fetchMode } from './api';

const REFRESH_MS = 5_000;

export default function App() {
  const [tab,     setTab]     = useState('status');
  const [logs,    setLogs]    = useState([]);
  const [state,   setState]   = useState({ light: false, pump: false, buzzer: false });
  const [alerts,  setAlerts]  = useState([]);
  const [plant,   setPlant]   = useState(null);
  const [mode,    setMode]    = useState('manual');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [logsData, stateData, alertsData, plantsData, modeData] = await Promise.all([
        fetchLogs(),
        fetchState(),
        fetchNotifications(),
        fetchPlants(),
        fetchMode().catch(() => ({ mode: 'manual' })),
      ]);
      setLogs(logsData);
      setState(stateData);
      setAlerts(alertsData);
      setPlant(plantsData.find(p => p.is_active) ?? null);
      setMode(modeData.mode ?? 'manual');
    } catch (err) {
      console.error('Refresh error:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const latest      = logs[0] ?? null;
  const unreadCount = alerts.filter(a => !a.acknowledged).length;

  return (
    <div className="app">
      <Header
        tab={tab}
        onTabChange={setTab}
        onRefresh={refresh}
        unreadCount={unreadCount}
      />

      <DeviceBar latest={latest} total={logs.length} plant={plant} />

      <main>
        {tab === 'status' && (
          <StatusView
            latest={latest}
            state={state}
            plant={plant}
            onStateChange={setState}
            onLogsCleared={refresh}
            loading={loading}
            mode={mode}
            onModeChange={setMode}
          />
        )}
        {tab === 'history' && (
          <HistoryView logs={logs} onLogsCleared={refresh} />
        )}
        {tab === 'reports' && (
          <ReportsView />
        )}
        {tab === 'plants' && (
          <PlantsView />
        )}
        {tab === 'chat' && (
          <ChatView />
        )}
        {tab === 'alerts' && (
          <AlertsView alerts={alerts} onAlertsChanged={refresh} />
        )}
      </main>
    </div>
  );
}
