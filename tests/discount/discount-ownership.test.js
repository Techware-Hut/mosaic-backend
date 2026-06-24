const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const mongoose = require('mongoose');

const discountControllerPath = path.resolve(__dirname, '../../controllers/discountController.js');
const ownerId = '507f1f77bcf86cd799439011';
const otherOwnerId = '507f1f77bcf86cd799439012';
const businessId = '507f1f77bcf86cd799439013';
const discountId = '507f1f77bcf86cd799439014';

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function buildDiscount(overrides = {}) {
  return {
    _id: discountId,
    businessId,
    name: 'Summer Sale',
    couponCode: 'SUMMER10',
    type: 'percentage',
    value: 10,
    minOrderAmount: 0,
    save: async function save() {
      return this;
    },
    deleteOne: async function deleteOne() {
      return { deletedCount: 1 };
    },
    ...overrides,
  };
}

function loadDiscountController({
  discountExists = true,
  businessOwnedByUser = true,
} = {}) {
  const originalLoad = Module._load;
  const discount = discountExists ? buildDiscount() : null;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Discounts')) {
      return {
        findById: async (id) => {
          if (!mongoose.Types.ObjectId.isValid(id)) {
            return null;
          }
          return discountExists ? buildDiscount({ _id: id }) : null;
        },
      };
    }
    if (request.endsWith('models/Business')) {
      return {
        findOne: async (query) => {
          if (!discountExists) {
            return null;
          }
          if (String(query.owner) !== String(ownerId)) {
            return null;
          }
          return businessOwnedByUser ? { _id: query._id, owner: ownerId } : null;
        },
      };
    }

    return originalLoad(request, parent, isMain);
  };

  delete require.cache[discountControllerPath];
  const controller = require(discountControllerPath);
  Module._load = originalLoad;
  return controller;
}

test('getDiscountById returns owned discount for business owner', async () => {
  const { getDiscountById } = loadDiscountController();
  const res = mockResponse();

  await getDiscountById(
    { params: { id: discountId }, user: { _id: ownerId } },
    res
  );

  assert.equal(res.statusCode, null);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data._id, discountId);
});

test('getDiscountById returns 404 when discount is not owned', async () => {
  const { getDiscountById } = loadDiscountController({ businessOwnedByUser: false });
  const res = mockResponse();

  await getDiscountById(
    { params: { id: discountId }, user: { _id: otherOwnerId } },
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, 'Discount not found');
});

test('getDiscountById returns 404 when discount does not exist', async () => {
  const { getDiscountById } = loadDiscountController({ discountExists: false });
  const res = mockResponse();

  await getDiscountById(
    { params: { id: discountId }, user: { _id: ownerId } },
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, 'Discount not found');
});

test('getDiscountById returns 404 for malformed discount id', async () => {
  const { getDiscountById } = loadDiscountController();
  const res = mockResponse();

  await getDiscountById(
    { params: { id: 'not-a-valid-id' }, user: { _id: ownerId } },
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, 'Discount not found');
});

test('updateDiscount updates owned discount and ignores businessId reassignment', async () => {
  const { updateDiscount } = loadDiscountController();
  const res = mockResponse();
  let savedBusinessId = businessId;

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Discounts')) {
      return {
        findById: async () => buildDiscount({
          save: async function save() {
            savedBusinessId = this.businessId;
            return this;
          },
        }),
      };
    }
    if (request.endsWith('models/Business')) {
      return {
        findOne: async () => ({ _id: businessId, owner: ownerId }),
      };
    }
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[discountControllerPath];
  const { updateDiscount: updateDiscountPatched } = require(discountControllerPath);
  Module._load = originalLoad;

  await updateDiscountPatched(
    {
      params: { id: discountId },
      user: { _id: ownerId },
      body: {
        name: 'Updated Sale',
        businessId: '507f1f77bcf86cd799439099',
      },
    },
    res
  );

  assert.equal(res.body.success, true);
  assert.equal(res.body.data.name, 'Updated Sale');
  assert.equal(String(savedBusinessId), businessId);
});

test('updateDiscount returns 404 when discount is not owned', async () => {
  const { updateDiscount } = loadDiscountController({ businessOwnedByUser: false });
  const res = mockResponse();

  await updateDiscount(
    {
      params: { id: discountId },
      user: { _id: otherOwnerId },
      body: { name: 'Blocked Update' },
    },
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, 'Discount not found');
});

test('deleteDiscount deletes owned discount', async () => {
  const { deleteDiscount } = loadDiscountController();
  const res = mockResponse();

  await deleteDiscount(
    { params: { id: discountId }, user: { _id: ownerId } },
    res
  );

  assert.equal(res.body.success, true);
  assert.equal(res.body.message, 'Discount deleted successfully');
});

test('deleteDiscount returns 404 when discount is not owned', async () => {
  const { deleteDiscount } = loadDiscountController({ businessOwnedByUser: false });
  const res = mockResponse();

  await deleteDiscount(
    { params: { id: discountId }, user: { _id: otherOwnerId } },
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, 'Discount not found');
});
