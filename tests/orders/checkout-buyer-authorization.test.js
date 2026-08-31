const test = require('node:test');
const assert = require('node:assert/strict');

const isCheckoutBuyer = require('../../middlewares/isCheckoutBuyer');
const {
  SELF_PURCHASE_MESSAGE,
  hasConsistentPurchaseOwnership,
  isSelfPurchase,
} = require('../../utils/purchaseAuthorization');

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

for (const role of ['customer', 'business_owner']) {
  test(`isCheckoutBuyer allows ${role}`, () => {
    const res = mockResponse();
    let nextCalls = 0;

    isCheckoutBuyer({ user: { role } }, res, () => {
      nextCalls += 1;
    });

    assert.equal(nextCalls, 1);
    assert.equal(res.statusCode, null);
  });
}

for (const role of ['admin', 'unknown']) {
  test(`isCheckoutBuyer denies ${role}`, () => {
    const res = mockResponse();
    let nextCalls = 0;

    isCheckoutBuyer({ user: { role } }, res, () => {
      nextCalls += 1;
    });

    assert.equal(nextCalls, 0);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'CHECKOUT_BUYER_REQUIRED');
  });
}

test('purchase ownership consistency requires Variant, Product, and canonical Business fields to agree', () => {
  const variant = { productId: { _id: 'product-1' }, businessId: 'business-1', ownerId: 'owner-1' };
  const product = { _id: 'product-1', businessId: 'business-1', ownerId: 'owner-1' };
  const business = { _id: 'business-1', owner: 'owner-1' };

  assert.equal(hasConsistentPurchaseOwnership({ variant, product, business }), true);
  assert.equal(
    hasConsistentPurchaseOwnership({
      variant,
      product: { ...product, ownerId: 'stale-owner' },
      business,
    }),
    false
  );
});

test('self-purchase decision uses authenticated buyer ID and canonical Business.owner', () => {
  assert.equal(isSelfPurchase({ buyerId: 'owner-1', business: { owner: 'owner-1' } }), true);
  assert.equal(isSelfPurchase({ buyerId: 'buyer-2', business: { owner: 'owner-1' } }), false);
  assert.equal(
    SELF_PURCHASE_MESSAGE,
    "You can’t purchase products from your own business. Please select a product from another vendor."
  );
});
