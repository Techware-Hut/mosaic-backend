const Discount = require('../models/Discounts');
const mongoose = require('mongoose');

const roundCurrency = (value) => Math.round(Number(value) * 100) / 100;

function computeDiscountAmount(discount, subtotalAmount) {
  let discountAmount = 0;

  if (discount.type === 'percentage') {
    discountAmount = (subtotalAmount * discount.value) / 100;
    if (discount.maxDiscountAmount) {
      discountAmount = Math.min(discountAmount, discount.maxDiscountAmount);
    }
  } else {
    discountAmount = discount.value;
  }

  discountAmount = roundCurrency(Math.min(discountAmount, subtotalAmount));
  return Math.max(0, discountAmount);
}

function validateDiscountRecord(discount, subtotalAmount) {
  const now = new Date();

  if (discount.validFrom && now < new Date(discount.validFrom)) {
    return {
      ok: false,
      errorCode: 'NOT_YET_VALID',
      message: 'Coupon is not yet valid',
    };
  }

  if (discount.validTill && now > new Date(discount.validTill)) {
    return {
      ok: false,
      errorCode: 'EXPIRED',
      message: 'Coupon expired',
    };
  }

  if (discount.usageLimit && discount.usedCount >= discount.usageLimit) {
    return {
      ok: false,
      errorCode: 'USAGE_LIMIT',
      message: 'Coupon usage limit reached',
    };
  }

  const minOrderAmount = Number(discount.minOrderAmount || 0);
  if (subtotalAmount < minOrderAmount) {
    return {
      ok: false,
      errorCode: 'MIN_ORDER',
      message: `Minimum order amount is ${minOrderAmount}`,
    };
  }

  return { ok: true };
}

/**
 * Evaluate a coupon against merchandise subtotal (before shipping).
 * @param {{ couponCode: string, businessId: string, subtotalAmount: number, discountDoc?: object }} params
 */
async function evaluateCouponDiscount({ couponCode, businessId, subtotalAmount, discountDoc = null }) {
  if (!couponCode || !String(couponCode).trim()) {
    return {
      ok: false,
      errorCode: 'INVALID_INPUT',
      message: 'Coupon code is required',
    };
  }

  if (!businessId || !mongoose.Types.ObjectId.isValid(String(businessId))) {
    return {
      ok: false,
      errorCode: 'INVALID_INPUT',
      message: 'Valid businessId is required',
    };
  }

  const normalizedSubtotal = Number(subtotalAmount);
  if (!Number.isFinite(normalizedSubtotal) || normalizedSubtotal < 0) {
    return {
      ok: false,
      errorCode: 'INVALID_AMOUNT',
      message: 'Valid order amount is required',
    };
  }

  const discount = discountDoc || await Discount.findOne({
    couponCode: String(couponCode).trim().toUpperCase(),
    businessId,
    isActive: true,
  });

  if (!discount) {
    return {
      ok: false,
      errorCode: 'INVALID_COUPON',
      message: 'Invalid coupon',
    };
  }

  const validation = validateDiscountRecord(discount, normalizedSubtotal);
  if (!validation.ok) {
    return validation;
  }

  const discountAmount = computeDiscountAmount(discount, normalizedSubtotal);
  const discountedSubtotal = roundCurrency(Math.max(0, normalizedSubtotal - discountAmount));

  return {
    ok: true,
    discount,
    discountAmount,
    discountedSubtotal,
    couponCode: discount.couponCode,
  };
}

module.exports = {
  evaluateCouponDiscount,
  computeDiscountAmount,
  validateDiscountRecord,
  roundCurrency,
};
