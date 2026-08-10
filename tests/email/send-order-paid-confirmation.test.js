const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const helperPath = path.resolve(
  __dirname,
  '../../utils/sendOrderPaidConfirmation.js'
);

function loadHelper({
  order,
  mailShouldFail = false,
} = {}) {
  let mailCalls = [];
  let findByIdCalls = 0;

  const hydrated = {
    paymentStatus: 'paid',
    paidConfirmationEmailSentAt: null,
    currency: 'usd',
    lifecycleEmailLog: [],
    userId: { name: 'Casey', email: 'customer@example.com' },
    vendorId: { email: 'vendor@example.com' },
    businessId: {
      businessName: 'Shop Co',
      slug: 'shop-co',
      email: 'biz@example.com',
      owner: { email: 'owner@example.com' },
    },
    items: [{ productId: { title: 'Candle' }, quantity: 1 }],
    save: async function save() {
      return this;
    },
    ...order,
    _id: order?._id || '507f1f77bcf86cd799439099',
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    const normalized = String(request).replace(/\\/g, '/');
    if (
      normalized.endsWith('/models/Order') ||
      normalized.endsWith('/models/Order.js') ||
      request === '../models/Order'
    ) {
      return {
        findById: () => {
          findByIdCalls += 1;
          return {
            populate: async () => hydrated,
          };
        },
      };
    }
    if (
      normalized.endsWith('/utils/OrderMail') ||
      normalized.endsWith('/utils/OrderMail.js') ||
      request === './OrderMail'
    ) {
      return {
        sendOrderPaidEmails: async (payload) => {
          mailCalls.push(payload);
          if (mailShouldFail) {
            throw new Error('SMTP unavailable');
          }
        },
      };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[helperPath];
  const helper = require(helperPath);
  Module._load = originalLoad;

  return {
    helper,
    getMailCalls: () => mailCalls,
    getFindByIdCalls: () => findByIdCalls,
    order: hydrated,
  };
}

test('sendOrderPaidConfirmationIfNeeded sends customer + vendor emails once', async () => {
  const { helper, getMailCalls, order } = loadHelper();
  const result = await helper.sendOrderPaidConfirmationIfNeeded(order._id, {
    currency: 'usd',
  });

  assert.equal(result.sent, true);
  assert.equal(getMailCalls().length, 1);
  assert.deepEqual(getMailCalls()[0].customerEmails, ['customer@example.com']);
  assert.ok(getMailCalls()[0].vendorEmails.includes('vendor@example.com'));
  assert.ok(order.paidConfirmationEmailSentAt instanceof Date);
  assert.equal(order.lifecycleEmailLog[0].deliveryStatus, 'sent');
});

test('sendOrderPaidConfirmationIfNeeded skips when already sent', async () => {
  const { helper, getMailCalls } = loadHelper({
    order: {
      paidConfirmationEmailSentAt: new Date('2026-08-01T00:00:00.000Z'),
    },
  });

  const result = await helper.sendOrderPaidConfirmationIfNeeded('order-1');
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'already_sent');
  assert.equal(getMailCalls().length, 0);
});

test('sendOrderPaidConfirmationIfNeeded records failure without throwing', async () => {
  const { helper, order } = loadHelper({ mailShouldFail: true });
  const result = await helper.sendOrderPaidConfirmationIfNeeded(order._id);

  assert.equal(result.failed, true);
  assert.equal(order.paidConfirmationEmailSentAt, null);
  assert.equal(order.lifecycleEmailLog[0].deliveryStatus, 'failed');
});
