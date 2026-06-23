const STATUS_CODES = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
  500: "INTERNAL_SERVER_ERROR",
};

function getRequestId(req) {
  const requestId = req?.requestId || req?.headers?.["x-request-id"];
  return typeof requestId === "string" && requestId.trim()
    ? requestId.trim().slice(0, 128)
    : undefined;
}

function normalizeFieldErrors(fieldErrors) {
  if (!fieldErrors || typeof fieldErrors !== "object" || Array.isArray(fieldErrors)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(fieldErrors)
      .filter(([key, value]) => key && value != null)
      .map(([key, value]) => [String(key), String(value)])
  );
}

function buildErrorPayload(req, {
  status = 500,
  message = "Internal server error",
  code,
  fieldErrors,
  includeLegacyError = false,
} = {}) {
  const payload = {
    success: false,
    message,
    code: code || STATUS_CODES[status] || "ERROR",
  };
  const requestId = getRequestId(req);
  const normalizedFieldErrors = normalizeFieldErrors(fieldErrors);

  if (requestId) payload.requestId = requestId;
  if (normalizedFieldErrors && Object.keys(normalizedFieldErrors).length > 0) {
    payload.fieldErrors = normalizedFieldErrors;
  }
  if (includeLegacyError) {
    payload.error = message;
  }

  return payload;
}

function sendError(req, res, status, options = {}) {
  return res.status(status).json(buildErrorPayload(req, { ...options, status }));
}

function sendValidationError(req, res, fieldErrors, message = "Validation failed") {
  return sendError(req, res, 400, {
    message,
    code: "VALIDATION_FAILED",
    fieldErrors,
    includeLegacyError: true,
  });
}

function sendUnauthorized(req, res, message = "Authentication required", options = {}) {
  return sendError(req, res, 401, {
    message,
    code: options.code || "AUTHENTICATION_REQUIRED",
    includeLegacyError: options.includeLegacyError,
  });
}

function sendForbidden(req, res, message = "Forbidden", options = {}) {
  return sendError(req, res, 403, {
    message,
    code: options.code || "FORBIDDEN",
    includeLegacyError: options.includeLegacyError,
  });
}

function sendNotFound(req, res, message = "Not found", options = {}) {
  return sendError(req, res, 404, {
    message,
    code: options.code || "NOT_FOUND",
    includeLegacyError: options.includeLegacyError,
  });
}

module.exports = {
  buildErrorPayload,
  sendError,
  sendForbidden,
  sendNotFound,
  sendUnauthorized,
  sendValidationError,
};
