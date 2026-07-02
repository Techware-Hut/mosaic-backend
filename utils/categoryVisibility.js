const mongoose = require('mongoose');

const KNOWN_INVALID_PUBLIC_CATEGORY_NAMES = new Set([
  'gcgjgjgg',
  'vvvvv',
  'v v v v',
]);

const PUBLIC_CATEGORY_STATUS_DENYLIST = [
  'inactive',
  'hidden',
  'deleted',
  'draft',
  'rejected',
  'archived',
  'disabled',
  'test',
];

const VISIBILITY_BOOLEAN_FIELDS = [
  'isActive',
  'isDeleted',
  'isPublic',
  'isPublished',
  'hidden',
  'isHidden',
];

const normalizeCategoryName = (value = '') =>
  String(value).replace(/\s+/g, ' ').trim();

const compactCategoryName = (value = '') =>
  normalizeCategoryName(value).toLowerCase().replace(/[^a-z0-9]/g, '');

const getInvalidCategoryNameReason = (value) => {
  const normalized = normalizeCategoryName(value);
  const compact = compactCategoryName(normalized);
  const lettersOnly = compact.replace(/[^a-z]/g, '');

  if (!normalized) return 'Category name is required';
  if (normalized.length < 2) return 'Category name must be at least 2 characters';
  if (normalized.length > 80) return 'Category name must be 80 characters or fewer';
  if (!/[a-z]/i.test(normalized)) return 'Category name must include letters';
  if (
    KNOWN_INVALID_PUBLIC_CATEGORY_NAMES.has(normalized.toLowerCase()) ||
    KNOWN_INVALID_PUBLIC_CATEGORY_NAMES.has(compact)
  ) {
    return 'Category name is reserved for test data';
  }

  if (compact.length >= 3 && /^([a-z0-9])\1+$/.test(compact)) {
    return 'Category name cannot be repeated placeholder characters';
  }

  const uniqueLetters = new Set(lettersOnly).size;
  if (
    lettersOnly.length >= 6 &&
    !/[aeiou]/.test(lettersOnly) &&
    uniqueLetters <= 3
  ) {
    return 'Category name appears to be test data';
  }

  return null;
};

const isValidCategoryName = (value) => !getInvalidCategoryNameReason(value);

const assertValidCategoryName = (value) => {
  const normalized = normalizeCategoryName(value);
  const reason = getInvalidCategoryNameReason(normalized);

  if (reason) {
    const error = new Error(reason);
    error.statusCode = 400;
    throw error;
  }

  return normalized;
};

const buildPublicCategoryFilter = (extraFilter = {}) => ({
  isActive: { $ne: false },
  isDeleted: { $ne: true },
  isPublic: { $ne: false },
  isPublished: { $ne: false },
  hidden: { $ne: true },
  isHidden: { $ne: true },
  status: { $nin: PUBLIC_CATEGORY_STATUS_DENYLIST },
  ...extraFilter,
});

const isPublicCategory = (category) => {
  if (!category) return false;
  if (category.isActive === false) return false;
  if (category.isDeleted === true) return false;
  if (category.isPublic === false) return false;
  if (category.isPublished === false) return false;
  if (category.hidden === true || category.isHidden === true) return false;

  const status = normalizeCategoryName(category.status).toLowerCase();
  if (status && PUBLIC_CATEGORY_STATUS_DENYLIST.includes(status)) return false;

  return isValidCategoryName(category.name);
};

const filterPublicCategories = (categories = []) =>
  categories.filter(isPublicCategory);

const parseOptionalBoolean = (value) => {
  if (value === true || value === false) return value;
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;

  return undefined;
};

const getCategoryVisibilityFields = (input = {}) => {
  const updates = {};

  for (const field of VISIBILITY_BOOLEAN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      const parsed = parseOptionalBoolean(input[field]);
      if (parsed !== undefined) updates[field] = parsed;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'status')) {
    const status = normalizeCategoryName(input.status).toLowerCase();
    if (status) updates.status = status;
  }

  return updates;
};

const findPublicCategory = async (Model, { id, slug }, projection = {}) => {
  const categoryFilter = {};

  if (id) {
    if (!mongoose.Types.ObjectId.isValid(String(id))) return null;
    categoryFilter._id = id;
  } else if (slug) {
    categoryFilter.slug = normalizeCategoryName(slug).toLowerCase();
  } else {
    return null;
  }

  const query = Model.findOne(buildPublicCategoryFilter(categoryFilter), {
    _id: 1,
    name: 1,
    slug: 1,
    status: 1,
    isActive: 1,
    isDeleted: 1,
    isPublic: 1,
    isPublished: 1,
    hidden: 1,
    isHidden: 1,
    ...projection,
  });

  const category = query && typeof query.lean === 'function'
    ? await query.lean()
    : await query;

  return isPublicCategory(category) ? category : null;
};

module.exports = {
  KNOWN_INVALID_PUBLIC_CATEGORY_NAMES,
  PUBLIC_CATEGORY_STATUS_DENYLIST,
  normalizeCategoryName,
  compactCategoryName,
  getInvalidCategoryNameReason,
  isValidCategoryName,
  assertValidCategoryName,
  buildPublicCategoryFilter,
  isPublicCategory,
  filterPublicCategories,
  getCategoryVisibilityFields,
  findPublicCategory,
};
