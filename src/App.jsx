import React, { useCallback, useEffect, useState } from 'react';
import Header from './components/Header';
import DeviceBar from './components/DeviceBar';
import StatusView from './views/StatusView';
import HistoryView from './views/HistoryView';
import CameraView from './views/CameraView';
import ReportsView from './views/ReportsView';
import PlantsView from './views/PlantsView';
import ChatView from './views/ChatView';
import AlertsView from './views/AlertsView';
import LabView from './views/LabView';
import UsageView from './views/UsageView';
import { DEFAULT_SECTION } from './appSections';
import { fetchLogs, fetchMode, fetchNotifications, fetchPlants, fetchState } from './api';

const REFRESH_MS = 5_000;

export default function App() {
  const [activeSection, setActiveSection] = useState(DEFAULT_SECTION);
  const [logs, setLogs] = useState([]);
  const [state, setState] = useState({ light: false, pump: false, buzzer: false, fan: false });
  const [alerts, setAlerts] = useState([]);
  const [plant, setPlant] = useState(null);
  const [mode, setMode] = useState('manual');
  const [loading, setLoading] = useState(true);

  const refreshDashboard = useCallback(async () => {
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
      setPlant(plantsData.find(item => item.is_active) ?? null);
      setMode(modeData.mode ?? 'manual');
    } catch (err) {
      console.error('Dashboard refresh failed:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshDashboard();
    const interval = setInterval(refreshDashboard, REFRESH_MS);
    return () => clearInterval(interval);
  }, [refreshDashboard]);

  const latestLog = logs[0] ?? null;
  const unreadAlertCount = alerts.filter(alert => !alert.acknowledged).length;

  function renderActiveSection() {
    if (activeSection === 'status') {
      return (
        <StatusView
          latest={latestLog}
          state={state}
          plant={plant}
          onStateChange={setState}
          loading={loading}
          mode={mode}
          onModeChange={setMode}
        />
      );
    }

    if (activeSection === 'history') {
      return <HistoryView logs={logs} onLogsCleared={refreshDashboard} />;
    }

    if (activeSection === 'camera') return <CameraView />;
    if (activeSection === 'reports') return <ReportsView />;
    if (activeSection === 'plants') return <PlantsView />;
    if (activeSection === 'chat') return <ChatView />;

    if (activeSection === 'alerts') {
      return <AlertsView alerts={alerts} onAlertsChanged={refreshDashboard} />;
    }

    if (activeSection === 'lab') return <LabView />;
    if (activeSection === 'usage') return <UsageView />;

    return null;
  }

  return (
    <div className="app">
      <Header
        tab={activeSection}
        onTabChange={setActiveSection}
        onRefresh={refreshDashboard}
        unreadCount={unreadAlertCount}
      />

      <DeviceBar latest={latestLog} total={logs.length} plant={plant} />

      <main>{renderActiveSection()}</main>
    </div>
  );
}
