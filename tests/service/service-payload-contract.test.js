const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeStringList,
  normalizeBusinessHoursForStorage,
  normalizeBusinessHoursForOwnerResponse,
  normalizeFaqList,
  normalizeAmenitiesList,
  resolveTaxonomyIdFromBody,
  formatOwnerServiceForResponse,
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
    features: [' Mobile appointments ', '', null, 'Consultation included'],
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
  assert.deepEqual(payload.features, ['Mobile appointments', 'Consultation included']);
});

test('normalizeStringList accepts arrays and single strings', () => {
  assert.deepEqual(
    normalizeStringList(['  One ', '', undefined, 'Two']),
    ['One', 'Two']
  );
  assert.deepEqual(normalizeStringList(' One feature '), ['One feature']);
  assert.deepEqual(normalizeStringList({ label: 'nope' }), []);
});

test('normalizeBusinessHoursForStorage accepts FE open/close shape', () => {
  assert.deepEqual(
    normalizeBusinessHoursForStorage([
      { day: 'Monday', openTime: '09:00', closeTime: '17:00', isOpen: true },
    ]),
    [{ day: 'Monday', hours: '09:00-17:00', closed: false }]
  );
});

test('normalizeBusinessHoursForOwnerResponse maps stored hours to FE shape', () => {
  assert.deepEqual(
    normalizeBusinessHoursForOwnerResponse([
      { day: 'Tuesday', hours: '10:00-18:00', closed: false },
    ]),
    [{ day: 'Tuesday', openTime: '10:00', closeTime: '18:00', isOpen: true }]
  );
});

test('normalizeFaqList trims and drops incomplete entries', () => {
  assert.deepEqual(
    normalizeFaqList([
      { question: ' Q ', answer: ' A ' },
      { question: 'Missing answer', answer: '' },
    ]),
    [{ question: 'Q', answer: 'A' }]
  );
});

test('normalizeAmenitiesList trims labels and coerces availability', () => {
  assert.deepEqual(
    normalizeAmenitiesList([
      { label: ' WiFi ', available: 'true' },
      { label: '', available: true },
    ]),
    [{ label: 'WiFi', available: true }]
  );
});

test('resolveTaxonomyIdFromBody accepts direct ids and nested category aliases', () => {
  assert.equal(
    resolveTaxonomyIdFromBody({ categoryId: '507f1f77bcf86cd799439014' }, 'categoryId', 'category'),
    '507f1f77bcf86cd799439014'
  );
  assert.equal(
    resolveTaxonomyIdFromBody(
      { category: { _id: '507f1f77bcf86cd799439020' } },
      'categoryId',
      'category'
    ),
    '507f1f77bcf86cd799439020'
  );
});

test('formatOwnerServiceForResponse maps stored business hours for owner reopen', () => {
  const formatted = formatOwnerServiceForResponse({
    _id: '507f1f77bcf86cd799439011',
    categoryId: { _id: '507f1f77bcf86cd799439014', name: 'Beauty' },
    businessHours: [{ day: 'Wednesday', hours: '08:00-12:00', closed: false }],
    faq: [{ question: 'Q', answer: 'A' }],
    amenities: [{ label: 'Parking', available: true }],
    features: ['Online Booking'],
  });

  assert.equal(formatted.categoryId.name, 'Beauty');
  assert.deepEqual(formatted.businessHours, [{
    day: 'Wednesday',
    openTime: '08:00',
    closeTime: '12:00',
    isOpen: true,
  }]);
  assert.deepEqual(formatted.faq, [{ question: 'Q', answer: 'A' }]);
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
