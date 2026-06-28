const test = require('node:test');
const assert = require('node:assert/strict');
const {
  startHarness,
  resetDatabase,
  stopHarness,
  getApp,
} = require('./setup/harness');
const { createAgent } = require('./helpers/client');
const {
  registerAndVerify,
  login,
  createAdminDirect,
  seedApprovedBusiness,
  seedPublishedProduct,
} = require('./helpers/factories');
const User = require('../../models/User');
const ProductVariant = require('../../models/ProductVariant');
const Cart = require('../../models/Cart');
const CartItem = require('../../models/CartItem');

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

test('authenticated customer receives cart payload', async () => {
  const agent = createAgent(getApp());
  const customer = await registerAndVerify(agent, { role: 'customer' });
  await login(agent, customer.email, customer.password);

  const res = await agent.get('/api/cart');
  assert.equal(res.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(res.body, 'cart'));
});

test('customer removes cart item by id and keeps quantity-based totalItems', async () => {
  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  const vendorUser = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(vendorUser);
  const product = await seedPublishedProduct(business, vendorUser);

  const variantA = await ProductVariant.create({
    productId: product._id,
    businessId: business._id,
    ownerId: vendorUser._id,
    attributes: { size: 'M' },
    sku: `SKU-CART-REMOVE-A-${Date.now()}`,
    price: 25,
    stock: 10,
    isPublished: true,
  });
  const variantB = await ProductVariant.create({
    productId: product._id,
    businessId: business._id,
    ownerId: vendorUser._id,
    attributes: { size: 'L' },
    sku: `SKU-CART-REMOVE-B-${Date.now()}`,
    price: 30,
    stock: 10,
    isPublished: true,
  });

  const customerAgent = createAgent(getApp());
  const customer = await registerAndVerify(customerAgent, { role: 'customer' });
  await login(customerAgent, customer.email, customer.password);
  const customerUser = await User.findOne({ email: customer.email });

  const lineToRemove = await CartItem.create({
    userId: customerUser._id,
    productId: product._id,
    variantId: variantA._id,
    businessId: business._id,
    quantity: 2,
    variant: 'M',
  });
  const lineToKeep = await CartItem.create({
    userId: customerUser._id,
    productId: product._id,
    variantId: variantB._id,
    businessId: business._id,
    quantity: 3,
    variant: 'L',
  });
  await Cart.create({
    userId: customerUser._id,
    businessId: business._id,
    items: [lineToRemove._id, lineToKeep._id],
    totalItems: 5,
  });

  const removeRes = await customerAgent.delete(`/api/cart/remove/${lineToRemove._id}`);
  assert.equal(removeRes.status, 200);
  assert.equal(removeRes.body.cart.totalItems, 3);
  assert.equal(removeRes.body.cart.items.length, 1);
  assert.equal(String(removeRes.body.cart.items[0]), String(lineToKeep._id));
  assert.equal(await CartItem.findById(lineToRemove._id), null);

  const reloadedCart = await Cart.findOne({ userId: customerUser._id }).lean();
  assert.equal(reloadedCart.totalItems, 3);
  assert.deepEqual(reloadedCart.items.map(String), [String(lineToKeep._id)]);
});

test('order initiate rejects empty cart for customer', async () => {
  const agent = createAgent(getApp());
  const customer = await registerAndVerify(agent, { role: 'customer' });
  await login(agent, customer.email, customer.password);

  const res = await agent.post('/api/orders/initiate').send({
    shippingAddress: {
      fullName: 'Test Customer',
      phone: '5555550100',
      addressLine1: '123 Main St',
      city: 'Atlanta',
      state: 'GA',
      country: 'USA',
      postalCode: '30301',
    },
  });

  assert.notEqual(res.status, 200);
});

test('vendor cannot initiate customer checkout order', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  await login(agent, vendor.email, vendor.password);

  const res = await agent.post('/api/orders/initiate').send({});
  assert.equal(res.status, 403);
});

test('admin can list orders; vendor can list vendor orders endpoint', async () => {
  const { email, password } = await createAdminDirect();
  const adminAgent = createAgent(getApp());
  await login(adminAgent, email, password);

  const adminOrders = await adminAgent.get('/api/orders/admin');
  assert.equal(adminOrders.status, 200);

  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  await login(vendorAgent, vendor.email, vendor.password);
  const user = await User.findOne({ email: vendor.email });
  await seedApprovedBusiness(user);

  const vendorOrders = await vendorAgent.get('/api/orders/vendor');
  assert.equal(vendorOrders.status, 200);
});
