/**
 * Canonical admin audit action codes for Phase 1.
 * @see docs/backend/ADMIN_AUDIT_TRAIL_PHASE1.md
 */
const ADMIN_AUDIT_ACTIONS = Object.freeze({
  VENDOR_APPLICATION_VERIFY_ITEM: 'vendor.application.verify_item',
  VENDOR_APPLICATION_FINALIZE_APPROVED: 'vendor.application.finalize_approved',
  VENDOR_APPLICATION_FINALIZE_REJECTED: 'vendor.application.finalize_rejected',
  VENDOR_APPLICATION_FINALIZE_FAILED: 'vendor.application.finalize_failed',
  VENDOR_APPLICATION_NOTIFY_GUIDANCE: 'vendor.application.notify_guidance',

  USER_BLOCK: 'user.block',
  USER_UNBLOCK: 'user.unblock',
  USER_SOFT_DELETE: 'user.soft_delete',

  BUSINESS_APPROVE: 'business.approve',
  BUSINESS_DISAPPROVE: 'business.disapprove',
  BUSINESS_ACTIVATE: 'business.activate',
  BUSINESS_DEACTIVATE: 'business.deactivate',
  BUSINESS_TAGS_UPDATE: 'business.tags_update',
  BUSINESS_FEATURE: 'business.feature',
  BUSINESS_UNFEATURE: 'business.unfeature',

  PRODUCT_FEATURE: 'product.feature',
  PRODUCT_UNFEATURE: 'product.unfeature',

  CATALOG_UPDATE: 'catalog.update',
  CATALOG_DEACTIVATE: 'catalog.deactivate',
  CATALOG_ACTIVATE: 'catalog.activate',
  CATALOG_DELETE: 'catalog.delete',

  BUSINESS_PROFILE_UPDATE: 'business.profile_update',

  CATEGORY_CREATE: 'category.create',
  CATEGORY_UPDATE: 'category.update',
  CATEGORY_DELETE: 'category.delete',

  CATEGORY_REQUEST_APPROVE: 'category_request.approve',
  CATEGORY_REQUEST_REJECT: 'category_request.reject',

  SUBSCRIPTION_PLAN_CREATE: 'subscription_plan.create',
  SUBSCRIPTION_PLAN_UPDATE: 'subscription_plan.update',
});

const ADMIN_AUDIT_TARGET_TYPES = Object.freeze({
  VENDOR_APPLICATION: 'vendor_application',
  USER: 'user',
  BUSINESS: 'business',
  PRODUCT: 'product',
  CATALOG_LISTING: 'catalog_listing',
  CATEGORY: 'category',
  CATEGORY_REQUEST: 'category_request',
  SUBSCRIPTION_PLAN: 'subscription_plan',
});

module.exports = {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
};
