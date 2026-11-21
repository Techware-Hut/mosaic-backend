'use strict';

/**
 * Google reCAPTCHA v2 server-side verification.
 *
 * Rollout (see the contact PR):
 *   1. Ship the frontend that sends `recaptchaToken`.
 *   2. Set RECAPTCHA_SECRET_KEY (and optionally RECAPTCHA_ALLOWED_HOSTNAMES).
 *   3. Deploy this backend.
 *
 * - RECAPTCHA_SECRET_KEY unset: verification is skipped (logged once), so
 *   deploying this before the secret exists does not break the form.
 * - RECAPTCHA_SECRET_KEY set: fail closed. A missing, invalid, wrong-host or
 *   unverifiable token is rejected, including when Google is unreachable.
 *
 * Allowed hostnames come from RECAPTCHA_ALLOWED_HOSTNAMES (comma-separated),
 * else from the hosts in FRONTEND_URL and CORS_ORIGINS.
 */

const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const VERIFY_TIMEOUT_MS = 5000;

function hostnameOf(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getAllowedHostnames(env = process.env) {
  const explicit = String(env.RECAPTCHA_ALLOWED_HOSTNAMES || '')
    .split(',')
    .map(hostnameOf)
    .filter(Boolean);
  if (String(env.RECAPTCHA_ALLOWED_HOSTNAMES || '').trim()) return [...new Set(explicit)];

  const derived = [env.FRONTEND_URL, ...String(env.CORS_ORIGINS || '').split(',')]
    .map(hostnameOf)
    .filter(Boolean);
  return [...new Set(derived)];
}

function isRecaptchaEnforced(env = process.env) {
  return Boolean(String(env.RECAPTCHA_SECRET_KEY || '').trim());
}

/**
 * @returns {Promise<{ ok: boolean, reason?: string, hostname?: string }>}
 */
async function verifyRecaptchaToken(token, {
  remoteIp,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = VERIFY_TIMEOUT_MS,
} = {}) {
  const secret = String(env.RECAPTCHA_SECRET_KEY || '').trim();
  if (!secret) return { ok: true, reason: 'not_configured' };

  const response = typeof token === 'string' ? token.trim() : '';
  if (!response) return { ok: false, reason: 'missing_token' };

  const params = new URLSearchParams({ secret, response });
  if (remoteIp) params.set('remoteip', String(remoteIp));

  let payload;
  try {
    const res = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, reason: 'verify_http_error' };
    payload = await res.json();
  } catch {
    return { ok: false, reason: 'verify_unreachable' };
  }

  if (!payload || payload.success !== true) {
    return { ok: false, reason: 'invalid_token' };
  }

  const allowed = getAllowedHostnames(env);
  const hostname = String(payload.hostname || '').toLowerCase();
  if (!allowed.length || !allowed.includes(hostname)) {
    return { ok: false, reason: 'hostname_mismatch', hostname };
  }

  return { ok: true, hostname };
}

let warnedNotConfigured = false;

/** Express middleware: reads req.body.recaptchaToken. */
function requireRecaptcha({ env = process.env, fetchImpl } = {}) {
  return async function recaptchaGuard(req, res, next) {
    if (!isRecaptchaEnforced(env)) {
      if (!warnedNotConfigured) {
        warnedNotConfigured = true;
        console.warn('[recaptcha] RECAPTCHA_SECRET_KEY not set; contact form tokens are not verified.');
      }
      return next();
    }

    const result = await verifyRecaptchaToken(req.body?.recaptchaToken, {
      remoteIp: req.ip,
      env,
      ...(fetchImpl ? { fetchImpl } : {}),
    });

    if (result.ok) return next();

    console.warn('[recaptcha] rejected', { reason: result.reason });
    if (result.reason === 'verify_unreachable' || result.reason === 'verify_http_error') {
      return res.status(503).json({
        success: false,
        code: 'RECAPTCHA_UNAVAILABLE',
        message: 'We could not verify the form right now. Please try again in a moment.',
      });
    }
    return res.status(400).json({
      success: false,
      code: result.reason === 'missing_token' ? 'RECAPTCHA_REQUIRED' : 'RECAPTCHA_FAILED',
      message: 'Please complete the verification check and try again.',
    });
  };
}

module.exports = {
  SITEVERIFY_URL,
  getAllowedHostnames,
  isRecaptchaEnforced,
  verifyRecaptchaToken,
  requireRecaptcha,
};
