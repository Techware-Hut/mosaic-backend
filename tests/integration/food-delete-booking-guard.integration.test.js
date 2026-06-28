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
  seedApprovedBusiness,
} = require('./helpers/factories');
const User = require('../../models/User');
const Food = require('../../models/Food');
const FoodCategory = require('../../models/FoodCategory');
const FoodSubcategory = require('../../models/FoodSubcategory');
const Booking = require('../../models/Booking');

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

async function setupVendorWithFood(agent) {
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user, { listingType: 'food' });

  const category = await FoodCategory.create({
    name: `Integration Food Category ${Date.now()}`,
  });
  const subcategory = await FoodSubcategory.create({
    name: `Integration Food Subcategory ${Date.now()}`,
    category: category._id,
  });

  const loginRes = await login(agent, vendor.email, vendor.password);
  assert.equal(loginRes.status, 200);

  const food = await Food.create({
    title: 'Integration Supper Club',
    description: 'Food booking guard listing',
    price: 35,
    categoryId: category._id,
    subcategoryId: subcategory._id,
    businessId: business._id,
    ownerId: user._id,
    isPublished: true,
  });

  return { vendor, user, business, category, subcategory, food };
}

async function createBookingCustomer() {
  return User.create({
    name: 'Integration Food Customer',
    email: `food-booking-customer-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`,
    role: 'customer',
    provider: 'google',
    providerId: `google-food-booking-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    isOtpVerified: true,
  });
}

async function seedFoodBooking(setup, status = 'Booked') {
  const customer = await createBookingCustomer();
  return Booking.create({
    bookingType: 'food',
    foodId: setup.food._id,
    foodTitle: setup.food.title,
    serviceTitle: setup.food.title,
    date: new Date(Date.now() + 24 * 60 * 60 * 1000),
    slot: '7:00 PM',
    time: '7:00 PM',
    seats: 'upto 2',
    status,
    businessId: setup.business._id,
    ownerId: setup.user._id,
    customerId: customer._id,
    customerInfo: {
      name: customer.name,
      email: customer.email,
      phone: '555-0101',
    },
  });
}

test('vendor cannot delete food listing while it has active booking', async () => {
  const agent = createAgent(getApp());
  const setup = await setupVendorWithFood(agent);

  await seedFoodBooking(setup, 'Booked');

  const deleteRes = await agent.delete(`/api/food/delete-food/${setup.food._id}`);

  assert.equal(deleteRes.status, 409);
  assert.equal(deleteRes.body.success, false);
  assert.match(deleteRes.body.message, /active bookings/i);

  const foodInDb = await Food.findById(setup.food._id);
  assert.ok(foodInDb, 'food listing must remain in database');
});

test('vendor can delete food listing when related booking is terminal', async () => {
  const agent = createAgent(getApp());
  const setup = await setupVendorWithFood(agent);

  await seedFoodBooking(setup, 'completed');

  const deleteRes = await agent.delete(`/api/food/delete-food/${setup.food._id}`);

  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.message, 'Food deleted successfully.');

  const foodInDb = await Food.findById(setup.food._id);
  assert.equal(foodInDb, null);
});
