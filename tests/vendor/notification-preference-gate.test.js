const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldSendVendorNotification,
  resolveVendorNotificationRecipients,
  resolveVendorBookingNotificationRecipients,
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

test('resolveVendorBookingNotificationRecipients falls back to owner email when prefs empty the list', async () => {
  const User = require('../../models/User');
  const originalFindById = User.findById;

  User.findById = () => ({
    select: () => ({
      lean: async () => ({
        notificationPreferences: { newBookingOrOrder: false },
      }),
    }),
  });

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const recipients = await resolveVendorBookingNotificationRecipients({
      business: { _id: 'biz-1', email: '' },
      owner: { _id: 'owner-1', email: 'owner@example.com' },
    });

    assert.deepEqual(recipients, ['owner@example.com']);
    assert.ok(
      warnings.some((line) => line.includes('using business/owner fallback')),
      'expected fallback warning'
    );
  } finally {
    User.findById = originalFindById;
    console.warn = originalWarn;
  }
});

test('resolveVendorBookingNotificationRecipients keeps preference-gated business email without fallback noise', async () => {
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
    const recipients = await resolveVendorBookingNotificationRecipients({
      business: { email: 'shop@example.com' },
      owner: { _id: 'owner-1', email: 'owner@example.com' },
    });

    assert.deepEqual(recipients, ['shop@example.com']);
  } finally {
    User.findById = originalFindById;
  }
});
