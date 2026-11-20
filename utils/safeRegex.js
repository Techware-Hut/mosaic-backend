'use strict';

/**
 * Helpers for building RegExps from user-controlled text (business names,
 * search terms). Without escaping, a name like "C++" throws
 * ("Nothing to repeat") and "A.B" matches "AxB".
 */

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive exact match, e.g. for "is this business name taken?". */
function exactCaseInsensitiveRegex(value = '') {
  return new RegExp(`^${escapeRegex(value)}$`, 'i');
}

/** Case-insensitive "contains" match for free-text filters. */
function containsCaseInsensitiveRegex(value = '') {
  return new RegExp(escapeRegex(value), 'i');
}

module.exports = {
  escapeRegex,
  exactCaseInsensitiveRegex,
  containsCaseInsensitiveRegex,
};
