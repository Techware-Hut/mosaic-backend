const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPublicCategoryFilter,
  filterPublicCategories,
  getInvalidCategoryNameReason,
  isValidCategoryName,
} = require('../../utils/categoryVisibility');

test('known broken public category names are invalid', () => {
  for (const name of ['gcgjgjgg', 'vvvvv', 'v v v v']) {
    assert.equal(isValidCategoryName(name), false);
    assert.ok(getInvalidCategoryNameReason(name));
  }
});

test('legitimate marketplace category names remain valid', () => {
  for (const name of ['Electronics', 'Home Cleaning', 'Food & Grocery', 'HVAC', 'BBQ']) {
    assert.equal(isValidCategoryName(name), true, `${name} should be valid`);
  }
});

test('public category filter excludes hidden and disabled status fields', () => {
  const filter = buildPublicCategoryFilter({ slug: 'electronics' });

  assert.deepEqual(filter.isActive, { $ne: false });
  assert.deepEqual(filter.isDeleted, { $ne: true });
  assert.deepEqual(filter.isPublic, { $ne: false });
  assert.deepEqual(filter.isPublished, { $ne: false });
  assert.deepEqual(filter.hidden, { $ne: true });
  assert.deepEqual(filter.isHidden, { $ne: true });
  assert.ok(filter.status.$nin.includes('hidden'));
  assert.equal(filter.slug, 'electronics');
});

test('filterPublicCategories removes invalid and hidden records only', () => {
  const categories = filterPublicCategories([
    { name: 'Electronics', slug: 'electronics' },
    { name: 'gcgjgjgg', slug: 'gcgjgjgg' },
    { name: 'vvvvv', slug: 'vvvvv' },
    { name: 'Home Cleaning', slug: 'home-cleaning', hidden: true },
    { name: 'Food & Grocery', slug: 'food-grocery', status: 'hidden' },
    { name: 'HVAC', slug: 'hvac', isActive: true },
  ]);

  assert.deepEqual(categories.map((category) => category.name), [
    'Electronics',
    'HVAC',
  ]);
});
