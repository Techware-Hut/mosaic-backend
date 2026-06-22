const SENSITIVE_FIELD_PATTERN =
  /password|otp|token|cookie|secret|credential|stripe|bank|routing|accountnumber|ein|ssn|taxid|document|url|file|content|body|raw/i;

const ALWAYS_REDACT_VALUE = '[REDACTED]';

function isSensitiveFieldName(fieldName) {
  if (typeof fieldName !== 'string') return true;
  return SENSITIVE_FIELD_PATTERN.test(fieldName);
}

function redactValue(fieldName, value) {
  if (isSensitiveFieldName(fieldName)) {
    return ALWAYS_REDACT_VALUE;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  }

  if (Array.isArray(value)) {
    return { count: value.length };
  }

  if (typeof value === 'object') {
    return redactObject(value, 1);
  }

  return ALWAYS_REDACT_VALUE;
}

function redactObject(source, depth = 0) {
  if (!source || typeof source !== 'object' || depth > 2) {
    return ALWAYS_REDACT_VALUE;
  }

  const output = {};
  for (const [key, value] of Object.entries(source)) {
    output[key] = redactValue(key, value);
  }
  return output;
}

/**
 * Build a sanitized before/after summary using field names and safe scalar values only.
 */
function buildChangeSummary({ before = {}, after = {}, fields = [] } = {}) {
  const fieldNames =
    fields.length > 0
      ? fields
      : [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];

  const safeFields = fieldNames.filter((name) => !isSensitiveFieldName(name));

  return {
    fields: safeFields,
    before: redactObject(
      Object.fromEntries(safeFields.map((name) => [name, before?.[name]]))
    ),
    after: redactObject(
      Object.fromEntries(safeFields.map((name) => [name, after?.[name]]))
    ),
  };
}

function sanitizeNote(note) {
  if (note === null || note === undefined || note === '') {
    return null;
  }

  const text = String(note).trim();
  if (!text) return null;

  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

module.exports = {
  ALWAYS_REDACT_VALUE,
  SENSITIVE_FIELD_PATTERN,
  isSensitiveFieldName,
  redactValue,
  redactObject,
  buildChangeSummary,
  sanitizeNote,
};
