const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyCatalogActiveTransition,
} = require('../../lib/admin/catalogActiveTransition');

test('published -> deactivated keeps published instead of forcing draft', () => {
  const next = applyCatalogActiveTransition(
    { isActive: true, isPublished: true },
    false
  );

  assert.equal(next.isActive, false);
  assert.equal(next.isPublished, true);
  assert.equal(next.wasPublishedAtDeactivation, true);
});

test('published -> deactivated -> reactivated restores published', () => {
  const deactivated = applyCatalogActiveTransition(
    { isActive: true, isPublished: true },
    false
  );
  const reactivated = applyCatalogActiveTransition(
    {
      isActive: deactivated.isActive,
      isPublished: deactivated.isPublished,
      wasPublishedAtDeactivation: deactivated.wasPublishedAtDeactivation,
    },
    true
  );

  assert.equal(reactivated.isActive, true);
  assert.equal(reactivated.isPublished, true);
  assert.equal(reactivated.wasPublishedAtDeactivation, false);
});

test('legacy deactivated published listing (isPublished already cleared) restores published on reactivate', () => {
  const next = applyCatalogActiveTransition(
    {
      isActive: false,
      isPublished: false,
      wasPublishedAtDeactivation: undefined,
    },
    true
  );

  assert.equal(next.isActive, true);
  assert.equal(next.isPublished, true);
});

test('genuine draft stays unpublished through deactivate/reactivate', () => {
  const deactivated = applyCatalogActiveTransition(
    { isActive: true, isPublished: false, wasPublishedAtDeactivation: false },
    false
  );
  assert.equal(deactivated.isPublished, false);
  assert.equal(deactivated.wasPublishedAtDeactivation, false);

  const reactivated = applyCatalogActiveTransition(
    {
      isActive: false,
      isPublished: false,
      wasPublishedAtDeactivation: false,
    },
    true
  );

  assert.equal(reactivated.isActive, true);
  assert.equal(reactivated.isPublished, false);
});

test('already-active unpublished draft is not auto-published when isActive stays true', () => {
  const next = applyCatalogActiveTransition(
    { isActive: true, isPublished: false },
    true
  );

  assert.equal(next.isActive, true);
  assert.equal(next.isPublished, false);
});

test('deactivating an unpublished draft remembers it was never published', () => {
  const next = applyCatalogActiveTransition(
    { isActive: true, isPublished: false },
    false
  );

  assert.equal(next.isActive, false);
  assert.equal(next.isPublished, false);
  assert.equal(next.wasPublishedAtDeactivation, false);
});

test('draft -> published is an explicit isPublished write, not an active toggle', () => {
  const listing = { isActive: true, isPublished: false };
  const untouched = applyCatalogActiveTransition(listing, undefined);
  assert.deepEqual(untouched, {});

  listing.isPublished = true;
  assert.equal(listing.isPublished, true);
});

test('product with a still-published variant restores parent publication on reactivate', () => {
  const next = applyCatalogActiveTransition(
    { isActive: false, isPublished: false },
    true,
    { hasPublishedVariant: true }
  );

  assert.equal(next.isActive, true);
  assert.equal(next.isPublished, true);
});
