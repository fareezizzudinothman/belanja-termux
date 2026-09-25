'use strict'

const { AppError } = require('../utils/http')

// Lightweight request body validation guard used by routes.
// `schema` maps field -> (value) => result|AppError. Collects all errors at once.
function validateBody(schema) {
  return (req, _res, next) => {
    if (req.body === undefined || req.body === null || typeof req.body !== 'object') {
      return next(new AppError(400, 'A JSON request body is required'))
    }

    const clean = {}
    const errors = []
    for (const [field, fn] of Object.entries(schema)) {
      if (fn === null) continue
      const result = fn(req.body[field], field)
      if (result instanceof AppError) {
        errors.push({ field, message: result.message })
      } else if (result !== undefined) {
        clean[field] = result
      }
    }

    if (errors.length) {
      return next(new AppError(400, 'Request body is invalid', errors))
    }

    req.clean = clean
    return next()
  }
}

// Validates URL path params that are integers (e.g. :id). Only applies to
// params actually present in the route.
function validateUuidParams(...names) {
  return (req, _res, next) => {
    for (const name of names) {
      const value = req.params[name]
      if (value === undefined) continue
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        return next(new AppError(400, `Invalid ${name}`))
      }
    }
    return next()
  }
}

module.exports = { validateBody, validateUuidParams }