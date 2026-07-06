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

test('customer can decrease cart quantity via update by cartItemId', async () => {
  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  const vendorUser = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(vendorUser, {
    shippingSettings: { method: 'flat_rate', flatRate: { standard: 5 } },
  });
  const product = await seedPublishedProduct(business, vendorUser);
  const variant = await ProductVariant.create({
    productId: product._id,
    businessId: business._id,
    ownerId: vendorUser._id,
    attributes: { size: 'M' },
    sku: `SKU-CART-DEC-${Date.now()}`,
    price: 25,
    stock: 10,
    isPublished: true,
  });

  const customerAgent = createAgent(getApp());
  const customer = await registerAndVerify(customerAgent, { role: 'customer' });
  await login(customerAgent, customer.email, customer.password);
  const customerUser = await User.findOne({ email: customer.email });

  const line = await CartItem.create({
    userId: customerUser._id,
    productId: product._id,
    variantId: variant._id,
    businessId: business._id,
    quantity: 3,
    variant: 'M',
    shippingMethod: 'standard',
  });
  await Cart.create({
    userId: customerUser._id,
    businessId: business._id,
    items: [line._id],
    totalItems: 3,
  });

  const updateRes = await customerAgent
    .put(`/api/cart/update/${line._id}`)
    .send({ quantity: 1 });

  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.cart.totalItems, 1);
  assert.equal(updateRes.body.cart.items[0].quantity, 1);
  assert.ok(updateRes.body.cart.pricing);
  assert.equal(updateRes.body.cart.pricing.subtotalAmount, 25);
});

test('authenticated cart exposes vendor state for local delivery UI', async () => {
  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  const vendorUser = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(vendorUser, {
    address: { city: 'Atlanta', state: 'GA', country: 'USA', zipCode: '30301' },
    shippingSettings: {
      method: 'flat_rate',
      flatRate: { standard: 5, express: 10, local: 2 },
    },
  });
  const product = await seedPublishedProduct(business, vendorUser);
  const variant = await ProductVariant.create({
    productId: product._id,
    businessId: business._id,
    ownerId: vendorUser._id,
    attributes: { size: 'M' },
    sku: `SKU-CART-LOCAL-${Date.now()}`,
    price: 25,
    stock: 10,
    isPublished: true,
  });

  const customerAgent = createAgent(getApp());
  const customer = await registerAndVerify(customerAgent, { role: 'customer' });
  await login(customerAgent, customer.email, customer.password);
  const customerUser = await User.findOne({ email: customer.email });

  const line = await CartItem.create({
    userId: customerUser._id,
    productId: product._id,
    variantId: variant._id,
    businessId: business._id,
    quantity: 1,
    variant: 'M',
    shippingMethod: 'local',
  });
  await Cart.create({
    userId: customerUser._id,
    businessId: business._id,
    items: [line._id],
    totalItems: 1,
  });

  const cartRes = await customerAgent.get('/api/cart').query({ deliverySpeed: 'local' });

  assert.equal(cartRes.status, 200);
  assert.equal(cartRes.body.cart.items[0].vendorState, 'GA');
  assert.equal(cartRes.body.cart.items[0].state, 'GA');
  assert.equal(cartRes.body.cart.items[0].shipping.local, 0);
  assert.equal(cartRes.body.cart.pricing.business.vendorState, 'GA');
  assert.deepEqual(cartRes.body.cart.pricing.availableDeliverySpeeds, ['standard', 'express', 'local']);
  assert.equal(cartRes.body.cart.pricing.shipping.deliverySpeed, 'local');
  assert.equal(cartRes.body.cart.pricing.shipping.amount, 2);
});

test('composite cart quantity update succeeds with mixed-case shippingMethod', async () => {
  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  const vendorUser = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(vendorUser, {
    shippingSettings: { method: 'flat_rate', flatRate: { standard: 5 } },
  });
  const product = await seedPublishedProduct(business, vendorUser);
  const variant = await ProductVariant.create({
    productId: product._id,
    businessId: business._id,
    ownerId: vendorUser._id,
    attributes: { size: 'M' },
    sku: `SKU-CART-COMP-${Date.now()}`,
    price: 25,
    stock: 10,
    isPublished: true,
  });

  const customerAgent = createAgent(getApp());
  const customer = await registerAndVerify(customerAgent, { role: 'customer' });
  await login(customerAgent, customer.email, customer.password);
  const customerUser = await User.findOne({ email: customer.email });

  const line = await CartItem.create({
    userId: customerUser._id,
    productId: product._id,
    variantId: variant._id,
    businessId: business._id,
    quantity: 3,
    variant: 'M',
    shippingMethod: 'standard',
  });
  await Cart.create({
    userId: customerUser._id,
    businessId: business._id,
    items: [line._id],
    totalItems: 3,
  });

  const updateRes = await customerAgent
    .put('/api/cart/update-quantity')
    .send({
      productId: product._id,
      variantId: variant._id,
      size: 'M',
      quantity: 2,
      shippingMethod: 'Standard',
    });

  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.cart.totalItems, 2);
  assert.equal(updateRes.body.cart.items[0].quantity, 2);
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
