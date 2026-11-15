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

/**
 * Wraps a transporter's sendMail with the opt-in staging recipient allowlist
 * (MAIL_RECIPIENT_ALLOWLIST). Outside hosted staging, or when the allowlist
 * env var is unset/blank, the original sendMail is called with the original
 * arguments unchanged.
 */
function applyMailRecipientAllowlist(transporter) {
  if (!transporter || typeof transporter.sendMail !== 'function') {
    return transporter;
  }
  const originalSendMail = transporter.sendMail;

  transporter.sendMail = function sendMailWithAllowlist(...args) {
    const { getMailAllowlist, filterMailOptions } = require('./recipientAllowlist');
    const allowlist = getMailAllowlist();
    if (!allowlist.active) {
      return originalSendMail.apply(this, args);
    }

    const [mailOptions, ...rest] = args;
    const callback = typeof rest[rest.length - 1] === 'function' ? rest[rest.length - 1] : null;
    const result = filterMailOptions(mailOptions, allowlist);

    if (result.suppress) {
      console.warn(
        `[isolation] mail suppressed by staging recipient allowlist (recipients=${result.total}, allowed=0, allowlistSize=${allowlist.size})`
      );
      const info = { suppressed: true, accepted: [], rejected: [], envelope: {}, response: 'suppressed' };
      if (callback) {
        callback(null, info);
        return undefined;
      }
      return Promise.resolve(info);
    }

    if (result.allowed < result.total) {
      console.warn(
        `[isolation] mail recipients filtered by staging allowlist (recipients=${result.total}, allowed=${result.allowed})`
      );
    }
    return originalSendMail.call(this, result.mailOptions, ...rest);
  };

  return transporter;
}

/**
 * Single construction point for SMTP transporters (shared SMTP config plus
 * the staging-only recipient allowlist guard). Call sites pass the nodemailer
 * module they already required so module-load-time binding is unchanged.
 */
function createMosaicTransport(nodemailerImpl = require('nodemailer')) {
  return applyMailRecipientAllowlist(nodemailerImpl.createTransport(buildSmtpTransportConfig()));
}

module.exports = {
  applyMailRecipientAllowlist,
  buildSmtpTransportConfig,
  createMosaicTransport,
  formatMosaicFromHeader,
  getMailFromAddress,
  parseMailPort,
  parseMailSecure,
};
