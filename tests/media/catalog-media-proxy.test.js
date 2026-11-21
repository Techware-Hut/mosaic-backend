const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const express = require('express');
const supertest = require('supertest');

const {
  MEDIA_PROXY_SECRET_HEADER,
  installCatalogMediaProxy,
  parseCatalogMediaKey,
  readCatalogMediaProxyConfig,
} = require('../../lib/media/catalogMediaProxy');

const SECRET = 'unit-test-media-proxy-secret-0123456789abcdef';
const BUCKET = 'mosaic-staging-media-test';
const S3_BASE = `https://${BUCKET}.s3.us-east-1.amazonaws.com`;
const PROXY_BASE = 'https://app.mosaicbizhub.com/api/media';
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const STAGING_ENV = Object.freeze({
  MEDIA_PROXY_MODE: 'staging',
  RELEASE_ENVIRONMENT: 'staging',
  MEDIA_PROXY_SHARED_SECRET: SECRET,
  MEDIA_PROXY_PUBLIC_BASE_URL: PROXY_BASE,
  AWS_S3_BUCKET: BUCKET,
  AWS_REGION: 'us-east-1',
});

const silentLogger = { info() {}, warn() {} };

function fakeS3(objects = {}) {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command.input);
      const object = objects[command.input.Key];
      if (!object) {
        const err = new Error('missing');
        err.name = 'NoSuchKey';
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      if (object.error) throw object.error;
      return {
        Body: Readable.from([object.body]),
        ContentType: object.contentType,
        ContentLength: object.length ?? object.body.length,
      };
    },
  };
}

/** Mirrors app.js ordering: express.json(), then the installer, then routes. */
function buildApp(env, s3) {
  const app = express();
  app.use(express.json());
  const config = installCatalogMediaProxy(app, { env, s3Client: s3, logger: silentLogger });
  app.get('/api/fixture/product', (_req, res) =>
    res.json({
      data: {
        coverImage: `${S3_BASE}/products/u1/cover/1700000000000-cover.png`,
        images: [`${S3_BASE}/services/u1/gallery/1-a.jpg`, `${S3_BASE}/foods/u1/gallery/2-b.webp`],
        license: `${S3_BASE}/vendor-onboarding/stage1/u1/business-license/1-doc.png`,
        generic: `${S3_BASE}/uploads/u1/generic/1-x.png`,
        otherBucket: 'https://mosaic-biz-hub.s3.us-east-1.amazonaws.com/products/u1/cover/1-x.png',
        note: 'plain text',
      },
    })
  );
  app.put('/api/fixture/product', (req, res) => res.status(200).send(JSON.stringify(req.body)));
  return { app, config };
}

const VALID_KEY = 'products/u1/cover/1700000000000-cover.png';

// ---------- key validation ----------

test('parseCatalogMediaKey accepts products/, services/ and foods/ keys', () => {
  for (const key of [VALID_KEY, 'services/u1/gallery/1-a.jpg', 'foods/u1/temp/2-b.webp']) {
    assert.deepEqual(parseCatalogMediaKey(key), { ok: true, key });
  }
});

test('parseCatalogMediaKey rejects non-catalog prefixes with 403', () => {
  for (const key of [
    'vendor-onboarding/stage1/u1/minority-proof/1-doc.png',
    'vendor-onboarding/stage1/u1/tax-doc/1-doc.png',
    'uploads/u1/generic/1-x.png',
    'Products/u1/cover/1.png',
    'productsx/u1/1.png',
  ]) {
    assert.equal(parseCatalogMediaKey(key).status, 403, key);
  }
});

test('parseCatalogMediaKey rejects traversal, encoding and malformed keys with 400', () => {
  for (const key of [
    'products/../vendor-onboarding/stage1/u1/tax-doc/1.png',
    'products/u1/../../vendor-onboarding/x.png',
    'products/./u1/x.png',
    'products/%2e%2e/vendor-onboarding/x.png',
    'products%2F..%2Fvendor-onboarding%2Fx.png',
    'products/u1/%252e%252e/x.png',
    'products//u1/x.png',
    '/products/u1/x.png',
    'products/u1/x.png/',
    'products',
    'products\\..\\vendor-onboarding\\x.png',
    'products/u1/x y.png',
    'products/u1/x.png?y=1',
    `products/${'a/'.repeat(10)}x.png`,
    `products/${'a'.repeat(600)}.png`,
    '',
    null,
  ]) {
    assert.equal(parseCatalogMediaKey(key).status, 400, String(key));
  }
});

// ---------- configuration / production stays off ----------

test('proxy stays off (installs nothing) without MEDIA_PROXY_MODE=staging', () => {
  for (const env of [{}, { ...STAGING_ENV, MEDIA_PROXY_MODE: '' }, { ...STAGING_ENV, MEDIA_PROXY_MODE: 'production' }]) {
    assert.deepEqual(readCatalogMediaProxyConfig(env), { enabled: false, reason: 'mode_off' });
  }
});

test('proxy fails closed on a production release or incomplete settings', () => {
  const cases = [
    [{ RELEASE_ENVIRONMENT: 'production' }, 'not_staging_release'],
    [{ RELEASE_ENVIRONMENT: undefined }, 'not_staging_release'],
    [{ MEDIA_PROXY_SHARED_SECRET: 'too-short' }, 'shared_secret_missing_or_short'],
    [{ MEDIA_PROXY_PUBLIC_BASE_URL: 'http://app.mosaicbizhub.com/api/media' }, 'public_base_url_invalid'],
    [{ MEDIA_PROXY_PUBLIC_BASE_URL: 'https://app.mosaicbizhub.com/api/media?x=1' }, 'public_base_url_invalid'],
    [{ AWS_S3_BUCKET: '' }, 'bucket_invalid'],
  ];
  for (const [override, reason] of cases) {
    const config = readCatalogMediaProxyConfig({ ...STAGING_ENV, ...override });
    assert.equal(config.enabled, false);
    assert.equal(config.reason, reason);
  }
});

test('proxy off: no route, no URL rewriting, request bodies untouched', async () => {
  const s3 = fakeS3({ [VALID_KEY]: { body: PNG_BYTES, contentType: 'image/png' } });
  const { app, config } = buildApp({ ...STAGING_ENV, MEDIA_PROXY_MODE: undefined }, s3);
  assert.equal(config.enabled, false);
  assert.equal(app.get('json replacer'), undefined);

  const media = await supertest(app).get(`/api/media/catalog/${VALID_KEY}`).set(MEDIA_PROXY_SECRET_HEADER, SECRET);
  assert.equal(media.status, 404);
  assert.equal(s3.calls.length, 0);

  const read = await supertest(app).get('/api/fixture/product');
  assert.equal(read.body.data.coverImage, `${S3_BASE}/${VALID_KEY}`);

  const proxyUrl = `${PROXY_BASE}/${VALID_KEY}`;
  const write = await supertest(app).put('/api/fixture/product').send({ coverImage: proxyUrl });
  assert.equal(JSON.parse(write.text).coverImage, proxyUrl);
});

test('production release with MEDIA_PROXY_MODE=staging still installs nothing', async () => {
  const s3 = fakeS3({ [VALID_KEY]: { body: PNG_BYTES, contentType: 'image/png' } });
  const { app } = buildApp({ ...STAGING_ENV, RELEASE_ENVIRONMENT: 'production' }, s3);
  const media = await supertest(app).get(`/api/media/catalog/${VALID_KEY}`).set(MEDIA_PROXY_SECRET_HEADER, SECRET);
  assert.equal(media.status, 404);
  assert.equal(s3.calls.length, 0);
  const read = await supertest(app).get('/api/fixture/product');
  assert.equal(read.body.data.coverImage, `${S3_BASE}/${VALID_KEY}`);
});

// ---------- streaming ----------

test('streams products/, services/ and foods/ images with private, nosniff headers', async () => {
  const objects = {
    [VALID_KEY]: { body: PNG_BYTES, contentType: 'image/png' },
    'services/u1/gallery/1-a.jpg': { body: Buffer.from('jpegbytes'), contentType: 'image/jpeg' },
    'foods/u1/gallery/2-b.webp': { body: Buffer.from('webpbytes'), contentType: 'image/webp; charset=binary' },
  };
  const s3 = fakeS3(objects);
  const { app } = buildApp(STAGING_ENV, s3);

  for (const [key, object] of Object.entries(objects)) {
    const res = await supertest(app)
      .get(`/api/media/catalog/${key}`)
      .set(MEDIA_PROXY_SECRET_HEADER, SECRET)
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    assert.equal(res.status, 200, key);
    assert.deepEqual(res.body, object.body);
    assert.equal(res.headers['content-type'], object.contentType.split(';')[0]);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(res.headers['cache-control'], /^private, no-store/);
    assert.equal(res.headers['content-length'], String(object.body.length));
  }
  assert.deepEqual(
    s3.calls.map((c) => [c.Bucket, c.Key]),
    Object.keys(objects).map((key) => [BUCKET, key])
  );
});

test('rejects requests without the shared secret before touching S3', async () => {
  const s3 = fakeS3({ [VALID_KEY]: { body: PNG_BYTES, contentType: 'image/png' } });
  const { app } = buildApp(STAGING_ENV, s3);

  const missing = await supertest(app).get(`/api/media/catalog/${VALID_KEY}`);
  assert.equal(missing.status, 403);
  const wrong = await supertest(app).get(`/api/media/catalog/${VALID_KEY}`).set(MEDIA_PROXY_SECRET_HEADER, `${SECRET}x`);
  assert.equal(wrong.status, 403);
  assert.equal(wrong.headers['cache-control'], 'private, no-store, max-age=0');
  assert.equal(s3.calls.length, 0);
});

test('rejects vendor-onboarding, other prefixes and traversal over HTTP without reading S3', async () => {
  const s3 = fakeS3({});
  const { app } = buildApp(STAGING_ENV, s3);
  const cases = [
    ['/api/media/catalog/vendor-onboarding/stage1/u1/tax-doc/1-doc.png', 403],
    ['/api/media/catalog/uploads/u1/generic/1-x.png', 403],
    // WHATWG URL parsing in the client resolves "%2e%2e" to "..", so this arrives as vendor-onboarding/.
    ['/api/media/catalog/products/%2e%2e/vendor-onboarding/stage1/u1/tax-doc/1.png', 403],
    ['/api/media/catalog/products%2F..%2Fvendor-onboarding%2Fx.png', 400],
    ['/api/media/catalog/products/..%2fvendor-onboarding/x.png', 400],
    ['/api/media/catalog/products/u1/%252e%252e/x.png', 400],
  ];
  for (const [path, status] of cases) {
    const res = await supertest(app).get(path).set(MEDIA_PROXY_SECRET_HEADER, SECRET);
    assert.equal(res.status, status, path);
  }
  // Literal "../" is normalized by HTTP clients before sending; send it raw too.
  const raw = await supertest(app)
    .get('/api/media/catalog/products/x')
    .set(MEDIA_PROXY_SECRET_HEADER, SECRET)
    .use((req) => {
      req.url = req.url.replace('/products/x', '/products/../vendor-onboarding/stage1/u1/tax-doc/1.png');
    });
  assert.ok([400, 403, 404].includes(raw.status));
  assert.equal(s3.calls.length, 0);
});

test('refuses non-image and SVG content types, missing objects and oversized objects', async () => {
  const s3 = fakeS3({
    'products/u1/x/1-page.html': { body: Buffer.from('<script>alert(1)</script>'), contentType: 'text/html' },
    'products/u1/x/1-icon.svg': { body: Buffer.from('<svg/>'), contentType: 'image/svg+xml' },
    'products/u1/x/1-big.png': { body: PNG_BYTES, contentType: 'image/png', length: 26 * 1024 * 1024 },
    'products/u1/x/1-denied.png': {
      error: Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }),
    },
    'products/u1/x/1-down.png': {
      error: Object.assign(new Error('boom'), { name: 'InternalError', $metadata: { httpStatusCode: 500 } }),
    },
  });
  const { app } = buildApp(STAGING_ENV, s3);
  const expectations = [
    ['products/u1/x/1-page.html', 415],
    ['products/u1/x/1-icon.svg', 415],
    ['products/u1/x/1-big.png', 502],
    ['products/u1/x/1-missing.png', 404],
    ['products/u1/x/1-denied.png', 404],
    ['products/u1/x/1-down.png', 502],
  ];
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const [key, status] of expectations) {
      const res = await supertest(app).get(`/api/media/catalog/${key}`).set(MEDIA_PROXY_SECRET_HEADER, SECRET);
      assert.equal(res.status, status, key);
      assert.notEqual(res.headers['content-type'], 'text/html');
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    }
  } finally {
    console.error = originalError;
  }
});

// ---------- URL rewriting ----------

test('proxy on: only this bucket\'s catalog URLs are rewritten in JSON responses', async () => {
  const { app } = buildApp(STAGING_ENV, fakeS3());
  const res = await supertest(app).get('/api/fixture/product');
  const data = res.body.data;
  assert.equal(data.coverImage, `${PROXY_BASE}/products/u1/cover/1700000000000-cover.png`);
  assert.deepEqual(data.images, [`${PROXY_BASE}/services/u1/gallery/1-a.jpg`, `${PROXY_BASE}/foods/u1/gallery/2-b.webp`]);
  // Private documents and non-catalog uploads are never exposed through the proxy.
  assert.equal(data.license, `${S3_BASE}/vendor-onboarding/stage1/u1/business-license/1-doc.png`);
  assert.equal(data.generic, `${S3_BASE}/uploads/u1/generic/1-x.png`);
  assert.equal(data.otherBucket, 'https://mosaic-biz-hub.s3.us-east-1.amazonaws.com/products/u1/cover/1-x.png');
  assert.equal(data.note, 'plain text');
});

test('proxy on: proxy URLs in JSON request bodies are stored as canonical S3 URLs', async () => {
  const { app } = buildApp(STAGING_ENV, fakeS3());
  const body = {
    coverImage: `${PROXY_BASE}/${VALID_KEY}`,
    images: [`${PROXY_BASE}/foods/u1/gallery/2-b.webp`, 'https://res.cloudinary.com/x/y.png'],
    variants: [{ image: `${PROXY_BASE}/products/u1/variant/3-c.png` }],
    sneaky: `${PROXY_BASE}/vendor-onboarding/stage1/u1/tax-doc/1.png`,
  };
  const res = await supertest(app).put('/api/fixture/product').send(body);
  const echoed = JSON.parse(res.text);
  assert.equal(echoed.coverImage, `${S3_BASE}/${VALID_KEY}`);
  assert.deepEqual(echoed.images, [`${S3_BASE}/foods/u1/gallery/2-b.webp`, 'https://res.cloudinary.com/x/y.png']);
  assert.equal(echoed.variants[0].image, `${S3_BASE}/products/u1/variant/3-c.png`);
  assert.equal(echoed.sneaky, `${PROXY_BASE}/vendor-onboarding/stage1/u1/tax-doc/1.png`);
});

test('server itself rejects un-normalized encoded and literal traversal sent on a raw socket', async () => {
  const http = require('node:http');
  const s3 = fakeS3({});
  const { app } = buildApp(STAGING_ENV, s3);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const rawGet = (path) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path, method: 'GET', headers: { [MEDIA_PROXY_SECRET_HEADER]: SECRET } },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        }
      );
      req.on('error', reject);
      req.end();
    });
  try {
    assert.equal(await rawGet('/api/media/catalog/products/%2e%2e/vendor-onboarding/stage1/u1/tax-doc/1.png'), 400);
    assert.equal(await rawGet('/api/media/catalog/products/%2E%2E%2Fvendor-onboarding%2Fx.png'), 400);
    assert.equal(await rawGet('/api/media/catalog/products/../vendor-onboarding/stage1/u1/tax-doc/1.png'), 400);
    assert.equal(await rawGet('/api/media/catalog/products/u1/..%5c..%5cvendor-onboarding/x.png'), 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(s3.calls.length, 0);
});

test('presigned upload URLs (with a query string) are never rewritten; returned fileUrl is', async () => {
  const app = express();
  app.use(express.json());
  installCatalogMediaProxy(app, { env: STAGING_ENV, s3Client: fakeS3(), logger: silentLogger });
  const key = 'products/u1/cover/1700000000000-cover.png';
  const uploadUrl = `${S3_BASE}/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc`;
  app.get('/api/fixture/upload-url', (_req, res) => res.json({ uploadUrl, fileUrl: `${S3_BASE}/${key}`, key }));
  const res = await supertest(app).get('/api/fixture/upload-url');
  assert.equal(res.body.uploadUrl, uploadUrl);
  assert.equal(res.body.fileUrl, `${PROXY_BASE}/${key}`);
  assert.equal(res.body.key, key);
});
