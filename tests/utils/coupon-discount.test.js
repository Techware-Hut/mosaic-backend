const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateCouponDiscount,
  computeDiscountAmount,
  validateDiscountRecord,
} = require('../../utils/couponDiscount');

function buildDiscount(overrides = {}) {
  return {
    couponCode: 'SAVE10',
    type: 'percentage',
    value: 10,
    minOrderAmount: 50,
    maxDiscountAmount: null,
    usageLimit: null,
    usedCount: 0,
    validFrom: new Date(Date.now() - 86400000),
    validTill: new Date(Date.now() + 86400000),
    isActive: true,
    ...overrides,
  };
}

test('evaluateCouponDiscount rejects missing amount', async () => {
  const result = await evaluateCouponDiscount({
    couponCode: 'SAVE10',
    businessId: '507f1f77bcf86cd799439011',
    subtotalAmount: undefined,
    discountDoc: buildDiscount(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'INVALID_AMOUNT');
});

test('evaluateCouponDiscount rejects subtotal below minOrderAmount', async () => {
  const result = await evaluateCouponDiscount({
    couponCode: 'SAVE10',
    businessId: '507f1f77bcf86cd799439011',
    subtotalAmount: 40,
    discountDoc: buildDiscount({ minOrderAmount: 50 }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'MIN_ORDER');
});

test('evaluateCouponDiscount accepts subtotal at minOrderAmount threshold', async () => {
  const result = await evaluateCouponDiscount({
    couponCode: 'SAVE10',
    businessId: '507f1f77bcf86cd799439011',
    subtotalAmount: 50,
    discountDoc: buildDiscount({ minOrderAmount: 50, value: 10, type: 'percentage' }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.discountAmount, 5);
  assert.equal(result.discountedSubtotal, 45);
});

test('evaluateCouponDiscount caps percentage discount with maxDiscountAmount', async () => {
  const discount = buildDiscount({
    minOrderAmount: 0,
    type: 'percentage',
    value: 50,
    maxDiscountAmount: 10,
  });

  const result = await evaluateCouponDiscount({
    couponCode: 'SAVE10',
    businessId: '507f1f77bcf86cd799439011',
    subtotalAmount: 100,
    discountDoc: discount,
  });

  assert.equal(result.ok, true);
  assert.equal(result.discountAmount, 10);
  assert.equal(result.discountedSubtotal, 90);
});

test('evaluateCouponDiscount applies fixed discount and clamps to subtotal', async () => {
  const discount = buildDiscount({
    minOrderAmount: 0,
    type: 'fixed',
    value: 75,
  });

  const result = await evaluateCouponDiscount({
    couponCode: 'SAVE10',
    businessId: '507f1f77bcf86cd799439011',
    subtotalAmount: 50,
    discountDoc: discount,
  });

  assert.equal(result.ok, true);
  assert.equal(result.discountAmount, 50);
  assert.equal(result.discountedSubtotal, 0);
});

test('validateDiscountRecord rejects expired coupons', () => {
  const result = validateDiscountRecord(
    buildDiscount({ validTill: new Date(Date.now() - 1000) }),
    100
  );

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'EXPIRED');
});

test('validateDiscountRecord rejects usage limit reached', () => {
  const result = validateDiscountRecord(
    buildDiscount({ usageLimit: 5, usedCount: 5 }),
    100
  );

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'USAGE_LIMIT');
});

test('computeDiscountAmount never exceeds subtotal', () => {
  assert.equal(
    computeDiscountAmount(buildDiscount({ type: 'fixed', value: 200 }), 50),
    50
  );
});
