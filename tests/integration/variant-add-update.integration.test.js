const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { startHarness, resetDatabase, stopHarness, getApp } = require('./setup/harness');
const { createAgent } = require('./helpers/client');
const { registerAndVerify, login, seedApprovedBusiness } = require('./helpers/factories');
const User = require('../../models/User');
const Product = require('../../models/Product');
const ProductVariant = require('../../models/ProductVariant');

test.before(() => startHarness());
test.afterEach(() => resetDatabase());
test.after(() => stopHarness());

test('FE variant add/update payloads persist through real routes and controllers', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user);
  const product = await Product.create({
    title: 'Variant validation product', description: 'Add/update persistence',
    categoryId: new mongoose.Types.ObjectId(), subcategoryId: new mongoose.Types.ObjectId(),
    ownerId: user._id, businessId: business._id,
    coverImage: 'https://example.test/product.webp', isPublished: false,
  });
  assert.equal((await login(agent, vendor.email, vendor.password)).status, 200);
  const payload = {
    attributes: { Size: 'M', Color: 'Blue' }, images: ['https://example.test/v.webp'],
    isPublished: false, sizes: [{ size: 'M', sku: 'SKU-M', stock: '3', price: '20' }],
    sku: 'SKU-M', stock: 3, price: 20, shipping: { standard: 2 },
  };
  const added = await agent.post(`/api/product/add-variants/${product._id}`).send({ variants: [payload] });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  const id = added.body.variants[0]._id;
  let persisted = await ProductVariant.findById(id);
  assert.equal(persisted.price.toString(), '20');
  assert.equal(persisted.stock, 3);
  assert.equal(persisted.attributes.get('Color'), 'Blue');
  assert.equal(persisted.shipping.standard, 2);
  const edit = { ...payload, attributes: { Size: 'L' }, label: 'Size', color: '',
    sizes: [{ size: 'L', sku: 'SKU-L', stock: '5', price: '25' }],
    sku: 'SKU-L', stock: 5, price: 25, shipping: { standard: 4 } };
  const updated = await agent.put(`/api/product/update-variant/${product._id}/${id}`).send(edit);
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  persisted = await ProductVariant.findById(id);
  assert.deepEqual(Object.fromEntries(persisted.attributes), { Size: 'L' });
  assert.equal(persisted.sku, 'SKU-L');
  assert.equal(persisted.price.toString(), '25');
  assert.equal(persisted.stock, 5);
  assert.equal(persisted.shipping.standard, 4);
  assert.deepEqual([...persisted.images], payload.images);
  assert.equal(persisted.isPublished, false);
});
