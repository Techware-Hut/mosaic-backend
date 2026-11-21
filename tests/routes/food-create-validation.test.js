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
    if (/controllers\/foodController$/.test(req)) return new Proxy({}, { get: () => pass });
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
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'VALIDATION_FAILED');
      assert.equal(res.body.errors[0].path, field);
    }
  }
});

test('add-food: accepts the add-food form payload', async () => {
  const app = loadRouter('routes/foodRoutes.js', '/api/food');
  const res = await request(app).post('/api/food/add-food').send(foodPayload);
  assert.equal(res.status, 200);
});

test('add-food: rejects non-string required fields and malformed galleries', async () => {
  const app = loadRouter('routes/foodRoutes.js', '/api/food');
  for (const field of ['title', 'description', 'coverImage']) {
    for (const value of [null, 42, false, [], {}]) {
      const res = await request(app).post('/api/food/add-food').send({ ...foodPayload, [field]: value });
      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'VALIDATION_FAILED');
      assert.equal(res.body.errors[0].path, field);
      assert.equal(res.body.error, res.body.errors[0].msg);
    }
  }
  for (const images of ['image.webp', {}, [42], [null], ['ok.webp', {}]]) {
    const res = await request(app).post('/api/food/add-food').send({ ...foodPayload, images });
    assert.equal(res.status, 400, JSON.stringify(images));
  }
});

test('add-food: optional galleries and long titles remain accepted; edit stays partial', async () => {
  const app = loadRouter('routes/foodRoutes.js', '/api/food');
  for (const images of [undefined, null, [], ['image.webp']]) {
    const res = await request(app).post('/api/food/add-food').send({ ...foodPayload, title: 'x'.repeat(201), images });
    assert.equal(res.status, 200);
  }
  const res = await request(app).put('/api/food/update-food/f1').send({ price: 5 });
  assert.equal(res.status, 200);
});
