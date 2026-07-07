const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getBusinessCheckoutBlock,
} = require('../../utils/checkoutGuards');
const {
  sanitizePaymentIntentForClient,
  sanitizeOrderForPaymentPoll,
} = require('../../utils/paymentIntentResponse');

test('getBusinessCheckoutBlock returns null for approved active connected business', () => {
  assert.equal(
    getBusinessCheckoutBlock({
      isApproved: true,
      isActive: true,
      stripeConnectAccountId: 'acct_test',
    }),
    null
  );
});

test('getBusinessCheckoutBlock blocks unapproved business', () => {
  const block = getBusinessCheckoutBlock({
    isApproved: false,
    isActive: true,
    stripeConnectAccountId: 'acct_test',
  });
  assert.equal(block.status, 403);
  assert.match(block.message, /approved and active/i);
});

test('getBusinessCheckoutBlock blocks inactive business', () => {
  const block = getBusinessCheckoutBlock({
    isApproved: true,
    isActive: false,
    stripeConnectAccountId: 'acct_test',
  });
  assert.equal(block.status, 403);
  assert.match(block.message, /approved and active/i);
});

test('getBusinessCheckoutBlock requires explicit approval and activation', () => {
  const block = getBusinessCheckoutBlock({
    stripeConnectAccountId: 'acct_test',
  });
  assert.equal(block.status, 403);
  assert.match(block.message, /approved and active/i);
});

test('getBusinessCheckoutBlock blocks online product checkout when Connect account is missing', () => {
  const block = getBusinessCheckoutBlock({
    isApproved: true,
    isActive: true,
    listingType: 'product',
    stripeConnectAccountId: null,
  });

  assert.equal(block.status, 400);
  assert.match(block.message, /not connected to Stripe/i);
});

test('sanitizePaymentIntentForClient strips sensitive Stripe fields', () => {
  const sanitized = sanitizePaymentIntentForClient({
    id: 'pi_test',
    status: 'succeeded',
    amount: 2500,
    currency: 'usd',
    created: 1710000000,
    client_secret: 'secret',
    charges: { data: [] },
    payment_method: 'pm_test',
    transfer_data: { destination: 'acct_test' },
    metadata: { orderId: '507f1f77bcf86cd799439020' },
    customer: 'cus_test',
  });

  assert.deepEqual(sanitized, {
    id: 'pi_test',
    status: 'succeeded',
    amount: 2500,
    currency: 'usd',
    created: 1710000000,
    metadata: { orderId: '507f1f77bcf86cd799439020' },
  });
});

test('sanitizeOrderForPaymentPoll omits user and vendor references', () => {
  const sanitized = sanitizeOrderForPaymentPoll({
    _id: '507f1f77bcf86cd799439020',
    userId: '507f1f77bcf86cd799439015',
    vendorId: '507f1f77bcf86cd799439011',
    groupOrderId: 'grp-001',
    status: 'ordered',
    paymentStatus: 'paid',
    totalAmount: 30,
    currency: 'USD',
    items: [{
      productId: { _id: '507f1f77bcf86cd799439013', title: 'Widget' },
      quantity: 1,
      price: 25,
      size: 'M',
    }],
  });

  assert.equal(sanitized.id, '507f1f77bcf86cd799439020');
  assert.equal(sanitized.userId, undefined);
  assert.equal(sanitized.vendorId, undefined);
  assert.equal(sanitized.items[0].title, 'Widget');
});
