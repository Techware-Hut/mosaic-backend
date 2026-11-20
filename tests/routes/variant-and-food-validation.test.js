const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');
const request = require('supertest');

// Real routers + validators; auth and controllers mocked. Handlers echo 200 when
// the request got past validation.
function loadRouter(rel, mount) {
  const routesPath = path.resolve(__dirname, '../..', rel);
  const originalLoad = Module._load;
  const pass = (req, res) => res.status(200).json({ reached: true });
  Module._load = function mockLoad(req, parent, isMain) {
    if (/controllers\/(productController|foodController)$/.test(req)) return new Proxy({}, { get: () => pass });
    if (req === '../controllers/reviewController') return new Proxy({}, { get: () => () => pass });
    if (/middlewares\/(authenticate|isBusinessOwner|isCustomer)$/.test(req)) return (_q, _s, next) => next();
    return originalLoad.call(this, req, parent, isMain);
  };
  delete require.cache[routesPath];
  try {
    const app = express();
    app.use(express.json());
    app.use(mount, require(routesPath));
    return app;
  } finally {
    Module._load = originalLoad;
  }
}

// Payload exactly as AddVariantForm / EditVariantForm build it (incl. extra fields).
const formVariant = {
  label: 'Size',
  color: 'Blue',
  sizes: [{ size: 'M', sku: 'SKU-M', stock: '3', price: '20' }],
  attributes: { Size: 'M', Color: 'Blue' },
  images: ['https://example.test/v.webp'],
  isPublished: true,
  sku: 'SKU-M',
  stock: 3,
  price: 20,
  salePrice: undefined,
};

test('add-variants: rejects missing/invalid variants with a readable 400', async () => {
  const app = loadRouter('routes/productRoutes.js', '/api/product');
  const cases = [
    [{}, /At least one variant/],
    [{ variants: [] }, /At least one variant/],
    [{ variants: ['x'] }, /must be an object/],
    [{ variants: [{ ...formVariant, attributes: 'Size:M' }] }, /attributes/],
    [{ variants: [{ ...formVariant, images: 'https://x' }] }, /images/],
    [{ variants: [{ ...formVariant, sku: 42 }] }, /SKU/],
  ];
  for (const [body, msg] of cases) {
    const res = await request(app).post('/api/product/add-variants/p1').send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.code, 'VALIDATION_FAILED');
    assert.match(res.body.error, msg);
  }
});

test('add-variants: accepts the inventory form payload', async () => {
  const app = loadRouter('routes/productRoutes.js', '/api/product');
  const res = await request(app).post('/api/product/add-variants/p1').send({ variants: [formVariant] });
  assert.equal(res.status, 200);
  assert.equal(res.body.reached, true);
});

test('update-variant: rejects malformed fields, accepts the edit form payload', async () => {
  const app = loadRouter('routes/productRoutes.js', '/api/product');
  for (const bad of [{ attributes: ['Size', 'M'] }, { images: 'one.webp' }, { shipping: 'free' }, { sku: {} }]) {
    const res = await request(app).put('/api/product/update-variant/p1/v1').send(bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  const ok = await request(app).put('/api/product/update-variant/p1/v1').send(formVariant);
  assert.equal(ok.status, 200);
  const partial = await request(app).put('/api/product/update-variant/p1/v1').send({ stock: 5 });
  assert.equal(partial.status, 200, 'partial updates still allowed');
});

const foodPayload = {
  title: 'Jollof Rice',
  description: 'Party-size tray',
  price: 25,
  categoryId: '507f1f77bcf86cd799439011',
  subcategoryId: '507f1f77bcf86cd799439012',
  businessId: '507f1f77bcf86cd799439013',
  coverImage: 'https://example.test/food.webp',
  images: ['https://example.test/g1.webp'],
  isPublished: false,
};

test('add-food: requires title, description and cover image', async () => {
  const app = loadRouter('routes/foodRoutes.js', '/api/food');
  for (const [field, msg] of [['title', /title/], ['description', /description/], ['coverImage', /Cover image/]]) {
    for (const value of [undefined, '', '   ']) {
      const body = { ...foodPayload, [field]: value };
      const res = await request(app).post('/api/food/add-food').send(body);
      assert.equal(res.status, 400, `${field}=${JSON.stringify(value)}`);
      assert.match(res.body.error, msg);
    }
  }
});

test('add-food: accepts the add-food form payload', async () => {
  const app = loadRouter('routes/foodRoutes.js', '/api/food');
  const res = await request(app).post('/api/food/add-food').send(foodPayload);
  assert.equal(res.status, 200);
});
