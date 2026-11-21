// Staging catalog media proxy ON, through the real app.js (MBH-055).
// Env must be set before the harness requires app.js (each integration file runs in its own process).
const SECRET = 'integration-media-proxy-secret-0123456789abcdef';
const PROXY_BASE = 'https://app.mosaicbizhub.com/api/media';
const BUCKET = 'integration-media-proxy-bucket';
process.env.MEDIA_PROXY_MODE = 'staging';
process.env.RELEASE_ENVIRONMENT = 'staging';
process.env.MEDIA_PROXY_SHARED_SECRET = SECRET;
process.env.MEDIA_PROXY_PUBLIC_BASE_URL = PROXY_BASE;
process.env.AWS_S3_BUCKET = BUCKET;
process.env.AWS_REGION = 'us-east-1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startHarness, resetDatabase, stopHarness, getApp } = require('./setup/harness');
const { createAgent } = require('./helpers/client');
const { registerAndVerify, seedApprovedBusiness, seedPublishedProduct } = require('./helpers/factories');
const User = require('../../models/User');
const Product = require('../../models/Product');
const { MEDIA_PROXY_SECRET_HEADER } = require('../../lib/media/catalogMediaProxy');

const S3_BASE = `https://${BUCKET}.s3.us-east-1.amazonaws.com`;

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

async function seedVendorProduct(agent) {
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user);
  const product = await seedPublishedProduct(business, user);
  const coverKey = `products/${user._id}/cover/1700000000000-synthetic-cover.png`;
  const galleryKey = `products/${user._id}/gallery/1700000000001-synthetic-gallery.jpg`;
  await Product.updateOne(
    { _id: product._id },
    { coverImage: `${S3_BASE}/${coverKey}`, galleryImages: [`${S3_BASE}/${galleryKey}`] }
  );
  return { user, product, coverKey, galleryKey };
}

test('storefront and edit-page reads return proxy URLs; DB keeps canonical S3 URLs', async () => {
  const agent = createAgent(getApp());
  const { product, coverKey, galleryKey } = await seedVendorProduct(agent);

  const storefront = await createAgent(getApp()).get(`/api/public/product/${product._id}`);
  assert.equal(storefront.status, 200);
  assert.equal(storefront.body.data.coverImage, `${PROXY_BASE}/${coverKey}`);
  assert.ok(!JSON.stringify(storefront.body).includes(S3_BASE), 'no raw private-bucket URL leaks to the storefront');

  const editPage = await agent.get(`/api/product/${product._id}`);
  assert.equal(editPage.status, 200);
  const editJson = JSON.stringify(editPage.body);
  assert.ok(editJson.includes(`${PROXY_BASE}/${coverKey}`));
  assert.ok(editJson.includes(`${PROXY_BASE}/${galleryKey}`));
  assert.ok(!editJson.includes(S3_BASE));

  const stored = await Product.findById(product._id).lean();
  assert.equal(stored.coverImage, `${S3_BASE}/${coverKey}`);
});

test('saving from the edit page with proxy URLs stores canonical S3 URLs (upload -> publish -> refresh)', async () => {
  const agent = createAgent(getApp());
  const { user, product, coverKey } = await seedVendorProduct(agent);
  const newCoverKey = `products/${user._id}/cover/1700000000999-new-cover.png`;

  // Unchanged cover sent back as a proxy URL: must map back, so it is not treated as a replacement.
  const same = await agent.put(`/api/product/${product._id}`).send({ coverImage: `${PROXY_BASE}/${coverKey}`, isPublished: true, variants: [{ attributes: { size: 'M' }, price: 25, stock: 5 }] });
  assert.equal(same.status, 200, JSON.stringify(same.body));
  assert.equal((await Product.findById(product._id).lean()).coverImage, `${S3_BASE}/${coverKey}`);

  // New upload: the editor received the canonical upload URL and may echo either form.
  const replaced = await agent.put(`/api/product/${product._id}`).send({ coverImage: `${PROXY_BASE}/${newCoverKey}`, isPublished: true, variants: [{ attributes: { size: 'M' }, price: 25, stock: 5 }] });
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  assert.equal((await Product.findById(product._id).lean()).coverImage, `${S3_BASE}/${newCoverKey}`);

  // Refresh: both surfaces show the new cover through the proxy.
  const storefront = await createAgent(getApp()).get(`/api/public/product/${product._id}`);
  assert.equal(storefront.body.data.coverImage, `${PROXY_BASE}/${newCoverKey}`);
  const editPage = await agent.get(`/api/product/${product._id}`);
  assert.ok(JSON.stringify(editPage.body).includes(`${PROXY_BASE}/${newCoverKey}`));
});

test('media read endpoint requires the shared secret and refuses private or traversal keys', async () => {
  const agent = createAgent(getApp());
  const key = 'products/u1/cover/1700000000000-synthetic-cover.png';

  const noSecret = await agent.get(`/api/media/catalog/${key}`);
  assert.equal(noSecret.status, 403);
  assert.equal(noSecret.headers['x-content-type-options'], 'nosniff');
  assert.match(noSecret.headers['cache-control'], /^private, no-store/);

  const wrongSecret = await agent.get(`/api/media/catalog/${key}`).set(MEDIA_PROXY_SECRET_HEADER, 'x'.repeat(48));
  assert.equal(wrongSecret.status, 403);

  const onboarding = await agent
    .get('/api/media/catalog/vendor-onboarding/stage1/u1/tax-doc/1700000000000-doc.png')
    .set(MEDIA_PROXY_SECRET_HEADER, SECRET);
  assert.equal(onboarding.status, 403);

  const generic = await agent.get('/api/media/catalog/uploads/u1/generic/1-x.png').set(MEDIA_PROXY_SECRET_HEADER, SECRET);
  assert.equal(generic.status, 403);

  const encoded = await agent
    .get('/api/media/catalog/products%2F..%2Fvendor-onboarding%2Fstage1%2Fu1%2Ftax-doc%2F1.png')
    .set(MEDIA_PROXY_SECRET_HEADER, SECRET);
  assert.equal(encoded.status, 400);
});
