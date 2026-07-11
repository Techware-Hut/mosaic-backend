const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateCatalogListingFlags,
  buildAuditItem,
  matchesRequestedFlags,
} = require('../../lib/admin/catalogAudit');

test('evaluateCatalogListingFlags marks published listing without price and image', () => {
  const flags = evaluateCatalogListingFlags(
    {
      title: 'Product',
      description: '',
      coverImage: '',
      price: null,
      isPublished: true,
    },
    'product',
    { variants: [] }
  );

  assert.ok(flags.includes('missing_description'));
  assert.ok(flags.includes('missing_image'));
  assert.ok(flags.includes('missing_price'));
  assert.ok(flags.includes('suspicious_title'));
  assert.ok(flags.includes('published_incomplete'));
});

test('evaluateCatalogListingFlags passes complete published product', () => {
  const flags = evaluateCatalogListingFlags(
    {
      title: 'Handmade Candle',
      description: 'A long enough product description for marketplace display.',
      coverImage: 'https://cdn.example.com/candle.jpg',
      price: 24.5,
      isPublished: true,
    },
    'product',
    { variants: [] }
  );

  assert.deepEqual(flags, []);
});

test('buildAuditItem includes business and severity metadata', () => {
  const item = buildAuditItem(
    {
      _id: '507f1f77bcf86cd799439011',
      title: 'Product',
      description: 'short',
      coverImage: '',
      price: 0,
      isPublished: true,
      isActive: true,
      businessId: { _id: '507f1f77bcf86cd799439012', businessName: 'Vendor Shop' },
      createdAt: new Date('2026-07-01'),
      updatedAt: new Date('2026-07-02'),
    },
    'product',
    { variants: [] }
  );

  assert.equal(item.listingType, 'product');
  assert.equal(item.businessName, 'Vendor Shop');
  assert.equal(item.severity, 'high');
  assert.ok(item.flags.length > 0);
});

test('matchesRequestedFlags filters by requested audit flags', () => {
  assert.equal(matchesRequestedFlags(['missing_price', 'missing_image'], ['missing_price']), true);
  assert.equal(matchesRequestedFlags(['suspicious_title'], ['missing_price']), false);
  assert.equal(matchesRequestedFlags(['missing_price'], []), true);
});
