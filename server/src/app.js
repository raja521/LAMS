import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import config, { ROOT_DIR } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import logger from './utils/logger.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and server-to-server calls arrive without an Origin header.
        if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not in CORS_ORIGINS.`));
      },
      credentials: true,
    })
  );

  app.use(
    express.json({
      limit: '1mb',
      // Kept so the intake webhook can verify its HMAC against the exact bytes sent.
      verify: (req, _res, buffer) => {
        req.rawBody = buffer.toString('utf8');
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  if (!config.isTest) {
    app.use(morgan(config.isProduction ? 'combined' : 'dev'));
  }

  app.use(
    '/api',
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
      skip: () => config.isTest,
    })
  );

  app.use('/api', routes);

  /*
   * In production the built front end is served by this same process, so a
   * deployment is one container behind one URL. In development Vite serves it
   * instead, and this is skipped.
   */
  if (config.isProduction) {
    const clientDir = path.resolve(ROOT_DIR, 'client/dist');
    if (fs.existsSync(clientDir)) {
      app.use(express.static(clientDir, { index: false, maxAge: '1h' }));

      // Anything that is not an API route is handed to the single-page app so
      // that a deep link like /management/parcels/123 works on a hard refresh.
      app.get(/^\/(?!api\/).*/, (_req, res) => {
        res.sendFile(path.join(clientDir, 'index.html'));
      });
      logger.info(`Serving the built front end from ${clientDir}`);
    } else {
      logger.warn(
        `No built front end found at ${clientDir}. Run "npm run build" — the API will run, but nothing will serve the screens.`
      );
    }
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
