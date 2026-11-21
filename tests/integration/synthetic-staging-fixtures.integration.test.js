const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { main } = require('../../scripts/fixtures/seed-synthetic-staging');
const {
  FIXTURE_TAG,
  FIXTURE_MODEL_NAMES,
  fixtureObjectId,
  MAX_RELATED_PER_COLLECTION,
} = require('../../scripts/fixtures/lib/seeder');

const DB_NAME = 'mbh_fixture_it_staging';

const EXPECTED_COUNTS = {
  User: 5,
  VendorOnboardingStage1: 2,
  Subscription: 3,
  Business: 3,
  ProductCategory: 1,
  ProductSubcategory: 1,
  ServiceCategory: 1,
  ServiceSubcategory: 1,
  FoodCategory: 1,
  FoodSubcategory: 1,
  Product: 2,
  ProductVariant: 2,
  Service: 1,
  Food: 1,
};
const EXPECTED_TOTAL = Object.values(EXPECTED_COUNTS).reduce((a, b) => a + b, 0);

let mongoServer;
let env;

function quiet() {
  const lines = [];
  const sink = (line) => lines.push(String(line));
  return { lines, log: sink, error: sink };
}

async function run(argv, overrides = {}) {
  const io = quiet();
  const code = await main({ argv, env: { ...env, ...overrides }, log: io.log, error: io.error });
  return { code, output: io.lines.join('\n') };
}

async function withDb(fn) {
  const conn = await mongoose.createConnection(env.MONGODB_URI).asPromise();
  try {
    return await fn(conn.db);
  } finally {
    await conn.close();
  }
}

async function collectionCounts(filter = {}) {
  return withDb(async (db) => {
    const counts = {};
    for (const name of FIXTURE_MODEL_NAMES) {
      const collection = mongoose.models[name]
        ? mongoose.models[name].collection.collectionName
        : null;
      if (!collection) continue;
      counts[name] = await db.collection(collection).countDocuments(filter);
    }
    return counts;
  });
}

async function schemaShape() {
  return withDb(async (db) => {
    const shape = {};
    for (const info of await db.listCollections().toArray()) {
      shape[info.name] = (await db.collection(info.name).indexes()).length;
    }
    return shape;
  });
}

async function totalDocuments() {
  return withDb(async (db) => {
    let total = 0;
    for (const info of await db.listCollections().toArray()) {
      total += await db.collection(info.name).countDocuments({});
    }
    return total;
  });
}

describe('synthetic staging fixture seeder (in-memory Mongo)', () => {
  let unmarked;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const baseUri = mongoServer.getUri().replace(/\/?$/, '/');
    env = {
      RELEASE_ENVIRONMENT: 'staging',
      FIXTURE_SEED_CONFIRM: 'synthetic-staging',
      MONGODB_URI: `${baseUri}${DB_NAME}`,
      FIXTURE_ALLOWED_DB_HOSTS: '127.0.0.1',
      FIXTURE_ALLOWED_DB_NAMES: DB_NAME,
      MAIL_RECIPIENT_ALLOWLIST: '@example.test',
      FIXTURE_EMAIL_BUYER: 'qa+buyer@example.test',
      FIXTURE_EMAIL_VENDOR_A: 'qa+vendor-a@example.test',
      FIXTURE_EMAIL_VENDOR_B: 'qa+vendor-b@example.test',
      FIXTURE_EMAIL_ADMIN: 'qa+admin@example.test',
      FIXTURE_EMAIL_FOOD_VENDOR: 'qa+food@example.test',
      FIXTURE_PASSWORD: 'synthetic-only-password-1',
    };

    // Pre-existing, unmarked data that must never be touched.
    await mongoose.connect(env.MONGODB_URI);
    const SubscriptionPlan = require('../../models/SubscriptionPlan');
    const User = require('../../models/User');
    const Subscription = require('../../models/Subscription');
    const Business = require('../../models/Business');
    require('../../scripts/fixtures/lib/seeder');
    // Load every fixture model so collection names resolve in helpers.
    for (const name of FIXTURE_MODEL_NAMES) {
      if (!mongoose.models[name]) require(`../../models/${name}`);
    }

    const plan = await SubscriptionPlan.create({
      name: 'Launch Plan',
      price: 0,
      limits: {
        productListings: 10,
        serviceListings: 10,
        foodListings: 10,
        imageLimit: 10,
        videoLimit: 1,
      },
    });
    const owner = await User.create({
      name: 'Existing Owner',
      email: 'existing-owner@example.test',
      mobile: '+14155550000',
      role: 'business_owner',
    });
    const subscription = await Subscription.create({
      userId: owner._id,
      subscriptionPlanId: plan._id,
      stripeSubscriptionId: 'existing_sub_placeholder',
      paymentStatus: 'COMPLETED',
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000),
    });
    const business = await Business.create({
      owner: owner._id,
      businessName: 'test vendor',
      listingType: 'product',
      subscriptionId: subscription._id,
      subscriptionPlanId: plan._id,
    });
    unmarked = { plan, owner, subscription, business };
    await mongoose.disconnect();
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  it('refuses when a database connection is already open in the process', async () => {
    await mongoose.connect(env.MONGODB_URI);
    try {
      const before = await totalDocuments();
      const { code, output } = await run(['--apply']);
      assert.equal(code, 2);
      assert.match(output, /connection is already open/);
      assert.equal(await totalDocuments(), before);
    } finally {
      await mongoose.disconnect();
    }
  });

  it('refuses when the database name is not allowlisted, writing nothing', async () => {
    const before = await totalDocuments();
    const { code, output } = await run(['--apply'], { FIXTURE_ALLOWED_DB_NAMES: 'mosaic_staging' });
    assert.equal(code, 2);
    assert.match(output, /DB_NAME_NOT_ALLOWED/);
    assert.equal(await totalDocuments(), before);
  });

  it('refuses the production database name even when allowlisted, writing nothing', async () => {
    const before = await totalDocuments();
    const prodUri = env.MONGODB_URI.replace(new RegExp(`/${DB_NAME}$`), '/mosaic');
    assert.notEqual(prodUri, env.MONGODB_URI);
    const { code, output } = await run(['--apply'], {
      MONGODB_URI: prodUri,
      FIXTURE_ALLOWED_DB_NAMES: `mosaic,${DB_NAME}`,
    });
    assert.equal(code, 2);
    assert.match(output, /DB_NAME_PRODUCTION/);
    assert.equal(await totalDocuments(), before);
  });

  it('refuses when the in-memory host is not allowlisted, writing nothing', async () => {
    const before = await totalDocuments();
    const { code, output } = await run(['--apply'], { FIXTURE_ALLOWED_DB_HOSTS: 'db.example.test' });
    assert.equal(code, 2);
    assert.match(output, /DB_HOST_NOT_ALLOWED/);
    assert.equal(await totalDocuments(), before);
  });

  it('dry-run (default) prints the plan and writes nothing', async () => {
    const before = await totalDocuments();
    const shapeBefore = await schemaShape();
    const { code, output } = await run([]);
    assert.equal(code, 0, output);
    assert.match(output, new RegExp(`${EXPECTED_TOTAL} to create, 0 already present`));
    assert.match(output, /Dry run: nothing was written/);
    assert.match(output, /host\(s\) 127\.0\.0\.1, db "mbh_fixture_it_staging"/);
    assert.ok(!output.includes(env.FIXTURE_PASSWORD));
    assert.equal(await totalDocuments(), before);
    assert.deepEqual(await schemaShape(), shapeBefore, 'no collections or indexes created');
    const marked = await collectionCounts({ fixtureTag: FIXTURE_TAG });
    assert.ok(Object.values(marked).every((n) => n === 0));
  });

  it('apply creates the expected fixture counts', async () => {
    const { code, output } = await run(['--apply']);
    assert.equal(code, 0, output);
    assert.match(output, new RegExp(`Applied: ${EXPECTED_TOTAL} created, 0 already present`));
    assert.ok(!output.includes(env.FIXTURE_PASSWORD));
    const marked = await collectionCounts({ fixtureTag: FIXTURE_TAG });
    assert.deepEqual(marked, EXPECTED_COUNTS);
  });

  it('seeds usable documents: roles, stock, bookable service, food, no Stripe Connect', async () => {
    await mongoose.connect(env.MONGODB_URI);
    try {
      const User = mongoose.model('User');
      const users = await User.find({ fixtureTag: FIXTURE_TAG }).lean();
      for (const u of users) {
        assert.equal(String(u._id), String(fixtureObjectId(u.fixtureKey)), 'deterministic ids');
      }
      const roles = users.map((u) => u.role).sort();
      assert.deepEqual(roles, ['admin', 'business_owner', 'business_owner', 'business_owner', 'customer']);
      assert.ok(users.every((u) => u.isOtpVerified === true && u.passwordHash));

      const variants = await mongoose.model('ProductVariant').find({ fixtureTag: FIXTURE_TAG }).lean();
      assert.deepEqual(variants.map((v) => v.stock).sort(), [1, 5]);

      const service = await mongoose.model('Service').findOne({ fixtureTag: FIXTURE_TAG }).lean();
      assert.ok(service.isPublished);
      assert.ok(service.services.length >= 1 && service.services.every((s) => s.durationMinutes > 0));
      assert.ok(service.businessHours.some((h) => !h.closed));

      const food = await mongoose.model('Food').findOne({ fixtureTag: FIXTURE_TAG }).lean();
      assert.ok(food.bookingTimeSlots.length > 0);

      const businesses = await mongoose.model('Business').find({ fixtureTag: FIXTURE_TAG }).lean();
      assert.deepEqual(businesses.map((b) => b.listingType).sort(), ['food', 'product', 'service']);
      for (const b of businesses) {
        assert.equal(b.stripeConnectAccountId, undefined);
        assert.equal(b.chargesEnabled, false);
        assert.equal(String(b.subscriptionPlanId), String(unmarked.plan._id));
      }

      const subs = await mongoose.model('Subscription').find({ fixtureTag: FIXTURE_TAG }).lean();
      assert.ok(subs.every((s) => !/^sub_/.test(s.stripeSubscriptionId)));

      // Documents hydrate and validate through the app models.
      const product = await mongoose.model('Product').findOne({ fixtureTag: FIXTURE_TAG });
      await product.validate();
    } finally {
      await mongoose.disconnect();
    }
  });

  it('a second apply is a no-op', async () => {
    const snapshot = await withDb((db) =>
      db.collection('users').find({ fixtureTag: FIXTURE_TAG }).sort({ _id: 1 }).toArray()
    );
    const totalBefore = await totalDocuments();

    const { code, output } = await run(['--apply']);
    assert.equal(code, 0, output);
    assert.match(output, new RegExp(`0 to create, ${EXPECTED_TOTAL} already present`));
    assert.match(output, new RegExp(`Applied: 0 created, ${EXPECTED_TOTAL} already present`));

    assert.equal(await totalDocuments(), totalBefore);
    const after = await withDb((db) =>
      db.collection('users').find({ fixtureTag: FIXTURE_TAG }).sort({ _id: 1 }).toArray()
    );
    assert.deepEqual(after, snapshot);
  });

  it('a partial fixture set blocks re-apply until cleanup; then apply restores consistent references', async () => {
    // Simulate a partial apply: one product and its variant are missing.
    await withDb(async (db) => {
      await db.collection('products').deleteOne({ fixtureTag: FIXTURE_TAG, fixtureKey: 'product.limited' });
      await db.collection('productvariants').deleteOne({
        fixtureTag: FIXTURE_TAG,
        fixtureKey: 'product.limited.variant',
      });
    });
    const before = await totalDocuments();
    const refused = await run(['--apply']);
    assert.equal(refused.code, 1);
    assert.match(refused.output, /FIXTURE_SET_PARTIAL/);
    assert.match(refused.output, /run --cleanup first/);
    assert.equal(await totalDocuments(), before);

    const cleaned = await run(['--cleanup', '--apply']);
    assert.equal(cleaned.code, 0, cleaned.output);
    const reapplied = await run(['--apply']);
    assert.equal(reapplied.code, 0, reapplied.output);
    assert.deepEqual(await collectionCounts({ fixtureTag: FIXTURE_TAG }), EXPECTED_COUNTS);

    // Every reference held by a fixture business resolves to an existing fixture doc.
    await withDb(async (db) => {
      const businesses = await db.collection('businesses').find({ fixtureTag: FIXTURE_TAG }).toArray();
      const refs = [];
      for (const b of businesses) {
        refs.push(['users', b.owner], ['subscriptions', b.subscriptionId]);
        for (const id of b.products || []) refs.push(['products', id]);
        for (const id of b.services || []) refs.push(['services', id]);
        for (const id of b.foods || []) refs.push(['foods', id]);
      }
      const variants = await db.collection('productvariants').find({ fixtureTag: FIXTURE_TAG }).toArray();
      for (const v of variants) refs.push(['products', v.productId], ['businesses', v.businessId]);
      for (const [collection, id] of refs) {
        assert.ok(
          await db.collection(collection).findOne({ _id: id, fixtureTag: FIXTURE_TAG }),
          `dangling reference into ${collection}`
        );
      }
    });
  });

  const fid = (key) => fixtureObjectId(key);
  const related = {};

  it('cleanup preview classifies related QA documents, deletes nothing, and exits non-zero on manual-review items', async () => {
    const foreignUser = unmarked.owner._id;
    await withDb(async (db) => {
      related.fixtureOrder = (await db.collection('orders').insertOne({
        groupOrderId: 'qa-group-1',
        userId: fid('user.buyer'),
        vendorId: fid('user.vendorA'),
        businessId: fid('business.vendorA.product'),
        items: [{ productId: fid('product.widget'), variantId: fid('product.widget.variant'), quantity: 1 }],
        inventoryAdjustments: [{ variantId: fid('product.widget.variant'), quantity: 1 }],
        totalAmount: 10,
      })).insertedId;
      related.foreignOrder = (await db.collection('orders').insertOne({
        groupOrderId: 'qa-group-2',
        userId: foreignUser,
        vendorId: fid('user.vendorA'),
        businessId: fid('business.vendorA.product'),
        items: [{ productId: fid('product.widget'), variantId: fid('product.widget.variant'), quantity: 1 }],
        totalAmount: 10,
      })).insertedId;
      related.fixtureRefund = (await db.collection('refunds').insertOne({
        orderId: related.fixtureOrder,
        refundedItems: [{ productVariantId: fid('product.widget.variant'), quantity: 1, refundAmount: 10 }],
        totalRefundAmount: 10,
        reason: 'qa',
      })).insertedId;
      related.fixtureCartItem = (await db.collection('cartitems').insertOne({
        userId: fid('user.buyer'),
        productId: fid('product.widget'),
        variantId: fid('product.widget.variant'),
        businessId: fid('business.vendorA.product'),
        quantity: 1,
      })).insertedId;
      related.mixedCart = (await db.collection('carts').insertOne({
        userId: fid('user.buyer'),
        businessId: unmarked.business._id,
        items: [],
      })).insertedId;
      related.fixtureReview = (await db.collection('reviews').insertOne({
        userId: fid('user.vendorB'),
        listingId: fid('service.consult'),
        listingType: 'service',
        rating: 5,
      })).insertedId;
      related.foreignReview = (await db.collection('reviews').insertOne({
        userId: foreignUser,
        listingId: fid('product.widget'),
        listingType: 'product',
        rating: 4,
      })).insertedId;
      related.foreignRefund = (await db.collection('refunds').insertOne({
        orderId: related.foreignOrder,
        refundedItems: [{ productVariantId: fid('product.widget.variant'), quantity: 1, refundAmount: 10 }],
        totalRefundAmount: 10,
        reason: 'qa',
      })).insertedId;
      related.mixedItemOrder = (await db.collection('orders').insertOne({
        groupOrderId: 'qa-group-3',
        userId: fid('user.buyer'),
        vendorId: fid('user.vendorA'),
        businessId: fid('business.vendorA.product'),
        items: [
          { productId: fid('product.widget'), variantId: fid('product.widget.variant'), quantity: 1 },
          { productId: new mongoose.Types.ObjectId(), variantId: new mongoose.Types.ObjectId(), quantity: 1 },
        ],
        totalAmount: 20,
      })).insertedId;
      related.foreignVendorBooking = (await db.collection('bookings').insertOne({
        bookingType: 'service',
        customerId: fid('user.vendorB'),
        ownerId: foreignUser,
        businessId: fid('business.vendorA.service'),
        serviceId: fid('service.consult'),
      })).insertedId;
      related.fixtureBooking = (await db.collection('bookings').insertOne({
        bookingType: 'service',
        customerId: fid('user.vendorB'),
        ownerId: fid('user.vendorA'),
        businessId: fid('business.vendorA.service'),
        serviceId: fid('service.consult'),
        customerInfo: { name: 'Private Name', email: 'private@example.test', phone: '+17575550199' },
      })).insertedId;
    });

    const before = await totalDocuments();
    const { code, output } = await run(['--cleanup']);
    assert.equal(code, 1, output);
    assert.match(output, /mode: cleanup-preview/);
    assert.match(output, /6 document\(s\) need manual review/);
    assert.match(output, new RegExp(`orders ids: .*${related.foreignOrder}`));
    assert.match(output, new RegExp(`orders ids: .*${related.mixedItemOrder}`));
    assert.match(output, new RegExp(`refunds ids: ${related.foreignRefund}`));
    assert.match(output, new RegExp(`bookings ids: ${related.foreignVendorBooking}`));
    assert.match(output, new RegExp(`carts ids: ${related.mixedCart}`));
    assert.match(output, new RegExp(`reviews ids: ${related.foreignReview}`));
    assert.match(output, /Stripe was not called/);
    assert.ok(!output.includes('Private Name') && !output.includes('private@example.test'));
    assert.equal(await totalDocuments(), before, 'dry-run deletes nothing');

    const ok = await run(['--cleanup', '--allow-orphans-report']);
    assert.equal(ok.code, 0, ok.output);
    assert.match(ok.output, /Cleanup dry run: nothing was deleted/);
    assert.equal(await totalDocuments(), before, 'dry-run deletes nothing');
  });

  it('cleanup --apply deletes nothing while manual-review items exist without --allow-orphans-report', async () => {
    const before = await totalDocuments();
    const { code, output } = await run(['--cleanup', '--apply']);
    assert.equal(code, 1, output);
    assert.match(output, /Nothing was deleted/);
    assert.equal(await totalDocuments(), before);
  });

  it('cleanup --apply removes fixture-owned related docs and marked fixtures only; "test vendor" untouched', async () => {
    const { code, output } = await run(['--cleanup', '--apply', '--allow-orphans-report']);
    assert.equal(code, 0, output);

    const marked = await collectionCounts({ fixtureTag: FIXTURE_TAG });
    assert.ok(Object.values(marked).every((n) => n === 0), JSON.stringify(marked));

    await withDb(async (db) => {
      // Fixture-owned related documents (all references fixture ids) are gone.
      assert.equal(await db.collection('orders').findOne({ _id: related.fixtureOrder }), null);
      assert.equal(await db.collection('refunds').findOne({ _id: related.fixtureRefund }), null);
      assert.equal(await db.collection('cartitems').findOne({ _id: related.fixtureCartItem }), null);
      assert.equal(await db.collection('reviews').findOne({ _id: related.fixtureReview }), null);
      assert.equal(await db.collection('bookings').findOne({ _id: related.fixtureBooking }), null);
      // Non-fixture-owned or mixed-reference documents are kept.
      assert.ok(await db.collection('orders').findOne({ _id: related.foreignOrder }));
      assert.ok(await db.collection('carts').findOne({ _id: related.mixedCart }));
      assert.ok(await db.collection('reviews').findOne({ _id: related.foreignReview }));
      assert.ok(await db.collection('refunds').findOne({ _id: related.foreignRefund }), 'refund on foreign order kept');
      assert.ok(await db.collection('orders').findOne({ _id: related.mixedItemOrder }), 'order with non-fixture item kept');
      assert.ok(
        await db.collection('bookings').findOne({ _id: related.foreignVendorBooking }),
        'booking with non-fixture vendor kept'
      );

      const business = await db.collection('businesses').findOne({ _id: unmarked.business._id });
      assert.ok(business, 'unmarked business must survive cleanup');
      assert.equal(business.businessName, 'test vendor');
      assert.ok(await db.collection('users').findOne({ _id: unmarked.owner._id }));
      assert.ok(await db.collection('subscriptions').findOne({ _id: unmarked.subscription._id }));
      assert.ok(await db.collection('subscriptionplans').findOne({ _id: unmarked.plan._id }));
      assert.equal(await db.collection('businesses').countDocuments({}), 1);
    });
  });

  it('cleanup refuses above the per-collection cap before deleting anything', async () => {
    const applied = await run(['--apply']);
    assert.equal(applied.code, 0, applied.output);
    const docs = Array.from({ length: MAX_RELATED_PER_COLLECTION + 1 }, () => ({
      userId: fid('user.buyer'),
      listingId: fid('product.widget'),
      listingType: 'product',
      rating: 5,
      capTest: true,
    }));
    await withDb((db) => db.collection('reviews').insertMany(docs));
    try {
      const before = await totalDocuments();
      const { code, output } = await run(['--cleanup', '--apply', '--allow-orphans-report']);
      assert.equal(code, 1, output);
      assert.match(output, new RegExp(`more than ${MAX_RELATED_PER_COLLECTION} reviews documents reference fixtures`));
      assert.match(output, /nothing was deleted/);
      assert.equal(await totalDocuments(), before);
      const marked = await collectionCounts({ fixtureTag: FIXTURE_TAG });
      assert.deepEqual(marked, EXPECTED_COUNTS);
    } finally {
      await withDb((db) => db.collection('reviews').deleteMany({ capTest: true }));
    }
    const cleaned = await run(['--cleanup', '--apply', '--allow-orphans-report']);
    assert.equal(cleaned.code, 0, cleaned.output);
  });

  for (const [label, collection, doc] of [
    ['product slug', 'products', { title: 'Other', slug: 'mbh-synthetic-widget' }],
    ['variant SKU', 'productvariants', { sku: 'MBH-SYNTH-WIDGET', stock: 1 }],
    ['category name', 'productcategories', { name: 'QA Synthetic Goods', slug: 'other-goods' }],
    ['category slug', 'servicecategories', { name: 'Other Services', slug: 'mbh-synthetic-service-category' }],
    ['business slug', 'businesses', { businessName: 'Other', slug: 'mbh-synthetic-vendor-a-goods' }],
  ]) {
    it(`refuses to apply when a non-fixture ${label} collides`, async () => {
      const { insertedId } = await withDb((db) => db.collection(collection).insertOne(doc));
      try {
        const before = await totalDocuments();
        const { code, output } = await run(['--apply']);
        assert.equal(code, 1);
        assert.match(output, /NON_FIXTURE_COLLISION/);
        assert.equal(await totalDocuments(), before);
      } finally {
        await withDb((db) => db.collection(collection).deleteOne({ _id: insertedId }));
      }
    });
  }

  it('refuses to apply when a non-fixture user already holds a fixture email', async () => {
    await withDb((db) =>
      db.collection('users').insertOne({
        name: 'Someone Else',
        email: env.FIXTURE_EMAIL_BUYER,
        role: 'customer',
      })
    );
    const before = await totalDocuments();
    const { code, output } = await run(['--apply']);
    assert.equal(code, 1);
    assert.match(output, /NON_FIXTURE_COLLISION/);
    assert.match(output, /Nothing was written/);
    assert.equal(await totalDocuments(), before);
  });
});
