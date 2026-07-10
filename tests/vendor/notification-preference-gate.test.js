const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldSendVendorNotification,
  resolveVendorNotificationRecipients,
  filterOrderPaidVendorEmails,
} = require('../../utils/notificationPreferenceGate');

test('resolveVendorNotificationRecipients includes business email and owner when prefs allow', async () => {
  const User = require('../../models/User');
  const originalFindById = User.findById;

  User.findById = () => ({
    select: () => ({
      lean: async () => ({
        notificationPreferences: { newBookingOrOrder: true },
      }),
    }),
  });

  try {
    const recipients = await resolveVendorNotificationRecipients({
      business: { email: 'shop@example.com' },
      owner: { _id: 'owner-1', email: 'owner@example.com' },
    });

    assert.deepEqual(recipients, ['shop@example.com', 'owner@example.com']);
  } finally {
    User.findById = originalFindById;
  }
});

test('resolveVendorNotificationRecipients omits owner email when prefs block', async () => {
  const User = require('../../models/User');
  const originalFindById = User.findById;

  User.findById = () => ({
    select: () => ({
      lean: async () => ({
        notificationPreferences: { newBookingOrOrder: false },
      }),
    }),
  });

  try {
    const recipients = await resolveVendorNotificationRecipients({
      business: { email: 'shop@example.com' },
      owner: { _id: 'owner-1', email: 'owner@example.com' },
    });

    assert.deepEqual(recipients, ['shop@example.com']);
  } finally {
    User.findById = originalFindById;
  }
});

test('filterOrderPaidVendorEmails removes owner email when payment prefs block', async () => {
  const User = require('../../models/User');
  const originalFindById = User.findById;

  User.findById = () => ({
    select: () => ({
      lean: async () => ({
        notificationPreferences: {
          newBookingOrOrder: true,
          paymentReceived: false,
        },
      }),
    }),
  });

  try {
    const filtered = await filterOrderPaidVendorEmails(
      {
        vendorId: { _id: 'owner-1', email: 'owner@example.com' },
        businessId: { email: 'shop@example.com' },
      },
      ['owner@example.com', 'shop@example.com']
    );

    assert.deepEqual(filtered, ['shop@example.com']);
  } finally {
    User.findById = originalFindById;
  }
});

test('shouldSendVendorNotification defaults to true without owner id', async () => {
  const allowed = await shouldSendVendorNotification(null, 'newBookingOrOrder');
  assert.equal(allowed, true);
});
