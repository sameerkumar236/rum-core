export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function asyncRoute(handler) {
  return (request, response, next) =>
    Promise.resolve(handler(request, response, next)).catch(next);
}

export function errorHandler(error, request, response, next) {
  if (response.headersSent) return next(error);
  let status = error.status || 500;
  let message = error.message || 'The server could not complete this request.';
  if (error.code === 11000) {
    status = 409;
    message = 'An account with this email already exists.';
  } else if (error.name === 'CastError') {
    status = 400;
    message = 'Invalid identifier.';
  } else if (error.name === 'ValidationError') {
    status = 400;
    message = 'Some fields contain invalid values.';
  } else if (error.type === 'entity.parse.failed') {
    status = 400;
    message = 'Send valid JSON.';
  } else if (status >= 500) {
    console.error(error);
    message = 'The server could not complete this request.';
  }
  response.status(status).json({ message });
}
