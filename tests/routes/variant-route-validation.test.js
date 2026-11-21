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
  const pass = (req, res) => res.status(200).json({ reached: true, body: req.body });
  Module._load = function mockLoad(req, parent, isMain) {
    if (/controllers\/(productController)$/.test(req)) return new Proxy({}, { get: () => pass });
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


const malformedFields = [
  ...[[], 'Size:M', 2].map(attributes => ({ attributes })),
  ...['', '   '].map(key => ({ attributes: { [key]: 'M' } })),
  ...[null, true, {}, []].map(value => ({ attributes: { Size: value } })),
  ...['one.webp', [42], [null], [{}]].map(images => ({ images })),
  ...[42, {}, []].map(sku => ({ sku })),
  ...['free', [], 42, true].map(shipping => ({ shipping })),
];

function assertValidationFailure(res) {
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'VALIDATION_FAILED');
  assert.equal(typeof res.body.error, 'string');
  assert.ok(res.body.error.length > 0);
  assert.ok(Array.isArray(res.body.errors) && res.body.errors.length > 0);
  assert.equal(res.body.error, res.body.errors[0].msg);
  assert.equal(res.body.reached, undefined);
}

test('add-variants: every malformed structure returns the validation envelope', async () => {
  const app = loadRouter('routes/productRoutes.js', '/api/product');
  const bodies = [
    {}, ...[null, {}, 'x', 1, []].map(variants => ({ variants })),
    ...[null, [], 'x', 1, true].map(variant => ({ variants: [variant] })),
    ...malformedFields.map(bad => ({ variants: [{ ...formVariant, ...bad }] })),
    { variants: [formVariant, { ...formVariant, shipping: [] }] },
  ];
  for (const body of bodies) {
    const send = () => request(app).post('/api/product/add-variants/p1').send(body);
    const res = await send();
    assertValidationFailure(res);
    assert.deepEqual((await send()).body, res.body, 'deterministic errors');
  }
});

test('update-variant: every malformed field returns the validation envelope', async () => {
  const app = loadRouter('routes/productRoutes.js', '/api/product');
  for (const body of malformedFields) {
    const send = () => request(app).put('/api/product/update-variant/p1/v1').send(body);
    const res = await send();
    assertValidationFailure(res);
    assert.deepEqual((await send()).body, res.body);
  }
});

// null optional fields mean "not provided" (as in #341); the controller treats
// them as absent (variant.attributes || {}, if (attributes) ...).
test('null optional fields pass validation like omitted ones', async () => {
  const app = loadRouter('routes/productRoutes.js', '/api/product');
  for (const field of ['attributes', 'images', 'sku', 'shipping']) {
    const add = await request(app).post('/api/product/add-variants/p1').send({ variants: [{ ...formVariant, [field]: null }] });
    assert.equal(add.status, 200, field);
    const upd = await request(app).put('/api/product/update-variant/p1/v1').send({ [field]: null });
    assert.equal(upd.status, 200, field);
  }
});

test('FE add/edit fixtures retain all extra fields, with and without color', async () => {
  const app = loadRouter('routes/productRoutes.js', '/api/product');
  for (const attributes of [{ Size: 'M', Color: 'Blue' }, { Size: 'M' }]) {
    const add = { attributes, images: formVariant.images, isPublished: true,
      sizes: formVariant.sizes, sku: 'SKU-M', stock: 3, price: 20 };
    const edit = { ...add, label: 'Size', color: attributes.Color || '',
      _id: 'v1', productId: 'p1', weightInKg: 1, shipping: { standard: 2 },
      salePrice: 15, createdAt: '2026-11-01T00:00:00.000Z' };
    const added = await request(app).post('/api/product/add-variants/p1').send({ variants: [add] });
    assert.equal(added.status, 200);
    assert.deepEqual(added.body.body, { variants: [add] });
    const updated = await request(app).put('/api/product/update-variant/p1/v1').send(edit);
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.body, edit);
  }
});

test('route validation leaves numeric parsing and pricing policy to controllers', async () => {
  const app = loadRouter('routes/productRoutes.js', '/api/product');
  for (const price of [0, -1, '20', 'invalid']) {
    const payload = { ...formVariant, price, stock: '3', attributes: { Size: 42 }, shipping: {} };
    assert.equal((await request(app).post('/api/product/add-variants/p1').send({ variants: [payload] })).status, 200);
    assert.equal((await request(app).put('/api/product/update-variant/p1/v1').send(payload)).status, 200);
  }
});
