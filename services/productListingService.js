// services/productListingService.js
const mongoose = require('mongoose');
const Product = require('../models/Product');

/** Safely coerce to ObjectId (null if invalid) */
const toOid = (v) => (mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(v) : null);

/**
 * Fetch products eligible for ranking (API-level filtered).
 * - Product: published & not deleted (+ optional brand/minorityType filters)
 * - Variant: published & not deleted & (allowBackorder || stock > 0)
 *            and optionally constrained to a specific `size`
 * - Business: active
 * - Subscription: status=active AND endDate > now
 *
 * Adds `firstEligible` to each item:
 *   {
 *     variantId, label, color, images, videos,
 *     averageRating, totalReviews, allowBackorder, totalStock,
 *     size, price, salePrice|null, discountEndDate|null,
 *     onSale: boolean, effectivePrice
 *   }
 *
 * @param {Object} params
 * @param {string} [params.categoryId]
 * @param {string} [params.subcategoryId]
 * @param {string} [params.excludeProductId]
 * @param {string} [params.brand]          // case-insensitive match on Product.brand
 * @param {string} [params.minorityType]   // case-insensitive match on Product.minorityType
 * @param {string} [params.size]           // filters variants to sizes.size === SIZE (e.g., "M")
 * @param {number} [params.fetchLimit=240]
 */
async function fetchEligibleProducts({
  categoryId,
  subcategoryId,
  excludeProductId,
  brand,
  minorityType,
  size,
  fetchLimit = 240
}) {
  const cat = categoryId ? toOid(categoryId) : null;
  const sub = subcategoryId ? toOid(subcategoryId) : null;
  const exclude = excludeProductId ? toOid(excludeProductId) : null;
  const sizeUpper = size ? String(size).toUpperCase() : null;

  // If caller passed an invalid ObjectId, return empty (avoid full scans).
  if ((categoryId && !cat) || (subcategoryId && !sub)) return [];

  // predictable, sane bounds
  const hardLimit = Math.max(50, Number(fetchLimit) || 240);     // cap on results after pipeline
  const scanLimit = Math.min(Math.max(50, hardLimit), 1000);     // cap BEFORE lookups (protects cluster)

  const match = {
    isPublished: true,
    isDeleted: false,
    isActive: { $ne: false },
    ...(cat ? { categoryId: cat } : {}),
    ...(sub ? { subcategoryId: sub } : {}),
    ...(exclude ? { _id: { $ne: exclude } } : {}),
    ...(brand ? { brand: { $regex: String(brand), $options: 'i' } } : {}),
    ...(minorityType ? { minorityType: { $regex: String(minorityType), $options: 'i' } } : {}),
  };

  const now = new Date(); // used in discountEndDate comparison and subscription endDate

  const pipeline = [
    { $match: match },

    // Keep working set “recent” and *bound it before heavy lookups*
    { $sort: { createdAt: -1, _id: -1 } },
    { $limit: scanLimit },

    // Variants: published & not deleted, then eligibility by sizes (+ optional size filter)
    {
      $lookup: {
        from: 'productvariants',
        let: { pid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$productId', '$$pid'] }, isPublished: true, isDeleted: false } },

          // Compute eligible sizes: (stock > 0 OR allowBackorder) AND (size == requested SIZE if provided)
          {
            $addFields: {
              eligibleSizes: {
                $filter: {
                  input: '$sizes',
                  as: 's',
                  cond: {
                    $and: [
                      { $or: [{ $gt: ['$$s.stock', 0] }, '$allowBackorder'] },
                      // inject optional size equality (built by Node when creating the pipeline)
                      ...(sizeUpper ? [{ $eq: ['$$s.size', sizeUpper] }] : [])
                    ]
                  }
                }
              }
            }
          },

          // Variant qualifies if it has at least one eligible size
          { $addFields: { eligibleSizeCount: { $size: '$eligibleSizes' } } },
          { $match: { eligibleSizeCount: { $gt: 0 } } },

          // totalStock across ALL sizes (not only eligibleSizes) — useful for UI badges
          {
            $addFields: {
              totalStock: {
                $sum: { $map: { input: '$sizes', as: 's', in: { $ifNull: ['$$s.stock', 0] } } }
              }
            }
          },

          // Take the first eligible size on this variant
          { $addFields: { firstEligibleSize: { $arrayElemAt: ['$eligibleSizes', 0] } } },

          // Keep minimal fields needed upstream + for firstEligible
          {
            $project: {
              _id: 1,
              label: 1,
              color: 1,
              images: 1,
              videos: 1,
              averageRating: 1,
              totalReviews: 1,
              allowBackorder: 1,
              totalStock: 1,
              firstEligibleSize: 1
            }
          }
        ],
        as: 'eligibleVariants'
      }
    },

    { $addFields: { eligibleVariantCount: { $size: '$eligibleVariants' } } },
    { $match: { eligibleVariantCount: { $gt: 0 } } },

    // Business must be active
    {
      $lookup: {
        from: 'businesses',
        localField: 'businessId',
        foreignField: '_id',
        as: 'biz',
        pipeline: [{ $project: { businessName: 1, isActive: 1, subscriptionId: 1 } }]
      }
    },
    { $unwind: '$biz' },
    { $match: { 'biz.isActive': true } },

    // Subscription must be active AND not expired (endDate > now)
    {
      $lookup: {
        from: 'subscriptions',
        localField: 'biz.subscriptionId',
        foreignField: '_id',
        as: 'sub',
        pipeline: [
          { $project: { status: 1, subscriptionPlanId: 1, endDate: 1 } },
          { $match: { status: 'active', endDate: { $gt: now } } }
        ]
      }
    },
    { $unwind: '$sub' },

    // Final projection (only what ranking & UI need)
    {
      $project: {
        _id: 1,
        title: 1,
        slug: 1,
        description: 1,
        coverImage: 1,
        businessId: 1,
        createdAt: 1,
        updatedAt: 1,
        categoryId: 1,
        subcategoryId: 1,

        // Variant rating rollups (pool-level)
        variantRatingAvg: { $avg: '$eligibleVariants.averageRating' },
        variantRatingCount: { $sum: '$eligibleVariants.totalReviews' },

        businessName: '$biz.businessName',
        planId: '$sub.subscriptionPlanId',

        // First eligible variant/size across variants, with proper sale logic
        firstEligible: {
          $let: {
            vars: {
              candidates: {
                $filter: {
                  input: '$eligibleVariants',
                  as: 'ev',
                  cond: { $ne: ['$$ev.firstEligibleSize', null] }
                }
              }
            },
            in: {
              $let: {
                vars: {
                  fev: { $arrayElemAt: ['$$candidates', 0] }
                },
                in: {
                  $cond: [
                    { $eq: ['$$fev', null] },
                    null,
                    {
                      $let: {
                        vars: {
                          rawDiscEnd: '$$fev.firstEligibleSize.discountEndDate',
                          rawSale: '$$fev.firstEligibleSize.salePrice',
                          rawPrice: '$$fev.firstEligibleSize.price'
                        },
                        in: {
                          $let: {
                            vars: {
                              discEnd: {
                                $cond: [
                                  {
                                    $and: [
                                      { $ifNull: ['$$rawDiscEnd', false] },
                                      { $ne: ['$$rawDiscEnd', ''] }
                                    ]
                                  },
                                  { $toDate: '$$rawDiscEnd' },
                                  null
                                ]
                              },
                              basePriceNum: { $toDouble: { $ifNull: ['$$rawPrice', 0] } },
                              salePriceNumTemp: {
                                $cond: [
                                  { $ne: ['$$rawSale', null] },
                                  { $toDouble: '$$rawSale' },
                                  null
                                ]
                              }
                            },
                            in: {
                              $let: {
                                vars: {
                                  saleValid: {
                                    $and: [
                                      { $ifNull: ['$$salePriceNumTemp', false] },
                                      { $gt: ['$$discEnd', now] }
                                    ]
                                  }
                                },
                                in: {
                                  variantId: '$$fev._id',
                                  label: '$$fev.label',
                                  color: '$$fev.color',
                                  images: '$$fev.images',
                                  videos: '$$fev.videos',
                                  averageRating: '$$fev.averageRating',
                                  totalReviews: '$$fev.totalReviews',
                                  allowBackorder: '$$fev.allowBackorder',
                                  totalStock: '$$fev.totalStock',
                                  size: '$$fev.firstEligibleSize.size',

                                  // Always return both base & sale fields + end date
                                  price: '$$basePriceNum',
                                  salePrice: { $cond: ['$$saleValid', '$$salePriceNumTemp', null] },
                                  discountEndDate: '$$discEnd',

                                  // Convenience
                                  onSale: '$$saleValid',
                                  effectivePrice: {
                                    $cond: ['$$saleValid', '$$salePriceNumTemp', '$$basePriceNum']
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  ]
                }
              }
            }
          }
        }
      }
    },

    // Hard cap on what flows to app layer (cheap now, but a nice guard)
    { $limit: hardLimit }
  ];

  // Use options argument for wide compatibility with Mongoose
  return Product.aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 4000 });
}

module.exports = { fetchEligibleProducts };
