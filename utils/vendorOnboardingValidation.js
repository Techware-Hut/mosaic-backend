/**
 * Stage-1 vendor onboarding submit-time validation.
 * Used only at POST /submit — draft saves remain permissive.
 */

const VALID_BUSINESS_TYPES = ['product', 'service', 'food'];
const OPTIONAL_URL_FIELDS = ['website', 'facebook', 'instagram', 'linkedin', 'tiktok'];

function isValidUrl(url) {
  const pattern =
    /^(https?:\/\/)?([\w\-])+\.{1}([a-zA-Z]{2,63})([\w\-._~:/?#[\]@!$&'()*+,;=]*)?$/;
  return pattern.test(url);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateStage1Payload(body = {}) {
  const errors = [];

  if (!body.businessName || body.businessName.trim().length < 2) {
    errors.push('Business name is required');
  }

  if (!VALID_BUSINESS_TYPES.includes(body.businessType)) {
    errors.push('Business type is required');
  }

  if (!isNonEmptyString(body.primaryContactName)) {
    errors.push('Primary contact name is required');
  }

  const address = body.address || {};
  if (!isNonEmptyString(address.city)) {
    errors.push('City is required');
  }
  if (!isNonEmptyString(address.state)) {
    errors.push('State is required');
  }
  if (!isNonEmptyString(address.country)) {
    errors.push('Country is required');
  }
  if (!isNonEmptyString(address.zipCode)) {
    errors.push('ZIP code is required');
  }

  if (body.isMinorityOwned === true) {
    if (!Array.isArray(body.minorityCategories) || body.minorityCategories.length === 0) {
      errors.push('At least one minority category must be selected');
    }
  }

  // Terms & Conditions must always be accepted
  if (!body.acceptedTerms) {
    errors.push('Terms and conditions must be accepted');
  }

  // General accuracy declaration is required for ALL vendors
  if (body.declarationAccepted !== true) {
    errors.push('General accuracy declaration must be accepted');
  }

  // Vendor cannot claim BOTH a business license AND a no-license compliance declaration
  if (body.hasBusinessLicense === true && body.noLicenseComplianceConfirmed === true) {
    errors.push('Cannot submit both a business license and a no-license compliance declaration at the same time');
  }

  // Compliance declaration is required when vendor has NO business license
  // noLicenseComplianceConfirmed is the dedicated field for this (separate from the general declarationAccepted)
  if (body.hasBusinessLicense === false) {
    if (body.noLicenseComplianceConfirmed !== true) {
      errors.push('Compliance declaration must be accepted when no business license is provided');
    }
  }

  // If vendor claims to have a business license, the number is required
  if (body.hasBusinessLicense === true && !isNonEmptyString(body.licenseNumber)) {
    errors.push('Business license number is required');
  }

  OPTIONAL_URL_FIELDS.forEach((field) => {
    if (body[field] && !isValidUrl(body[field])) {
      errors.push(`Invalid URL provided for ${field}`);
    }
  });

  return errors;
}

module.exports = {
  VALID_BUSINESS_TYPES,
  isValidUrl,
  isNonEmptyString,
  validateStage1Payload,
};
