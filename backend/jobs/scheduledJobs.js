'use strict';

function startScheduledJobs({ notifications, plantIntelligence }) {
  const { checkNotifications, intervalMs: notificationIntervalMs } = notifications;
  const { computeHealthScore, generateDailyReport, diagnosePlantFromLatestFrame } = plantIntelligence;

  setInterval(checkNotifications, notificationIntervalMs);
  checkNotifications();

  const HEALTH_INTERVAL_MS = 60 * 60 * 1000;
  setInterval(() => computeHealthScore().catch(e => console.error('[HEALTH auto]', e.message)), HEALTH_INTERVAL_MS);
  setTimeout(() => computeHealthScore().catch(e => console.error('[HEALTH init]', e.message)), 10_000);

  const REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000;
  setInterval(() => generateDailyReport().catch(e => console.error('[REPORT auto]', e.message)), REPORT_INTERVAL_MS);

  const VISION_INTERVAL_MS = 60 * 60 * 1000;
  setInterval(() => diagnosePlantFromLatestFrame().catch(e => console.error('[VISION auto]', e.message)), VISION_INTERVAL_MS);
  setTimeout(() => diagnosePlantFromLatestFrame().catch(() => {}), 30_000);
}

module.exports = { startScheduledJobs };
