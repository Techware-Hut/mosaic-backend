const SELF_PURCHASE_MESSAGE =
  "You can’t purchase products from your own business. Please select a product from another vendor.";

const PRODUCT_OWNERSHIP_INVALID_MESSAGE =
  'Product ownership information is inconsistent.';

function normalizeId(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function hasConsistentPurchaseOwnership({ variant, product, business }) {
  if (!variant || !product || !business) return false;

  const variantProductId = normalizeId(variant.productId?._id || variant.productId);
  const productId = normalizeId(product._id);
  const variantBusinessId = normalizeId(variant.businessId);
  const productBusinessId = normalizeId(product.businessId);
  const businessId = normalizeId(business._id);
  const variantOwnerId = normalizeId(variant.ownerId);
  const productOwnerId = normalizeId(product.ownerId);
  const businessOwnerId = normalizeId(business.owner);

  return Boolean(
    variantProductId &&
      productId &&
      variantProductId === productId &&
      variantBusinessId &&
      productBusinessId &&
      businessId &&
      variantBusinessId === productBusinessId &&
      productBusinessId === businessId &&
      variantOwnerId &&
      productOwnerId &&
      businessOwnerId &&
      variantOwnerId === productOwnerId &&
      productOwnerId === businessOwnerId
  );
}

function isSelfPurchase({ buyerId, business }) {
  const normalizedBuyerId = normalizeId(buyerId);
  const businessOwnerId = normalizeId(business?.owner);

  return Boolean(
    normalizedBuyerId &&
      businessOwnerId &&
      normalizedBuyerId === businessOwnerId
  );
}

module.exports = {
  PRODUCT_OWNERSHIP_INVALID_MESSAGE,
  SELF_PURCHASE_MESSAGE,
  hasConsistentPurchaseOwnership,
  isSelfPurchase,
};
