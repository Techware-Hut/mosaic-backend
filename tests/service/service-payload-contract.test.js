const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeServicePayload,
  PUBLISH_CHILD_SERVICE_REQUIRED_MESSAGE,
  validateChildServices,
  validatePublishRequest,
  evaluateServicePublication,
  formatOwnerServiceResponse,
} = require('../../lib/service/serviceContract');

test('validateChildServices rejects missing child price with field key', () => {
  const result = validateChildServices([
    { name: 'Basic Cut', durationMinutes: 60 },
  ]);

  assert.equal(result.ok, false);
  assert.ok(result.fieldErrors['services[0].price']);
});

test('validateChildServices rejects missing child duration with field key', () => {
  const result = validateChildServices([
    { name: 'Basic Cut', price: 45 },
  ]);

  assert.equal(result.ok, false);
  assert.ok(result.fieldErrors['services[0].durationMinutes']);
});

test('normalizeServicePayload persists canonical parent and child fields', () => {
  const payload = normalizeServicePayload({
    title: 'Hair Styling',
    description: 'Full salon menu',
    services: [{
      name: 'Basic Cut',
      price: 45,
      durationMinutes: 60,
    }],
  });

  assert.equal(payload.title, 'Hair Styling');
  assert.equal(payload.description, 'Full salon menu');
  assert.equal(payload.parentPrice, 45);
  assert.equal(payload.normalizedServices[0].price, 45);
  assert.equal(payload.normalizedServices[0].durationMinutes, 60);
});

test('normalizeServicePayload backfills single name-only child from top-level price and duration', () => {
  const payload = normalizeServicePayload({
    title: 'Hair Styling',
    description: 'Full salon menu',
    price: 45,
    duration: '60',
    services: [{ name: 'Basic Cut' }],
  });

  assert.equal(payload.normalizedServices.length, 1);
  assert.equal(payload.normalizedServices[0].name, 'Basic Cut');
  assert.equal(payload.normalizedServices[0].price, 45);
  assert.equal(payload.normalizedServices[0].durationMinutes, 60);
  assert.equal(payload.parentPrice, 45);
});

test('validatePublishRequest rejects publish without valid children', () => {
  const result = validatePublishRequest({
    isPublished: true,
    normalizedServices: [{ name: 'Only Name' }],
  });

  assert.equal(result.ok, false);
  assert.ok(result.fieldErrors.isPublished);
});

test('validatePublishRequest uses clear copy when publishing without child services', () => {
  const result = validatePublishRequest({
    isPublished: true,
    normalizedServices: [],
  });

  assert.equal(result.ok, false);
  assert.equal(result.message, PUBLISH_CHILD_SERVICE_REQUIRED_MESSAGE);
  assert.equal(result.fieldErrors.services, PUBLISH_CHILD_SERVICE_REQUIRED_MESSAGE);
  assert.equal(result.fieldErrors.isPublished, PUBLISH_CHILD_SERVICE_REQUIRED_MESSAGE);
});

test('evaluateServicePublication returns SERVICE_UNPUBLISHED for drafts', () => {
  const publication = evaluateServicePublication({
    service: {
      isPublished: false,
      services: [{ name: 'Cut', price: 20, durationMinutes: 30 }],
    },
    business: { isActive: true },
  });

  assert.equal(publication.isPubliclyVisible, false);
  assert.equal(publication.visibilityReason, 'SERVICE_UNPUBLISHED');
});

test('evaluateServicePublication returns BUSINESS_INACTIVE for inactive business', () => {
  const publication = evaluateServicePublication({
    service: {
      isPublished: true,
      services: [{ name: 'Cut', price: 20, durationMinutes: 30 }],
    },
    business: { isActive: false },
  });

  assert.equal(publication.isPubliclyVisible, false);
  assert.equal(publication.visibilityReason, 'BUSINESS_INACTIVE');
});

test('formatOwnerServiceResponse includes publication block', () => {
  const response = formatOwnerServiceResponse(
    {
      _id: '507f1f77bcf86cd799439011',
      title: 'Hair Styling',
      isPublished: true,
      services: [{ name: 'Cut', price: 20, durationMinutes: 30 }],
    },
    { isActive: true }
  );

  assert.equal(response.success, true);
  assert.equal(response.data.publication.isPubliclyVisible, true);
  assert.equal(response.data.publication.visibilityReason, null);
});
