const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStage1Payload } = require('../../utils/vendorOnboardingValidation');

function buildStage1Payload(overrides = {}) {
  return {
    businessName: 'No License Vendor LLC',
    businessType: 'service',
    primaryContactName: 'Sam Service',
    address: {
      street: '100 Main St',
      city: 'Norfolk',
      state: 'VA',
      country: 'USA',
      zipCode: '23510',
    },
    acceptedTerms: true,
    declarationAccepted: true,
    isMinorityOwned: false,
    ...overrides,
  };
}

test('Yes-license path requires both general declarationAccepted and licenseNumber', () => {
  const missingDeclaration = validateStage1Payload(
    buildStage1Payload({
      hasBusinessLicense: true,
      licenseNumber: 'LIC-12345',
      declarationAccepted: false,
    })
  );
  assert.ok(missingDeclaration.some((e) => e.includes('General accuracy declaration')));

  const missingLicenseNumber = validateStage1Payload(
    buildStage1Payload({
      hasBusinessLicense: true,
      licenseNumber: '',
      declarationAccepted: true,
    })
  );
  assert.ok(missingLicenseNumber.some((e) => e.includes('Business license number')));

  const validYes = validateStage1Payload(
    buildStage1Payload({
      hasBusinessLicense: true,
      licenseNumber: 'LIC-12345',
      declarationAccepted: true,
    })
  );
  assert.deepEqual(validYes, []);
});

test('No-license path requires both general declarationAccepted and noLicenseComplianceConfirmed', () => {
  const missingCompliance = validateStage1Payload(
    buildStage1Payload({
      hasBusinessLicense: false,
      noLicenseComplianceConfirmed: false,
      declarationAccepted: true,
    })
  );
  assert.ok(missingCompliance.some((e) => e.includes('Compliance declaration')));

  const missingGeneralAcc = validateStage1Payload(
    buildStage1Payload({
      hasBusinessLicense: false,
      noLicenseComplianceConfirmed: true,
      declarationAccepted: false,
    })
  );
  assert.ok(missingGeneralAcc.some((e) => e.includes('General accuracy declaration')));

  const validNo = validateStage1Payload(
    buildStage1Payload({
      hasBusinessLicense: false,
      noLicenseComplianceConfirmed: true,
      declarationAccepted: true,
    })
  );
  assert.deepEqual(validNo, []);
});
