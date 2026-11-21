const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const orderPhasePath = path.resolve(__dirname, '../../utils/orderPhase.js');
const { STAGING_SUPPRESSED_REASON } = require('../../utils/smtpTransport');
const { sendCustomerOrderLifecycleEmail } = require('../../utils/orderLifecycleEmailDelivery');

const CUSTOMER_EMAIL = 'customer.person@gmail.com';
const ENV_KEYS = ['RELEASE_ENVIRONMENT', 'SENTRY_ENVIRONMENT', 'MAIL_RECIPIENT_ALLOWLIST'];
const STAGING = { RELEASE_ENVIRONMENT: 'staging', MAIL_RECIPIENT_ALLOWLIST: 'qa@example.com' };
const PRODUCTION = { RELEASE_ENVIRONMENT: 'production' };

function buildOrder() {
  return {
    _id: '507f1f77bcf86cd799439031',
    groupOrderId: 'MBH-ORDER-STATUS-1',
    status: 'accepted',
    paymentStatus: 'paid',
    userId: { _id: '507f1f77bcf86cd799439032', name: 'Customer Person', email: CUSTOMER_EMAIL },
    lifecycleEmailLog: [],
    save: async () => {},
  };
}

async function withHarness(env, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);

  const providerSends = [];
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'nodemailer') {
      return {
        createTransport: () => ({
          sendMail: async (message) => {
            providerSends.push(message);
            return { messageId: 'provider-message-1', accepted: [].concat(message.to), rejected: [] };
          },
        }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[orderPhasePath];
  let orderPhase;
  try {
    orderPhase = require(orderPhasePath);
  } finally {
    Module._load = originalLoad;
  }

  const logs = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const capture = (...args) => logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  try {
    return await fn({ orderPhase, providerSends, logs });
  } finally {
    Object.assign(console, original);
    delete require.cache[orderPhasePath];
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

for (const status of ['accepted', 'rejected']) {
  test(`production order ${status} email: sends as before and logs ids, never the address`, () =>
    withHarness(PRODUCTION, async ({ orderPhase, providerSends, logs }) => {
      const order = buildOrder();
      const info = await orderPhase.sendOrderStatusEmail(CUSTOMER_EMAIL, order, status);

      assert.equal(providerSends.length, 1);
      assert.equal(providerSends[0].to, CUSTOMER_EMAIL);
      assert.equal(info.messageId, 'provider-message-1');
      const line = logs.find((entry) => entry.startsWith(`Order ${status} email sent`));
      assert.ok(line, 'expected the sent log line');
      assert.ok(line.includes(order._id));
      assert.ok(line.includes(order.userId._id));
      assert.ok(line.includes('provider-message-1'));
      assert.ok(logs.every((entry) => !entry.includes(CUSTOMER_EMAIL)));
    }));

  test(`staging-suppressed order ${status} email: logs skipped with reason and no address`, () =>
    withHarness(STAGING, async ({ orderPhase, providerSends, logs }) => {
      const order = buildOrder();
      const info = await orderPhase.sendOrderStatusEmail(CUSTOMER_EMAIL, order, status);

      assert.equal(providerSends.length, 0);
      assert.equal(info.suppressed, true);
      assert.ok(!logs.some((entry) => entry.includes(`Order ${status} email sent`)));
      const line = logs.find((entry) => entry.startsWith(`Order ${status} email skipped`));
      assert.ok(line, 'expected the skipped log line');
      assert.ok(line.includes(STAGING_SUPPRESSED_REASON));
      assert.ok(line.includes(order._id));
      assert.ok(logs.every((entry) => !entry.includes(CUSTOMER_EMAIL)));
    }));
}

test('order lifecycle evidence: staging suppression is persisted as skipped, production as sent', async () => {
  const staging = await withHarness(STAGING, async ({ orderPhase }) => {
    const order = buildOrder();
    const result = await sendCustomerOrderLifecycleEmail({
      order,
      event: 'order_accepted',
      send: (customerEmail) => orderPhase.sendOrderStatusEmail(customerEmail, order, 'accepted'),
    });
    return { order, result };
  });
  assert.equal(staging.result.emailSent, false);
  assert.equal(staging.result.emailSkipped, true);
  assert.equal(staging.result.emailFailed, false);
  assert.equal(staging.order.lifecycleEmailLog.length, 1);
  assert.equal(staging.order.lifecycleEmailLog[0].deliveryStatus, 'skipped');
  assert.equal(staging.order.lifecycleEmailLog[0].reason, STAGING_SUPPRESSED_REASON);
  assert.equal(staging.order.lifecycleEmailLog[0].error, undefined);

  const production = await withHarness(PRODUCTION, async ({ orderPhase }) => {
    const order = buildOrder();
    const result = await sendCustomerOrderLifecycleEmail({
      order,
      event: 'order_accepted',
      send: (customerEmail) => orderPhase.sendOrderStatusEmail(customerEmail, order, 'accepted'),
    });
    return { order, result };
  });
  assert.equal(production.result.emailSent, true);
  assert.equal(production.order.lifecycleEmailLog[0].deliveryStatus, 'sent');
  assert.equal(production.order.lifecycleEmailLog[0].reason, undefined);
});

test('order lifecycle: a send that resolves without a mail result is still recorded as sent', async () => {
  const order = buildOrder();
  const result = await sendCustomerOrderLifecycleEmail({
    order,
    event: 'order_shipped',
    send: async () => undefined,
  });
  assert.equal(result.emailSent, true);
  assert.equal(order.lifecycleEmailLog[0].deliveryStatus, 'sent');
});

test('order lifecycle evidence: suppressed shipped/cancelled emails are skipped, not sent', async () => {
  const outcomes = await withHarness(STAGING, async ({ orderPhase, providerSends }) => {
    const shippedOrder = buildOrder();
    const shipped = await sendCustomerOrderLifecycleEmail({
      order: shippedOrder,
      event: 'order_shipped',
      send: (customerEmail) => orderPhase.sendOrderUpdateEmail(customerEmail, 'shipped', null, { order: shippedOrder }),
    });
    const cancelledOrder = buildOrder();
    const cancelled = await sendCustomerOrderLifecycleEmail({
      order: cancelledOrder,
      event: 'order_cancelled',
      send: (customerEmail) => orderPhase.sendOrderLifecycleEmail(customerEmail, cancelledOrder, 'order_cancelled'),
    });
    return { shipped, cancelled, shippedOrder, cancelledOrder, providerSends: providerSends.length };
  });
  assert.equal(outcomes.providerSends, 0);
  for (const key of ['shipped', 'cancelled']) {
    assert.equal(outcomes[key].emailSent, false);
    assert.equal(outcomes[key].emailSkipped, true);
    assert.equal(outcomes[`${key}Order`].lifecycleEmailLog[0].deliveryStatus, 'skipped');
    assert.equal(outcomes[`${key}Order`].lifecycleEmailLog[0].reason, STAGING_SUPPRESSED_REASON);
  }

  const production = await withHarness(PRODUCTION, async ({ orderPhase, providerSends }) => {
    const order = buildOrder();
    const result = await sendCustomerOrderLifecycleEmail({
      order,
      event: 'order_cancelled',
      send: (customerEmail) => orderPhase.sendOrderLifecycleEmail(customerEmail, order, 'order_cancelled'),
    });
    return { result, order, sends: providerSends.length };
  });
  assert.equal(production.sends, 1);
  assert.equal(production.result.emailSent, true);
  assert.equal(production.order.lifecycleEmailLog[0].deliveryStatus, 'sent');
});
