'use strict';

const { validationResult } = require('express-validator');

/**
 * Ends the request with a readable 400 when express-validator flagged input.
 * Shape matches what the vendor forms already display: { error } (plus details).
 */
function rejectInvalidRequest(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const errors = result.array();
  return res.status(400).json({
    success: false,
    code: 'VALIDATION_FAILED',
    error: errors[0]?.msg || 'Invalid request.',
    errors,
  });
}

module.exports = { rejectInvalidRequest };
