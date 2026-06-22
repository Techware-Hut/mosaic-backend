const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dtoPath = path.resolve(__dirname, '../../lib/listing/publicListingDto.js');
const {
  normalizePrice,
  normalizeImages,
  normalizeListingStatus,
  normalizeLocation,
  toPublicListingCard,
  toPublicListingDetail,
  toPublicBusinessCard,
} = require(dtoPath);

function assertNoUndefinedValues(obj, prefix = '') {
  for (const [key, value] of Object.entries(obj)) {
    const pathKey = prefix ? `${prefix}.${key}` : key;
    assert.notEqual(value, undefined, `expected no undefined at ${pathKey}`);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      assertNoUndefinedValues(value, pathKey);
    }
  }
}

test('normalizeImages returns null image and empty array when missing', () => {
  const result = normalizeImages({});
  assert.equal(result.image, null);
  assert.equal(result.imageUrl, null);
  assert.deepEqual(result.images, []);
});

test('normalizeImages prefers coverImage then images then logo', () => {
  const result = normalizeImages({
    coverImage: 'https://cdn.example.com/cover.jpg',
    images: ['https://cdn.example.com/a.jpg'],
    logo: 'https://cdn.example.com/logo.jpg',
  });
  assert.equal(result.imageUrl, 'https://cdn.example.com/cover.jpg');
  assert.equal(result.images.length, 3);
});

test('normalizePrice returns null for missing values', () => {
  assert.equal(normalizePrice(null), null);
  assert.equal(normalizePrice(undefined), null);
  assert.equal(normalizePrice(''), null);
});

test('normalizePrice parses Decimal128 shape and zero', () => {
  assert.equal(normalizePrice({ $numberDecimal: '19.99' }), 19.99);
  assert.equal(normalizePrice(0), 0);
});

test('toPublicListingCard handles missing price with safe priceLabel', () => {
  const card = toPublicListingCard(
    { _id: '507f1f77bcf86cd799439011', title: 'Sample' },
    { listingType: 'product' }
  );
  assert.equal(card.price, null);
  assert.equal(card.priceLabel, 'Contact for price');
  assert.equal(card.listingType, 'product');
  assert.equal(card.id, '507f1f77bcf86cd799439011');
  assert.deepEqual(card.tags, []);
});

test('toPublicListingCard normalizes populated businessId vendor fields', () => {
  const card = toPublicListingCard(
    {
      _id: '507f1f77bcf86cd799439011',
      title: 'Widget',
      businessId: {
        _id: '507f1f77bcf86cd799439012',
        businessName: 'Acme Co',
        badge: 'Gold',
      },
    },
    { listingType: 'product' }
  );
  assert.equal(card.vendorId, '507f1f77bcf86cd799439012');
  assert.equal(card.vendorName, 'Acme Co');
  assert.equal(card.badge, 'Gold');
});

test('toPublicListingCard preserves legacy keys and adds canonical fields', () => {
  const card = toPublicListingCard(
    {
      _id: '507f1f77bcf86cd799439011',
      title: 'Featured Item',
      coverImage: 'https://cdn.example.com/p.jpg',
      categoryId: { _id: 'cat1', name: 'Apparel', slug: 'apparel' },
      price: 25,
    },
    { listingType: 'product' }
  );
  assert.equal(card._id, '507f1f77bcf86cd799439011');
  assert.equal(card.coverImage, 'https://cdn.example.com/p.jpg');
  assert.equal(card.imageUrl, 'https://cdn.example.com/p.jpg');
  assert.equal(card.category?.name, 'Apparel');
  assert.equal(card.detailPath, '/products/507f1f77bcf86cd799439011');
  assertNoUndefinedValues(card);
});

test('toPublicListingCard does not invent badge when absent', () => {
  const card = toPublicListingCard(
    { _id: '507f1f77bcf86cd799439011', title: 'Plain' },
    { listingType: 'service' }
  );
  assert.equal(card.badge, null);
});

test('toPublicListingCard handles service businessDetails legacy shape', () => {
  const card = toPublicListingCard(
    {
      _id: '507f1f77bcf86cd799439011',
      title: 'Consulting',
      businessId: '507f1f77bcf86cd799439012',
      businessDetails: {
        businessName: 'Consult LLC',
        logo: 'https://cdn.example.com/logo.jpg',
        badge: 'Silver',
      },
    },
    { listingType: 'service' }
  );
  assert.equal(card.vendorName, 'Consult LLC');
  assert.equal(card.businessDetails.businessName, 'Consult LLC');
  assert.equal(card.imageUrl, 'https://cdn.example.com/logo.jpg');
});

test('toPublicBusinessCard normalizes vendor browse card fields', () => {
  const card = toPublicBusinessCard({
    _id: '507f1f77bcf86cd799439011',
    businessName: 'Shop Co',
    slug: 'shop-co',
    logo: 'https://cdn.example.com/logo.jpg',
  });
  assert.equal(card.id, '507f1f77bcf86cd799439011');
  assert.equal(card.name, 'Shop Co');
  assert.equal(card.detailPath, '/business/shop-co');
  assert.deepEqual(card.tags, []);
  assertNoUndefinedValues(card);
});

test('toPublicListingDetail merges extras such as variants and tax fields', () => {
  const detail = toPublicListingDetail(
    { _id: '507f1f77bcf86cd799439011', title: 'Widget', price: 10 },
    {
      listingType: 'product',
      extras: {
        taxCategory: 'standard',
        taxRate: 0.08,
        variants: [{ variantId: 'v1', price: 12 }],
      },
    }
  );
  assert.equal(detail.taxCategory, 'standard');
  assert.equal(detail.taxRate, 0.08);
  assert.equal(detail.variants.length, 1);
  assert.equal(detail.id, '507f1f77bcf86cd799439011');
});

test('toPublicListingDetail omits undefined values in nested objects', () => {
  const detail = toPublicListingDetail(
    { _id: '507f1f77bcf86cd799439011', title: 'Plain' },
    { listingType: 'product' }
  );
  assertNoUndefinedValues(detail);
});

test('toPublicListingCard resolves featured-style populated aliases', () => {
  const card = toPublicListingCard(
    {
      _id: '507f1f77bcf86cd799439011',
      title: 'Featured Item',
      category: { _id: 'cat1', name: 'Apparel' },
      subcategory: { _id: 'sub1', name: 'Shirts' },
      business: { _id: 'biz1', businessName: 'Acme Co', badge: 'Gold' },
    },
    { listingType: 'product' }
  );
  assert.equal(card.category?.name, 'Apparel');
  assert.equal(card.subcategory?.name, 'Shirts');
  assert.equal(card.vendorName, 'Acme Co');
  assert.equal(card.badge, 'Gold');
});

test('normalizeListingStatus marks unpublished and out-of-stock as unavailable', () => {
  assert.equal(normalizeListingStatus({ isPublished: false }), 'unavailable');
  assert.equal(normalizeListingStatus({ stockQuantity: 0 }), 'unavailable');
  assert.equal(normalizeListingStatus({ isPublished: true }), 'available');
});

test('displayPrice mirrors priceLabel on listing cards', () => {
  const withPrice = toPublicListingCard(
    { _id: '507f1f77bcf86cd799439011', title: 'Priced', price: 12.5 },
    { listingType: 'product' }
  );
  assert.equal(withPrice.priceLabel, '$12.50');
  assert.equal(withPrice.displayPrice, '$12.50');

  const noPrice = toPublicListingCard(
    { _id: '507f1f77bcf86cd799439011', title: 'Free quote' },
    { listingType: 'service' }
  );
  assert.equal(noPrice.displayPrice, 'Contact for price');
});

test('vendorLogo comes from populated businessId without inventing values', () => {
  const card = toPublicListingCard(
    {
      _id: '507f1f77bcf86cd799439011',
      title: 'Widget',
      businessId: {
        _id: '507f1f77bcf86cd799439012',
        businessName: 'Acme Co',
        logo: 'https://cdn.example.com/logo.jpg',
      },
    },
    { listingType: 'product' }
  );
  assert.equal(card.vendorLogo, 'https://cdn.example.com/logo.jpg');
  assert.equal(card.business?.logo, 'https://cdn.example.com/logo.jpg');
});

test('normalizeLocation extracts city and state from address when present', () => {
  const result = normalizeLocation(
    {
      location: { city: 'Austin', state: 'TX', country: 'US' },
    },
    null
  );
  assert.equal(result.city, 'Austin');
  assert.equal(result.state, 'TX');
  assert.deepEqual(result.location, { city: 'Austin', state: 'TX', country: 'US' });
});

test('normalizeLocation returns null fields when no source data exists', () => {
  const result = normalizeLocation({}, null);
  assert.equal(result.location, null);
  assert.equal(result.city, null);
  assert.equal(result.state, null);

  const card = toPublicListingCard(
    { _id: '507f1f77bcf86cd799439011', title: 'No location' },
    { listingType: 'product' }
  );
  assert.equal(card.location, null);
  assert.equal(card.city, null);
  assert.equal(card.state, null);
});

test('toPublicListingCard omits oversized media fields from list payloads', () => {
  const card = toPublicListingCard(
    {
      _id: '507f1f77bcf86cd799439011',
      title: 'Gallery Item',
      coverImage: 'https://cdn.example.com/cover.jpg',
      images: [
        'https://cdn.example.com/cover.jpg',
        'https://cdn.example.com/b.jpg',
        'https://cdn.example.com/c.jpg',
      ],
      videos: ['https://cdn.example.com/promo.mp4'],
    },
    { listingType: 'product' }
  );

  assert.equal(card.imageUrl, 'https://cdn.example.com/cover.jpg');
  assert.deepEqual(card.images, ['https://cdn.example.com/cover.jpg']);
  assert.equal(card.coverImage, 'https://cdn.example.com/cover.jpg');
  assert.equal(card.videos, undefined);
});

test('toPublicListingDetail preserves full image gallery on detail payloads', () => {
  const detail = toPublicListingDetail(
    {
      _id: '507f1f77bcf86cd799439011',
      title: 'Gallery Item',
      coverImage: 'https://cdn.example.com/cover.jpg',
      images: [
        'https://cdn.example.com/cover.jpg',
        'https://cdn.example.com/b.jpg',
      ],
    },
    { listingType: 'product' }
  );

  assert.equal(detail.imageUrl, 'https://cdn.example.com/cover.jpg');
  assert.equal(detail.images.length, 2);
  assert.equal(detail.images[1], 'https://cdn.example.com/b.jpg');
});

test('toPublicListingCard returns null imageUrl when no media exists', () => {
  const card = toPublicListingCard(
    { _id: '507f1f77bcf86cd799439011', title: 'No media' },
    { listingType: 'food' }
  );

  assert.equal(card.image, null);
  assert.equal(card.imageUrl, null);
  assert.deepEqual(card.images, []);
});
