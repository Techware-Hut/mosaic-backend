const Business = require('../../models/Business');
const Product = require('../../models/Product');
const ProductVariant = require('../../models/ProductVariant');
const Service = require('../../models/Service');
const Food = require('../../models/Food');
const Discount = require('../../models/Discounts');
const Cart = require('../../models/Cart');
const CartItem = require('../../models/CartItem');
const Booking = require('../../models/Booking');
const BusinessEnquiry = require('../../models/BusinessEnquiry');
const ServiceRfq = require('../../models/ServiceRfq');
const Subscription = require('../../models/Subscription');
const Order = require('../../models/Order');
const VendorOnboardingStage1 = require('../../models/VendorOnboardingStage1');

/**
 * Hard-delete a business and clean associated marketplace listings / carts / bookings.
 * Historical orders are retained (businessId remains for accounting); pass force=true
 * when orders exist, otherwise responds with 409 so admins can deactivate instead.
 */
async function hardDeleteBusinessCascade(businessId, { force = false } = {}) {
  const business = await Business.findById(businessId);
  if (!business) {
    const err = new Error('Business not found');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  const orderCount = await Order.countDocuments({ businessId: business._id });
  if (orderCount > 0 && !force) {
    const err = new Error(
      `Business has ${orderCount} order(s). Deactivate instead, or hard-delete with force=true (orders are retained with orphan business refs).`
    );
    err.status = 409;
    err.code = 'HAS_ORDERS';
    err.orderCount = orderCount;
    throw err;
  }

  const [
    products,
    variants,
    services,
    foods,
    discounts,
    cartItems,
    carts,
    bookings,
    enquiries,
    rfqs,
    onboarding,
  ] = await Promise.all([
    Product.updateMany(
      { businessId: business._id },
      { $set: { isDeleted: true, isPublished: false, isActive: false } }
    ),
    ProductVariant.updateMany(
      { businessId: business._id },
      { $set: { isDeleted: true } }
    ),
    Service.deleteMany({ businessId: business._id }),
    Food.deleteMany({ businessId: business._id }),
    Discount.deleteMany({ businessId: business._id }),
    CartItem.deleteMany({ businessId: business._id }),
    Cart.deleteMany({ businessId: business._id }),
    Booking.deleteMany({ businessId: business._id }),
    BusinessEnquiry.deleteMany({ businessId: business._id }),
    ServiceRfq.deleteMany({ businessId: business._id }),
    VendorOnboardingStage1.deleteMany({ businessId: business._id }),
  ]);

  if (business.subscriptionId) {
    await Subscription.updateOne(
      { _id: business.subscriptionId },
      { $set: { businessId: null } }
    );
  }
  await Subscription.updateMany(
    { businessId: business._id },
    { $set: { businessId: null } }
  );

  const snapshot = {
    _id: business._id,
    businessName: business.businessName,
    email: business.email,
    listingType: business.listingType,
    isActive: business.isActive,
  };

  await business.deleteOne();

  return {
    business: snapshot,
    ordersRetained: orderCount,
    cleanup: {
      productsSoftDeleted: products.modifiedCount ?? 0,
      variantsSoftDeleted: variants.modifiedCount ?? 0,
      servicesDeleted: services.deletedCount ?? 0,
      foodsDeleted: foods.deletedCount ?? 0,
      discountsDeleted: discounts.deletedCount ?? 0,
      cartItemsDeleted: cartItems.deletedCount ?? 0,
      cartsDeleted: carts.deletedCount ?? 0,
      bookingsDeleted: bookings.deletedCount ?? 0,
      enquiriesDeleted: enquiries.deletedCount ?? 0,
      rfqsDeleted: rfqs.deletedCount ?? 0,
      onboardingDeleted: onboarding.deletedCount ?? 0,
    },
  };
}

module.exports = {
  hardDeleteBusinessCascade,
};
