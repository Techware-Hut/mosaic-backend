const Booking = require('../models/Booking');

const ACTIVE_BOOKING_STATUSES = [
  'created',
  'Booked',
  'pending_vendor_action',
  'payment_requested',
  'approved',
  'confirmed',
];

const activeBookingFilter = {
  status: { $in: ACTIVE_BOOKING_STATUSES },
};

const hasActiveFoodBookings = async ({ foodId, ownerId }) => {
  const booking = await Booking.exists({
    ...activeBookingFilter,
    bookingType: 'food',
    foodId,
    ownerId,
  });

  return Boolean(booking);
};

const hasActiveServiceBookings = async ({ serviceId, ownerId }) => {
  const booking = await Booking.exists({
    ...activeBookingFilter,
    bookingType: 'service',
    serviceId,
    ownerId,
  });

  return Boolean(booking);
};

module.exports = {
  ACTIVE_BOOKING_STATUSES,
  hasActiveFoodBookings,
  hasActiveServiceBookings,
};
