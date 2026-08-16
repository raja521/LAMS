import { Router } from 'express';
import mongoose from 'mongoose';
import config from '../config/env.js';
import authRoutes from './auth.routes.js';
import usersRoutes from './users.routes.js';
import parcelsRoutes from './parcels.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import activityRoutes from './activity.routes.js';
import acquisitionRoutes from './acquisition.routes.js';
import managementRoutes from './management.routes.js';
import dispositionRoutes from './disposition.routes.js';
import documentsRoutes from './documents.routes.js';
import gisRoutes from './gis.routes.js';
import reportsRoutes from './reports.routes.js';
import integrationsRoutes from './integrations.routes.js';

const router = Router();

router.get('/health', (_req, res) => {
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.json({
    status: 'ok',
    environment: config.nodeEnv,
    database: dbStates[mongoose.connection.readyState] ?? 'unknown',
    uptimeSeconds: Math.round(process.uptime()),
  });
});

/** What is switched on in this environment, so the UI can hide what is off. */
router.get('/config', (_req, res) => {
  res.json({
    appEnvironment: config.nodeEnv,
    features: config.features,
    gis: { provider: config.gis.provider },
    intake: { source: config.intake.source },
    storage: { provider: config.storage.provider },
  });
});

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/parcels', parcelsRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/activity', activityRoutes);

/* The three modules */
router.use('/acquisition', acquisitionRoutes);
router.use('/management', managementRoutes);
router.use('/disposition', dispositionRoutes);

/* Shared across all three */
router.use('/documents', documentsRoutes);
router.use('/gis', gisRoutes);
router.use('/reports', reportsRoutes);
router.use('/integrations', integrationsRoutes);

export default router;
