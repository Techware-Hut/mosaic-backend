function getTrimmedEnv(env, name) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : value;
}

function parseMailPort(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseMailSecure(value) {
  return String(value).trim().toLowerCase() === 'true';
}

function buildSmtpTransportConfig(env = process.env) {
  const host = getTrimmedEnv(env, 'MAIL_HOST');
  const user = getTrimmedEnv(env, 'MAIL_USER');
  const pass = getTrimmedEnv(env, 'MAIL_PASSWORD');

  if (!host) {
    return {
      service: 'gmail',
      auth: { user, pass },
    };
  }

  const config = {
    host,
    secure: parseMailSecure(env.MAIL_SECURE),
    auth: { user, pass },
  };

  const port = parseMailPort(env.MAIL_PORT);
  if (port !== undefined) {
    config.port = port;
  }

  return config;
}

function getMailFromAddress(env = process.env) {
  return getTrimmedEnv(env, 'MAIL_FROM') || getTrimmedEnv(env, 'MAIL_USER');
}

function formatMosaicFromHeader(env = process.env) {
  const mailFrom = getTrimmedEnv(env, 'MAIL_FROM');
  if (mailFrom) {
    return mailFrom;
  }

  const fromAddress = getTrimmedEnv(env, 'MAIL_USER');
  return fromAddress ? `"Mosaic Biz Hub" <${fromAddress}>` : '"Mosaic Biz Hub"';
}

module.exports = {
  buildSmtpTransportConfig,
  formatMosaicFromHeader,
  getMailFromAddress,
  parseMailPort,
  parseMailSecure,
};
