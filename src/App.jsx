import React, { useState, useEffect, useCallback } from 'react';
import Header      from './components/Header';
import DeviceBar   from './components/DeviceBar';
import StatusView  from './components/StatusView';
import HistoryView from './components/HistoryView';
import ReportsView from './components/ReportsView';
import ChatView    from './components/ChatView';
import AlertsView  from './components/AlertsView';
import { fetchLogs, fetchState, fetchNotifications } from './api';

const REFRESH_MS = 5_000;

export default function App() {
  const [tab,     setTab]     = useState('status');
  const [logs,    setLogs]    = useState([]);
  const [state,   setState]   = useState({ light: false, pump: false, buzzer: false });
  const [alerts,  setAlerts]  = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [logsData, stateData, alertsData] = await Promise.all([
        fetchLogs(),
        fetchState(),
        fetchNotifications(),
      ]);
      setLogs(logsData);
      setState(stateData);
      setAlerts(alertsData);
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

      <DeviceBar latest={latest} total={logs.length} />

      <main>
        {tab === 'status' && (
          <StatusView
            latest={latest}
            state={state}
            onStateChange={setState}
            onLogsCleared={refresh}
            loading={loading}
          />
        )}
        {tab === 'history' && (
          <HistoryView logs={logs} onLogsCleared={refresh} />
        )}
        {tab === 'reports' && (
          <ReportsView />
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
