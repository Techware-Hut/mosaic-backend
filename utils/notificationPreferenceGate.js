const User = require('../models/User');

/**
 * Returns whether the vendor owner account opted in for a notification class.
 * Defaults to true when prefs are missing.
 */
async function shouldSendVendorNotification(ownerUserId, preference = 'newBookingOrOrder') {
  if (!ownerUserId) return true;

  const user = await User.findById(ownerUserId).select('notificationPreferences email').lean();
  if (!user) return true;

  const prefs = user.notificationPreferences || {};

  if (preference === 'paymentReceived') {
    return prefs.paymentReceived !== false && prefs.newBookingOrOrder !== false;
  }

  return prefs[preference] !== false;
}

/**
 * Build vendor recipient list: always include business profile email when present;
 * include owner user email only when notification prefs allow it.
 */
async function resolveVendorNotificationRecipients({
  business,
  owner,
  preference = 'newBookingOrOrder',
}) {
  const recipients = [];
  const businessEmail = String(business?.email || '').trim();
  const ownerEmail = String(owner?.email || '').trim();
  const ownerId = owner?._id || owner?.id;

  if (businessEmail) {
    recipients.push(businessEmail);
  }

  const ownerAllowed = await shouldSendVendorNotification(ownerId, preference);
  if (ownerEmail && ownerAllowed && !recipients.includes(ownerEmail)) {
    recipients.push(ownerEmail);
  }

  return [...new Set(recipients)];
}

/**
 * Filter a pre-built vendor email list from order-paid webhook payloads.
 * Removes the vendor user email when prefs block it; keeps distinct business email.
 */
async function filterOrderPaidVendorEmails(order, vendorEmails = []) {
  const normalized = [...new Set((vendorEmails || []).map((e) => String(e || '').trim()).filter(Boolean))];
  if (!normalized.length) return [];

  const ownerId = order?.vendorId?._id || order?.vendorId;
  const ownerEmail = String(order?.vendorId?.email || '').trim();
  const businessEmail = String(order?.businessId?.email || '').trim();

  const ownerAllowed = await shouldSendVendorNotification(ownerId, 'paymentReceived');

  if (ownerAllowed) {
    return normalized;
  }

  return normalized.filter((email) => {
    if (ownerEmail && email === ownerEmail) return false;
    if (businessEmail && email === businessEmail) return true;
    return !ownerEmail || email !== ownerEmail;
  });
}

/**
 * Resolve paid-order recipients together with the preference decision so the
 * orchestrator can persist an intentional skip separately from missing data.
 * The paid-order preference gates the complete vendor-role notification. A
 * disabled preference must not be bypassed by a second business-profile alias.
 */
async function resolveOrderPaidVendorEmailDelivery(order) {
  const vendor = order?.vendorId || {};
  const business = order?.businessId || {};
  const businessOwner = business?.owner || {};
  const vendorId = String(vendor?._id || vendor?.id || vendor || "");
  const businessOwnerId = String(
    businessOwner?._id || businessOwner?.id || businessOwner || ""
  );
  const ownerMatches = !businessOwnerId || !vendorId || businessOwnerId === vendorId;
  const vendorEmail = String(vendor?.email || "").trim();
  const ownerAlias = ownerMatches ? String(businessOwner?.email || "").trim() : "";
  const dedupeEmails = (values) => {
    const byLowerCase = new Map();
    for (const value of values) {
      const email = String(value || "").trim();
      if (email && !byLowerCase.has(email.toLowerCase())) {
        byLowerCase.set(email.toLowerCase(), email);
      }
    }
    return [...byLowerCase.values()];
  };
  const ownerEmails = dedupeEmails([vendorEmail, ownerAlias]);
  const rawBusinessEmail = String(business?.email || "").trim();
  const businessEmail = ownerEmails.some(
    (email) => email.toLowerCase() === rawBusinessEmail.toLowerCase()
  )
    ? ""
    : rawBusinessEmail;
  const ownerAllowed = await shouldSendVendorNotification(
    vendor?._id || vendor?.id || vendor,
    "paymentReceived"
  );

  if (!ownerAllowed) {
    return {
      recipients: [],
      preferenceAllowed: false,
      ownerSuppressed: ownerEmails.length > 0,
      reason: "vendor_preference_disabled",
    };
  }

  const recipients = dedupeEmails([
    businessEmail,
    ...ownerEmails,
  ]);

  if (recipients.length) {
    return {
      recipients,
      preferenceAllowed: true,
      ownerSuppressed: false,
      reason: null,
    };
  }

  return {
    recipients: [],
    preferenceAllowed: true,
    ownerSuppressed: false,
    reason: "missing_recipient",
  };
}

/**
 * Booking requests are actionable notifications. Prefer preference-gated recipients,
 * but never drop the vendor alert entirely when a business/owner email exists.
 */
async function resolveVendorBookingNotificationRecipients({ business, owner }) {
  const preferred = await resolveVendorNotificationRecipients({
    business,
    owner,
    preference: 'newBookingOrOrder',
  });

  if (preferred.length) {
    return preferred;
  }

  const fallback = [
    ...new Set(
      [business?.email, owner?.email]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    ),
  ];

  if (fallback.length) {
    console.warn('Vendor booking recipients empty after preference gate; using business/owner fallback', {
      businessId: business?._id ? String(business._id) : null,
      ownerId: owner?._id ? String(owner._id) : owner?.id || null,
      fallbackCount: fallback.length,
    });
  } else {
    console.warn('Vendor booking recipients unavailable: no business or owner email on file', {
      businessId: business?._id ? String(business._id) : null,
      ownerId: owner?._id ? String(owner._id) : owner?.id || null,
    });
  }

  return fallback;
}

module.exports = {
  shouldSendVendorNotification,
  resolveVendorNotificationRecipients,
  resolveVendorBookingNotificationRecipients,
  filterOrderPaidVendorEmails,
  resolveOrderPaidVendorEmailDelivery,
};
