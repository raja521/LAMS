import process from 'node:process';
import config from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { createApp } from './app.js';
import logger from './utils/logger.js';
import { verifyTemplateDirectory } from './services/templateService.js';
import { startScheduler, stopScheduler } from './services/schedulerService.js';
import { describeAll } from './connectors/index.js';

async function start() {
  await connectDatabase();

  // Fail loudly at boot rather than at the moment someone clicks "generate".
  const templateCounts = await verifyTemplateDirectory();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`LAMS API listening on ${config.apiBaseUrl} (${config.nodeEnv})`);
    logger.info(`Sign-in methods: ${config.auth.providers.join(', ')}`);
    logger.info(`Document storage: ${config.storage.provider}`);
    logger.info(`GIS provider: ${config.gis.provider}   Application intake: ${config.intake.source}`);
    logger.info(
      `Templates loaded from ${config.documents.templateDir}: ` +
        Object.entries(templateCounts)
          .map(([kind, count]) => `${kind}=${count}`)
          .join(', ')
    );
    const connectorStates = describeAll();
    const on = connectorStates.filter((connector) => connector.enabled);
    logger.info(
      `Connectors: ${on.length ? on.map((c) => `${c.id}=${c.state}`).join(', ') : 'none switched on'}`
    );
    for (const connector of on.filter((c) => c.state === 'not_configured')) {
      logger.warn(`${connector.name} is switched on but not configured: ${connector.message}`);
    }

    const registered = startScheduler();
    if (registered.length) {
      logger.info(`Scheduled jobs: ${registered.map((job) => `${job.name} (${job.expression})`).join(', ')}`);
    }

    if (config.defaultsApplied.length) {
      logger.warn(`Defaults applied for optional settings: ${config.defaultsApplied.join(', ')}`);
    }
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down.`);
    stopScheduler();
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  logger.error('Failed to start LAMS API:', error.message);
  process.exit(1);
});
