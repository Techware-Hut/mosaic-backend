'use strict';

const { body } = require('express-validator');

// --- Variant add/update (replace the disabled validateVariantInput /
// validateUpdateVariantInput, which required price > 0 and rejected the extra
// fields the inventory forms send). Structural checks only; price/stock/sale
// parsing stays in the controller (normalizeVariantPayload).

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const isAttributeMap = (value) => {
  if (!isPlainObject(value)) return false;
  return Object.entries(value).every(
    ([key, val]) => String(key).trim().length > 0 && (typeof val === 'string' || typeof val === 'number')
  );
};

const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

exports.validateVariantCreate = [
  body('variants')
    .isArray({ min: 1 }).withMessage('At least one variant is required.'),
  body('variants.*')
    .custom(isPlainObject).withMessage('Each variant must be an object.'),
  body('variants.*.attributes')
    .optional({ nullable: true })
    .custom(isAttributeMap).withMessage('Variant attributes must be name/value pairs (e.g. Size: M).'),
  body('variants.*.images')
    .optional({ nullable: true })
    .custom(isStringArray).withMessage('Variant images must be a list of URLs.'),
  body('variants.*.shipping')
    .optional({ nullable: true })
    .custom(isPlainObject).withMessage('Variant shipping must be an object.'),
  body('variants.*.sku')
    .optional({ nullable: true })
    .isString().withMessage('Variant SKU must be text.'),
];

exports.validateVariantUpdate = [
  body('attributes')
    .optional({ nullable: true })
    .custom(isAttributeMap).withMessage('Variant attributes must be name/value pairs (e.g. Size: M).'),
  body('images')
    .optional({ nullable: true })
    .custom(isStringArray).withMessage('Variant images must be a list of URLs.'),
  body('sku')
    .optional({ nullable: true })
    .isString().withMessage('Variant SKU must be text.'),
  body('shipping')
    .optional({ nullable: true })
    .custom(isPlainObject).withMessage('Variant shipping must be an object.'),
];
