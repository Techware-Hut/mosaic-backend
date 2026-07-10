const mongoose = require('mongoose');
const Order = require('../models/Order');
const Booking = require('../models/Booking');
const BusinessEnquiry = require('../models/BusinessEnquiry');

const getAuthenticatedUserId = (req) => req.user?.id || req.user?._id;

exports.getVendorAlertsSummary = async (req, res) => {
  try {
    const { businessId } = req.query;
    const ownerId = getAuthenticatedUserId(req);

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: 'businessId is required',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid businessId',
      });
    }

    const businessObjectId = new mongoose.Types.ObjectId(businessId);

    const [
      pendingOrders,
      pendingServiceBookings,
      pendingFoodBookings,
      totalInquiries,
    ] = await Promise.all([
      Order.countDocuments({
        vendorId: ownerId,
        businessId: businessObjectId,
        paymentStatus: 'paid',
        status: 'ordered',
      }),
      Booking.countDocuments({
        ownerId,
        businessId: businessObjectId,
        bookingType: 'service',
        status: 'pending_vendor_action',
      }),
      Booking.countDocuments({
        ownerId,
        businessId: businessObjectId,
        bookingType: 'food',
        status: 'Booked',
      }),
      BusinessEnquiry.countDocuments({
        vendorId: ownerId,
        businessId: businessObjectId,
      }),
    ]);

    const pendingBookings = pendingServiceBookings + pendingFoodBookings;
    const totalPending = pendingOrders + pendingBookings;

    return res.status(200).json({
      success: true,
      pendingOrders,
      pendingServiceBookings,
      pendingFoodBookings,
      pendingBookings,
      totalInquiries,
      totalPending,
    });
  } catch (error) {
    console.error('Failed to fetch vendor alerts summary:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor alerts summary',
    });
  }
};
