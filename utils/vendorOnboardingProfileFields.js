const VENDOR_BUSINESS_PROFILE_ALLOWLIST = [
  'firstName',
  'lastName',
  'primaryEmail',
  'primaryPhone',
  'language',
  'licenseNumber',
  'businessBio',
  'characterLimit',
  'businessProfileImage',
  'featureBanner',
  'businessEmail',
  'businessPhone',
  'alternatePhone',
  'website',
  'facebook',
  'instagram',
  'twitter',
  'linkedin',
  'tiktok',
  'refundPolicyDocument',
  'termsDocument',
  'googleReviewLink',
  'communityServiceLink',
];

const VENDOR_PROTECTED_ONBOARDING_FIELDS = [
  'verificationPayment',
  'status',
  'applicationId',
  'badge',
  'totalVerificationPoints',
  'verificationChecklist',
  'businessId',
  'submittedAt',
  'profileCompletionNotifiedAt',
  'verificationNotificationLog',
  'userId',
  'trustScore',
  'trust_score',
  'isApproved',
  'isVerified',
  'role',
  'adminNotes',
];

const VENDOR_MEDIA_SUBDOC_FIELDS = new Set([
  'businessProfileImage',
  'featureBanner',
  'refundPolicyDocument',
  'termsDocument',
]);

const VENDOR_DOCUMENT_ARRAY_FIELDS = new Set([
  'minorityProofDocuments',
  'taxDocuments',
  'businessLicenseDocuments',
]);

function stripProtectedVendorFields(payload) {
  const cleaned = { ...payload };

  for (const field of VENDOR_PROTECTED_ONBOARDING_FIELDS) {
    delete cleaned[field];
  }

  return cleaned;
}

function sanitizeVendorMediaField(incoming, existing) {
  if (incoming === undefined) {
    return undefined;
  }

  const existingVerified = existing?.verified ?? false;

  if (incoming === null) {
    return { url: '', verified: existingVerified };
  }

  if (typeof incoming === 'string') {
    return { url: incoming, verified: existingVerified };
  }

  if (typeof incoming === 'object') {
    const url = typeof incoming.url === 'string' ? incoming.url : '';
    return { url, verified: existingVerified };
  }

  return existing ?? { url: '', verified: false };
}

function sanitizeVendorDocumentArray(items) {
  if (!Array.isArray(items)) {
    return items;
  }

  return items.map((item) => {
    if (typeof item === 'string') {
      return { url: item, verified: false };
    }

    if (item && typeof item === 'object') {
      return {
        url: typeof item.url === 'string' ? item.url : '',
        verified: false,
      };
    }

    return { url: '', verified: false };
  });
}

function applyVendorBusinessProfileFields(onboarding, payload) {
  for (const field of VENDOR_BUSINESS_PROFILE_ALLOWLIST) {
    if (payload[field] === undefined) {
      continue;
    }

    if (VENDOR_MEDIA_SUBDOC_FIELDS.has(field)) {
      onboarding[field] = sanitizeVendorMediaField(payload[field], onboarding[field]);
    } else {
      onboarding[field] = payload[field];
    }
  }
}

function applyVendorDraftField(onboarding, key, value) {
  if (VENDOR_MEDIA_SUBDOC_FIELDS.has(key)) {
    onboarding[key] = sanitizeVendorMediaField(value, onboarding[key]);
    return;
  }

  if (VENDOR_DOCUMENT_ARRAY_FIELDS.has(key)) {
    onboarding[key] = sanitizeVendorDocumentArray(value);
    return;
  }

  onboarding[key] = value;
}

module.exports = {
  VENDOR_BUSINESS_PROFILE_ALLOWLIST,
  VENDOR_PROTECTED_ONBOARDING_FIELDS,
  VENDOR_MEDIA_SUBDOC_FIELDS,
  VENDOR_DOCUMENT_ARRAY_FIELDS,
  stripProtectedVendorFields,
  sanitizeVendorMediaField,
  sanitizeVendorDocumentArray,
  applyVendorBusinessProfileFields,
  applyVendorDraftField,
};
