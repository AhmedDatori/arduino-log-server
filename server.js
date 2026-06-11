'use strict';

const { port } = require('./backend/config');
const { initDB } = require('./backend/database');
const { createApp } = require('./backend/app');
const { startScheduledJobs } = require('./backend/jobs/scheduledJobs');

initDB()
  .then(() => {
    const { app, jobs } = createApp();
    app.listen(port, '0.0.0.0', () => {
      console.log('Smart Green House server running on port ' + port);
      startScheduledJobs(jobs);
    });
  })
  .catch(err => {
    console.error('[FATAL] DB init failed:', err.message);
    process.exit(1);
  });
