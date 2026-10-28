/**
 * utils/vendorOnboardingEmails.js
 *
 * Facade re-exporting vendor onboarding email functions.
 */

'use strict';

const {
  resolveTierDetails,
  sendVendorTierWelcomeEmail,
  triggerTierWelcomeNotifications,
} = require('./vendorTierWelcomeEmail');

module.exports = {
  resolveTierDetails,
  sendVendorTierWelcomeEmail,
  triggerTierWelcomeNotifications,
};
