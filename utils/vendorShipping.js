const SHIPPING_METHODS = ["flat_rate", "quantity_based"];
const DELIVERY_SPEEDS = ["standard", "express", "local"];

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "object" && value.$numberDecimal != null) {
    return Number(value.$numberDecimal);
  }

  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
};

const normalizeDeliverySpeed = (value) => {
  const normalized = String(value || "standard").trim().toLowerCase();
  if (normalized === "overnight") return "express";
  return normalized;
};

const normalizeRateMap = (input, label) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} is required`);
  }

  const rates = {};

  for (const speed of DELIVERY_SPEEDS) {
    const amount = toNumber(input[speed]);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`${label} ${speed} price is required`);
    }

    rates[speed] = amount;
  }

  return rates;
};

const normalizeQuantityTier = (tier, index) => {
  if (!tier || typeof tier !== "object" || Array.isArray(tier)) {
    throw new Error(`Quantity tier ${index + 1} is invalid`);
  }

  const minQuantity = toNumber(tier.minQuantity);
  const hasMax =
    tier.maxQuantity !== undefined &&
    tier.maxQuantity !== null &&
    tier.maxQuantity !== "";
  const maxQuantity = hasMax ? toNumber(tier.maxQuantity) : null;

  if (!Number.isInteger(minQuantity) || minQuantity < 1) {
    throw new Error(`Quantity tier ${index + 1} minQuantity must be an integer greater than 0`);
  }

  if (hasMax && (!Number.isInteger(maxQuantity) || maxQuantity < minQuantity)) {
    throw new Error(`Quantity tier ${index + 1} maxQuantity must be greater than or equal to minQuantity`);
  }

  return {
    minQuantity,
    maxQuantity,
    rates: normalizeRateMap(tier.rates || tier, `Quantity tier ${index + 1}`),
  };
};

const validateNoOverlap = (tiers) => {
  for (let i = 1; i < tiers.length; i += 1) {
    const previous = tiers[i - 1];
    const current = tiers[i];

    if (previous.maxQuantity == null) {
      throw new Error("Only the last quantity tier can have an open-ended maxQuantity");
    }

    if (current.minQuantity <= previous.maxQuantity) {
      throw new Error("Quantity tiers cannot overlap");
    }
  }
};

const normalizeFreeShippingThreshold = (input) => {
  const enabled = Boolean(input?.enabled);
  if (!enabled) {
    return {
      enabled: false,
      threshold: null,
    };
  }

  const threshold = toNumber(input.threshold ?? input.amount ?? input.minOrderValue);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error("Free shipping threshold must be greater than 0");
  }

  return {
    enabled: true,
    threshold,
  };
};

const normalizeShippingSettingsInput = (payload = {}) => {
  const method = String(payload.method || "").trim().toLowerCase();
  if (!SHIPPING_METHODS.includes(method)) {
    throw new Error("Shipping method must be either flat_rate or quantity_based");
  }

  const freeShipping = normalizeFreeShippingThreshold(
    payload.freeShipping || {
      enabled: payload.freeShippingEnabled,
      threshold: payload.freeShippingThreshold,
    }
  );

  const normalized = {
    method,
    freeShipping,
    flatRate: null,
    quantityTiers: [],
  };

  if (method === "flat_rate") {
    normalized.flatRate = normalizeRateMap(
      payload.flatRate || payload.rates,
      "Flat rate"
    );
    return normalized;
  }

  const tiersInput = Array.isArray(payload.quantityTiers)
    ? payload.quantityTiers
    : Array.isArray(payload.tiers)
      ? payload.tiers
      : [];

  if (tiersInput.length === 0) {
    throw new Error("At least one quantity tier is required");
  }

  const quantityTiers = tiersInput
    .map((tier, index) => normalizeQuantityTier(tier, index))
    .sort((a, b) => a.minQuantity - b.minQuantity);

  validateNoOverlap(quantityTiers);
  normalized.quantityTiers = quantityTiers;

  return normalized;
};

const calculateShippingForVendor = (settings, options = {}) => {
  if (!settings?.method) {
    throw new Error("Vendor shipping settings are not configured");
  }

  const deliverySpeed = normalizeDeliverySpeed(options.deliverySpeed);
  if (!DELIVERY_SPEEDS.includes(deliverySpeed)) {
    throw new Error("Invalid delivery speed selected");
  }

  const subtotal = toNumber(options.subtotal);
  const totalQuantity = toNumber(options.totalQuantity);

  if (!Number.isFinite(subtotal) || subtotal < 0) {
    throw new Error("Subtotal is invalid");
  }

  if (!Number.isInteger(totalQuantity) || totalQuantity < 1) {
    throw new Error("Total quantity is invalid");
  }

  const freeShipping = settings.freeShipping || { enabled: false, threshold: null };
  if (freeShipping.enabled && subtotal >= Number(freeShipping.threshold || 0)) {
    return {
      deliverySpeed,
      amount: 0,
      method: "free_shipping",
      freeShippingApplied: true,
      freeShippingThreshold: Number(freeShipping.threshold),
      matchedTier: null,
    };
  }

  if (settings.method === "flat_rate") {
    const amount = toNumber(settings?.flatRate?.[deliverySpeed]);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`Missing ${deliverySpeed} flat rate`);
    }

    return {
      deliverySpeed,
      amount,
      method: "flat_rate",
      freeShippingApplied: false,
      freeShippingThreshold: freeShipping.threshold ?? null,
      matchedTier: null,
    };
  }

  const tiers = Array.isArray(settings.quantityTiers) ? settings.quantityTiers : [];
  const matchedTier = tiers.find(
    (tier) =>
      totalQuantity >= Number(tier.minQuantity) &&
      (tier.maxQuantity == null || totalQuantity <= Number(tier.maxQuantity))
  );

  if (!matchedTier) {
    throw new Error("No quantity tier matches the cart quantity");
  }

  const amount = toNumber(matchedTier?.rates?.[deliverySpeed]);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Missing ${deliverySpeed} quantity tier price`);
  }

  return {
    deliverySpeed,
    amount,
    method: "quantity_based",
    freeShippingApplied: false,
    freeShippingThreshold: freeShipping.threshold ?? null,
    matchedTier: {
      minQuantity: Number(matchedTier.minQuantity),
      maxQuantity:
        matchedTier.maxQuantity == null ? null : Number(matchedTier.maxQuantity),
    },
  };
};

const readLegacyShippingAmount = (shippingObj, deliverySpeed) => {
  if (!shippingObj || typeof shippingObj !== "object" || Array.isArray(shippingObj)) {
    return 0;
  }

  const speed = normalizeDeliverySpeed(deliverySpeed);
  if (speed === "express") {
    const expressAmount = toNumber(shippingObj.express ?? shippingObj.overnight);
    return Number.isFinite(expressAmount) && expressAmount >= 0 ? expressAmount : 0;
  }

  const amount = toNumber(shippingObj[speed]);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
};

const calculateLegacyShippingTotal = (items = [], deliverySpeed = "standard") => {
  if (!Array.isArray(items) || items.length === 0) return 0;

  const requestedSpeed = normalizeDeliverySpeed(deliverySpeed);

  return items.reduce((sum, item) => {
    const quantity = Number(item?.quantity || 1);
    const itemSpeed = normalizeDeliverySpeed(item?.shippingMethod || item?.shippingType || "standard");
    const storedCharge = toNumber(item?.shippingCharge ?? item?.shippingCost);

    if (Number.isFinite(storedCharge) && storedCharge >= 0 && itemSpeed === requestedSpeed) {
      return sum + storedCharge * quantity;
    }

    const legacyAmount = readLegacyShippingAmount(item?.shipping, deliverySpeed);
    return sum + legacyAmount * quantity;
  }, 0);
};

const resolveShippingForCheckout = (settings, options = {}) => {
  if (settings?.method) {
    return calculateShippingForVendor(settings, options);
  }

  const deliverySpeed = normalizeDeliverySpeed(options.deliverySpeed);
  if (!DELIVERY_SPEEDS.includes(deliverySpeed)) {
    throw new Error("Invalid delivery speed selected");
  }

  const legacyShippingAmount = Number.isFinite(toNumber(options.legacyShippingAmount))
    ? Math.max(0, toNumber(options.legacyShippingAmount))
    : calculateLegacyShippingTotal(options.legacyItems || [], deliverySpeed);

  return {
    deliverySpeed,
    amount: legacyShippingAmount,
    method: "legacy_product_shipping",
    freeShippingApplied: false,
    freeShippingThreshold: null,
    matchedTier: null,
  };
};

module.exports = {
  SHIPPING_METHODS,
  DELIVERY_SPEEDS,
  normalizeDeliverySpeed,
  normalizeShippingSettingsInput,
  calculateShippingForVendor,
  readLegacyShippingAmount,
  calculateLegacyShippingTotal,
  resolveShippingForCheckout,
};
