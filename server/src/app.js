import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import config from './config/env.js';
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
        /*
         * The client is deployed separately, so an unlisted origin is a very
         * likely first-run mistake. Refuse by withholding the header — which is
         * what actually stops the browser — and say so in the log, rather than
         * throwing, which surfaced as a confusing 500.
         */
        logger.warn(
          `Refused a browser request from ${origin}. Add it to CORS_ORIGINS if that address is your client.`
        );
        return callback(null, false);
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
   * This process serves the API only. The React client is a separate project
   * with its own deployment, so it reaches the API across origins — which is
   * what CORS_ORIGINS above is for.
   */

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
