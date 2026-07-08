const Service = require('../models/Service');
const Business = require('../models/Business');
const Subscription = require('../models/Subscription');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const PendingImage = require('../models/PendingImage');
const deleteCloudinaryFile = require('../utils/deleteCloudinaryFile');
const {
  normalizeChildServices,
  normalizeServicePayload,
  normalizeStringList,
  normalizeBusinessHoursForStorage,
  normalizeBusinessHoursForOwnerResponse,
  normalizeFaqList,
  normalizeAmenitiesList,
  resolveTaxonomyIdFromBody,
  validateChildServices,
  validatePublishRequest,
  getMinimumChildServicePrice,
  formatOwnerServiceResponse,
  formatValidationErrorResponse,
} = require('../lib/service/serviceContract');
const { normalizeImages } = require('../lib/listing/publicListingDto');
const { hasActiveServiceBookings } = require('../utils/bookingDeleteGuards');
const { S3Client } = require('@aws-sdk/client-s3');
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const {
  PRESIGNED_S3_UPLOAD_EXPIRES_IN_SECONDS,
  MAX_IMAGE_S3_UPLOAD_BYTES,
  buildPresignedS3UploadContract,
  isAllowedImageS3UploadMimeType,
  parseS3UploadSizeBytes,
  resolveImageS3UploadMimeType,
  sanitizeS3UploadFileName,
} = require('../utils/s3PresignedUploadContract');
const {
  buildUploadedMediaResponse,
  buildUploadStorageConfigError,
  getMissingS3UploadEnvNames,
  logUploadConfigFailure,
  logUploadFailure,
} = require('../utils/uploadDiagnostics');

require('../models/ServiceCategory');
require('../models/ServiceSubcategory');

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const getGalleryImageLimit = (subscriptionPlan) =>
  subscriptionPlan?.limits?.galleryImageLimit ?? subscriptionPlan?.limits?.imageLimit ?? 0;

const countGalleryImages = (images) =>
  Array.isArray(images) ? images.filter(Boolean).length : 0;

const getOwnerChildServiceCount = async (ownerId, excludeServiceId = null) => {
  const filters = { ownerId };
  if (excludeServiceId) {
    filters._id = { $ne: excludeServiceId };
  }

  const services = await Service.find(filters).select('services').lean();
  return services.reduce((sum, item) => (
    sum + (Array.isArray(item.services) ? item.services.length : 0)
  ), 0);
};

// Create parent service with minimal details
exports.createParentService = async (req, res) => {
  const session = await Service.startSession();
  session.startTransaction();

  try {
    const {
      title,
      description,
      categoryId,
      subcategoryId,
      businessId,
      coverImage,
      images,
      location,
      businessHours,
      bookingToolLink
    } = req.body;

    const userId = req.user._id;

    const existingParentService = await Service.findOne({
      businessId,
      ownerId: userId
    });

    if (existingParentService) {
      return res.status(400).json({
        error: 'Parent service already exists for this business. You can only add child services now.',
        existingService: existingParentService
      });
    }

    // Verify business ownership
    const business = await Business.findOne({ _id: businessId, owner: userId });
    if (!business)
      return res.status(403).json({ error: 'You do not own this business.' });

    // Subscription check
    const subscription = await Subscription.findOne({
      userId,
      status: 'active',
      endDate: { $gte: new Date() },
    }).sort({ createdAt: -1 });

    if (!subscription)
      return res.status(403).json({ error: 'Valid subscription not found.' });

    const subscriptionPlan = await SubscriptionPlan.findById(subscription.subscriptionPlanId);
    const galleryImageLimit = getGalleryImageLimit(subscriptionPlan);

    if (countGalleryImages(images) > galleryImageLimit) {
      return res.status(400).json({
        error: `Service gallery can have maximum ${galleryImageLimit} images for your plan.`,
      });
    }

    // Create parent service with minimal required fields
    const service = new Service({
      title: title || 'Service',
      description: description || '',
      price: 0, // Will be updated when child services are added
      duration: '',

      categoryId,
      subcategoryId,
      businessId,
      coverImage: coverImage || '',
      images: Array.isArray(images) ? images.filter(Boolean) : [],
      location: location?.address || '',
      businessHours: normalizeBusinessHoursForStorage(businessHours || []),
      bookingToolLink: bookingToolLink || '',

      // Empty arrays for child services to be added later
      services: [],

      contact: {
        phone: '',
        email: '',
        address: location?.address || '',
        website: ''
      },

      ownerId: userId,
      minorityType: business.minorityType,
      isPublished: false, // Keep unpublished until child services are added
      maxBookingsPerSlot: 1,
      features: normalizeStringList(req.body.features),
      amenities: normalizeAmenitiesList(req.body.amenities),
      videos: [],
      faq: normalizeFaqList(req.body.faq)
    });

    await service.save();

    const usedImages = [coverImage, ...(Array.isArray(images) ? images : [])].filter(Boolean);
    if (usedImages.length > 0) {
      await PendingImage.deleteMany({ url: { $in: usedImages } });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'Parent service created successfully. You can now add child services.',
      service,
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    console.error('Parent service creation failed:', err.message);
    return res.status(400).json({ error: err.message || 'Failed to create parent service' });
  }
};


exports.createService = async (req, res) => {
  const session = await Service.startSession();
  session.startTransaction();

  try {
    const {
      categoryId,
      subcategoryId,
      businessId,
      bookingToolLink,
      coverImage,
      images,
      businessHours,
      location,
    } = req.body;

    const userId = req.user._id;
    const payload = normalizeServicePayload(req.body);
    const { title, description, isPublished, normalizedServices, parentPrice, parentDuration, features } = payload;

    const business = await Business.findOne({ _id: businessId, owner: userId });
    if (!business)
      return res.status(403).json({ error: 'You do not own this business.' });

    const existingParentService = await Service.findOne({
      businessId,
      ownerId: userId,
    }).select('_id title isPublished');

    if (existingParentService) {
      return res.status(409).json({
        success: false,
        error: 'A service listing already exists for this business. Use PUT /api/service/:id to update or publish it.',
        existingServiceId: existingParentService._id,
        fieldErrors: {
          businessId: 'Service listing already exists for this business.',
        },
      });
    }

    const publishValidation = validatePublishRequest({ isPublished, normalizedServices });
    if (!publishValidation.ok) {
      return res.status(400).json(formatValidationErrorResponse(
        publishValidation.fieldErrors,
        publishValidation.message
      ));
    }

    const childValidation = validateChildServices(normalizedServices);
    if (!childValidation.ok) {
      return res.status(400).json(formatValidationErrorResponse(childValidation.fieldErrors));
    }

    const subscription = await Subscription.findOne({
      userId,
      status: 'active',
      endDate: { $gte: new Date() },
    }).sort({ createdAt: -1 });

    if (!subscription)
      return res.status(403).json({ error: 'Valid subscription not found.' });

    const subscriptionPlan = await SubscriptionPlan.findById(subscription.subscriptionPlanId);
    const serviceLimit = subscriptionPlan?.limits?.serviceListings || 0;
    const galleryImageLimit = getGalleryImageLimit(subscriptionPlan);

    const currentChildServiceCount = await getOwnerChildServiceCount(userId);
    if (currentChildServiceCount + normalizedServices.length > serviceLimit) {
      return res.status(403).json({
        error: `Service listing limit reached. You can add only ${Math.max(serviceLimit - currentChildServiceCount, 0)}  services.`,
      });
    }

    if (countGalleryImages(images) > galleryImageLimit) {
      return res.status(400).json({
        error: `Service gallery can have maximum ${galleryImageLimit} images for your plan.`,
      });
    }

    const service = new Service({
      title,
      description,
      price: parentPrice,
      duration: parentDuration,

      categoryId,
      subcategoryId,
      businessId,
      bookingToolLink: bookingToolLink || '',
      services: normalizedServices,
      coverImage: coverImage || '',
      images: images || [],
      isPublished,
      businessHours: normalizeBusinessHoursForStorage(businessHours || []),
      location: location?.address || '',

      contact: {
        phone: '',
        email: '',
        address: location?.address || '',
        website: ''
      },

      ownerId: userId,
      minorityType: business.minorityType,
      maxBookingsPerSlot: 1,
      features,
      amenities: normalizeAmenitiesList(req.body.amenities),
      videos: [],
      faq: normalizeFaqList(req.body.faq)
    });

    await service.save();

    const usedImages = [coverImage, ...(images || [])].filter(Boolean);
    if (usedImages.length > 0) {
      await PendingImage.deleteMany({ url: { $in: usedImages } });
    }

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json(
      formatOwnerServiceResponse(service, business, 'Service created successfully.')
    );

  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    const usedImages = [req.body.coverImage, ...(req.body.images || [])].filter(Boolean);
    for (const image of usedImages) {
      await deleteCloudinaryFile(image).catch(() => { });
      await PendingImage.deleteOne({ url: image }).catch(() => { });
    }

    console.error('Service creation failed:', err.message);
    return res.status(400).json({ error: err.message || 'Failed to create service' });
  }
};


// exports.createService = async (req, res) => {
//   const session = await Service.startSession();
//   session.startTransaction();

//   try {
//     const {
//       categoryId,
//       subcategoryId,
//       businessId,
//       bookingToolLink,
//       services,
//       coverImage,
//       images,
//       businessHours,
//       location,
//       isPublished,
//     } = req.body;

//     const userId = req.user._id;

//     // 🛡️ Step 1: Verify ownership
//     const business = await Business.findOne({ _id: businessId, owner: userId });
//     if (!business)
//       return res.status(403).json({ error: 'You do not own this business.' });

//       return res.status(400).json({ error: 'Business is not approved yet.' });

//     if (business.listingType !== 'service')
//       return res.status(400).json({ error: 'This business is not allowed to list services.' });

//     // 📅 Step 2: Subscription check
//     const subscription = await Subscription.findOne({
//       userId: userId,
//       status: 'active',
//       endDate: { $gte: new Date() },
//     }).sort({ createdAt: -1 });

//     if (!subscription)
//       return res.status(403).json({ error: 'Valid subscription not found.' });

//     const subscriptionPlan = await SubscriptionPlan.findById(subscription.subscriptionPlanId);
//     const serviceLimit = subscriptionPlan?.limits?.serviceListings || 0;

//     const existingServiceCount = await Service.countDocuments({ ownerId: userId });

//     if (existingServiceCount >= serviceLimit) {
//       return res.status(403).json({
//         error: `Service listing limit reached for your subscription. You can add up to ${serviceLimit} services.`,
//       });
//     }

//     // ✅ Step 3: Save service with defaults for optional fields
//     const service = new Service({
//       // Default values for required fields
//       title: 'Service',
//       description: '',
//       price: 0,
//       duration: '60 minutes',

//       // Your actual data
//       categoryId,
//       subcategoryId,
//       businessId,
//       bookingToolLink: bookingToolLink || '',
//       services: services || [],
//       coverImage: coverImage || '',
//       images: images || [],
//       isPublished: isPublished || false,
//       businessHours: businessHours || [],
//       location: location?.address || '',

//       // Default contact
//       contact: {
//         phone: '',
//         email: '',
//         address: location?.address || '',
//         website: ''
//       },

//       ownerId: userId,
//       minorityType: business.minorityType,
//       maxBookingsPerSlot: 1,
//       features: [],
//       amenities: [],
//       videos: [],
//       faq: []
//     });

//     await service.save();

//     // Clean up pending images
//     const usedImages = [coverImage, ...(images || [])].filter(Boolean);
//     if (usedImages.length > 0) {
//       await PendingImage.deleteMany({ url: { $in: usedImages } });
//     }

//     await session.commitTransaction();
//     session.endSession();

//     res.status(201).json({
//       message: 'Service created successfully.',
//       service,
//     });

//   } catch (err) {
//     await session.abortTransaction();
//     session.endSession();

//     // Clean up uploaded images on error
//     const usedImages = [req.body.coverImage, ...(req.body.images || [])].filter(Boolean);
//     for (const image of usedImages) {
//       await deleteCloudinaryFile(image).catch(() => {});
//       await PendingImage.deleteOne({ url: image }).catch(() => {});
//     }

//     console.error('Service creation failed:', err.message);
//     return res.status(400).json({ error: err.message || 'Failed to create service' });
//   }
// };

// Other functions remain the same but with updated field references



// Get parent services (services without child services or with empty services array)
exports.getParentServices = async (req, res) => {
  try {
    const userId = req.user._id;

    const parentServices = await Service.find({
      ownerId: userId,
      $or: [
        { services: { $exists: false } },
        { services: { $size: 0 } }
      ]
    }).populate('categoryId subcategoryId businessId');

    res.status(200).json({
      message: 'Parent services retrieved successfully.',
      services: parentServices
    });
  } catch (err) {
    console.error('Failed to get parent services:', err.message);
    return res.status(400).json({ error: err.message || 'Failed to get parent services' });
  }
};

// Get child services of a specific parent service
exports.getChildServices = async (req, res) => {
  try {
    const { parentServiceId } = req.params;
    const userId = req.user._id;

    const parentService = await Service.findOne({
      _id: parentServiceId,
      ownerId: userId
    });

    if (!parentService) {
      return res.status(404).json({ error: 'Parent service not found.' });
    }

    res.status(200).json({
      message: 'Child services retrieved successfully.',
      childServices: parentService.services || [],
      parentService: {
        id: parentService._id,
        title: parentService.title,
        description: parentService.description
      }
    });
  } catch (err) {
    console.error('Failed to get child services:', err.message);
    return res.status(400).json({ error: err.message || 'Failed to get child services' });
  }
};

// Add child services to existing parent service
exports.addChildServices = async (req, res) => {
  try {
    const { parentServiceId, businessId, childServices, coverImage, images } = req.body;
    const userId = req.user._id;

    if (!Array.isArray(childServices) || childServices.length === 0) {
      return res.status(400).json({ error: 'childServices must be a non-empty array.' });
    }

    const withBusinessOwner = (query) => query.populate('businessId', 'owner');

    let parentService = null;

    // 1) Standard lookup using parent service id
    if (parentServiceId) {
      parentService = await withBusinessOwner(Service.findById(parentServiceId));
    }

    // 2) Lookup by business id when frontend sends businessId
    if (!parentService && businessId) {
      parentService = await withBusinessOwner(
        Service.findOne({ businessId }).sort({ createdAt: -1 })
      );
    }

    // 3) Backward-compatible fallback: treat parentServiceId as businessId
    if (!parentService && parentServiceId) {
      parentService = await withBusinessOwner(
        Service.findOne({ businessId: parentServiceId }).sort({ createdAt: -1 })
      );
    }

    if (!parentService) {
      return res.status(404).json({ error: 'Parent service not found for provided parentServiceId/businessId.' });
    }

    const isOwner = parentService.ownerId && String(parentService.ownerId) === String(userId);
    const isBusinessOwnerUser =
      parentService.businessId &&
      parentService.businessId.owner &&
      String(parentService.businessId.owner) === String(userId);

    if (!isOwner && !isBusinessOwnerUser) {
      return res.status(403).json({ error: 'You do not own this parent service/business.' });
    }

    const subscription = await Subscription.findOne({
      userId,
      status: 'active',
      endDate: { $gte: new Date() },
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.status(403).json({ error: 'Valid subscription not found.' });
    }

    const subscriptionPlan = await SubscriptionPlan.findById(subscription.subscriptionPlanId);
    const serviceLimit = subscriptionPlan?.limits?.serviceListings || 0;
    const galleryImageLimit = getGalleryImageLimit(subscriptionPlan);

    // Add new child services to existing ones
    const normalizedChildServices = normalizeChildServices(childServices);
    const childValidation = validateChildServices(normalizedChildServices);
    if (!childValidation.ok) {
      return res.status(400).json(formatValidationErrorResponse(childValidation.fieldErrors));
    }

    const currentChildServiceCount = await getOwnerChildServiceCount(userId);
    if (currentChildServiceCount + normalizedChildServices.length > serviceLimit) {
      return res.status(403).json({
        error: `Service listing limit reached. You can add only ${Math.max(serviceLimit - currentChildServiceCount, 0)} more services.`,
      });
    }

    const nextGalleryImages = images !== undefined ? images : parentService.images;
    if (countGalleryImages(nextGalleryImages) > galleryImageLimit) {
      return res.status(400).json({
        error: `Service gallery can have maximum ${galleryImageLimit} images for your plan.`,
      });
    }

    const updatedChildServices = [...parentService.services, ...normalizedChildServices];

    // Update parent service price to minimum of all child services
    const newParentPrice = getMinimumChildServicePrice(updatedChildServices, parentService.price);

    const updatePayload = {
      services: updatedChildServices,
      price: newParentPrice,
      duration: ''
    };

    // Optional parent media updates in same request
    if (coverImage !== undefined) {
      updatePayload.coverImage = coverImage || '';
    }
    if (images !== undefined) {
      updatePayload.images = Array.isArray(images) ? images.filter(Boolean) : [];
    }

    // Update the parent service
    const updatedService = await Service.findByIdAndUpdate(
      parentService._id,
      updatePayload,
      { new: true }
    );

    const business = await Business.findById(parentService.businessId).select('isActive isApproved owner');

    return res.status(200).json(
      formatOwnerServiceResponse(updatedService, business, 'Child services added successfully.')
    );

  } catch (err) {
    console.error('Failed to add child services:', err.message);
    return res.status(400).json({ error: err.message || 'Failed to add child services' });
  }
};

exports.getMyServices = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const isPublished = req.query.isPublished;
    const categoryId = req.query.categoryId;

    const filters = { ownerId: userId };

    if (isPublished === 'true') filters.isPublished = true;
    if (isPublished === 'false') filters.isPublished = false;
    if (categoryId) filters.categoryId = categoryId;

    const services = await Service.find(filters)
      .populate('categoryId', 'name')
      .populate('subcategoryId', 'name')
      .populate('ownerId', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Service.countDocuments(filters);

    const businessIds = [...new Set(services.map((item) => String(item.businessId)).filter(Boolean))];
    const businesses = await Business.find({ _id: { $in: businessIds } })
      .select('_id isActive isApproved owner')
      .lean();
    const businessById = new Map(businesses.map((item) => [String(item._id), item]));

    const servicesWithPublication = services.map((item) => {
      const plainService = item.toObject();
      const business = businessById.get(String(item.businessId));
      return formatOwnerServiceResponse(plainService, business).data;
    });

    res.status(200).json({
      services: servicesWithPublication.map((entry) => entry.service),
      publicationByServiceId: Object.fromEntries(
        servicesWithPublication.map((entry) => [String(entry.service._id), entry.publication])
      ),
      data: servicesWithPublication,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });

  } catch (err) {
    console.error('Failed to fetch user services:', err.message);
    res.status(500).json({ error: err.message || 'Failed to retrieve services.' });
  }
};

exports.deleteService = async (req, res) => {
  try {
    const serviceId = req.params.id;
    const userId = req.user._id;

    const service = await Service.findOne({ _id: serviceId, ownerId: userId });
    if (!service)
      return res.status(404).json({ error: 'Service not found or unauthorized.' });

    const hasActiveBookings = await hasActiveServiceBookings({
      serviceId: service._id,
      ownerId: userId,
    });

    if (hasActiveBookings) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete service while active bookings are pending.',
      });
    }

    const usedImages = [service.coverImage, ...service.images].filter(Boolean);
    for (const image of usedImages) {
      await deleteCloudinaryFile(image).catch(() => { });
    }

    await service.deleteOne();

    res.status(200).json({ message: 'Service deleted successfully.' });

  } catch (err) {
    console.error('Failed to delete service:', err.message);
    res.status(500).json({ error: 'Failed to delete service.' });
  }
};

exports.updateService = async (req, res) => {
  try {
    const userId = req.user._id;
    const serviceId = req.params.id;

    const service = await Service.findOne({ _id: serviceId, ownerId: userId });
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    const business = await Business.findOne({ _id: service.businessId, owner: userId })
      .select('_id isActive isApproved owner');

    const subscription = await Subscription.findOne({
      userId,
      status: 'active',
      endDate: { $gte: new Date() },
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.status(403).json({ message: 'Valid subscription not found.' });
    }

    const subscriptionPlan = await SubscriptionPlan.findById(subscription.subscriptionPlanId);
    const serviceLimit = subscriptionPlan?.limits?.serviceListings || 0;
    const galleryImageLimit = getGalleryImageLimit(subscriptionPlan);

    if (req.body.coverImage && req.body.coverImage !== service.coverImage) {
      await deleteCloudinaryFile(service.coverImage).catch(() => { });
    }

    if (Array.isArray(req.body.images) && Array.isArray(service.images)) {
      const removedImages = service.images.filter(img => !req.body.images.includes(img));
      for (const image of removedImages) {
        await deleteCloudinaryFile(image).catch(() => { });
      }
    }

    const requestedPublish =
      req.body.isPublished === true || req.body.isPublished === 'true';

    let nextServices = service.services;
    if (req.body.services !== undefined) {
      const payload = normalizeServicePayload({
        ...req.body,
        services: req.body.services,
      });

      if (payload.normalizedServices.length === 0 && !requestedPublish) {
        nextServices = [];
        service.services = nextServices;
        service.price = 0;
        service.duration = '';
      } else {
        const childValidation = validateChildServices(payload.normalizedServices);
        if (!childValidation.ok) {
          return res.status(400).json(formatValidationErrorResponse(childValidation.fieldErrors));
        }

        const otherChildServiceCount = await getOwnerChildServiceCount(userId, service._id);
        if (otherChildServiceCount + payload.normalizedServices.length > serviceLimit) {
          return res.status(403).json({
            message: `Service listing limit reached. You can add only ${Math.max(serviceLimit - otherChildServiceCount, 0)} more child services.`,
          });
        }

        nextServices = payload.normalizedServices;
        service.services = nextServices;
        service.price = getMinimumChildServicePrice(nextServices, service.price);
        service.duration = '';
      }
    }

    const updatableFields = [
      'title', 'description', 'coverImage', 'images',
      'bookingToolLink', 'maxBookingsPerSlot', 'location', 'contact'
    ];

    for (const field of updatableFields) {
      if (req.body[field] !== undefined) {
        service[field] = req.body[field];
      }
    }

    if (req.body.amenities !== undefined) {
      service.amenities = normalizeAmenitiesList(req.body.amenities);
    }

    if (req.body.businessHours !== undefined) {
      service.businessHours = normalizeBusinessHoursForStorage(req.body.businessHours);
    }

    if (req.body.faq !== undefined) {
      service.faq = normalizeFaqList(req.body.faq);
    }

    const nextCategoryId = resolveTaxonomyIdFromBody(req.body, 'categoryId', 'category');
    if (nextCategoryId) {
      service.categoryId = nextCategoryId;
    }

    const nextSubcategoryId = resolveTaxonomyIdFromBody(req.body, 'subcategoryId', 'subcategory');
    if (nextSubcategoryId) {
      service.subcategoryId = nextSubcategoryId;
    }

    if (req.body.features !== undefined) {
      service.features = normalizeStringList(req.body.features);
    }

    if (req.body.title !== undefined) {
      service.title = String(req.body.title).trim() || 'Service';
    }

    if (req.body.description !== undefined) {
      service.description = String(req.body.description).trim();
    }

    if (req.body.isPublished !== undefined) {
      service.isPublished = requestedPublish;
    }

    const publishValidation = validatePublishRequest({
      isPublished: service.isPublished,
      normalizedServices: nextServices,
    });
    if (!publishValidation.ok) {
      return res.status(400).json(formatValidationErrorResponse(
        publishValidation.fieldErrors,
        publishValidation.message
      ));
    }

    const nextGalleryImages = req.body.images !== undefined ? req.body.images : service.images;
    if (countGalleryImages(nextGalleryImages) > galleryImageLimit) {
      return res.status(400).json({
        message: `Service gallery can have maximum ${galleryImageLimit} images for your plan.`,
      });
    }

    if (req.body.location?.address) {
      service.location = req.body.location.address;
      if (service.contact) {
        service.contact.address = req.body.location.address;
      }
    }

    await service.save();

    const refreshedService = await Service.findById(service._id)
      .populate('categoryId', 'name')
      .populate('subcategoryId', 'name');

    return res.status(200).json(
      formatOwnerServiceResponse(refreshedService, business, 'Service updated successfully')
    );

  } catch (error) {
    console.error('Service update error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getServiceById = async (req, res) => {
  try {
    const userId = req.user._id;
    const serviceId = req.params.id;

    const service = await Service.findOne({
      _id: serviceId,
      ownerId: userId
    })
      .populate('categoryId', 'name')
      .populate('subcategoryId', 'name')
      .populate('ownerId', 'name email');

    if (!service) {
      return res.status(404).json({
        message: 'Service not found or unauthorized.'
      });
    }

    const business = await Business.findOne({ _id: service.businessId, owner: userId })
      .select('_id isActive isApproved owner');

    return res.status(200).json(
      formatOwnerServiceResponse(service, business)
    );

  } catch (err) {
    console.error('Failed to fetch service:', err.message);
    res.status(500).json({
      message: 'Internal server error'
    });
  }
};

exports.getPrivateBusinessServiceByBusinessId = async (req, res) => {
  try {
    const userId = req.user._id;
    const { businessId } = req.params;

    const business = await Business.findOne({ _id: businessId, owner: userId })
      .select('_id isActive isApproved owner businessName name');

    if (!business) {
      return res.status(403).json({
        success: false,
        message: 'You do not own this business.',
      });
    }

    const service = await Service.findOne({ businessId, ownerId: userId })
      .sort({ createdAt: -1 })
      .populate('categoryId', 'name')
      .populate('subcategoryId', 'name')
      .populate('businessId', 'businessName name owner isActive isApproved');

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service draft not found for this business.',
      });
    }

    const response = formatOwnerServiceResponse(
      service,
      business,
      'Service draft retrieved successfully.'
    );

    return res.status(200).json({
      ...response,
      hasChildServices: Array.isArray(service.services) && service.services.length > 0,
    });
  } catch (err) {
    console.error('Failed to fetch private business service:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

exports.getBusinessServiceById = async (req, res) => {
  try {
    const { id } = req.params;
    const populateService = (query) =>
      query
        .populate('categoryId', 'name')
        .populate('subcategoryId', 'name')
        .populate('businessId', 'businessName owner');

    // Supports both serviceId and businessId on the same endpoint param.
    let service = await populateService(Service.findById(id));
    if (!service) {
      service = await populateService(
        Service.findOne({ businessId: id }).sort({ createdAt: -1 })
      );
    }

    if (!service) {
      return res.status(404).json({
        message: 'Business service not found.'
      });
    }

    const visibleBusiness = await Business.findOne({
      _id: service.businessId?._id,
      isActive: true,
    }).select('_id').lean();

    if (!visibleBusiness) {
      return res.status(404).json({
        message: 'Business service not found.'
      });
    }

    if (service.isPublished !== true) {
      return res.status(404).json({
        message: 'Business service not found.'
      });
    }

    const childServices = Array.isArray(service.services) ? service.services : [];
    const hasChildServices = childServices.length > 0;

    const mappedBusinessHours = normalizeBusinessHoursForOwnerResponse(service.businessHours);

    const serviceImages = normalizeImages({
      coverImage: service.coverImage,
      images: service.images,
    });

    const mappedService = {
      _id: service._id,
      title: service.title || '',
      description: service.description || '',
      price: typeof service.price === 'number' ? service.price : 0,
      duration: service.duration || '',
      categoryId: service.categoryId
        ? {
          _id: service.categoryId._id,
          name: service.categoryId.name || ''
        }
        : null,
      subcategoryId: service.subcategoryId
        ? {
          _id: service.subcategoryId._id,
          name: service.subcategoryId.name || ''
        }
        : null,
      businessId: service.businessId
        ? {
          _id: service.businessId._id,
          name: service.businessId.businessName || service.businessId.name || '',
          owner: service.businessId.owner || null
        }
        : null,
      coverImage: service.coverImage || '',
      images: serviceImages.images,
      image: serviceImages.image,
      imageUrl: serviceImages.imageUrl,
      location: service.location || '',
      businessHours: mappedBusinessHours,
      bookingToolLink: service.bookingToolLink || '',
      features: Array.isArray(service.features) ? service.features : [],
      amenities: Array.isArray(service.amenities) ? service.amenities : [],
      faq: Array.isArray(service.faq) ? service.faq : [],
      services: childServices.map((item) => ({
        name: item.name || '',
        price: typeof item.price === 'number' ? item.price : 0,
        duration: item.duration || (item.durationMinutes ? `${item.durationMinutes} minutes` : ''),
        description: item.description || '',
        image: item.image || (Array.isArray(item.images) ? item.images[0] : '') || '',
        images: Array.isArray(item.images)
          ? item.images
          : (item.image ? [item.image] : [])
      })),
      isPublished: Boolean(service.isPublished),
      ownerId: service.ownerId,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt
    };

    return res.status(200).json({
      message: 'Business service retrieved successfully.',
      service: mappedService,
      hasChildServices
    });
  } catch (err) {
    console.error('Failed to fetch business service:', err.message);
    return res.status(500).json({
      message: 'Internal server error'
    });
  }
};



exports.getServiceUploadUrl = async (req, res) => {
  const uploadContext = {
    route: 'GET /api/service/upload-url',
    userId: req.user?._id ? String(req.user._id) : undefined,
    documentType: req.query?.documentType,
  };

  try {
    const userId = req.user._id;
    const { fileName, fileType, fileSize, documentType, serviceId, currentImageCount } = req.query;

    if (!fileName || !fileType || !documentType) {
      return res.status(400).json({
        success: false,
        message: "fileName, fileType, and documentType are required",
      });
    }

    // Allowed service image types
    const allowedDocTypes = [
      "service-cover",     // Main service cover/banner image
      "service-gallery"    // Service gallery images
    ];

    if (!allowedDocTypes.includes(documentType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid document type. Allowed: service-cover, service-gallery",
      });
    }

    // Validate file type (images only)
    const normalizedFileType = resolveImageS3UploadMimeType(fileType, fileName);
    if (!isAllowedImageS3UploadMimeType(fileType, fileName)) {
      return res.status(400).json({
        success: false,
        message: "Only image files are allowed (JPEG, JPG, PNG, GIF, WEBP)",
      });
    }

    const uploadSizeBytes = parseS3UploadSizeBytes(fileSize);
    if (Number.isNaN(uploadSizeBytes)) {
      return res.status(400).json({
        success: false,
        message: "Invalid file size",
      });
    }

    if (uploadSizeBytes !== null && uploadSizeBytes > MAX_IMAGE_S3_UPLOAD_BYTES) {
      return res.status(400).json({
        success: false,
        message: `File must be under ${Math.round(MAX_IMAGE_S3_UPLOAD_BYTES / (1024 * 1024))}MB`,
        maxBytes: MAX_IMAGE_S3_UPLOAD_BYTES,
      });
    }

    if (documentType === "service-gallery") {
      const subscription = await Subscription.findOne({
        userId,
        status: 'active',
        endDate: { $gte: new Date() },
      }).sort({ createdAt: -1 });

      if (!subscription) {
        return res.status(403).json({
          success: false,
          message: 'Valid subscription not found.',
        });
      }

      const subscriptionPlan = await SubscriptionPlan.findById(subscription.subscriptionPlanId);
      const galleryImageLimit = getGalleryImageLimit(subscriptionPlan);
      const currentCount = Number(currentImageCount || 0);

      if (currentCount + 1 > galleryImageLimit) {
        return res.status(403).json({
          success: false,
          message: `Gallery image upload limit reached. Maximum ${galleryImageLimit} gallery images allowed for your plan.`,
        });
      }
    }

    const missingEnv = getMissingS3UploadEnvNames();
    if (missingEnv.length) {
      logUploadConfigFailure('service_presign', missingEnv, uploadContext);
      return res.status(503).json(buildUploadStorageConfigError(missingEnv));
    }

    const bucketName = process.env.AWS_S3_BUCKET;

    // Organize folder structure based on document type
    let folderPath;
    switch (documentType) {
      case "service-cover":
        // If serviceId provided, organize in service-specific folder
        if (serviceId) {
          folderPath = `services/${userId}/${serviceId}/cover`;
        } else {
          folderPath = `services/${userId}/covers/temp`;
        }
        break;
      case "service-gallery":
        if (serviceId) {
          folderPath = `services/${userId}/${serviceId}/gallery`;
        } else {
          folderPath = `services/${userId}/gallery/temp`;
        }
        break;
      default:
        folderPath = `services/${userId}/temp`;
    }

    // Clean filename and add timestamp to prevent collisions
    const cleanFileName = sanitizeS3UploadFileName(fileName);
    const timestamp = Date.now();
    const key = `${folderPath}/${timestamp}-${cleanFileName}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: normalizedFileType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: PRESIGNED_S3_UPLOAD_EXPIRES_IN_SECONDS,
    });

    // Construct public URL
    const region = process.env.AWS_REGION || 'us-east-1';
    const fileUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

    return res.json(buildUploadedMediaResponse({
      success: true,
      uploadUrl,
      fileUrl,
      documentType,
      key,
      ...buildPresignedS3UploadContract(normalizedFileType),
    }));

  } catch (error) {
    logUploadFailure('service_presign', error, uploadContext);
    return res.status(500).json({
      success: false,
      code: "UPLOAD_URL_GENERATION_FAILED",
      message: "Failed to generate upload URL",
    });
  }
};

