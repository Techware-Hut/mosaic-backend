# Tier Listing Limit Implementation

## Final Rule

Keep the implementation simple and enforce only these things:

1. Product quota should use:
   - main `Product` count
   - plus `ProductVariant` count

2. Service quota should use:
   - child service count inside `Service.services[]`

3. Food quota should use:
   - `Food` count

4. Image quota should use:
   - gallery images only

Do not restrict:

- `coverImage`
- product variant images
- food `menuImage`

## Tier Mapping

### Silver

- `productListings: 5`
- `serviceListings: 3`
- `foodListings: 3`
- `galleryImageLimit: 3`

### Gold

- `productListings: 10`
- `serviceListings: 5`
- `foodListings: 5`
- `galleryImageLimit: 5`

### Platinum

- `productListings: 20`
- `serviceListings: 10`
- `foodListings: 10`
- `galleryImageLimit: 7`

## What To Count

### Product usage

Product quota should be based on:

```text
total product usage = total Products + total ProductVariants
```

Example:

- 2 products
- 6 variants
- total product usage = `8`

So if vendor is on Silver plan with limit `5`, this should be blocked.

### Service usage

Service quota should be based on:

```text
total service usage = total child services across all parent Service documents
```

Example:

- parent service A has 2 child services
- parent service B has 3 child services
- total service usage = `5`

So if vendor is on Gold plan with limit `5`, next child service should be blocked.

The parent `Service` document itself should not consume the quota directly. Only child services should count.

### Food usage

Food quota should be based on:

```text
total food usage = total Food documents
```

### Gallery image usage

Only gallery arrays should be restricted:

- product: `galleryImages`
- service: `images`
- food: `images`

Do not count:

- product `coverImage`
- product variant `images`
- service `coverImage`
- child service `images`
- food `coverImage`
- food `menuImage`

## Where To Enforce

## 1. Product controller

File:

- [controllers/productController.js](/abs/path/c:/Users/Asus/OneDrive/Desktop/TWH-projects/mosiac-backend/controllers/productController.js:127)

Enforce before create:

- count total `Product`
- count total `ProductVariant`
- add both
- compare with `subscriptionPlan.limits.productListings`

Suggested logic:

```js
const productLimit = subscriptionPlan?.limits?.productListings || 0;

const productCount = await Product.countDocuments({
  businessId,
  isDeleted: false,
});

const variantCount = await ProductVariant.countDocuments({
  businessId,
  isDeleted: false,
});

const totalProductUsage = productCount + variantCount;

if (totalProductUsage >= productLimit) {
  return res.status(403).json({
    error: `Product listing limit reached. Your plan allows ${productLimit} total product/variant entries.`,
  });
}
```

Also enforce in:

- [controllers/productController.js](/abs/path/c:/Users/Asus/OneDrive/Desktop/TWH-projects/mosiac-backend/controllers/productController.js:960)

For `addVariants`, check:

```js
if (totalProductUsage + variants.length > productLimit) {
  return res.status(403).json({
    error: `Product listing limit reached. You can add only ${Math.max(productLimit - totalProductUsage, 0)} more product/variant entries.`,
  });
}
```

## 2. Product gallery image restriction

Restrict only:

- `galleryImages.length`

Do not restrict:

- `coverImage`
- `variant.images`

Suggested logic:

```js
const galleryImageLimit = subscriptionPlan?.limits?.galleryImageLimit
  ?? subscriptionPlan?.limits?.imageLimit
  ?? 0;

const galleryCount = Array.isArray(galleryImages)
  ? galleryImages.filter(Boolean).length
  : 0;

if (galleryCount > galleryImageLimit) {
  return res.status(400).json({
    error: `Product gallery can have maximum ${galleryImageLimit} images for your plan.`,
  });
}
```

Apply in:

- product create
- product update

No gallery-image plan check is needed in variant update, because variant images are excluded from this rule.

## 3. Service controller

File:

- [controllers/serviceController.js](/abs/path/c:/Users/Asus/OneDrive/Desktop/TWH-projects/mosiac-backend/controllers/serviceController.js:197)
- [controllers/serviceController.js](/abs/path/c:/Users/Asus/OneDrive/Desktop/TWH-projects/mosiac-backend/controllers/serviceController.js:510)
- [controllers/serviceController.js](/abs/path/c:/Users/Asus/OneDrive/Desktop/TWH-projects/mosiac-backend/controllers/serviceController.js:663)

Service quota should count child services only.

Suggested logic:

```js
const serviceLimit = subscriptionPlan?.limits?.serviceListings || 0;

const existingServices = await Service.find({ ownerId: userId }).select('services');

const currentChildServiceCount = existingServices.reduce((sum, item) => {
  return sum + (Array.isArray(item.services) ? item.services.length : 0);
}, 0);
```

For create:

```js
const newChildServiceCount = Array.isArray(services) ? services.length : 0;

if (currentChildServiceCount + newChildServiceCount > serviceLimit) {
  return res.status(403).json({
    error: `Service listing limit reached. You can add only ${Math.max(serviceLimit - currentChildServiceCount, 0)} more child services.`,
  });
}
```

For add child services:

```js
const incomingChildCount = Array.isArray(childServices) ? childServices.length : 0;

if (currentChildServiceCount + incomingChildCount > serviceLimit) {
  return res.status(403).json({
    error: `Service listing limit reached. You can add only ${Math.max(serviceLimit - currentChildServiceCount, 0)} more child services.`,
  });
}
```

## 4. Service gallery image restriction

Restrict only:

- `images.length`

Do not restrict:

- `coverImage`
- child service images

Suggested logic:

```js
const galleryImageLimit = subscriptionPlan?.limits?.galleryImageLimit
  ?? subscriptionPlan?.limits?.imageLimit
  ?? 0;

const galleryCount = Array.isArray(images)
  ? images.filter(Boolean).length
  : 0;

if (galleryCount > galleryImageLimit) {
  return res.status(400).json({
    error: `Service gallery can have maximum ${galleryImageLimit} images for your plan.`,
  });
}
```

Apply in:

- create parent service
- create service
- add child services if parent `images` is updated there
- update service

## 5. Food controller

File:

- [controllers/foodController.js](/abs/path/c:/Users/Asus/OneDrive/Desktop/TWH-projects/mosiac-backend/controllers/foodController.js:26)
- [controllers/foodController.js](/abs/path/c:/Users/Asus/OneDrive/Desktop/TWH-projects/mosiac-backend/controllers/foodController.js:238)

Food quota should count `Food` documents only.

Suggested logic:

```js
const foodLimit = subscriptionPlan?.limits?.foodListings || 0;

const foodCount = await Food.countDocuments({
  ownerId: userId,
});

if (foodCount >= foodLimit) {
  return res.status(403).json({
    error: `Food listing limit reached. You can add up to ${foodLimit} foods.`,
  });
}
```

## 6. Food gallery image restriction

Restrict only:

- `images.length`

Do not restrict:

- `coverImage`
- `menuImage`

Suggested logic:

```js
const galleryImageLimit = subscriptionPlan?.limits?.galleryImageLimit
  ?? subscriptionPlan?.limits?.imageLimit
  ?? 0;

const galleryCount = Array.isArray(images)
  ? images.filter(Boolean).length
  : 0;

if (galleryCount > galleryImageLimit) {
  return res.status(400).json({
    error: `Food gallery can have maximum ${galleryImageLimit} images for your plan.`,
  });
}
```

## 7. Upload URL endpoints

Restrict gallery upload URL generation only for:

- `product-gallery`
- `service-gallery`
- `food-gallery`

Do not restrict upload URL generation for:

- product cover
- product variant images
- service cover
- food cover
- food menu

Suggested check:

```js
const currentImageCount = Number(req.query.currentImageCount || 0);
const galleryImageLimit = subscriptionPlan?.limits?.galleryImageLimit
  ?? subscriptionPlan?.limits?.imageLimit
  ?? 0;

if (currentImageCount + 1 > galleryImageLimit) {
  return res.status(403).json({
    message: `Gallery image upload limit reached. Maximum ${galleryImageLimit} gallery images allowed for your plan.`,
  });
}
```

Apply in:

- [controllers/productController.js](/abs/path/c:/Users/Asus/OneDrive/Desktop/TWH-projects/mosiac-backend/controllers/productController.js:1286)
- [controllers/serviceController.js](/abs/path/c:/Users/Asus/OneDrive/Desktop/TWH-projects/mosiac-backend/controllers/serviceController.js:876)
- [controllers/foodController.js](/abs/path/c:/Users/Asus/OneDrive/Desktop/TWH-projects/mosiac-backend/controllers/foodController.js:314)

## Recommendation

Use this exact simple enforcement model:

1. Products use `Product + ProductVariant` count
2. Services use child service count
3. Foods use `Food` count
4. Gallery restriction applies only to gallery arrays

This is the clearest version of the rule based on what you asked for.
