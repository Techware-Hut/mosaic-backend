const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');

const root = path.resolve(__dirname, '../..');
const controllerPath = path.join(root, 'controllers/invoiceController.js');
const invoiceServicePath = path.join(root, 'services/invoiceService.js');
const Order = require(path.join(root, 'models/Order.js'));

const originalFindById = Order.findById;
const originalInvoiceServiceCache = require.cache[invoiceServicePath];

function loadController(renderInvoicePdfById) {
  delete require.cache[controllerPath];
  require.cache[invoiceServicePath] = {
    id: invoiceServicePath,
    filename: invoiceServicePath,
    loaded: true,
    exports: { renderInvoicePdfById },
  };
  return require(controllerPath);
}

function restoreModules() {
  Order.findById = originalFindById;
  delete require.cache[controllerPath];

  if (originalInvoiceServiceCache) {
    require.cache[invoiceServicePath] = originalInvoiceServiceCache;
  } else {
    delete require.cache[invoiceServicePath];
  }
}

function mockOrderLookup(order) {
  Order.findById = () => ({
    select() {
      return this;
    },
    lean: async () => order,
  });
}

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

test.afterEach(() => {
  restoreModules();
});

test('canAccessOrderInvoice allows the order customer, vendor, and admin', () => {
  const { canAccessOrderInvoice } = loadController(async () => Buffer.from('pdf'));
  const customerId = new mongoose.Types.ObjectId();
  const vendorId = new mongoose.Types.ObjectId();
  const order = { userId: customerId, vendorId };

  assert.equal(canAccessOrderInvoice({ _id: customerId, role: 'customer' }, order), true);
  assert.equal(canAccessOrderInvoice({ _id: vendorId, role: 'business_owner' }, order), true);
  assert.equal(canAccessOrderInvoice({ _id: new mongoose.Types.ObjectId(), role: 'admin' }, order), true);
  assert.equal(canAccessOrderInvoice({ _id: new mongoose.Types.ObjectId(), role: 'customer' }, order), false);
});

test('getInvoicePdf denies unrelated users before rendering the invoice', async () => {
  let renderCalled = false;
  const { getInvoicePdf } = loadController(async () => {
    renderCalled = true;
    return Buffer.from('pdf');
  });

  mockOrderLookup({
    userId: new mongoose.Types.ObjectId(),
    vendorId: new mongoose.Types.ObjectId(),
  });

  const req = {
    params: { id: new mongoose.Types.ObjectId().toString() },
    query: {},
    user: { _id: new mongoose.Types.ObjectId(), role: 'customer' },
  };
  const res = mockResponse();

  await getInvoicePdf(req, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Not authorized to access this invoice' });
  assert.equal(renderCalled, false);
});

test('getInvoicePdf renders for the order customer', async () => {
  let renderedOrderId = null;
  const { getInvoicePdf } = loadController(async (orderId) => {
    renderedOrderId = orderId;
    return Buffer.from('pdf');
  });
  const orderId = new mongoose.Types.ObjectId().toString();
  const customerId = new mongoose.Types.ObjectId();

  mockOrderLookup({
    userId: customerId,
    vendorId: new mongoose.Types.ObjectId(),
  });

  const req = {
    params: { id: orderId },
    query: {},
    user: { _id: customerId, role: 'customer' },
  };
  const res = mockResponse();

  await getInvoicePdf(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(renderedOrderId, orderId);
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.equal(res.body.toString(), 'pdf');
});
