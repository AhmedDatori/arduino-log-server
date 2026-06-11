'use strict';

const express = require('express');
const path = require('path');
const { clientDistDir } = require('./config');
const { pool } = require('./database');
const { createGeminiClient } = require('./ai/geminiClient');
const { createGreenhouseState } = require('./services/greenhouseState');
const { createActuatorService } = require('./services/actuators');
const { createAutopilotService } = require('./services/autopilot');
const { registerSensorAndControlRoutes } = require('./routes/sensorAndControlRoutes');
const { registerChatRoutes } = require('./routes/chatRoutes');
const { createAlertAndConversationModule } = require('./routes/alertAndConversationRoutes');
const { registerPlantRoutes } = require('./routes/plantRoutes');
const { registerModeAndAutopilotRoutes } = require('./routes/modeAndAutopilotRoutes');
const { createPlantIntelligenceModule } = require('./routes/plantIntelligenceRoutes');
const { registerAiInsightRoutes } = require('./routes/aiInsightRoutes');
const { registerCameraRoutes } = require('./routes/cameraRoutes');

function createApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(express.static(clientDistDir));

  const stateService = createGreenhouseState(pool);
  const aiClient = createGeminiClient(pool);
  const actuatorService = createActuatorService(pool);
  const autopilotService = createAutopilotService({ pool, stateService, actuatorService, aiClient });

  registerSensorAndControlRoutes(app, { pool, stateService, actuatorService, autopilotService });
  registerChatRoutes(app, { pool, stateService, actuatorService, aiClient });
  const notifications = createAlertAndConversationModule(app, { pool, stateService });
  registerPlantRoutes(app, { pool });
  registerModeAndAutopilotRoutes(app, { pool, stateService, autopilotService });
  const plantIntelligence = createPlantIntelligenceModule(app, { pool, stateService, aiClient });
  registerAiInsightRoutes(app, { pool, stateService, aiClient });
  registerCameraRoutes(app, { pool, plantIntelligence });

  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDistDir, 'index.html'));
  });

  return { app, jobs: { notifications, plantIntelligence } };
}

module.exports = { createApp };
