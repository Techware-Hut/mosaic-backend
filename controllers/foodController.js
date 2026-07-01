const Food = require('../models/Food');
const Business = require('../models/Business');
const Subscription = require('../models/Subscription');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { hasActiveFoodBookings } = require('../utils/bookingDeleteGuards');
const {
  PRESIGNED_S3_UPLOAD_EXPIRES_IN_SECONDS,
  buildPresignedS3UploadContract,
  sanitizeS3UploadFileName,
} = require('../utils/s3PresignedUploadContract');

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

const normalizeMetaFields = (metaFields) => {
  if (!Array.isArray(metaFields)) return [];
  return metaFields
    .filter((item) => item && (item.key || item.value))
    .map((item) => ({
      key: String(item.key || '').trim(),
      value: String(item.value || '').trim(),
    }));
};

exports.createFood = async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      categoryId,
      subcategoryId,
      businessId,
      coverImage,
      images,
      menuImage,
      businessHours,
      bookingToolLink,
      metaFields,
      location,
      isPublished,
      foodType,
      brand,
    } = req.body;

    const userId = req.user._id;

    if (!categoryId || !subcategoryId || !businessId) {
      return res.status(400).json({
        error: 'categoryId, subcategoryId, and businessId are required.',
      });
    }

    const business = await Business.findOne({ _id: businessId, owner: userId });
    if (!business) {
      return res.status(403).json({ error: 'You do not own this business.' });
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
    const foodLimit = subscriptionPlan?.limits?.foodListings || 0;
    const galleryImageLimit = getGalleryImageLimit(subscriptionPlan);
    const existingFoodCount = await Food.countDocuments({ ownerId: userId });

    if (existingFoodCount >= foodLimit) {
      return res.status(403).json({
        error: `Food listing limit reached for your subscription. You can add up to ${foodLimit} foods.`,
      });
    }

    if (countGalleryImages(images) > galleryImageLimit) {
      return res.status(400).json({
        error: `Food gallery can have maximum ${galleryImageLimit} images for your plan.`,
      });
    }

    const food = new Food({
      title: title || 'Food',
      description: description || '',
      price: Number.isFinite(Number(price)) ? Number(price) : 0,
      categoryId,
      subcategoryId,
      businessId,
      businessName: business.businessName || '',
      minorityType: business.minorityType,
      ownerId: userId,
      coverImage: coverImage || '',
      images: Array.isArray(images) ? images.filter(Boolean) : [],
      menuImage: menuImage || '',
      businessHours: Array.isArray(businessHours) ? businessHours : [],
      bookingToolLink: bookingToolLink || '',
      metaFields: normalizeMetaFields(metaFields),
      location: location?.coordinates
  ? {
      type: 'Point',
      coordinates: location.coordinates,
      address: location.address || '',
    }
  : undefined,
      isPublished: Boolean(isPublished),
      foodType: foodType || '',
      brand: brand || '',
    });

    await food.save();

    return res.status(201).json({
      message: 'Food created successfully.',
      food,
    });
  } catch (err) {
    console.error('Food creation failed:', err.message);
    return res.status(400).json({ error: err.message || 'Failed to create food.' });
  }
};

exports.getMyFoods = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const isPublished = req.query.isPublished;
    const categoryId = req.query.categoryId;
    const businessId = req.query.businessId;

    const filters = { ownerId: userId };
    if (isPublished === 'true') filters.isPublished = true;
    if (isPublished === 'false') filters.isPublished = false;
    if (categoryId) filters.categoryId = categoryId;
    if (businessId) filters.businessId = businessId;

    const foods = await Food.find(filters)
      .populate('categoryId', 'name')
      .populate('subcategoryId', 'name')
      .populate('businessId', 'businessName owner')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Food.countDocuments(filters);

    return res.status(200).json({
      foods,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('Failed to fetch foods:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to retrieve foods.' });
  }
};

exports.getBusinessFoodById = async (req, res) => {
  try {
    const { id } = req.params;

    const populateFood = (query) =>
      query
        .populate('categoryId', 'name')
        .populate('subcategoryId', 'name')
        .populate('businessId', 'businessName owner');

    let food = await populateFood(Food.findById(id));
    if (!food) {
      food = await populateFood(Food.findOne({ businessId: id }).sort({ createdAt: -1 }));
    }

    if (!food) {
      return res.status(404).json({ message: 'Business food not found.' });
    }

    const visibleBusiness = await Business.findOne({
      _id: food.businessId?._id,
      isActive: true,
    }).select('_id').lean();

    if (!visibleBusiness) {
      return res.status(404).json({ message: 'Business food not found.' });
    }

    const mappedFood = {
      _id: food._id,
      title: food.title || '',
      description: food.description || '',
      price: typeof food.price === 'number' ? food.price : 0,
      categoryId: food.categoryId
        ? { _id: food.categoryId._id, name: food.categoryId.name || '' }
        : null,
      subcategoryId: food.subcategoryId
        ? { _id: food.subcategoryId._id, name: food.subcategoryId.name || '' }
        : null,
      businessId: food.businessId
        ? {
            _id: food.businessId._id,
            name: food.businessId.businessName || '',
            owner: food.businessId.owner || null,
          }
        : null,
      coverImage: food.coverImage || '',
      images: Array.isArray(food.images) ? food.images : [],
      menuImage: food.menuImage || '',
      businessHours: Array.isArray(food.businessHours) ? food.businessHours : [],
      bookingToolLink: food.bookingToolLink || '',
      metaFields: Array.isArray(food.metaFields) ? food.metaFields : [],
      location: food.location || '',
      isPublished: Boolean(food.isPublished),
      ownerId: food.ownerId,
      createdAt: food.createdAt,
      updatedAt: food.updatedAt,
    };

    return res.status(200).json({
      message: 'Business food retrieved successfully.',
      food: mappedFood,
    });
  } catch (err) {
    console.error('Failed to fetch business food:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getFoodById = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const food = await Food.findOne({ _id: id, ownerId: userId })
      .populate('categoryId', 'name')
      .populate('subcategoryId', 'name')
      .populate('businessId', 'businessName owner');

    if (!food) {
      return res.status(404).json({ message: 'Food not found or unauthorized.' });
    }

    return res.status(200).json({ food });
  } catch (err) {
    console.error('Failed to fetch food:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateFood = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const food = await Food.findOne({ _id: id, ownerId: userId });
    if (!food) {
      return res.status(404).json({ message: 'Food not found.' });
    }

    const subscription = await Subscription.findOne({
      userId,
      status: 'active',
      endDate: { $gte: new Date() },
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.status(403).json({ message: 'Valid subscription not found.' });
    }

    const subscriptionPlan = await SubscriptionPlan.findById(subscription.subscriptionPlanId);
    const galleryImageLimit = getGalleryImageLimit(subscriptionPlan);
    const nextGalleryImages = req.body.images !== undefined ? req.body.images : food.images;

    if (countGalleryImages(nextGalleryImages) > galleryImageLimit) {
      return res.status(400).json({
        message: `Food gallery can have maximum ${galleryImageLimit} images for your plan.`,
      });
    }

    const updatableFields = [
      'title',
      'description',
      'price',
      'coverImage',
      'images',
      'menuImage',
      'businessHours',
      'bookingToolLink',
      'location',
      'isPublished',
      'foodType',
      'brand',
      'categoryId',
      'subcategoryId',
    ];

    updatableFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        food[field] = req.body[field];
      }
    });

    if (req.body.metaFields !== undefined) {
      food.metaFields = normalizeMetaFields(req.body.metaFields);
    }

    if (req.body.location?.address) {
      food.location = req.body.location.address;
    }

    if (Array.isArray(food.images)) {
      food.images = food.images.filter(Boolean);
    }

    await food.save();

    return res.status(200).json({
      message: 'Food updated successfully.',
      food,
    });
  } catch (err) {
    console.error('Food update failed:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteFood = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const food = await Food.findOne({ _id: id, ownerId: userId });
    if (!food) {
      return res.status(404).json({ message: 'Food not found or unauthorized.' });
    }

    const hasActiveBookings = await hasActiveFoodBookings({
      foodId: food._id,
      ownerId: userId,
    });

    if (hasActiveBookings) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete food item while active bookings are pending.',
      });
    }

    await food.deleteOne();

    return res.status(200).json({ message: 'Food deleted successfully.' });
  } catch (err) {
    console.error('Food deletion failed:', err.message);
    return res.status(500).json({ message: 'Failed to delete food.' });
  }
};

exports.getFoodUploadUrl = async (req, res) => {
  try {
    const userId = req.user._id;
    const { fileName, fileType, documentType, foodId, currentImageCount } = req.query;

    if (!fileName || !fileType || !documentType) {
      return res.status(400).json({
        message: 'fileName, fileType, and documentType are required',
      });
    }

    const allowedDocTypes = ['food-cover', 'food-gallery', 'food-menu'];
    if (!allowedDocTypes.includes(documentType)) {
      return res.status(400).json({
        message: 'Invalid document type. Allowed: food-cover, food-gallery, food-menu',
      });
    }

    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedMimeTypes.includes(fileType)) {
      return res.status(400).json({
        message: 'Only image files are allowed (JPEG, JPG, PNG, GIF, WEBP)',
      });
    }

    if (documentType === 'food-gallery') {
      const subscription = await Subscription.findOne({
        userId,
        status: 'active',
        endDate: { $gte: new Date() },
      }).sort({ createdAt: -1 });

      if (!subscription) {
        return res.status(403).json({
          message: 'Valid subscription not found.',
        });
      }

      const subscriptionPlan = await SubscriptionPlan.findById(subscription.subscriptionPlanId);
      const galleryImageLimit = getGalleryImageLimit(subscriptionPlan);
      const currentCount = Number(currentImageCount || 0);

      if (currentCount + 1 > galleryImageLimit) {
        return res.status(403).json({
          message: `Gallery image upload limit reached. Maximum ${galleryImageLimit} gallery images allowed for your plan.`,
        });
      }
    }

    const bucketName = process.env.AWS_S3_BUCKET;

    let folderPath;
    switch (documentType) {
      case 'food-cover':
        folderPath = foodId ? `foods/${userId}/${foodId}/cover` : `foods/${userId}/covers/temp`;
        break;
      case 'food-gallery':
        folderPath = foodId ? `foods/${userId}/${foodId}/gallery` : `foods/${userId}/gallery/temp`;
        break;
      case 'food-menu':
        folderPath = foodId ? `foods/${userId}/${foodId}/menu` : `foods/${userId}/menu/temp`;
        break;
      default:
        folderPath = `foods/${userId}/temp`;
    }

    const cleanFileName = sanitizeS3UploadFileName(fileName);
    const timestamp = Date.now();
    const key = `${folderPath}/${timestamp}-${cleanFileName}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: PRESIGNED_S3_UPLOAD_EXPIRES_IN_SECONDS,
    });
    const region = process.env.AWS_REGION || 'us-east-1';
    const fileUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

    return res.status(200).json({
      success: true,
      uploadUrl,
      fileUrl,
      documentType,
      key,
      ...buildPresignedS3UploadContract(fileType),
    });
  } catch (err) {
    console.error('Food presigned URL error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate upload URL',
    });
  }
};
