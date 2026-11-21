const { resolveShippingForCheckout } = require('../../utils/vendorShipping');
const { getTaxRateForCategory, buildTaxAwareAmounts, extractTaxFromInclusiveAmount, roundCurrency } = require('../../utils/vendorTax');
const { evaluateCouponDiscount } = require('../../utils/couponDiscount');

// Read-only pricing, including coupon evaluation. Preserve checkout rounding.
async function priceOrderLines({ rawVendorItems, business, businessId, deliverySpeed, couponCode, validateSubmittedPrices = true }, dependencies = {}) {
  const { resolveShippingForCheckout: shippingResolver = resolveShippingForCheckout,
    getTaxRateForCategory: taxRateForCategory = getTaxRateForCategory,
    buildTaxAwareAmounts: taxAmounts = buildTaxAwareAmounts,
    extractTaxFromInclusiveAmount: extractTax = extractTaxFromInclusiveAmount,
    roundCurrency: round = roundCurrency,
    evaluateCouponDiscount: evaluateCoupon = evaluateCouponDiscount } = dependencies;
  const vendorItems = rawVendorItems.map((item) => {
    const taxRate = taxRateForCategory(
      business.taxSettings,
      item.taxCategory
    );
    const taxPricing = taxAmounts({
      priceExclTax: item.priceExclTax,
      salePriceExclTax: null,
      taxRate,
    });
    const unitPriceInclTax = taxPricing.priceInclTax ?? round(item.priceExclTax);
    const lineAmounts = extractTax({
      inclusiveAmount: unitPriceInclTax * Number(item.quantity || 0),
      taxRate,
    });
    const submittedPrice = Number(item.submittedPrice);
    const acceptsLegacyPrice =
      Math.abs(submittedPrice - Number(item.priceExclTax || 0)) < 0.01;
    const acceptsTaxInclusivePrice =
      Math.abs(submittedPrice - Number(unitPriceInclTax || 0)) < 0.01;

    if (validateSubmittedPrices && !acceptsLegacyPrice && !acceptsTaxInclusivePrice) {
      const error = new Error(`Price mismatch for size ${item.size}`);
      error.statusCode = 400;
      throw error;
    }

    return {
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      price: unitPriceInclTax,
      size: item.size,
      sku: item.sku,
      color: item.color,
      tax: {
        categoryCode: item.taxCategory?.code || null,
        categoryLabel: item.taxCategory?.label || null,
        rate: taxRate,
        taxIncluded: true,
        unitPriceExclTax: taxPricing.priceExclTax,
        unitPriceInclTax,
        lineBaseAmount: lineAmounts.amountExclTax,
        lineTaxAmount: lineAmounts.taxAmount,
        lineTotalAmount: lineAmounts.amountInclTax,
      },
    };
  });

  const subtotalAmount = vendorItems.reduce(
    (sum, i) => sum + Number(i.tax?.lineTotalAmount || (i.price * i.quantity) || 0),
    0
  );
  const subtotalExclTaxAmount = vendorItems.reduce(
    (sum, i) => sum + Number(i.tax?.lineBaseAmount || 0),
    0
  );
  const taxTotal = vendorItems.reduce(
    (sum, i) => sum + Number(i.tax?.lineTaxAmount || 0),
    0
  );
  const totalQuantity = vendorItems.reduce(
    (sum, i) => sum + Number(i.quantity || 0),
    0
  );

  let discountAmount = 0;
  let discountedSubtotal = subtotalAmount;
  let appliedCouponCode = null;

  if (couponCode) {
    const couponResult = await evaluateCoupon({
      couponCode,
      businessId,
      subtotalAmount,
    });

    if (!couponResult.ok) {
      throw Object.assign(new Error(couponResult.message), { statusCode: 400 });
    }

    discountAmount = couponResult.discountAmount;
    discountedSubtotal = couponResult.discountedSubtotal;
    appliedCouponCode = couponResult.couponCode;
  }

  let shippingCalculation;
  try {
    shippingCalculation = shippingResolver(
      business.shippingSettings,
      {
        deliverySpeed,
        subtotal: discountedSubtotal,
        totalQuantity,
        legacyItems: rawVendorItems,
      }
    );
  } catch (shippingError) {
    throw Object.assign(shippingError, { statusCode: 400 });
  }

  const totalAmount =
    discountedSubtotal + Number(shippingCalculation.amount || 0);

  return { vendorItems, subtotalAmount, subtotalExclTaxAmount, taxTotal, discountAmount, discountedSubtotal, appliedCouponCode, shippingCalculation, totalAmount };
}
module.exports = { priceOrderLines };
