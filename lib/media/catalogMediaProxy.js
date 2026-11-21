/**
 * Staging-only catalog media proxy (MBH-055).
 *
 * Why: catalog uploads are stored as plain S3 object URLs. When the staging
 * bucket is private those URLs 403 in the browser. This module lets the staging
 * frontend (app.mosaicbizhub.com, behind the QA access gate) show catalog
 * images without making the bucket public:
 *
 *   browser --(QA cookie, same origin)--> Next.js /api/media/<key>
 *           --(shared secret header)----> GET /api/media/catalog/<key> (here)
 *           --(instance role, GetObject)-> private S3 bucket
 *
 * Scope:
 * - Only `products/`, `services/` and `foods/` keys. `vendor-onboarding/`,
 *   `uploads/` and every other prefix are rejected, as are traversal and any
 *   percent-encoding.
 * - Only raster image content types are streamed (no SVG / HTML).
 * - JSON responses rewrite this bucket's catalog object URLs to the proxy base
 *   URL, and JSON request bodies map proxy URLs back, so the database keeps the
 *   canonical S3 URLs and turning the mode off restores the old URLs.
 *
 * Off by default. When MEDIA_PROXY_MODE is not "staging" (production, local,
 * tests) installCatalogMediaProxy() installs nothing at all, so existing
 * behaviour is byte-for-byte unchanged. It also refuses to enable unless
 * RELEASE_ENVIRONMENT is exactly "staging" and every required setting is valid
 * (fail closed).
 */

const crypto = require('crypto');
const { pipeline } = require('stream');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { buildS3ClientConfig } = require('../../utils/s3ClientConfig');

const MEDIA_PROXY_ROUTE_PREFIX = '/api/media/catalog/';
const MEDIA_PROXY_SECRET_HEADER = 'x-mosaic-media-proxy-secret';
const CATALOG_PREFIXES = Object.freeze(['products', 'services', 'foods']);
const MIN_SHARED_SECRET_LENGTH = 32;
const MAX_KEY_LENGTH = 512;
const MAX_KEY_SEGMENTS = 8;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const ALLOWED_IMAGE_CONTENT_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

const KEY_CHARSET = /^[A-Za-z0-9._\-/]+$/;
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION_NAME = /^[a-z]{2}(?:-[a-z]+)+-\d$/;

const PRIVATE_MEDIA_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cross-Origin-Resource-Policy': 'same-site',
  'X-Robots-Tag': 'noindex, nofollow',
});

function trimmed(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

/**
 * Validates a raw (still percent-encoded) object key from the request path.
 * Returns { ok: true, key } or { ok: false, status, code }.
 */
function parseCatalogMediaKey(rawKey) {
  if (typeof rawKey !== 'string' || rawKey.length === 0 || rawKey.length > MAX_KEY_LENGTH) {
    return { ok: false, status: 400, code: 'invalid_media_key' };
  }
  // Keys we generate never need encoding; any '%' could hide '.', '/' or '\'.
  if (rawKey.includes('%') || !KEY_CHARSET.test(rawKey)) {
    return { ok: false, status: 400, code: 'invalid_media_key' };
  }
  const segments = rawKey.split('/');
  if (segments.length < 2 || segments.length > MAX_KEY_SEGMENTS) {
    return { ok: false, status: 400, code: 'invalid_media_key' };
  }
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return { ok: false, status: 400, code: 'invalid_media_key' };
  }
  if (!CATALOG_PREFIXES.includes(segments[0])) {
    return { ok: false, status: 403, code: 'media_prefix_not_allowed' };
  }
  return { ok: true, key: rawKey };
}

/** Normalizes an upstream Content-Type and returns it only when allowlisted. */
function allowedImageContentType(value) {
  const base = trimmed(value).split(';')[0].trim().toLowerCase();
  return ALLOWED_IMAGE_CONTENT_TYPES.includes(base) ? base : null;
}

function parsePublicBaseUrl(raw) {
  const value = trimmed(raw).replace(/\/+$/, '');
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_err) {
    return null;
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

/**
 * Reads the proxy configuration. Returns { enabled: false, reason } unless every
 * requirement holds. `reason` is a fixed code and never contains env values.
 */
function readCatalogMediaProxyConfig(env = process.env) {
  if (trimmed(env.MEDIA_PROXY_MODE).toLowerCase() !== 'staging') {
    return { enabled: false, reason: 'mode_off' };
  }
  if (trimmed(env.RELEASE_ENVIRONMENT).toLowerCase() !== 'staging') {
    return { enabled: false, reason: 'not_staging_release' };
  }
  const sharedSecret = trimmed(env.MEDIA_PROXY_SHARED_SECRET);
  if (sharedSecret.length < MIN_SHARED_SECRET_LENGTH) {
    return { enabled: false, reason: 'shared_secret_missing_or_short' };
  }
  const publicBaseUrl = parsePublicBaseUrl(env.MEDIA_PROXY_PUBLIC_BASE_URL);
  if (!publicBaseUrl) {
    return { enabled: false, reason: 'public_base_url_invalid' };
  }
  const bucket = trimmed(env.AWS_S3_BUCKET);
  if (!BUCKET_NAME.test(bucket)) {
    return { enabled: false, reason: 'bucket_invalid' };
  }
  // Same default the upload controllers use when building object URLs.
  const region = trimmed(env.AWS_REGION) || 'us-east-1';
  if (!REGION_NAME.test(region)) {
    return { enabled: false, reason: 'region_invalid' };
  }
  return {
    enabled: true,
    sharedSecret,
    publicBaseUrl,
    bucket,
    region,
    s3ObjectBaseUrl: `https://${bucket}.s3.${region}.amazonaws.com`,
  };
}

/** Constant-time comparison of two strings via fixed-length digests. */
function secretsMatch(provided, expected) {
  if (typeof provided !== 'string' || provided.length === 0 || provided.length > 1024) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Builds the string mappers used for response rewriting and request back-mapping. */
function createUrlMappers(config) {
  const s3Prefix = `${config.s3ObjectBaseUrl}/`;
  const proxyPrefix = `${config.publicBaseUrl}/`;

  function mapBetween(value, fromPrefix, toPrefix) {
    if (typeof value !== 'string' || !value.startsWith(fromPrefix)) return value;
    const key = value.slice(fromPrefix.length);
    return parseCatalogMediaKey(key).ok ? `${toPrefix}${key}` : value;
  }

  return {
    toProxyUrl: (value) => mapBetween(value, s3Prefix, proxyPrefix),
    toCanonicalUrl: (value) => mapBetween(value, proxyPrefix, s3Prefix),
  };
}

/** Recursively maps string values of a parsed JSON body. Returns the new value. */
function mapJsonStrings(value, mapString, depth = 0) {
  if (depth > 32) return value;
  if (typeof value === 'string') return mapString(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = mapJsonStrings(value[i], mapString, depth + 1);
    return value;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const key of Object.keys(value)) value[key] = mapJsonStrings(value[key], mapString, depth + 1);
  }
  return value;
}

function sendError(res, status, code) {
  res.status(status);
  res.set(PRIVATE_MEDIA_HEADERS);
  return res.json({ error: code });
}

function isMissingObjectError(err) {
  const name = err && (err.name || err.Code);
  const status = err && err.$metadata && err.$metadata.httpStatusCode;
  // Without s3:ListBucket a missing key comes back as 403 AccessDenied.
  return name === 'NoSuchKey' || name === 'NotFound' || name === 'AccessDenied' || status === 404 || status === 403;
}

/**
 * Express handler for GET /api/media/catalog/<key>. `s3Client` is injectable
 * for tests; production uses the shared S3 client configuration (#336).
 */
function createCatalogMediaHandler(config, { s3Client } = {}) {
  const client = s3Client || new S3Client(buildS3ClientConfig());

  return async function catalogMediaHandler(req, res) {
    if (!secretsMatch(req.get(MEDIA_PROXY_SECRET_HEADER), config.sharedSecret)) {
      return sendError(res, 403, 'forbidden');
    }

    // Use the raw path so percent-encoded traversal cannot be decoded past the checks.
    const rawPath = String(req.originalUrl || '').split('?')[0];
    if (!rawPath.startsWith(MEDIA_PROXY_ROUTE_PREFIX)) {
      return sendError(res, 400, 'invalid_media_key');
    }
    const parsed = parseCatalogMediaKey(rawPath.slice(MEDIA_PROXY_ROUTE_PREFIX.length));
    if (!parsed.ok) return sendError(res, parsed.status, parsed.code);

    let object;
    try {
      object = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: parsed.key }));
    } catch (err) {
      if (isMissingObjectError(err)) return sendError(res, 404, 'not_found');
      console.error('[catalog-media-proxy] S3 read failed', { name: err && err.name });
      return sendError(res, 502, 'media_unavailable');
    }

    const body = object && object.Body;
    const destroyBody = () => {
      if (body && typeof body.destroy === 'function') body.destroy();
    };
    const contentType = allowedImageContentType(object && object.ContentType);
    if (!contentType) {
      destroyBody();
      return sendError(res, 415, 'unsupported_media_type');
    }
    const length = Number(object.ContentLength);
    if (Number.isFinite(length) && length > MAX_MEDIA_BYTES) {
      destroyBody();
      return sendError(res, 502, 'media_too_large');
    }
    if (!body || typeof body.pipe !== 'function') {
      return sendError(res, 502, 'media_unavailable');
    }

    res.status(200);
    res.set(PRIVATE_MEDIA_HEADERS);
    res.set('Content-Type', contentType);
    res.set('Content-Disposition', 'inline');
    if (Number.isFinite(length) && length >= 0) res.set('Content-Length', String(length));

    if (req.method === 'HEAD') {
      destroyBody();
      return res.end();
    }
    pipeline(body, res, (err) => {
      if (err) console.error('[catalog-media-proxy] stream aborted', { name: err.name });
    });
    return undefined;
  };
}

/**
 * Installs the proxy on an Express app when (and only when) the configuration
 * is fully valid. Must be called after express.json() and before the routes.
 * Returns the resolved config ({ enabled: false } installs nothing).
 */
function installCatalogMediaProxy(app, { env = process.env, s3Client, logger = console } = {}) {
  const config = readCatalogMediaProxyConfig(env);
  if (!config.enabled) {
    if (config.reason !== 'mode_off') {
      logger.warn(`[catalog-media-proxy] MEDIA_PROXY_MODE is set but the proxy stays disabled (${config.reason})`);
    }
    return config;
  }

  const { toProxyUrl, toCanonicalUrl } = createUrlMappers(config);

  // Stored catalog URLs leave the API as proxy URLs (applies to every res.json).
  const previousReplacer = app.get('json replacer');
  app.set('json replacer', function catalogMediaReplacer(key, value) {
    const next = typeof previousReplacer === 'function' ? previousReplacer.call(this, key, value) : value;
    return typeof next === 'string' ? toProxyUrl(next) : next;
  });

  // Proxy URLs sent back by the editor are stored as canonical S3 URLs.
  app.use((req, _res, next) => {
    if (req.body && typeof req.body === 'object') {
      req.body = mapJsonStrings(req.body, toCanonicalUrl);
    }
    next();
  });

  const handler = createCatalogMediaHandler(config, { s3Client });
  app.get(/^\/api\/media\/catalog\/.+/, handler);

  logger.info('[catalog-media-proxy] staging catalog media proxy enabled');
  return config;
}

module.exports = {
  ALLOWED_IMAGE_CONTENT_TYPES,
  CATALOG_PREFIXES,
  MEDIA_PROXY_ROUTE_PREFIX,
  MEDIA_PROXY_SECRET_HEADER,
  MIN_SHARED_SECRET_LENGTH,
  allowedImageContentType,
  createCatalogMediaHandler,
  createUrlMappers,
  installCatalogMediaProxy,
  mapJsonStrings,
  parseCatalogMediaKey,
  readCatalogMediaProxyConfig,
};
