const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateStage1Payload,
  isValidUrl,
  VALID_BUSINESS_TYPES,
} = require('../../utils/vendorOnboardingValidation');

function validPayload(overrides = {}) {
  return {
    businessName: 'Test Business LLC',
    businessType: 'product',
    primaryContactName: 'Jane Vendor',
    address: {
      city: 'Atlanta',
      state: 'GA',
      country: 'USA',
      zipCode: '30301',
    },
    acceptedTerms: true,
    declarationAccepted: true,
    isMinorityOwned: false,
    ...overrides,
  };
}

test('validateStage1Payload accepts valid MVP payload', () => {
  assert.deepEqual(validateStage1Payload(validPayload()), []);
});

test('validateStage1Payload requires business name', () => {
  const errors = validateStage1Payload(validPayload({ businessName: 'A' }));
  assert.ok(errors.some((e) => e.includes('Business name')));
});

test('validateStage1Payload requires business type', () => {
  const errors = validateStage1Payload(validPayload({ businessType: 'invalid' }));
  assert.ok(errors.some((e) => e.includes('Business type')));
});

test('validateStage1Payload requires primary contact name', () => {
  const errors = validateStage1Payload(validPayload({ primaryContactName: '' }));
  assert.ok(errors.some((e) => e.includes('Primary contact name')));
});

test('validateStage1Payload requires address fields', () => {
  const errors = validateStage1Payload(validPayload({
    address: { city: '', state: '', country: '', zipCode: '' },
  }));
  assert.ok(errors.some((e) => e.includes('City')));
  assert.ok(errors.some((e) => e.includes('State')));
  assert.ok(errors.some((e) => e.includes('Country')));
  assert.ok(errors.some((e) => e.includes('ZIP code')));
});

test('validateStage1Payload requires minority categories when minority-owned', () => {
  const errors = validateStage1Payload(validPayload({
    isMinorityOwned: true,
    minorityCategories: [],
  }));
  assert.ok(errors.some((e) => e.includes('minority category')));
});

test('validateStage1Payload requires terms and declaration', () => {
  const errors = validateStage1Payload(validPayload({
    acceptedTerms: false,
    declarationAccepted: false,
  }));
  assert.ok(errors.some((e) => e.includes('Terms and declaration')));
});

test('validateStage1Payload validates optional social URLs when provided', () => {
  const errors = validateStage1Payload(validPayload({ website: 'not-a-url' }));
  assert.ok(errors.some((e) => e.includes('website')));
});

test('isValidUrl accepts https URLs', () => {
  assert.equal(isValidUrl('https://example.com/page'), true);
});

test('VALID_BUSINESS_TYPES includes product service food', () => {
  assert.deepEqual(VALID_BUSINESS_TYPES, ['product', 'service', 'food']);
});
