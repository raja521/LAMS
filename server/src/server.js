import fs from 'node:fs/promises';
import process from 'node:process';
import config from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { createApp } from './app.js';
import logger from './utils/logger.js';
import { verifyTemplateDirectory } from './services/templateService.js';
import { startScheduler, stopScheduler } from './services/schedulerService.js';
import { describeAll } from './connectors/index.js';

/**
 * Create the directories the application writes into, so a fresh checkout — or a
 * fresh server with an empty disk — does not fail the first time someone
 * generates a document or a report.
 */
async function ensureRuntimeDirectories() {
  const directories = [config.reporting.outputDir];
  if (config.storage.provider === 'local') directories.push(config.storage.localPath);
  if (config.connectors.accufund.enabled) {
    directories.push(
      config.connectors.accufund.exportDir,
      config.connectors.accufund.importDir,
      config.connectors.accufund.archiveDir
    );
  }
  for (const directory of directories.filter(Boolean)) {
    await fs.mkdir(directory, { recursive: true });
  }
}

async function start() {
  await connectDatabase();
  await ensureRuntimeDirectories();

  // Fail loudly at boot rather than at the moment someone clicks "generate".
  const templateCounts = await verifyTemplateDirectory();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`LAMS API listening on ${config.apiBaseUrl} (${config.nodeEnv})`);
    logger.info(`Accepting browser requests from: ${config.corsOrigins.join(', ')}`);
    logger.info(`Self-registration: ${config.auth.allowRegistration ? 'open' : 'closed'}`);
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

    /*
     * Most settings are expected to sit at their default, so this is reported
     * rather than warned about — but it is still reported, so a default is
     * never a silent substitution. Run `npm run env:check` to see the values.
     */
    if (config.defaultsApplied.length) {
      logger.info(`${config.defaultsApplied.length} setting(s) using their default value.`);
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
