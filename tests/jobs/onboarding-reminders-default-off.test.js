const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const jobPath = path.resolve(__dirname, '../../jobs/onboardingReminders.js');
const reminderEnvKeys = [
  'ENABLE_ONBOARDING_REMINDERS',
  'ONBOARDING_REMINDER_CRON',
  'ONBOARDING_REMINDER_MIN_AGE_HOURS',
  'ONBOARDING_REMINDER_COOLDOWN_HOURS',
  'ONBOARDING_REMINDER_BATCH_LIMIT',
];

function application(overrides = {}) {
  return {
    applicationId: 'LOCAL-REMINDER-PENDING',
    businessName: 'Local Reminder Fixture',
    status: 'payment_pending',
    updatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    verificationPayment: { status: 'pending' },
    userId: { name: 'Local Vendor', email: 'vendor@example.test' },
    onboardingReminderLog: [],
    ...overrides,
  };
}

async function withJob({ flag, applications = [], invalidCron = false } = {}, exercise) {
  const previousEnv = new Map(reminderEnvKeys.map((key) => [key, process.env[key]]));
  const previousCache = require.cache[jobPath];
  const previousLoad = Module._load;
  const previousConsole = { log: console.log, warn: console.warn, error: console.error };
  const calls = { validate: [], schedules: [], queries: [], deliveries: [], sends: [], saves: [], logs: [], warnings: [], errors: [] };
  const task = { name: 'local-cron-task-with-no-timer' };

  try {
    if (flag === undefined) delete process.env.ENABLE_ONBOARDING_REMINDERS;
    else process.env.ENABLE_ONBOARDING_REMINDERS = flag;
    process.env.ONBOARDING_REMINDER_CRON = invalidCron ? 'invalid cron expression' : '0 9 * * *';
    process.env.ONBOARDING_REMINDER_MIN_AGE_HOURS = '1';
    process.env.ONBOARDING_REMINDER_COOLDOWN_HOURS = '72';
    process.env.ONBOARDING_REMINDER_BATCH_LIMIT = '10';
    console.log = (...args) => calls.logs.push(args.join(' '));
    console.warn = (...args) => calls.warnings.push(args.join(' '));
    console.error = (...args) => calls.errors.push(args.join(' '));

    for (const candidate of applications) {
      candidate.save = async function save() {
        calls.saves.push(this.applicationId);
        return this;
      };
    }
    const stubs = {
      'node-cron': {
        validate(expression) { calls.validate.push(expression); return !invalidCron; },
        schedule(expression, callback) { calls.schedules.push({ expression, callback }); return task; },
      },
      '../models/VendorOnboardingStage1': {
        find(query) {
          const call = { query, populate: null, limit: null };
          calls.queries.push(call);
          const chain = {
            populate(...args) { call.populate = args; return chain; },
            limit(value) { call.limit = value; return chain; },
            async exec() { return applications.filter((candidate) => candidate.status === query.status); },
          };
          return chain;
        },
      },
      '../utils/WellcomeMailer': {
        async sendPaymentReminderEmail(payload) {
          calls.sends.push(payload);
          return { messageId: `local-reminder-${calls.sends.length}` };
        },
      },
      '../utils/vendorOnboardingEmailDelivery': {
        async deliverVendorOnboardingEmail(options) {
          calls.deliveries.push(options.label);
          const delivered = await options.send();
          return { sent: true, ...delivered };
        },
      },
    };

    Module._load = function loadStub(request, parent, isMain) {
      if (parent?.filename === jobPath && Object.hasOwn(stubs, request)) return stubs[request];
      return previousLoad.call(this, request, parent, isMain);
    };
    delete require.cache[jobPath];
    let job;
    try {
      job = require(jobPath);
    } finally {
      Module._load = previousLoad;
    }

    await exercise({ job, calls, task });
  } finally {
    Module._load = previousLoad;
    if (previousCache) require.cache[jobPath] = previousCache;
    else delete require.cache[jobPath];
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    Object.assign(console, previousConsole);
  }
}

for (const flag of [undefined, '', 'false', '0', '1', 'TRUE', 'yes', ' true ']) {
  test(`reminders stay inert when the flag is ${flag === undefined ? 'unset' : JSON.stringify(flag)}`, async () => {
    const candidates = [
      application(),
      application({ applicationId: 'LOCAL-REMINDER-PAID', status: 'draft', verificationPayment: { status: 'paid' } }),
    ];
    await withJob({ flag, applications: candidates }, async ({ job, calls }) => {
      assert.equal(job.getOnboardingReminderConfig().enabled, false);
      assert.equal(job.startOnboardingReminderScheduler(), null);
      assert.deepEqual(await job.runOnboardingReminderBatch(), { enabled: false, processed: 0, results: [] });
      for (const key of ['validate', 'schedules', 'queries', 'deliveries', 'sends', 'saves']) {
        assert.deepEqual(calls[key], [], `disabled path must not perform ${key}`);
      }
      assert.deepEqual(calls.logs, ['Onboarding reminder scheduler disabled (explicit opt-in required)']);
      assert.deepEqual(calls.warnings, []);
      assert.deepEqual(calls.errors, []);
      for (const candidate of candidates) assert.deepEqual(candidate.onboardingReminderLog, []);
    });
  });
}

test('exact true preserves scheduling, both reminder kinds and audit appends', async () => {
  const candidates = [
    application(),
    application({ applicationId: 'LOCAL-REMINDER-PAID', status: 'draft', verificationPayment: { status: 'paid' } }),
  ];
  await withJob({ flag: 'true', applications: candidates }, async ({ job, calls, task }) => {
    assert.equal(job.getOnboardingReminderConfig().enabled, true);
    assert.equal(job.startOnboardingReminderScheduler(), task);
    assert.deepEqual(calls.validate, ['0 9 * * *']);
    assert.equal(calls.schedules.length, 1);
    assert.equal(calls.schedules[0].expression, '0 9 * * *');
    assert.equal(typeof calls.schedules[0].callback, 'function');
    const result = await job.runOnboardingReminderBatch();
    assert.equal(result.enabled, true);
    assert.equal(result.processed, 2);
    assert.deepEqual(result.results.map(({ kind }) => kind), ['payment_pending', 'paid_draft_unsubmitted']);
    assert.deepEqual(calls.sends.map(({ reminderKind }) => reminderKind), ['payment_pending', 'paid_draft_unsubmitted']);
    assert.deepEqual(calls.deliveries, ['onboarding_reminder_payment_pending', 'onboarding_reminder_paid_draft_unsubmitted']);
    assert.equal(calls.queries.length, 2);
    assert.equal(calls.queries[0].query.status, 'payment_pending');
    assert.deepEqual(calls.queries[0].query['verificationPayment.status'], { $in: ['pending', 'failed', 'not_started'] });
    assert.equal(calls.queries[1].query.status, 'draft');
    assert.equal(calls.queries[1].query['verificationPayment.status'], 'paid');
    assert.deepEqual(calls.queries[1].query.$or, [{ submittedAt: { $exists: false } }, { submittedAt: null }]);
    assert.deepEqual(calls.queries.map(({ limit }) => limit), [10, 9]);
    for (const call of calls.queries) {
      assert.deepEqual(call.populate, ['userId', 'name email']);
      assert.ok(call.query.updatedAt.$lte instanceof Date);
    }
    assert.equal(calls.saves.length, 2);
    for (const [index, candidate] of candidates.entries()) {
      assert.equal(candidate.onboardingReminderLog.length, 1);
      assert.equal(candidate.onboardingReminderLog[0].kind, result.results[index].kind);
      assert.equal(candidate.onboardingReminderLog[0].deliveryStatus, 'sent');
    }
  });
});

test('invalid cron is still rejected when explicitly enabled', async () => {
  await withJob({ flag: 'true', invalidCron: true }, async ({ job, calls }) => {
    assert.equal(job.startOnboardingReminderScheduler(), null);
    assert.deepEqual(calls.validate, ['invalid cron expression']);
    assert.deepEqual(calls.schedules, []);
    assert.deepEqual(calls.queries, []);
    assert.deepEqual(calls.sends, []);
    assert.deepEqual(calls.errors, ['Invalid ONBOARDING_REMINDER_CRON expression: invalid cron expression']);
  });
});

test('an enabled empty candidate set delivers and appends nothing', async () => {
  await withJob({ flag: 'true' }, async ({ job, calls }) => {
    assert.deepEqual(await job.runOnboardingReminderBatch(), { enabled: true, processed: 0, results: [] });
    assert.equal(calls.queries.length, 2);
    for (const key of ['deliveries', 'sends', 'saves']) assert.deepEqual(calls[key], []);
  });
});

test('missing linked user or email does not deliver, append or crash an enabled batch', async () => {
  const candidates = [
    application({ userId: undefined }),
    application({ applicationId: 'LOCAL-REMINDER-NO-EMAIL', status: 'draft', verificationPayment: { status: 'paid' }, userId: { name: 'Local Vendor' } }),
  ];
  await withJob({ flag: 'true', applications: candidates }, async ({ job, calls }) => {
    const result = await job.runOnboardingReminderBatch();
    assert.equal(result.enabled, true);
    assert.equal(result.processed, 2);
    assert.equal(result.results.length, 2);
    assert.ok(result.results.every(({ sent, error }) => sent === false && error === 'vendor_email_missing'));
    for (const key of ['deliveries', 'sends', 'saves']) assert.deepEqual(calls[key], []);
    assert.equal(calls.warnings.length, 2);
    for (const candidate of candidates) assert.deepEqual(candidate.onboardingReminderLog, []);
  });
});
