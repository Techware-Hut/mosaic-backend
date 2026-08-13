const test = require('node:test');
const assert = require('node:assert/strict');

const {
  startHarness,
  resetDatabase,
  stopHarness,
} = require('./setup/harness');
const {
  seedApprovedBusiness,
  seedPublishedProduct,
  uniqueEmail,
} = require('./helpers/factories');

let User;
let Order;
let sendOrderPaidConfirmationIfNeeded;
let order;

const sendCalls = [];
const priorMailer = global.__MAILER__;
const priorMailLogoUrl = process.env.MAIL_LOGO_URL;

function roleForMessage(message) {
  const entityRef = String(message?.headers?.['X-Entity-Ref-ID'] || '');
  if (entityRef.includes('-customer-')) return 'customer';
  if (entityRef.includes('-vendor-')) return 'vendor';
  throw new Error(`Unexpected paid-order message header: ${entityRef}`);
}

test.before(async () => {
  global.__MAILER__ = {
    async sendMail(message) {
      const role = roleForMessage(message);
      sendCalls.push({ role, message });

      // Hold the winning claim open long enough for the other orchestrators to
      // observe `processing`. This proves the database CAS, not call timing,
      // prevents duplicate SMTP sends.
      await new Promise((resolve) => setTimeout(resolve, 75));

      const recipients = Array.isArray(message.to) ? message.to : [message.to];
      return {
        messageId: `<paid-order-${role}-provider-id@example.test>`,
        accepted: recipients,
        rejected: [],
      };
    },
  };

  // Keep the optional logo path local and deterministic during the real
  // mailer/PDF integration path.
  process.env.MAIL_LOGO_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  await startHarness();

  User = require('../../models/User');
  Order = require('../../models/Order');
  ({ sendOrderPaidConfirmationIfNeeded } = require(
    '../../utils/sendOrderPaidConfirmation'
  ));
});

test.beforeEach(async () => {
  sendCalls.length = 0;

  const customer = await User.create({
    name: 'Paid Email Customer',
    email: uniqueEmail('paid-email-customer'),
    role: 'customer',
    provider: 'google',
    providerId: `customer-${Date.now()}`,
    isOtpVerified: true,
  });
  const vendor = await User.create({
    name: 'Paid Email Vendor',
    email: uniqueEmail('paid-email-vendor'),
    role: 'business_owner',
    provider: 'google',
    providerId: `vendor-${Date.now()}`,
    isOtpVerified: true,
    notificationPreferences: {
      newBookingOrOrder: true,
      paymentReceived: true,
    },
  });
  const business = await seedApprovedBusiness(vendor, {
    businessName: 'Paid Email Integration Shop',
    email: uniqueEmail('paid-email-business'),
  });
  const product = await seedPublishedProduct(business, vendor);

  order = await Order.create({
    groupOrderId: `paid-email-race-${Date.now()}`,
    userId: customer._id,
    vendorId: vendor._id,
    businessId: business._id,
    items: [
      {
        productId: product._id,
        color: 'Black',
        size: 'M',
        sku: 'PAID-EMAIL-RACE-1',
        quantity: 1,
        price: 19.99,
      },
    ],
    subtotalAmount: 19.99,
    totalAmount: 19.99,
    currency: 'USD',
    status: 'ordered',
    statusHistory: [{ status: 'created' }, { status: 'ordered' }],
    paymentStatus: 'paid',
    paymentId: `pi_paid_email_race_${Date.now()}`,
    shippingAddress: {
      fullName: customer.name,
      addressLine1: '100 Integration Way',
      city: 'Atlanta',
      state: 'GA',
      country: 'USA',
      pincode: '30301',
    },
  });
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();

  if (priorMailer === undefined) {
    delete global.__MAILER__;
  } else {
    global.__MAILER__ = priorMailer;
  }

  if (priorMailLogoUrl === undefined) {
    delete process.env.MAIL_LOGO_URL;
  } else {
    process.env.MAIL_LOGO_URL = priorMailLogoUrl;
  }
});

test('real Mongo atomically deduplicates concurrent paid-order customer and vendor delivery', async () => {
  const concurrentResults = await Promise.all(
    Array.from({ length: 3 }, () =>
      sendOrderPaidConfirmationIfNeeded(order._id, { currency: 'usd' })
    )
  );

  assert.equal(
    sendCalls.filter((call) => call.role === 'customer').length,
    1,
    'customer provider send must be claimed exactly once'
  );
  assert.equal(
    sendCalls.filter((call) => call.role === 'vendor').length,
    1,
    'vendor provider send must be claimed exactly once'
  );

  const stored = await Order.findById(order._id).lean();
  assert.equal(stored.paidOrderEmailDelivery.version, 1);
  assert.equal(stored.paidOrderEmailDelivery.customer.status, 'sent');
  assert.equal(stored.paidOrderEmailDelivery.vendor.status, 'sent');
  assert.equal(stored.paidOrderEmailDelivery.customer.attemptCount, 1);
  assert.equal(stored.paidOrderEmailDelivery.vendor.attemptCount, 1);
  assert.equal(
    stored.paidOrderEmailDelivery.customer.messageId,
    '<paid-order-customer-provider-id@example.test>'
  );
  assert.equal(
    stored.paidOrderEmailDelivery.vendor.messageId,
    '<paid-order-vendor-provider-id@example.test>'
  );
  assert.equal(stored.paidOrderEmailDelivery.customer.claimToken, undefined);
  assert.equal(stored.paidOrderEmailDelivery.vendor.claimToken, undefined);
  assert.ok(stored.paidConfirmationEmailSentAt instanceof Date);

  assert.equal(
    concurrentResults.some(
      (result) =>
        result.customer?.status === 'sent' &&
        result.vendor?.status === 'sent' &&
        result.emailSent === true &&
        result.emailFailed === false
    ),
    true,
    'at least one concurrent caller must observe the completed aggregate'
  );

  const callsBeforeReplay = sendCalls.length;
  const replay = await sendOrderPaidConfirmationIfNeeded(order._id, {
    currency: 'usd',
  });

  assert.equal(sendCalls.length, callsBeforeReplay);
  assert.equal(replay.reason, 'no_claimable_delivery');
  assert.equal(replay.emailSent, true);
  assert.equal(replay.emailFailed, false);
  assert.equal(replay.emailWarning, undefined);
  assert.equal(replay.customer.status, 'sent');
  assert.equal(replay.vendor.status, 'sent');
});
