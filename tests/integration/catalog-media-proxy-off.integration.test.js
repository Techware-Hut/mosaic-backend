// Staging catalog media proxy OFF (production / default): the real app.js must behave exactly as before.
for (const key of ['MEDIA_PROXY_MODE', 'MEDIA_PROXY_SHARED_SECRET', 'MEDIA_PROXY_PUBLIC_BASE_URL']) delete process.env[key];

const test = require('node:test');
const assert = require('node:assert/strict');
const { startHarness, resetDatabase, stopHarness, getApp } = require('./setup/harness');
const { createAgent } = require('./helpers/client');
const { registerAndVerify, seedApprovedBusiness, seedPublishedProduct } = require('./helpers/factories');
const User = require('../../models/User');
const Product = require('../../models/Product');

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

test('proxy off: no media route, no JSON replacer, stored S3 URLs returned unchanged', async () => {
  const app = getApp();
  assert.equal(app.get('json replacer'), undefined);

  const agent = createAgent(app);
  const media = await agent.get('/api/media/catalog/products/u1/cover/1-x.png').set('x-mosaic-media-proxy-secret', 'x'.repeat(48));
  assert.equal(media.status, 404);

  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user);
  const product = await seedPublishedProduct(business, user);
  const s3Url = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/products/${user._id}/cover/1-x.png`;
  await Product.updateOne({ _id: product._id }, { coverImage: s3Url });

  const storefront = await agent.get(`/api/public/product/${product._id}`);
  assert.equal(storefront.status, 200);
  assert.equal(storefront.body.data.coverImage, s3Url);

  const proxyLooking = 'https://app.mosaicbizhub.com/api/media/products/u1/cover/2-y.png';
  const saved = await agent.put(`/api/product/${product._id}`).send({ coverImage: proxyLooking, isPublished: true, variants: [{ attributes: { size: 'M' }, price: 25, stock: 5 }] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal((await Product.findById(product._id).lean()).coverImage, proxyLooking);
});
