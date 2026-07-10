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

module.exports = {
  shouldSendVendorNotification,
  resolveVendorNotificationRecipients,
  filterOrderPaidVendorEmails,
};
