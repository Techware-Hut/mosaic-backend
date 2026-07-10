const Booking = require('../models/Booking');
const Service = require('../models/Service');
const Food = require('../models/Food');
const Business = require('../models/Business');
const User = require('../models/User');
const {
  sendVendorNewServiceBookingEmail,
  sendVendorNewFoodBookingEmail,
  sendCustomerNewServiceBookingConfirmationEmail,
  sendCustomerServicePaymentRequestEmail,
  sendCustomerServiceBookingDecisionEmail,
} = require('../utils/bookingMailer');
const {
  resolveVendorNotificationRecipients,
} = require('../utils/notificationPreferenceGate');

const ALLOWED_SEAT_OPTIONS = ['upto 2', 'upto 4', 'upto 8', 'more than 10'];

const normalizeStringArray = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const getAuthenticatedUserId = (req) => req.user?.id || req.user?._id;

const formatBookingDate = (value) => {
  if (!value) return 'N/A';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const getVendorRecipients = async (business, owner) => {
  return resolveVendorNotificationRecipients({
    business,
    owner,
    preference: 'newBookingOrOrder',
  });
};

const loadBookingForVendorAction = async (bookingId, vendorId) => {
  return Booking.findOne({
    _id: bookingId,
    ownerId: vendorId,
    bookingType: 'service',
  });
};

exports.createServiceBooking = async (req, res) => {
  try {
    const serviceId = req.params.serviceId || req.body.serviceId;
    const {
      name,
      email,
      phone,
      services,
      date,
      slot,
      notes,
    } = req.body;

    if (!serviceId) {
      return res.status(400).json({ success: false, message: 'serviceId is required' });
    }

    if (!name || !email || !phone || !date || !slot) {
      return res.status(400).json({
        success: false,
        message: 'name, email, phone, date and slot are required',
      });
    }

    const normalizedServices = normalizeStringArray(services);
    if (normalizedServices.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one service is required',
      });
    }

    const service = await Service.findById(serviceId);
    if (!service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    const [business, owner] = await Promise.all([
      Business.findById(service.businessId).select('businessName email slug'),
      User.findById(service.ownerId).select('name email'),
    ]);

    const newBooking = await Booking.create({
      bookingType: 'service',
      serviceId: service._id,
      serviceTitle: service.title,
      services: normalizedServices,
      serviceItems: normalizedServices,
      date,
      slot,
      time: slot,
      status: 'pending_vendor_action',
      notes,
      businessId: service.businessId,
      ownerId: service.ownerId,
      customerId: getAuthenticatedUserId(req),
      customerInfo: { name, email, phone },
    });

    try {
      const vendorRecipients = await getVendorRecipients(business, owner);
      await sendVendorNewServiceBookingEmail({
        to: vendorRecipients,
        vendorName: owner?.name || business?.businessName || 'Vendor',
        serviceTitle: service.title,
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        services: normalizedServices,
        date: formatBookingDate(date),
        slot,
        bookingId: newBooking._id.toString(),
        businessSlug: business?.slug,
      });
    } catch (mailError) {
      console.error('Failed to send new service booking email to vendor:', mailError);
    }

    try {
      await sendCustomerNewServiceBookingConfirmationEmail({
        to: email,
        customerName: name,
        serviceTitle: service.title,
        vendorName: owner?.name || business?.businessName || 'Vendor',
        date: formatBookingDate(date),
        slot,
        services: normalizedServices,
        bookingId: newBooking._id.toString(),
      });
    } catch (mailError) {
      console.error('Failed to send service booking confirmation email to customer:', mailError);
    }

    res.status(201).json({ success: true, booking: newBooking });
  } catch (error) {
    console.error('Failed to create service booking:', error);
    res.status(500).json({ success: false, message: 'Failed to create service booking', error: error.message });
  }
};

exports.createFoodBooking = async (req, res) => {
  try {
    const foodId = req.params.foodId || req.body.foodId;
    const {
      name,
      email,
      phone,
      date,
      slot,
      seats,
      notes,
    } = req.body;

    if (!foodId) {
      return res.status(400).json({ success: false, message: 'foodId is required' });
    }

    if (!name || !email || !phone || !date || !slot || !seats) {
      return res.status(400).json({
        success: false,
        message: 'name, email, phone, date, slot and seats are required',
      });
    }

    const normalizedSeats = String(seats).trim().toLowerCase();
    if (!ALLOWED_SEAT_OPTIONS.includes(normalizedSeats)) {
      return res.status(400).json({
        success: false,
        message: 'seats must be one of: upto 2, upto 4, upto 8, more than 10',
      });
    }

    const food = await Food.findById(foodId);
    if (!food) {
      return res.status(404).json({ success: false, message: 'Food listing not found' });
    }

    const [business, owner] = await Promise.all([
      Business.findById(food.businessId).select('businessName email slug'),
      User.findById(food.ownerId).select('name email'),
    ]);

    const newBooking = await Booking.create({
      bookingType: 'food',
      foodId: food._id,
      foodTitle: food.title,
      serviceTitle: food.title,
      date,
      slot,
      time: slot,
      status: 'Booked',
      seats: normalizedSeats,
      notes,
      businessId: food.businessId,
      ownerId: food.ownerId,
      customerId: getAuthenticatedUserId(req),
      customerInfo: { name, email, phone },
    });

    try {
      const vendorRecipients = await getVendorRecipients(business, owner);
      await sendVendorNewFoodBookingEmail({
        to: vendorRecipients,
        vendorName: owner?.name || business?.businessName || 'Vendor',
        foodTitle: food.title,
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        date: formatBookingDate(date),
        slot,
        seats: normalizedSeats,
        bookingId: newBooking._id.toString(),
        businessSlug: business?.slug,
      });
    } catch (mailError) {
      console.error('Failed to send new food booking email to vendor:', mailError);
    }

    res.status(201).json({ success: true, booking: newBooking });
  } catch (error) {
    console.error('Failed to create food booking:', error);
    res.status(500).json({ success: false, message: 'Failed to create food booking', error: error.message });
  }
};

exports.requestServiceBookingPayment = async (req, res) => {
  try {
    const vendorId = getAuthenticatedUserId(req);
    const booking = await loadBookingForVendorAction(req.params.id, vendorId);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Service booking not found' });
    }

    const { paymentLink, note } = req.body;

    if (!paymentLink) {
      return res.status(400).json({ success: false, message: 'paymentLink is required' });
    }

    booking.paymentLink = paymentLink;
    booking.paymentRequestedAt = new Date();
    booking.vendorDecisionNote = note || '';
    booking.status = 'payment_requested';

    await booking.save();

    try {
      const vendor = await User.findById(booking.ownerId).select('name email');
      await sendCustomerServicePaymentRequestEmail({
        to: booking.customerInfo.email,
        customerName: booking.customerInfo.name,
        serviceTitle: booking.serviceTitle,
        vendorName: vendor?.name || 'Vendor',
        date: formatBookingDate(booking.date),
        slot: booking.slot || booking.time,
        paymentLink,
        bookingId: booking._id.toString(),
        message: note,
      });
    } catch (mailError) {
      console.error('Failed to send payment request email to customer:', mailError);
    }

    res.json({
      success: true,
      message: 'Payment link sent to customer successfully',
      booking,
    });
  } catch (error) {
    console.error('Failed to request payment for service booking:', error);
    res.status(500).json({ success: false, message: 'Failed to request payment', error: error.message });
  }
};

exports.approveServiceBooking = async (req, res) => {
  try {
    const vendorId = getAuthenticatedUserId(req);
    const booking = await loadBookingForVendorAction(req.params.id, vendorId);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Service booking not found' });
    }

    if (booking.status === 'cancelled' || booking.status === 'rejected' || booking.status === 'completed') {
      return res.status(400).json({ success: false, message: `Cannot approve a ${booking.status} booking` });
    }

    booking.status = 'approved';
    booking.vendorDecisionAt = new Date();
    booking.vendorDecisionNote = req.body.note || booking.vendorDecisionNote || '';
    await booking.save();

    try {
      const vendor = await User.findById(booking.ownerId).select('name email');
      await sendCustomerServiceBookingDecisionEmail({
        to: booking.customerInfo.email,
        customerName: booking.customerInfo.name,
        serviceTitle: booking.serviceTitle,
        vendorName: vendor?.name || 'Vendor',
        date: formatBookingDate(booking.date),
        slot: booking.slot || booking.time,
        bookingId: booking._id.toString(),
        status: 'approved',
        note: booking.vendorDecisionNote,
      });
    } catch (mailError) {
      console.error('Failed to send approval email to customer:', mailError);
    }

    res.json({
      success: true,
      message: 'Service booking approved successfully',
      booking,
    });
  } catch (error) {
    console.error('Failed to approve service booking:', error);
    res.status(500).json({ success: false, message: 'Failed to approve service booking', error: error.message });
  }
};

exports.rejectServiceBooking = async (req, res) => {
  try {
    const vendorId = getAuthenticatedUserId(req);
    const booking = await loadBookingForVendorAction(req.params.id, vendorId);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Service booking not found' });
    }

    if (booking.status === 'approved' || booking.status === 'completed' || booking.status === 'cancelled') {
      return res.status(400).json({ success: false, message: `Cannot reject a ${booking.status} booking` });
    }

    booking.status = 'rejected';
    booking.vendorDecisionAt = new Date();
    booking.vendorDecisionNote = req.body.note || booking.vendorDecisionNote || '';
    await booking.save();

    try {
      const vendor = await User.findById(booking.ownerId).select('name email');
      await sendCustomerServiceBookingDecisionEmail({
        to: booking.customerInfo.email,
        customerName: booking.customerInfo.name,
        serviceTitle: booking.serviceTitle,
        vendorName: vendor?.name || 'Vendor',
        date: formatBookingDate(booking.date),
        slot: booking.slot || booking.time,
        bookingId: booking._id.toString(),
        status: 'rejected',
        note: booking.vendorDecisionNote,
      });
    } catch (mailError) {
      console.error('Failed to send rejection email to customer:', mailError);
    }

    res.json({
      success: true,
      message: 'Service booking rejected successfully',
      booking,
    });
  } catch (error) {
    console.error('Failed to reject service booking:', error);
    res.status(500).json({ success: false, message: 'Failed to reject service booking', error: error.message });
  }
};

exports.getVendorBookings = async (req, res) => {
  try {
    const { businessId, status, bookingType } = req.query;

    if (!businessId) {
      return res.status(400).json({ success: false, message: 'businessId is required' });
    }

    const query = {
      businessId,
      ownerId: getAuthenticatedUserId(req),
    };

    if (status) {
      query.status = status;
    }

    if (bookingType) {
      query.bookingType = bookingType;
    }

    const bookings = await Booking.find(query)
      .populate('customerId', 'name email')
      .sort({ createdAt: -1 });

    res.json({ success: true, bookings });
  } catch (error) {
    console.error('Error in getVendorBookings:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bookings', error: error.message });
  }
};

exports.getVendorServiceBookings = async (req, res) => {
  req.query.bookingType = 'service';
  return exports.getVendorBookings(req, res);
};

exports.getVendorFoodBookings = async (req, res) => {
  req.query.bookingType = 'food';
  return exports.getVendorBookings(req, res);
};

exports.getCustomerBookings = async (req, res) => {
  try {
    const { status, bookingType } = req.query;

    const query = {
      customerId: getAuthenticatedUserId(req),
    };

    if (status) {
      query.status = status;
    }

    if (bookingType) {
      query.bookingType = bookingType;
    }

    const bookings = await Booking.find(query)
      .populate('businessId', 'businessName email')
      .populate('serviceId', 'title')
      .populate('foodId', 'title')
      .sort({ createdAt: -1 });

    res.json({ success: true, bookings });
  } catch (error) {
    console.error('Error in getCustomerBookings:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch customer bookings', error: error.message });
  }
};

exports.getCustomerServiceBookings = async (req, res) => {
  req.query.bookingType = 'service';
  return exports.getCustomerBookings(req, res);
};

exports.getCustomerFoodBookings = async (req, res) => {
  req.query.bookingType = 'food';
  return exports.getCustomerBookings(req, res);
};

exports.updateBookingStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const userId = String(getAuthenticatedUserId(req));
    const isVendor = String(booking.ownerId) === userId;
    const isCustomer = String(booking.customerId) === userId;

    if (isVendor) {
      booking.status = status;
    } else if (isCustomer) {
      if (status !== 'cancelled') {
        return res.status(403).json({ success: false, message: 'You can only cancel your booking' });
      }

      if (booking.status === 'completed') {
        return res.status(400).json({ success: false, message: 'Cannot cancel a completed booking' });
      }

      booking.status = 'cancelled';
    } else {
      return res.status(403).json({ success: false, message: 'Not authorized to change this booking' });
    }

    await booking.save();

    res.json({ success: true, message: `Booking marked as ${booking.status}` });
  } catch (error) {
    console.error('Error updating booking status:', error);
    res.status(500).json({ success: false, message: 'Status update failed', error: error.message });
  }
};

exports.deleteBooking = async (req, res) => {
  try {
    const { id } = req.params;

    const booking = await Booking.findByIdAndDelete(id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    res.json({ success: true, message: 'Booking deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete booking', error: error.message });
  }
};
