#!/usr/bin/env node
/**
 * One-time cleanup: unpublish live listings with missing or zero effective price.
 *
 * Usage:
 *   node scripts/unpublish-unpriced-listings.js --dry-run
 *   node scripts/unpublish-unpriced-listings.js --apply
 */

require('dotenv').config();

const mongoose = require('mongoose');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const Service = require('../models/Service');
const Food = require('../models/Food');
const {
  productHasPublishablePrice,
  serviceHasPublishablePrice,
  foodHasPublishablePrice,
} = require('../lib/marketplace/listingPricePolicy');

const mode = process.argv.includes('--apply') ? 'apply' : 'dry-run';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const [products, services, foods, variants] = await Promise.all([
    Product.find({ isPublished: true, isDeleted: { $ne: true } }).lean(),
    Service.find({ isPublished: true }).lean(),
    Food.find({ isPublished: true }).lean(),
    ProductVariant.find({ isDeleted: { $ne: true } }).select('productId price salePrice isPublished isDeleted').lean(),
  ]);

  const variantsByProduct = new Map();
  for (const variant of variants) {
    const productId = String(variant.productId);
    if (!variantsByProduct.has(productId)) variantsByProduct.set(productId, []);
    variantsByProduct.get(productId).push(variant);
  }

  const badProducts = products.filter((product) =>
    !productHasPublishablePrice({
      ...product,
      variants: variantsByProduct.get(String(product._id)) || [],
    })
  );
  const badServices = services.filter((service) => !serviceHasPublishablePrice(service));
  const badFoods = foods.filter((food) => !foodHasPublishablePrice(food));

  const summary = {
    mode,
    badProducts: badProducts.map((item) => ({ id: String(item._id), title: item.title })),
    badServices: badServices.map((item) => ({ id: String(item._id), title: item.title })),
    badFoods: badFoods.map((item) => ({ id: String(item._id), title: item.title })),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (mode !== 'apply') {
    console.log('Dry run only. Re-run with --apply to unpublish these listings.');
    await mongoose.disconnect();
    return;
  }

  const [productResult, serviceResult, foodResult] = await Promise.all([
    badProducts.length
      ? Product.updateMany(
          { _id: { $in: badProducts.map((item) => item._id) } },
          { $set: { isPublished: false } }
        )
      : { modifiedCount: 0 },
    badServices.length
      ? Service.updateMany(
          { _id: { $in: badServices.map((item) => item._id) } },
          { $set: { isPublished: false } }
        )
      : { modifiedCount: 0 },
    badFoods.length
      ? Food.updateMany(
          { _id: { $in: badFoods.map((item) => item._id) } },
          { $set: { isPublished: false } }
        )
      : { modifiedCount: 0 },
  ]);

  console.log(
    JSON.stringify(
      {
        applied: true,
        modifiedProducts: productResult.modifiedCount || 0,
        modifiedServices: serviceResult.modifiedCount || 0,
        modifiedFoods: foodResult.modifiedCount || 0,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
