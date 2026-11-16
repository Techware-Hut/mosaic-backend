const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const {
  STAGING_SUPPRESSED_REASON,
  applyMailRecipientAllowlist,
  isSuppressedMailResult,
} = require('../../utils/smtpTransport');
const { normalizeProviderResult } = require('../../utils/OrderMail');
const { deliverVendorOnboardingEmail } = require('../../utils/vendorOnboardingEmailDelivery');

const ENV_KEYS = [
  'RELEASE_ENVIRONMENT',
  'SENTRY_ENVIRONMENT',
  'MAIL_RECIPIENT_ALLOWLIST',
  'MAIL_HOST',
  'MAIL_USER',
  'MAIL_PASSWORD',
  'MAIL_FROM',
];

async function withEnv(values, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = originalWarn;
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function providerTransport() {
  const sent = [];
  const transporter = applyMailRecipientAllowlist({
    sendMail: async (message) => {
      sent.push(message);
      return { messageId: '<provider@mosaic.test>', accepted: [].concat(message.to), rejected: [] };
    },
  });
  return { transporter, sent };
}

const STAGING = { RELEASE_ENVIRONMENT: 'staging', MAIL_RECIPIENT_ALLOWLIST: 'qa@example.com' };

test('guard-suppressed mail normalizes to a non-failure, never-sent "skipped" status', () =>
  withEnv(STAGING, async () => {
    const { transporter, sent } = providerTransport();
    const info = await transporter.sendMail({ to: 'customer@gmail.com' });
    assert.equal(sent.length, 0);
    assert.equal(isSuppressedMailResult(info), true);
    assert.deepEqual(normalizeProviderResult(info, 1), {
      status: 'skipped',
      provider: 'smtp',
      recipientCount: 1,
      acceptedCount: 0,
      rejectedCount: 0,
      messageId: null,
      reason: STAGING_SUPPRESSED_REASON,
    });
  }));

test('a provider response cannot forge the suppressed marker', () => {
  const forged = { suppressed: true, accepted: [], rejected: [], response: 'suppressed' };
  assert.equal(isSuppressedMailResult(forged), false);
  assert.equal(isSuppressedMailResult(JSON.parse(JSON.stringify(forged))), false);
  const result = normalizeProviderResult(forged, 1);
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'provider_accepted_no_recipients');
});

test('production (no staging marker) never yields a suppressed result', () =>
  withEnv({ RELEASE_ENVIRONMENT: 'production' }, async () => {
    const { transporter, sent } = providerTransport();
    const info = await transporter.sendMail({ to: 'customer@gmail.com' });
    assert.equal(sent.length, 1);
    assert.equal(isSuppressedMailResult(info), false);
    assert.equal(normalizeProviderResult(info, 1).status, 'sent');
  }));

test('allowlisted staging mail still normalizes to "sent"', () =>
  withEnv(STAGING, async () => {
    const { transporter } = providerTransport();
    const info = await transporter.sendMail({ to: 'qa@example.com' });
    assert.equal(isSuppressedMailResult(info), false);
    assert.equal(normalizeProviderResult(info, 1).status, 'sent');
  }));

test('suppressed callback-style sendMail invokes the callback asynchronously', () =>
  withEnv(STAGING, async () => {
    const { transporter } = providerTransport();
    let called = false;
    const done = new Promise((resolve) => {
      const returned = transporter.sendMail({ to: 'customer@gmail.com' }, (err, info) => {
        called = true;
        assert.equal(err, null);
        assert.equal(isSuppressedMailResult(info), true);
        resolve();
      });
      assert.equal(returned, undefined);
    });
    assert.equal(called, false, 'callback must not run synchronously');
    await done;
    assert.equal(called, true);
  }));

test('vendor onboarding delivery reports a suppressed send as skipped, not sent or failed', () =>
  withEnv({ ...STAGING, MAIL_USER: 'synthetic-user', MAIL_PASSWORD: 'synthetic-password' }, async () => {
    const { transporter } = providerTransport();
    const suppressed = await deliverVendorOnboardingEmail({
      label: 'test',
      send: () => transporter.sendMail({ to: 'vendor@gmail.com' }),
    });
    assert.equal(suppressed.sent, false);
    assert.equal(suppressed.skipped, true);
    assert.equal(suppressed.reason, STAGING_SUPPRESSED_REASON);
    assert.equal(suppressed.error, undefined);

    const allowed = await deliverVendorOnboardingEmail({
      label: 'test',
      send: () => transporter.sendMail({ to: 'qa@example.com' }),
    });
    assert.equal(allowed.sent, true);
  }));

test('order-paid mailer end to end: staging suppression is skipped, production is sent', async () => {
  const mailerPath = path.resolve(__dirname, '../../utils/OrderMail.js');
  const order = {
    _id: '507f1f77bcf86cd799439020',
    groupOrderId: 'MBH-ORDER-001',
    userId: { name: 'Customer User', email: 'customer@gmail.com' },
    businessId: { businessName: 'Vendor Shop', slug: 'vendor-shop' },
    items: [{ productId: { title: 'Test Product' }, quantity: 1, price: 20 }],
    totalAmount: 20,
    currency: 'USD',
    paymentStatus: 'paid',
  };

  async function run(env) {
    return withEnv({ ...env, MAIL_HOST: 'smtp.example.test', MAIL_USER: 'u', MAIL_PASSWORD: 'p' }, async () => {
      const sent = [];
      const originalLoad = Module._load;
      const priorGlobal = global.__MAILER__;
      delete global.__MAILER__;
      Module._load = function mockLoad(request, parent, isMain) {
        if (request === 'nodemailer') {
          return {
            createTransport: () => ({
              sendMail: async (message) => {
                sent.push(message);
                return { messageId: '<m@mosaic.test>', accepted: [].concat(message.to), rejected: [] };
              },
            }),
          };
        }
        if (request === '../services/invoiceService') {
          return { renderInvoicePdfBufferForOrder: async () => Buffer.from('%PDF-1.4') };
        }
        return originalLoad.call(this, request, parent, isMain);
      };
      delete require.cache[mailerPath];
      let mailer;
      try {
        mailer = require(mailerPath);
      } finally {
        Module._load = originalLoad;
        if (priorGlobal !== undefined) global.__MAILER__ = priorGlobal;
      }
      try {
        const results = await mailer.sendOrderPaidEmails({
          order,
          customerEmails: ['customer@gmail.com'],
          vendorEmails: [],
          roles: { customer: true, vendor: false },
        });
        return { results, sent };
      } finally {
        delete require.cache[mailerPath];
      }
    });
  }

  const staging = await run(STAGING);
  assert.equal(staging.sent.length, 0);
  assert.equal(staging.results.customer.status, 'skipped');
  assert.equal(staging.results.customer.reason, STAGING_SUPPRESSED_REASON);
  assert.equal(staging.results.customer.error, undefined);

  const production = await run({ RELEASE_ENVIRONMENT: 'production' });
  assert.equal(production.sent.length, 1);
  assert.equal(production.results.customer.status, 'sent');
});
