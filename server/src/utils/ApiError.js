export default class ApiError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code ?? httpCode(status);
    this.details = details;
    this.expected = true;
  }

  static badRequest(message, opts) {
    return new ApiError(400, message, opts);
  }
  static unauthorized(message = 'Authentication required.', opts) {
    return new ApiError(401, message, opts);
  }
  static forbidden(message = 'You do not have permission to perform this action.', opts) {
    return new ApiError(403, message, opts);
  }
  static notFound(message = 'Resource not found.', opts) {
    return new ApiError(404, message, opts);
  }
  static conflict(message, opts) {
    return new ApiError(409, message, opts);
  }
}

function httpCode(status) {
  return (
    {
      400: 'BAD_REQUEST',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      429: 'RATE_LIMITED',
    }[status] ?? 'INTERNAL_ERROR'
  );
}
