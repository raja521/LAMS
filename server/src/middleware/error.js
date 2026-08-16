import config from '../config/env.js';
import logger from '../utils/logger.js';
import ApiError from '../utils/ApiError.js';

export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`No route matches ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity.
export function errorHandler(err, req, res, _next) {
  let status = err.status ?? 500;
  let message = err.message;
  let details = err.details;
  let code = err.code;

  if (err.name === 'ValidationError' && err.errors) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Some fields need attention.';
    details = Object.fromEntries(Object.entries(err.errors).map(([key, e]) => [key, e.message]));
  } else if (err.name === 'CastError') {
    status = 400;
    code = 'INVALID_ID';
    message = `"${err.value}" is not a valid identifier.`;
  } else if (err.code === 11000) {
    status = 409;
    code = 'DUPLICATE_KEY';
    const field = Object.keys(err.keyValue ?? {})[0] ?? 'value';
    message = `That ${field} is already in use.`;
  }

  if (status >= 500) {
    logger.error(`${req.method} ${req.originalUrl}`, err.stack ?? err.message);
    if (config.isProduction) message = 'Something went wrong on our end.';
  }

  res.status(status).json({
    error: {
      code: code ?? 'INTERNAL_ERROR',
      message,
      ...(details ? { details } : {}),
      ...(config.isProduction || status < 500 ? {} : { stack: err.stack }),
    },
  });
}
