const mongoose = require('mongoose');

const Business = require('../../models/Business');
const BusinessEnquiry = require('../../models/BusinessEnquiry');
const Service = require('../../models/Service');
const ServiceRfq = require('../../models/ServiceRfq');
const User = require('../../models/User');
const {
  resolvePublicExternalLink,
} = require('../../utils/serviceLeadConfig');
const {
  sendVendorNewServiceRfqEmail,
  sendCustomerServiceRfqConfirmationEmail,
} = require('../../utils/rfqMailer');
const {
  resolveVendorNotificationRecipients,
} = require('../../utils/notificationPreferenceGate');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeStringArray = (value) => {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => String(item ?? '').trim()).filter(Boolean);
};

const getVendorRecipients = async (business, owner) =>
  resolveVendorNotificationRecipients({
    business,
    owner,
    preference: 'newBookingOrOrder',
  });

exports.createRevealEnquiry = async (req, res) => {
  try {
    const { businessId, source = 'vendor_profile_reveal' } = req.body;

    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid businessId is required',
      });
    }

    const business = await Business.findById(businessId)
      .select('_id owner businessName isActive isApproved')
      .lean();

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found',
      });
    }

    if (business.owner?.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot create an enquiry for your own business',
      });
    }

    const now = new Date();
    const customerPhone = req.user.mobile || '';

    const enquiry = await BusinessEnquiry.findOneAndUpdate(
      {
        businessId: business._id,
        customerId: req.user._id,
        source,
      },
      {
        $set: {
          vendorId: business.owner,
          customerName: req.user.name,
          customerEmail: req.user.email,
          customerPhone,
          lastRevealedAt: now,
        },
        $setOnInsert: {
          businessId: business._id,
          customerId: req.user._id,
          source,
        },
        $inc: {
          revealCount: 1,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    const createdNow = enquiry.createdAt?.getTime() === enquiry.updatedAt?.getTime();

    return res.status(createdNow ? 201 : 200).json({
      success: true,
      message: createdNow
        ? 'Enquiry saved successfully'
        : 'Enquiry updated successfully',
      data: {
        _id: enquiry._id,
        businessId: enquiry.businessId,
        vendorId: enquiry.vendorId,
        customerId: enquiry.customerId,
        customerName: enquiry.customerName,
        customerEmail: enquiry.customerEmail,
        customerPhone: enquiry.customerPhone,
        source: enquiry.source,
        revealCount: enquiry.revealCount,
        lastRevealedAt: enquiry.lastRevealedAt,
      },
    });
  } catch (error) {
    console.error('Error creating reveal enquiry:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save enquiry',
    });
  }
};

exports.createServiceRfq = async (req, res) => {
  try {
    const {
      serviceId,
      name,
      email,
      phone,
      message,
      services,
      budget,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid serviceId is required',
      });
    }

    const trimmedName = String(name || '').trim();
    const trimmedEmail = String(email || '').trim().toLowerCase();
    const trimmedPhone = String(phone || '').trim();
    const trimmedMessage = String(message || '').trim();
    const trimmedBudget = String(budget || '').trim();

    if (!trimmedName || !trimmedEmail || !trimmedPhone || !trimmedMessage) {
      return res.status(400).json({
        success: false,
        message: 'name, email, phone, and message are required',
      });
    }

    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'A valid email address is required',
      });
    }

    if (trimmedMessage.length < 10) {
      return res.status(400).json({
        success: false,
        message: 'message must be at least 10 characters',
      });
    }

    const service = await Service.findById(serviceId)
      .select('_id title businessId ownerId isPublished isActive rfqEnabled externalLink bookingToolLink')
      .lean();

    if (!service || service.isPublished !== true || service.isActive === false) {
      return res.status(404).json({
        success: false,
        message: 'Service not found',
      });
    }

    if (service.rfqEnabled !== true) {
      return res.status(400).json({
        success: false,
        message: 'This service listing does not accept quote requests',
      });
    }

    if (resolvePublicExternalLink(service)) {
      return res.status(400).json({
        success: false,
        message: 'This service uses an external booking link. Quote requests are unavailable.',
      });
    }

    const business = await Business.findById(service.businessId)
      .select('_id owner businessName email slug isActive isApproved')
      .lean();

    if (!business || business.isActive !== true) {
      return res.status(404).json({
        success: false,
        message: 'Business not found',
      });
    }

    if (business.owner?.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot submit a quote request for your own business',
      });
    }

    const owner = await User.findById(service.ownerId).select('name email').lean();
    const requestedServices = normalizeStringArray(services);

    const rfq = await ServiceRfq.create({
      serviceId: service._id,
      businessId: business._id,
      vendorId: business.owner,
      customerId: req.user._id,
      customerName: trimmedName,
      customerEmail: trimmedEmail,
      customerPhone: trimmedPhone,
      message: trimmedMessage,
      requestedServices,
      budget: trimmedBudget,
      status: 'pending',
      source: 'service_rfq',
    });

    try {
      const vendorRecipients = await getVendorRecipients(business, owner);
      await sendVendorNewServiceRfqEmail({
        to: vendorRecipients,
        vendorName: owner?.name || business.businessName || 'Vendor',
        serviceTitle: service.title || 'Service',
        customerName: trimmedName,
        customerEmail: trimmedEmail,
        customerPhone: trimmedPhone,
        message: trimmedMessage,
        requestedServices,
        budget: trimmedBudget,
        rfqId: rfq._id.toString(),
        businessSlug: business.slug,
      });
    } catch (mailError) {
      console.error('Failed to send service RFQ email to vendor:', mailError);
    }

    try {
      await sendCustomerServiceRfqConfirmationEmail({
        to: trimmedEmail,
        customerName: trimmedName,
        serviceTitle: service.title || 'Service',
        vendorName: owner?.name || business.businessName || 'Vendor',
        message: trimmedMessage,
        requestedServices,
        budget: trimmedBudget,
        rfqId: rfq._id.toString(),
      });
    } catch (mailError) {
      console.error('Failed to send service RFQ confirmation email to customer:', mailError);
    }

    return res.status(201).json({
      success: true,
      message: 'Quote request submitted successfully',
      data: {
        _id: rfq._id,
        serviceId: rfq.serviceId,
        businessId: rfq.businessId,
        customerName: rfq.customerName,
        customerEmail: rfq.customerEmail,
        customerPhone: rfq.customerPhone,
        message: rfq.message,
        requestedServices: rfq.requestedServices,
        budget: rfq.budget,
        status: rfq.status,
        createdAt: rfq.createdAt,
      },
    });
  } catch (error) {
    console.error('Error creating service RFQ:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit quote request',
    });
  }
};

exports.getVendorRfqs = async (req, res) => {
  try {
    const { businessId, page = 1, limit = 20 } = req.query;

    const ownedBusinessFilter = { owner: req.user._id };

    if (businessId) {
      if (!mongoose.Types.ObjectId.isValid(businessId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid businessId',
        });
      }

      ownedBusinessFilter._id = businessId;
    }

    const businesses = await Business.find(ownedBusinessFilter)
      .select('_id businessName')
      .lean();

    if (!businesses.length) {
      return res.status(200).json({
        success: true,
        total: 0,
        page: Number(page),
        totalPages: 0,
        data: [],
      });
    }

    const businessIds = businesses.map((item) => item._id);
    const businessNameMap = new Map(
      businesses.map((item) => [item._id.toString(), item.businessName])
    );

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const limitNumber = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNumber - 1) * limitNumber;

    const [rfqs, total] = await Promise.all([
      ServiceRfq.find({
        vendorId: req.user._id,
        businessId: { $in: businessIds },
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber)
        .populate('serviceId', 'title slug')
        .populate('customerId', 'name email mobile profileImage')
        .lean(),
      ServiceRfq.countDocuments({
        vendorId: req.user._id,
        businessId: { $in: businessIds },
      }),
    ]);

    const data = rfqs.map((rfq) => ({
      ...rfq,
      businessName: businessNameMap.get(rfq.businessId?.toString()) || null,
      serviceTitle:
        typeof rfq.serviceId === 'object' && rfq.serviceId?.title
          ? rfq.serviceId.title
          : null,
    }));

    return res.status(200).json({
      success: true,
      total,
      page: pageNumber,
      totalPages: Math.ceil(total / limitNumber),
      data,
    });
  } catch (error) {
    console.error('Error fetching vendor RFQs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch quote requests',
    });
  }
};

exports.getVendorEnquiries = async (req, res) => {
  try {
    const { businessId, page = 1, limit = 20 } = req.query;

    const ownedBusinessFilter = { owner: req.user._id };

    if (businessId) {
      if (!mongoose.Types.ObjectId.isValid(businessId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid businessId',
        });
      }

      ownedBusinessFilter._id = businessId;
    }

    const businesses = await Business.find(ownedBusinessFilter)
      .select('_id businessName')
      .lean();

    if (!businesses.length) {
      return res.status(200).json({
        success: true,
        total: 0,
        page: Number(page),
        totalPages: 0,
        data: [],
      });
    }

    const businessIds = businesses.map((item) => item._id);
    const businessNameMap = new Map(
      businesses.map((item) => [item._id.toString(), item.businessName])
    );

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const limitNumber = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNumber - 1) * limitNumber;

    const [enquiries, total] = await Promise.all([
      BusinessEnquiry.find({
        vendorId: req.user._id,
        businessId: { $in: businessIds },
      })
        .sort({ lastRevealedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNumber)
        .populate('customerId', 'name email mobile profileImage')
        .lean(),
      BusinessEnquiry.countDocuments({
        vendorId: req.user._id,
        businessId: { $in: businessIds },
      }),
    ]);

    const data = enquiries.map((enquiry) => ({
      ...enquiry,
      businessName: businessNameMap.get(enquiry.businessId?.toString()) || null,
    }));

    return res.status(200).json({
      success: true,
      total,
      page: pageNumber,
      totalPages: Math.ceil(total / limitNumber),
      data,
    });
  } catch (error) {
    console.error('Error fetching vendor enquiries:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch enquiries',
    });
  }
};
