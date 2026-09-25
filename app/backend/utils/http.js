'use strict'

class AppError extends Error {
  constructor(statusCode, message, details) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = true
    if (details !== undefined) this.details = details
  }
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

function notFoundHandler(req, res) {
  res.status(404).json({
    status: 'error',
    error: 'Not Found',
    message: `No route for ${req.method} ${req.originalUrl}`,
  })
}

// Central error handler. Never leaks stack traces or DB internals to the client.
function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || (err.isOperational ? 400 : 500)
  const payload = {
    status: 'error',
    error: statusCode >= 500 ? 'Internal Server Error' : err.name || 'Error',
    message: statusCode >= 500 ? 'Something went wrong on our side.' : err.message,
  }
  if (err.details && statusCode < 500) payload.details = err.details

  // pg unique violation / FK violation -> friendly 409 / 400.
  if (err.code === '23505') {
    payload.error = 'Conflict'
    payload.message = 'A record with the same unique key already exists.'
    return res.status(409).json(payload)
  }
  if (err.code === '23503') {
    payload.error = 'Conflict'
    payload.message = 'The related record does not exist.'
    return res.status(409).json(payload)
  }
  // CHECK / NOT NULL / data-type violations -> client mistakes, not 500s.
  if (['23514', '23502', '22001', '22P02', '23502'].includes(err.code)) {
    payload.error = 'Validation Error'
    payload.message = 'The submitted data violates a database constraint.'
    return res.status(400).json(payload)
  }

  if (statusCode >= 500) {
    console.error('[unhandled]', err)
  }
  res.status(statusCode).json(payload)
}

module.exports = { AppError, asyncHandler, notFoundHandler, errorHandler }