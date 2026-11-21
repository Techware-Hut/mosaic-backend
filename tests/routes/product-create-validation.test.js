const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');
const request = require('supertest');
const { validationResult } = require('express-validator');

const routesPath = path.resolve(__dirname, '../../routes/productRoutes.js');

// Real router + validators; auth and controllers mocked. The create handler
// echoes what the validators flagged.
function loadApp() {
  const originalLoad = Module._load;
  const echo = (req, res) => res.json({ errors: validationResult(req).array().map((e) => e.path) });
  Module._load = function mockLoad(req, parent, isMain) {
    if (req === '../controllers/productController') return new Proxy({}, { get: () => echo });
    if (req === '../controllers/reviewController') return new Proxy({}, { get: () => () => echo });
    if (req === '../middlewares/authenticate' || req === '../middlewares/isBusinessOwner' || req === '../middlewares/isCustomer') {
      return (_req, _res, next) => next();
    }
    return originalLoad.call(this, req, parent, isMain);
  };
  delete require.cache[routesPath];
  try {
    const router = require(routesPath);
    const app = express();
    app.use(express.json());
    app.use('/api/product', router);
    return app;
  } finally {
    Module._load = originalLoad;
  }
}

const id = () => '507f1f77bcf86cd7994390' + String(Math.floor(Math.random() * 90) + 10);

function validBody(overrides = {}) {
  return {
    title: 'Test Product 1',
    description: 'Synthetic product',
    businessId: id(),
    categoryId: id(),
    subcategoryId: id(),
    coverImage: 'https://example.test/cover.webp',
    galleryImages: ['https://example.test/g1.webp'],
    // Single-price product as the vendor form sends it: one variant, no attributes.
    variants: [{ attributes: {}, price: 12.5, stock: 1 }],
    discount: { type: 'fixed', amount: 2 },
    isPublished: true,
    ...overrides,
  };
}

test('POST /api/product rejects a create without required fields', async () => {
  const app = loadApp();
  const res = await request(app).post('/api/product').send({ variants: [] });
  for (const field of ['title', 'description', 'businessId', 'categoryId', 'subcategoryId', 'coverImage', 'variants']) {
    assert.ok(res.body.errors.includes(field), `expected ${field} to be flagged, got ${res.body.errors}`);
  }
});

test('POST /api/product rejects a missing cover image and malformed ids', async () => {
  const app = loadApp();
  const res = await request(app).post('/api/product').send(validBody({ coverImage: '  ', categoryId: 'abc' }));
  assert.ok(res.body.errors.includes('coverImage'));
  assert.ok(res.body.errors.includes('categoryId'));
});

test('POST /api/product accepts the current vendor form payload (single price, fixed discount)', async () => {
  const app = loadApp();
  const res = await request(app).post('/api/product').send(validBody());
  assert.deepEqual(res.body.errors, []);
});

test('POST /api/product accepts a two-attribute variant payload', async () => {
  const app = loadApp();
  const res = await request(app).post('/api/product').send(validBody({
    variants: [
      { attributes: { Size: 'Large', Fabric: 'Silk' }, price: 30, stock: 2, sku: '' },
      { attributes: { Size: 'Small', Fabric: 'Silk' }, price: 28, stock: 1 },
    ],
  }));
  assert.deepEqual(res.body.errors, []);
});

test('one-attribute vendor form remains accepted', async () => {
  const res = await request(loadApp()).post('/api/product').send(validBody({
    attributes: [{ name: 'Size', values: ['M'] }],
    shipping: { standard: 0, overnight: 5, local: 0 },
    metaFields: [{ key: 'Material', value: 'Cotton' }],
    taxCategory: { code: 'txcd_99999999' },
    discount: { type: 'percentage', amount: 10, minCartValue: 20 },
    variants: [{ attributes: { Size: 'M' }, price: 20, salePrice: 18, stock: 2, images: [], shipping: {} }],
  }));
  assert.deepEqual(res.body.errors, []);
});

test('variants must be a nonempty array of objects', async () => {
  for (const variants of [undefined, [], 'bad', [null], [1], [[]]]) {
    const res = await request(loadApp()).post('/api/product').send(validBody({ variants }));
    assert.ok(res.body.errors.some(path => path.startsWith('variants')));
  }
});

test('titles longer than 200 characters are accepted', async () => {
  const res = await request(loadApp()).post('/api/product').send(validBody({ title: 'A'.repeat(201) }));
  assert.deepEqual(res.body.errors, []);
});
