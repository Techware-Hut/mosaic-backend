const HTTPS_URL_PATTERN = /^https?:\/\/.+\..+/;

const isValidExternalServiceUrl = (value) => {
  if (!value || typeof value !== 'string') return false;
  return HTTPS_URL_PATTERN.test(value.trim());
};

const resolvePublicExternalLink = (service = {}) => {
  const externalLink = String(service.externalLink || '').trim();
  if (externalLink && isValidExternalServiceUrl(externalLink)) {
    return externalLink;
  }

  const bookingToolLink = String(service.bookingToolLink || '').trim();
  if (bookingToolLink && isValidExternalServiceUrl(bookingToolLink)) {
    return bookingToolLink;
  }

  return '';
};

const parseBooleanFlag = (value) => value === true || value === 'true';

const parseLeadConfigFromBody = (body = {}) => {
  const hasExternalInput = body.externalLink !== undefined || body.bookingToolLink !== undefined;
  const externalRaw = body.externalLink !== undefined ? body.externalLink : body.bookingToolLink;
  const bookingRaw = body.bookingToolLink !== undefined ? body.bookingToolLink : body.externalLink;

  const externalLink = typeof externalRaw === 'string' ? externalRaw.trim() : '';
  const bookingToolLink = typeof bookingRaw === 'string' ? bookingRaw.trim() : externalLink;

  return {
    hasExternalInput,
    externalLink,
    bookingToolLink: bookingToolLink || externalLink,
    rfqEnabled: parseBooleanFlag(body.rfqEnabled),
  };
};

const applyLeadConfigToDocument = (target, body = {}) => {
  const config = parseLeadConfigFromBody(body);

  if (config.hasExternalInput) {
    if (config.externalLink && !isValidExternalServiceUrl(config.externalLink)) {
      const error = new Error('externalLink must be a valid http(s) URL');
      error.statusCode = 400;
      throw error;
    }

    target.externalLink = config.externalLink;
    target.bookingToolLink = config.bookingToolLink;
  }

  if (body.rfqEnabled !== undefined) {
    target.rfqEnabled = config.rfqEnabled;
  }

  return target;
};

module.exports = {
  HTTPS_URL_PATTERN,
  isValidExternalServiceUrl,
  resolvePublicExternalLink,
  parseBooleanFlag,
  parseLeadConfigFromBody,
  applyLeadConfigToDocument,
};
