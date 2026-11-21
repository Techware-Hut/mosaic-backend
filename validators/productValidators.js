const { body } = require('express-validator');

/**
 * Validate product creation input
 */
exports.validateProductInput = [
  // Basic product fields
  body('title').notEmpty().withMessage('Title is required.'),
  body('description').notEmpty().withMessage('Description is required.'),
  body('categoryId').notEmpty().withMessage('Category ID is required.'),
  body('subcategoryId').notEmpty().withMessage('Subcategory ID is required.'),
  body('businessId').notEmpty().withMessage('Business ID is required.'),
  body('coverImage').notEmpty().withMessage('Cover image is required.'),

  body('taxCategory')
    .optional({ nullable: true })
    .isObject().withMessage('Tax category must be an object')
    .custom((taxCategory) => {
      if (taxCategory) {
        if (!taxCategory.code || typeof taxCategory.code !== 'string') {
          throw new Error('Tax category code is required');
        }
        if (!taxCategory.label || typeof taxCategory.label !== 'string') {
          throw new Error('Tax category label is required');
        }
      }
      return true;
    }),

  // Attributes validation (optional)
  body('attributes')
    .optional()
    .isArray().withMessage('Attributes must be an array')
    .custom((attributes) => {
      if (attributes) {
        for (const attr of attributes) {
          if (!attr.name || !attr.values || !Array.isArray(attr.values) || attr.values.length === 0) {
            throw new Error('Each attribute must have a name and non-empty values array');
          }
        }
      }
      return true;
    }),

  // Shipping validation (optional)
  body('shipping')
    .optional()
    .isObject().withMessage('Shipping must be an object')
    .custom((shipping) => {
      if (shipping) {
        if (shipping.standard !== undefined && typeof shipping.standard !== 'number') {
          throw new Error('Standard shipping must be a number');
        }
        if (shipping.overnight !== undefined && typeof shipping.overnight !== 'number') {
          throw new Error('Overnight shipping must be a number');
        }
        if (shipping.local !== undefined && typeof shipping.local !== 'number') {
          throw new Error('Local shipping must be a number');
        }
      }
      return true;
    }),

  // Gallery images validation
  body('galleryImages')
    .optional()
    .isArray().withMessage('Gallery images must be an array'),

  // Meta fields validation
  body('metaFields')
    .optional()
    .isArray().withMessage('Meta fields must be an array')
    .custom((fields) => {
      if (fields) {
        for (const field of fields) {
          if (!field.key || !field.value) {
            throw new Error('Each meta field must have key and value');
          }
        }
      }
      return true;
    }),

  // Discount validation
  body('discount')
    .optional()
    .isObject().withMessage('Discount must be an object')
    .custom((discount) => {
      if (discount) {
        if (discount.type && !['value', 'percentage'].includes(discount.type)) {
          throw new Error('Discount type must be either "value" or "percentage"');
        }
        if (discount.amount !== undefined && typeof discount.amount !== 'number') {
          throw new Error('Discount amount must be a number');
        }
        if (discount.minCartValue !== undefined && typeof discount.minCartValue !== 'number') {
          throw new Error('Minimum cart value must be a number');
        }
      }
      return true;
    }),

  // Variants validation
  body('variants')
    .isArray({ min: 1 }).withMessage('At least one variant is required.')
    .custom((variants) => {
      for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        
        // Check attributes object (Map structure)
        if (!variant.attributes || typeof variant.attributes !== 'object' || Object.keys(variant.attributes).length === 0) {
          throw new Error(`Variant at index ${i} must have attributes object with at least one attribute (e.g., Size, Color)`);
        }

        // Price validation
        if (!variant.price || typeof variant.price !== 'number' || variant.price <= 0) {
          throw new Error(`Variant at index ${i} must have a valid price (positive number)`);
        }

        // Sale price validation (optional)
        if (variant.salePrice !== undefined && (typeof variant.salePrice !== 'number' || variant.salePrice < 0)) {
          throw new Error(`Variant at index ${i} sale price must be a positive number`);
        }

        // Stock validation (optional, defaults to 0)
        if (variant.stock !== undefined && (typeof variant.stock !== 'number' || variant.stock < 0)) {
          throw new Error(`Variant at index ${i} stock must be a non-negative number`);
        }

        // Images validation
        // if (!variant.images || !Array.isArray(variant.images) || variant.images.length === 0) {
        //   throw new Error(`Variant at index ${i} must have at least one image`);
        // }

        // SKU validation (optional - will be auto-generated if not provided)
        if (variant.sku !== undefined && typeof variant.sku !== 'string') {
          throw new Error(`Variant at index ${i} SKU must be a string`);
        }

        // Shipping validation (optional)
        if (variant.shipping !== undefined) {
          if (typeof variant.shipping !== 'object') {
            throw new Error(`Variant at index ${i} shipping must be an object`);
          }
          if (variant.shipping.standard !== undefined && typeof variant.shipping.standard !== 'number') {
            throw new Error(`Variant at index ${i} standard shipping must be a number`);
          }
        }
      }
      return true;
    }),

  // isPublished validation (optional)
  body('isPublished')
    .optional()
    .isBoolean().withMessage('isPublished must be a boolean'),
];

/**
 * Validate adding variants to existing product
 */
exports.validateVariantInput = [
  body('variants')
    .isArray({ min: 1 }).withMessage('At least one variant is required.')
    .custom((variants) => {
      for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        
        // Check attributes object (Map structure)
        if (!variant.attributes || typeof variant.attributes !== 'object' || Object.keys(variant.attributes).length === 0) {
          throw new Error(`Variant at index ${i} must have attributes object with at least one attribute`);
        }

        // Price validation
        if (!variant.price || typeof variant.price !== 'number' || variant.price <= 0) {
          throw new Error(`Variant at index ${i} must have a valid price (positive number)`);
        }

        // Sale price validation (optional)
        if (variant.salePrice !== undefined && (typeof variant.salePrice !== 'number' || variant.salePrice < 0)) {
          throw new Error(`Variant at index ${i} sale price must be a positive number`);
        }

        // Stock validation (optional)
        if (variant.stock !== undefined && (typeof variant.stock !== 'number' || variant.stock < 0)) {
          throw new Error(`Variant at index ${i} stock must be a non-negative number`);
        }

        // Images validation
        if (!variant.images || !Array.isArray(variant.images) || variant.images.length === 0) {
          throw new Error(`Variant at index ${i} must have at least one image`);
        }

        // SKU validation (optional)
        if (variant.sku !== undefined && typeof variant.sku !== 'string') {
          throw new Error(`Variant at index ${i} SKU must be a string`);
        }
      }
      return true;
    }),
];

/**
 * Validate updating a single variant
 */
exports.validateUpdateVariantInput = [
  body('price')
    .optional()
    .isNumeric().withMessage('Price must be a number')
    .custom((value) => value > 0).withMessage('Price must be positive'),
  
  body('salePrice')
    .optional()
    .isNumeric().withMessage('Sale price must be a number')
    .custom((value) => value >= 0).withMessage('Sale price must be non-negative'),
  
  body('stock')
    .optional()
    .isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),
  
  body('attributes')
    .optional()
    .isObject().withMessage('Attributes must be an object')
    .custom((attributes) => {
      if (attributes && Object.keys(attributes).length === 0) {
        throw new Error('Attributes object cannot be empty');
      }
      return true;
    }),
  
  body('images')
    .optional()
    .isArray().withMessage('Images must be an array')
    .custom((images) => {
      if (images && images.length === 0) {
        throw new Error('Images array cannot be empty');
      }
      return true;
    }),
  
  body('isPublished')
    .optional()
    .isBoolean().withMessage('isPublished must be a boolean'),
  
  body('sku')
    .optional()
    .isString().withMessage('SKU must be a string')
    .trim()
    .notEmpty().withMessage('SKU cannot be empty if provided'),
  
  body('shipping')
    .optional()
    .isObject().withMessage('Shipping must be an object')
    .custom((shipping) => {
      if (shipping) {
        if (shipping.standard !== undefined && typeof shipping.standard !== 'number') {
          throw new Error('Standard shipping must be a number');
        }
      }
      return true;
    }),
];

/**
 * Validate updating a product
 */
exports.validateUpdateProductInput = [
  body('title')
    .optional()
    .notEmpty().withMessage('Title cannot be empty'),
  
  body('description')
    .optional()
    .notEmpty().withMessage('Description cannot be empty'),
  
  body('categoryId')
    .optional()
    .isMongoId().withMessage('Invalid category ID'),
  
  body('subcategoryId')
    .optional()
    .isMongoId().withMessage('Invalid subcategory ID'),
  
  body('coverImage')
    .optional()
    .isURL().withMessage('Cover image must be a valid URL'),

  body('taxCategory')
    .optional({ nullable: true })
    .isObject().withMessage('Tax category must be an object')
    .custom((taxCategory) => {
      if (taxCategory) {
        if (!taxCategory.code || typeof taxCategory.code !== 'string') {
          throw new Error('Tax category code is required');
        }
        if (!taxCategory.label || typeof taxCategory.label !== 'string') {
          throw new Error('Tax category label is required');
        }
      }
      return true;
    }),
  
  body('isPublished')
    .optional()
    .isBoolean().withMessage('isPublished must be a boolean'),
  
  body('attributes')
    .optional()
    .isArray().withMessage('Attributes must be an array'),
  
  body('shipping')
    .optional()
    .isObject().withMessage('Shipping must be an object'),
  
  body('galleryImages')
    .optional()
    .isArray().withMessage('Gallery images must be an array'),
  
  body('metaFields')
    .optional()
    .isArray().withMessage('Meta fields must be an array'),
  
  body('discount')
    .optional()
    .isObject().withMessage('Discount must be an object'),
];

/**
 * Validate getting product by ID
 */
exports.validateProductId = [
  body('productId')
    .optional()
    .isMongoId().withMessage('Invalid product ID'),
];

/**
 * Validate variant ID
 */
exports.validateVariantId = [
  body('variantId')
    .optional()
    .isMongoId().withMessage('Invalid variant ID'),
];

/**
 * Validation for POST /api/product (create with variants).
 *
 * Replaces the disabled `validateProductInput` on that route. That validator no
 * longer matches the vendor form: it rejects single-price products (sent as one
 * variant with `attributes: {}`) and discount type "fixed". This one checks the
 * fields every create needs and leaves per-variant price/stock parsing to the
 * controller (normalizeVariantPayload), which already runs before any write.
 */
const requiredString = (field, label) =>
  body(field)
    .custom((value) => typeof value === 'string' && value.trim().length > 0)
    .withMessage(`${label} is required.`);

exports.validateProductCreate = [
  requiredString('title', 'Product title'),
  requiredString('description', 'Product description'),
  body('businessId').isMongoId().withMessage('Business is required.'),
  body('categoryId').isMongoId().withMessage('Category is required.'),
  body('subcategoryId').isMongoId().withMessage('Subcategory is required.'),
  requiredString('coverImage', 'Cover image'),
  body('galleryImages')
    .optional()
    .isArray().withMessage('Gallery images must be a list.'),
  body('galleryImages.*')
    .optional()
    .isString().withMessage('Each gallery image must be a URL.'),
  body('taxCategory')
    .optional({ nullable: true })
    .custom((taxCategory) => {
      if (taxCategory && (typeof taxCategory !== 'object' || typeof taxCategory.code !== 'string' || !taxCategory.code)) {
        throw new Error('Tax category is invalid.');
      }
      return true;
    }),
  body('variants')
    .isArray({ min: 1 }).withMessage('At least one variant is required.'),
  body('variants.*')
    .custom((variant) => variant !== null && typeof variant === 'object' && !Array.isArray(variant))
    .withMessage('Each variant must be an object.'),
  body('isPublished')
    .optional()
    .isBoolean().withMessage('isPublished must be true or false.'),
];
