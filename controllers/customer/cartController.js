const Cart = require('../../models/Cart');
const CartItem = require('../../models/CartItem');
const Product = require('../../models/Product');
const ProductVariant = require('../../models/ProductVariant');
const Business = require('../../models/Business');
const {
    calculateShippingForVendor,
    normalizeDeliverySpeed,
} = require('../../utils/vendorShipping');
const {
    getResolvedTaxCategory,
    getTaxRateForCategory,
    buildTaxAwareAmounts,
    extractTaxFromInclusiveAmount,
} = require('../../utils/vendorTax');
const {
    getPublicMarketplaceBusinessBlock,
    isPublicMarketplaceBusiness,
} = require('../../lib/marketplace/businessEligibility');

const toNum = (value) => {
    if (value && typeof value === 'object' && value.$numberDecimal != null) {
        return Number(value.$numberDecimal);
    }
    return value == null ? null : Number(value);
};

const normalizeShipping = (shipping) => {
    if (!shipping) return null;

    return {
        standard: Number(shipping.standard || 0),
        overnight: Number(shipping.overnight || 0),
        local: Number(shipping.local || 0),
    };
};

const getEffectiveShipping = (productDoc, variantDoc) => {
    const variantShipping = normalizeShipping(variantDoc?.shipping);
    const productShipping = normalizeShipping(productDoc?.shipping);

    if (variantShipping && Object.values(variantShipping).some((value) => value > 0)) {
        return variantShipping;
    }

    return productShipping || { standard: 0, overnight: 0, local: 0 };
};

const resolveRequestedShippingMethod = (body) => {
    return body?.shippingMethod || body?.shippingType || body?.shippingOption || body?.shipping?.method || body?.shipping?.type || null;
};

const resolveRequestedDeliverySpeed = (source) => {
    return normalizeDeliverySpeed(
        source?.deliverySpeed ||
        source?.selectedDeliverySpeed ||
        source?.deliveryOption ||
        source?.speed ||
        source?.shippingMethod ||
        source?.shippingType ||
        source?.shippingOption ||
        source?.shipping?.deliverySpeed ||
        source?.shipping?.selectedDeliverySpeed ||
        source?.shipping?.speed ||
        source?.shipping?.method ||
        source?.shipping?.type
    );
};

const resolveShippingSelection = (productDoc, variantDoc, requestedMethod) => {
    const shipping = getEffectiveShipping(productDoc, variantDoc);
    const requested = requestedMethod ? String(requestedMethod).trim().toLowerCase() : 'standard';
    const validMethods = ['standard', 'overnight', 'local'];

    if (!validMethods.includes(requested)) {
        return null;
    }

    const charge = Number(shipping[requested] || 0);
    return {
        shipping,
        shippingMethod: requested,
        shippingCharge: charge,
    };
};

const buildCartPricing = async ({ cartDoc, items, deliverySpeed, businessDoc }) => {
    const subtotalAmount = items.reduce(
        (sum, item) => sum + (Number(item.lineTotalAmount || 0)),
        0
    );
    const subtotalExclTaxAmount = items.reduce(
        (sum, item) => sum + (Number(item.lineBaseAmount || 0)),
        0
    );
    const taxTotal = items.reduce(
        (sum, item) => sum + (Number(item.lineTaxAmount || 0)),
        0
    );
    const totalQuantity = items.reduce(
        (sum, item) => sum + (Number(item.quantity) || 0),
        0
    );

    const business = businessDoc || (cartDoc?.businessId
        ? await Business.findById(cartDoc.businessId)
            .select('businessName slug shippingSettings taxSettings owner')
            .lean()
        : null);

    let shipping = null;
    let shippingError = null;

    if (business?.shippingSettings?.method && totalQuantity > 0) {
        try {
            const shippingResult = calculateShippingForVendor(
                business.shippingSettings,
                {
                    deliverySpeed,
                    subtotal: subtotalAmount,
                    totalQuantity,
                }
            );

            shipping = {
                deliverySpeed: shippingResult.deliverySpeed,
                amount: Number(shippingResult.amount || 0),
                method: shippingResult.method,
                freeShippingApplied: Boolean(shippingResult.freeShippingApplied),
                freeShippingThreshold: shippingResult.freeShippingThreshold,
                matchedTier: shippingResult.matchedTier,
            };
        } catch (error) {
            shippingError = error.message;
        }
    } else if (totalQuantity > 0) {
        shippingError = 'Vendor shipping settings are not configured';
    }

    const shippingAmount = Number(shipping?.amount || 0);

    return {
        business: business
            ? {
                _id: business._id,
                businessName: business.businessName,
                slug: business.slug,
            }
            : null,
        availableDeliverySpeeds: ['standard', 'express', 'local'],
        selectedDeliverySpeed: deliverySpeed,
        subtotalAmount,
        subtotalExclTaxAmount,
        taxTotal,
        taxIncluded: true,
        totalQuantity,
        shipping,
        shippingError,
        totalAmount: subtotalAmount + shippingAmount,
        currency: 'USD',
    };
};

const getVariantAttribute = (variantDoc, key) => {
    if (!variantDoc?.attributes) return null;

    if (typeof variantDoc.attributes.get === 'function') {
        const direct = variantDoc.attributes.get(key);
        if (direct != null) return direct;

        const fallbackKey = Array.from(variantDoc.attributes.keys()).find(
            (attrKey) => String(attrKey).toLowerCase() === String(key).toLowerCase()
        );
        return fallbackKey ? variantDoc.attributes.get(fallbackKey) : null;
    }

    const entries = Object.entries(variantDoc.attributes);
    const match = entries.find(([attrKey]) => String(attrKey).toLowerCase() === String(key).toLowerCase());
    return match ? match[1] : null;
};

const resolveVariantSelection = (variantDoc, requestedValue) => {
    const requested = requestedValue == null ? '' : String(requestedValue).trim();
    const sizes = Array.isArray(variantDoc?.sizes) ? variantDoc.sizes : null;

    if (sizes) {
        const selectedSize = sizes.find((entry) => String(entry.size) === requested);
        if (!selectedSize) return null;

        return {
            key: String(selectedSize.size),
            stock: Number(selectedSize.stock || 0),
            sku: selectedSize.sku || variantDoc.sku || null,
            price: toNum(selectedSize.price),
            salePrice: toNum(selectedSize.salePrice),
            discountEndDate: selectedSize.discountEndDate || null,
            allowBackorder: Boolean(variantDoc.allowBackorder),
        };
    }

    const attributeSize = getVariantAttribute(variantDoc, 'size');
    const normalizedKey = requested || attributeSize || 'default';

    if (attributeSize && requested && String(attributeSize).toLowerCase() !== requested.toLowerCase()) {
        return null;
    }

    return {
        key: String(normalizedKey),
        stock: Number(variantDoc?.stock || 0),
        sku: variantDoc?.sku || null,
        price: toNum(variantDoc?.price),
        salePrice: toNum(variantDoc?.salePrice),
        discountEndDate: null,
        allowBackorder: Boolean(variantDoc?.allowBackorder),
    };
};

// Add Item to Cart
const addItemToCart = async (req, res) => {
    const { productId, variantId, quantity, variant } = req.body;
    const userId = req.user._id;

    try {
        const qty = Number(quantity) || 1;
        if (qty < 1) return res.status(400).json({ message: 'Quantity must be at least 1' });

        const requestedSize = typeof variant === 'string' ? variant : variant?.size;
        if (!requestedSize) {
            return res.status(400).json({ message: 'Selected variant size/color not found' });
        }

        // Product validity
        const product = await Product.findById(productId);
        if (!product || !product.isPublished || product.isDeleted) {
            return res.status(400).json({ message: 'Product is not available (unpublished or deleted)' });
        }

        // Variant validity (+ belongs to product if you want to enforce)
        const variantData = await ProductVariant.findById(variantId);
        if (!variantData || !variantData.isPublished || variantData.isDeleted) {
            return res.status(400).json({ message: 'Product variant is not available (unpublished or deleted)' });
        }
        // Optional: ensure variant belongs to product
        // if (!variantData.productId.equals(product._id)) {
        //   return res.status(400).json({ message: 'Variant does not belong to product' });
        // }

        const selectedVariant = resolveVariantSelection(variantData, requestedSize);
        if (!selectedVariant) {
            return res.status(400).json({ message: 'Selected variant size/color not found' });
        }

        const shippingSelection = resolveShippingSelection(
            product,
            variantData,
            resolveRequestedShippingMethod(req.body)
        );
        if (!shippingSelection) {
            return res.status(400).json({ message: 'Invalid shipping method selected' });
        }

        // Stock / backorder checks on ADD
        if (qty > selectedVariant.stock && !selectedVariant.allowBackorder) {
            return res.status(422).json({ message: `Not enough stock. Only ${selectedVariant.stock} left.` });
        }

        // Determine business via product (safer)
        const businessId = product.businessId;
        const business = await Business.findById(businessId)
            .select('isApproved isActive businessName')
            .lean();
        const marketplaceBlock = getPublicMarketplaceBusinessBlock(business, {
            ineligibleMessage:
                'This vendor is not approved and active for the public marketplace.',
        });
        if (marketplaceBlock) {
            return res.status(marketplaceBlock.status).json({
                message: marketplaceBlock.message,
            });
        }

        // Find or create user's cart
        let cart = await Cart.findOne({ userId: req.user._id });

        let reset = false;
        if (!cart) {
            cart = new Cart({ userId, businessId, items: [], totalItems: 0 });
            await cart.save();
        }

        // If existing cart is for different business, reset it
        if (cart.businessId && !cart.businessId.equals(businessId)) {
            await CartItem.deleteMany({ _id: { $in: cart.items } });
            cart.items = [];
            cart.totalItems = 0;
            cart.businessId = businessId;
            await cart.save();
            reset = true;
        }

        // Try to find an existing line (same product + variant + size)
        const existingLine = await CartItem.findOne({
            _id: { $in: cart.items },
            productId: product._id,
            variantId: variantData._id,
            variant: selectedVariant.key,
            shippingMethod: shippingSelection.shippingMethod,
        });

        if (existingLine) {
            const newQty = existingLine.quantity + qty;

            if (newQty > selectedVariant.stock && !selectedVariant.allowBackorder) {
                return res.status(422).json({ message: `Not enough stock. Only ${selectedVariant.stock} left.` });
            }

            existingLine.quantity = newQty;
            existingLine.shippingCharge = shippingSelection.shippingCharge;
            await existingLine.save();
        } else {
            // Create new line
            const cartItem = new CartItem({
                userId: req.user._id,
                productId: product._id,
                variantId: variantData._id,
                businessId,
                quantity: qty,
                variant: selectedVariant.key,
                shippingMethod: shippingSelection.shippingMethod,
                shippingCharge: shippingSelection.shippingCharge,
            });
            await cartItem.save();

            cart.items.push(cartItem._id);
            await cart.save();
        }

        // Recompute totalItems as sum of quantities
        const quantities = await CartItem.find({ _id: { $in: cart.items } }).select('quantity');
        const totalQty = quantities.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
        cart.totalItems = totalQty;
        await cart.save();

        return res.status(201).json({
            message: 'Item added to cart',
            reset,
            // Optional: include businessName for frontend toast
            // businessName: product.businessName || undefined,
            cart,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Error adding item to cart', error: err.message });
    }
};



// Get Cart
const getCart = async (req, res) => {
    try {
        const deliverySpeed = resolveRequestedDeliverySpeed({
            ...req.query,
            shipping: req.query,
        });

        // Fetch the cart for the user and populate CartItems with productId and variantId
        const cart = await Cart.findOne({ userId: req.user._id })
            .populate({
                path: 'items',
                populate: [
                    { path: 'productId', select: 'title coverImage shipping taxCategory isPublished isDeleted', match: { isPublished: true, isDeleted: false } },  // Populate product details (name, coverImage) and ensure it's published and not deleted
                    { path: 'variantId', select: 'attributes sku price salePrice stock color label sizes allowBackorder shipping isPublished isDeleted images', match: { isPublished: true, isDeleted: false } },  // Populate variant details and ensure it's published and not deleted
                ],
            });

        if (!cart) {
            return res.status(200).json({
                message: 'Cart retrieved successfully',
                cart: null,
            });
        }

        const cartBusinessIds = [...new Set(
            [
                cart.businessId,
                ...(Array.isArray(cart.items) ? cart.items.map((item) => item.businessId) : []),
            ]
                .filter(Boolean)
                .map(String)
        )];

        const businesses = cartBusinessIds.length
            ? await Business.find({ _id: { $in: cartBusinessIds } })
                .select('businessName slug shippingSettings taxSettings owner isApproved isActive')
                .lean()
            : [];

        const businessById = new Map(
            businesses.map((business) => [String(business._id), business])
        );
        const businessDoc = cart.businessId
            ? businessById.get(String(cart.businessId)) || null
            : null;

        const invalidItems = [];
        const removedItems = [];

        // Map the cart items to include only the necessary data for the frontend
        const cartItems = cart.items.map(cartItem => {
            const variant = cartItem.variantId;  // Already populated
            const product = cartItem.productId;  // Already populated

            // Check if the product and variant are valid (published and not deleted)
            if (!product || !variant) {
                // If the product or variant is invalid, remove the cart item
                invalidItems.push(cartItem._id);  // Track the invalid item
                removedItems.push({
                    cartItemId: cartItem._id,
                    productId: cartItem.productId?._id || cartItem.productId || null,
                    reason: 'unavailable_listing',
                });
                return null; // Return null to exclude this item from the response
            }

            const itemBusiness = businessById.get(String(cartItem.businessId || cart.businessId));
            if (!isPublicMarketplaceBusiness(itemBusiness)) {
                invalidItems.push(cartItem._id);
                removedItems.push({
                    cartItemId: cartItem._id,
                    productId: product._id,
                    businessId: cartItem.businessId,
                    reason: 'ineligible_vendor',
                    message: 'Vendor is not approved and active for the public marketplace.',
                });
                return null;
            }

            const selectedVariant = resolveVariantSelection(variant, cartItem.variant);
            if (!selectedVariant) {
                // If size not found in the variant, remove the cart item
                invalidItems.push(cartItem._id);
                removedItems.push({
                    cartItemId: cartItem._id,
                    productId: product._id,
                    businessId: cartItem.businessId,
                    reason: 'unavailable_variant_selection',
                });
                return null; // Exclude this item from the response
            }

            const discountEnd = selectedVariant.discountEndDate ? new Date(selectedVariant.discountEndDate) : null;
            const useSale = !!selectedVariant.salePrice && (!discountEnd || discountEnd.getTime() > Date.now());

            const priceExclTax = toNum(selectedVariant.price);
            const salePriceExclTax = toNum(selectedVariant.salePrice);
            const taxCategory = getResolvedTaxCategory(product);
            const taxRate = getTaxRateForCategory(businessDoc?.taxSettings, taxCategory);
            const taxPricing = buildTaxAwareAmounts({
                priceExclTax,
                salePriceExclTax,
                taxRate,
            });
            const selectedSizePrice = useSale
                ? (taxPricing.salePriceInclTax ?? taxPricing.priceInclTax ?? 0)
                : (taxPricing.priceInclTax ?? 0);
            const selectedSizePriceExclTax = useSale
                ? (taxPricing.salePriceExclTax ?? taxPricing.priceExclTax ?? 0)
                : (taxPricing.priceExclTax ?? 0);
            const lineAmounts = extractTaxFromInclusiveAmount({
                inclusiveAmount: selectedSizePrice * Number(cartItem.quantity || 0),
                taxRate,
            });
            const shipping = getEffectiveShipping(product, variant);
            const shippingMethod = ['standard', 'overnight', 'local'].includes(cartItem.shippingMethod)
                ? cartItem.shippingMethod
                : 'standard';
            const shippingCharge = (() => {
                const stored = cartItem.shippingCharge != null ? Number(cartItem.shippingCharge) : null;
                // Only trust a stored value that is genuinely > 0.
                // A value of 0 usually means the item was synced from a guest cart without a charge.
                if (stored !== null && stored > 0) return stored;
                return Number(shipping[shippingMethod] || 0);
            })();


            // Return only necessary details (price is calculated on the frontend)
            return {
                title: product.title,
                productId: product._id,
                variantId: variant._id,
                businessId: cartItem.businessId,
                quantity: cartItem.quantity,
                size: selectedVariant.key,
                color: variant.color || getVariantAttribute(variant, 'color'),
                label: variant.label || selectedVariant.key,
                stock: selectedVariant.stock,
                sku: selectedVariant.sku,
                salePrice: taxPricing.salePriceInclTax,
                discountEndDate: selectedVariant.discountEndDate,
                price: taxPricing.priceInclTax,
                priceExclTax: taxPricing.priceExclTax,
                priceInclTax: taxPricing.priceInclTax,
                salePriceExclTax: taxPricing.salePriceExclTax,
                salePriceInclTax: taxPricing.salePriceInclTax,
                selectedSizePrice,  // Effective customer-facing tax-inclusive price
                selectedSizePriceExclTax,
                selectedSizePriceInclTax: selectedSizePrice,
                taxIncluded: true,
                taxRate,
                taxCategory,
                lineBaseAmount: lineAmounts.amountExclTax,
                lineTaxAmount: lineAmounts.taxAmount,
                lineTotalAmount: lineAmounts.amountInclTax,
                shippingMethod,
                shippingCharge,
                imageUrl: Array.isArray(variant.images) ? variant.images[0] : null,
                allowBackorder: selectedVariant.allowBackorder,
            };
        });

        const items = cartItems.filter(item => item !== null);
        const totalItems = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

        // Remove invalid items from the cart
        if (invalidItems.length > 0) {
            await CartItem.deleteMany({ _id: { $in: invalidItems } });  // Remove invalid items
            await Cart.updateOne(
                { _id: cart._id },
                {
                    $pull: { items: { $in: invalidItems } },
                    $set: { totalItems },
                }
            );
        }

        const pricing = await buildCartPricing({
            cartDoc: cart,
            items,
            deliverySpeed,
            businessDoc,
        });

        const removedForIneligibleVendor = removedItems.some(
            (item) => item.reason === 'ineligible_vendor'
        );

        return res.status(200).json({
            message: invalidItems.length > 0
                ? (removedForIneligibleVendor
                    ? 'Some items were removed from the cart because their vendor is no longer approved and active.'
                    : 'Some items were removed from the cart as they were unpublished or deleted.')
                : 'Cart retrieved successfully',
            cart: {
                ...cart.toObject(),
                items,  // Filter out the null values (removed items)
                totalItems,
                removedItems,
                pricing,
            },
        });
    } catch (err) {
        return res.status(500).json({ message: 'Error fetching cart', error: err.message });
    }
};


// Update Cart Item
const updateCartItem = async (req, res) => {
    const { cartItemId } = req.params;
    const { quantity } = req.body;

    try {
        const qty = Number(quantity);
        if (!Number.isFinite(qty) || qty < 1) {
            return res.status(400).json({ message: 'Quantity must be at least 1' });
        }

        const cartItem = await CartItem.findById(cartItemId);
        if (!cartItem) {
            return res.status(404).json({ message: 'Cart item not found' });
        }

        // Ensure the cart item belongs to the current user
        const cart = await Cart.findOne({ userId: req.user._id });
        if (!cart || !cart.items.some(id => id.equals(cartItem._id))) {
            return res.status(400).json({ message: 'Cart item does not belong to the user' });
        }

        // Product/Variant validity
        const product = await Product.findById(cartItem.productId);
        if (!product || !product.isPublished || product.isDeleted) {
            return res.status(400).json({ message: 'Product is not available (unpublished or deleted)' });
        }

        const variantData = await ProductVariant.findById(cartItem.variantId);
        if (!variantData || !variantData.isPublished || variantData.isDeleted) {
            return res.status(400).json({ message: 'Product variant is not available (unpublished or deleted)' });
        }

        // Size lookup (cartItem.variant is the size string)
        const selectedVariant = resolveVariantSelection(variantData, cartItem.variant);
        if (!selectedVariant) {
            return res.status(400).json({ message: 'Variant size/color not found' });
        }

        // Stock / backorder (variant-level allowBackorder)
        if (qty > selectedVariant.stock && !selectedVariant.allowBackorder) {
            return res.status(422).json({ message: `Not enough stock for the selected variant. Only ${selectedVariant.stock} left.` });
        }

        // Update quantity
        cartItem.quantity = qty;
        await cartItem.save();

        // Recompute totalItems as sum of quantities
        const quantities = await CartItem.find({ _id: { $in: cart.items } }).select('quantity');
        const totalQty = quantities.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
        cart.totalItems = totalQty;
        await cart.save();

        return res.status(200).json({ message: 'Cart item updated successfully', cart });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Error updating cart item', error: err.message });
    }
};



// Remove Item from Cart
const removeItemFromCart = async (req, res) => {
    const { cartItemId } = req.params;
    const userId = req.user._id;

    try {
        // Find the cart item by ID
        const cartItem = await CartItem.findById(cartItemId);

        if (!cartItem) {
            return res.status(404).json({ message: 'Cart item not found' });
        }

        // Ensure the cart item belongs to the current user
        const cart = await Cart.findOne({ userId });
        const ownsCartItem = cart?.items?.some((id) => String(id) === String(cartItem._id));
        if (!cart || !ownsCartItem) {
            return res.status(400).json({ message: 'Cart item does not belong to the user' });
        }

        cart.items.pull(cartItem._id);
        await cartItem.deleteOne();

        const quantities = await CartItem.find({ _id: { $in: cart.items } }).select('quantity');
        cart.totalItems = quantities.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
        await cart.save();

        return res.status(200).json({ message: 'Item removed from cart', cart });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Error removing item from cart', error: err.message });
    }
};




// UPDATE by composite key
const updateCartItemByComposite = async (req, res) => {
    try {
        const { productId, variantId, quantity } = req.body;
        const size = req.body.size || req.body?.variant?.size;
        const qty = Number(quantity);

        if (!productId || !variantId || !size) {
            return res.status(400).json({ message: 'productId, variantId and size are required' });
        }
        if (!Number.isFinite(qty) || qty < 1) {
            return res.status(400).json({ message: 'Quantity must be at least 1' });
        }

        // Load cart
        const cart = await Cart.findOne({ userId: req.user._id });
        if (!cart) return res.status(404).json({ message: 'Cart not found' });

        // Find the line item in this cart
        const line = await CartItem.findOne({
            _id: { $in: cart.items },
            productId,
            variantId,
            variant: size,
            ...(resolveRequestedShippingMethod(req.body) ? { shippingMethod: resolveRequestedShippingMethod(req.body) } : {}),
        });
        if (!line) return res.status(404).json({ message: 'Cart item not found' });

        // Validate product + variant
        const product = await Product.findById(line.productId);
        if (!product || !product.isPublished || product.isDeleted) {
            return res.status(400).json({ message: 'Product is not available (unpublished or deleted)' });
        }
        const variantData = await ProductVariant.findById(line.variantId);
        if (!variantData || !variantData.isPublished || variantData.isDeleted) {
            return res.status(400).json({ message: 'Product variant is not available (unpublished or deleted)' });
        }

        // Size + stock/backorder
        const selectedVariant = resolveVariantSelection(variantData, size);
        if (!selectedVariant) return res.status(400).json({ message: 'Variant size/color not found' });
        if (qty > selectedVariant.stock && !selectedVariant.allowBackorder) {
            return res.status(422).json({ message: `Not enough stock. Only ${selectedVariant.stock} left.` });
        }

        // Update quantity
        line.quantity = qty;
        await line.save();

        // Recompute totalItems = sum of quantities
        const quantities = await CartItem.find({ _id: { $in: cart.items } }).select('quantity');
        cart.totalItems = quantities.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
        await cart.save();

        return res.status(200).json({ message: 'Cart item updated successfully', cart });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Error updating cart item', error: err.message });
    }
};


// REMOVE by composite key
const removeItemByComposite = async (req, res) => {
    try {
        const { productId, variantId } = req.body;
        const size = req.body.size || req.body?.variant?.size;

        if (!productId || !variantId || !size) {
            return res.status(400).json({ message: 'productId, variantId and size are required' });
        }

        const cart = await Cart.findOne({ userId: req.user._id });
        if (!cart) return res.status(404).json({ message: 'Cart not found' });

        const line = await CartItem.findOne({
            _id: { $in: cart.items },
            productId,
            variantId,
            variant: size,
            ...(resolveRequestedShippingMethod(req.body) ? { shippingMethod: resolveRequestedShippingMethod(req.body) } : {}),
        });
        if (!line) return res.status(404).json({ message: 'Cart item not found' });

        // Remove from cart + delete line
        cart.items.pull(line._id);
        await cart.save();
        await line.deleteOne();

        // Recompute totalItems
        const quantities = await CartItem.find({ _id: { $in: cart.items } }).select('quantity');
        cart.totalItems = quantities.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
        await cart.save();

        return res.status(200).json({ message: 'Item removed from cart', cart });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Error removing item from cart', error: err.message });
    }
};





// Utility: collect IDs from query (?ids=a,b,c) or body {ids:[]}

function parseIds(req) {
    const ids = [];
    if (req.query.ids) ids.push(...String(req.query.ids).split(","));
    if (Array.isArray(req.body?.ids)) ids.push(...req.body.ids);
    return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function parseFilters(req) {
    // Accepts duplicates; we'll group by variantId
    const arr = Array.isArray(req.body?.filters) ? req.body.filters : [];
    const map = new Map(); // variantId -> Set(sizes)
    for (const f of arr) {
        if (!f?.variantId || !f?.size) continue;
        const vid = String(f.variantId);
        const size = String(f.size).toUpperCase();
        if (!map.has(vid)) map.set(vid, new Set());
        map.get(vid).add(size);
    }
    return map; // Map<string, Set<string>>
}

async function getVariantsMini(req, res, next) {
    try {
        const ids = parseIds(req);
        if (!ids.length) return res.json([]);

        const wantedByVariant = parseFilters(req); // Map<variantId, Set<sizes>>

        // IMPORTANT: no .lean() so toJSON() flattens Decimal128
        const docs = await ProductVariant.find({
            _id: { $in: ids },
            isDeleted: false,
            isPublished: true,
        })
            .select("_id productId label color allowBackorder images sizes")
            .exec();

        const variants = docs.map((d) => d.toJSON());

        const out = variants.map((v) => {
            const wanted = wantedByVariant.get(String(v._id)); // Set or undefined
            const sizes = Array.isArray(v.sizes) ? v.sizes : [];
            const filtered = wanted && wanted.size
                ? sizes.filter((s) => wanted.has(String(s.size).toUpperCase()))
                : sizes; // if no filter supplied, return all (backward compatible)
            return {
                _id: v._id,
                productId: v.productId,
                label: v.label,
                color: v.color,
                allowBackorder: v.allowBackorder,
                images: v.images,
                sizes: filtered,
            };
        });

        res.json(out);
    } catch (err) {
        next(err);
    }
}

/**
 * GET/POST /api/public/products/mini
 */
const getProductsMini = async (req, res, next) => {
    try {
        const ids = parseIds(req);
        if (!ids.length) return res.json([]);

        const products = await Product.find({
            _id: { $in: ids },
            isDeleted: false,
            isPublished: true,
        })
            .select("_id title coverImage businessId slug")
            .lean();

        const businessIds = [...new Set(
            products
                .map((product) => product.businessId?.toString())
                .filter(Boolean)
        )];

        const businesses = businessIds.length
            ? await Business.find({ _id: { $in: businessIds } })
                .select("_id businessName slug shippingSettings")
                .lean()
            : [];

        const businessById = new Map(
            businesses.map((business) => [String(business._id), business])
        );

        const out = products.map((product) => {
            const business = businessById.get(String(product.businessId)) || null;

            return {
                ...product,
                business: business
                    ? {
                        _id: business._id,
                        businessName: business.businessName,
                        slug: business.slug,
                        shippingSettings: business.shippingSettings || null,
                    }
                    : null,
                businessShippingSettings: business?.shippingSettings || null,
            };
        });

        res.json(out);
    } catch (err) {
        next(err);
    }
}

/**
 * GET/POST /api/public/variants/mini
 * Expects: ids[]=variantId, optional sizes filter: { variantId: "xxx", size: "SM" }
 */
// const getVariantsMini = async (req, res, next) => {
//     try {
//         const ids = parseIds(req);
//         if (!ids.length) return res.json([]);

//         const filters = parseFilters(req); // optional size filters per variant

//         // IMPORTANT: no .lean() so toJSON transform converts Decimal128
//         const docs = await ProductVariant.find({
//             _id: { $in: ids },
//             isDeleted: false,
//             isPublished: true,
//         })
//             .select("_id productId label color allowBackorder images sizes")
//             .exec();

//         // toJSON() applies your Decimal128 -> number conversion
//         const variants = docs.map((d) => d.toJSON());

//         const out = variants.map((v) => {
//             const f = filters.find((x) => String(x.variantId) === String(v._id));
//             const wantedSize = f?.size ? String(f.size).toUpperCase() : null;

//             return {
//                 _id: v._id,
//                 productId: v.productId,
//                 label: v.label,
//                 color: v.color,
//                 allowBackorder: v.allowBackorder,
//                 images: v.images,
//                 sizes: wantedSize
//                     ? (v.sizes || []).filter((s) => s.size === wantedSize)
//                     : v.sizes || [],
//             };
//         });

//         res.json(out);
//     } catch (err) {
//         next(err);
//     }
// }







async function destroyCart(cartDoc) {
    if (!cartDoc) return;
    if (Array.isArray(cartDoc.items) && cartDoc.items.length) {
        await CartItem.deleteMany({ _id: { $in: cartDoc.items } });
    }
    await Cart.deleteOne({ _id: cartDoc._id });
}

// ensure exactly ONE open cart (isBooked:false) per user, for the given businessId
// if an open cart exists for a different business, remove it and create a fresh one
async function ensureActiveCart(userId, businessId) {
    const openCarts = await Cart.find({ userId, isBooked: false });

    // try to keep the one matching this business
    let active = openCarts.find(c => String(c.businessId) === String(businessId));

    if (active) {
        // remove any other open carts
        const toRemove = openCarts.filter(c => String(c._id) !== String(active._id));
        for (const c of toRemove) await destroyCart(c);
        return active;
    }

    // no active cart for this business -> remove all others and create fresh
    for (const c of openCarts) await destroyCart(c);

    return await Cart.create({
        userId,
        businessId,
        items: [],
        totalItems: 0,
        isBooked: false,
    });
}

// recompute totalItems from referenced CartItem.quantity and persist on Cart
async function recalcCartTotals(cartId) {
    const cart = await Cart.findById(cartId).lean();
    if (!cart) return 0;

    const items = cart.items?.length
        ? await CartItem.find({ _id: { $in: cart.items } }, { quantity: 1 }).lean()
        : [];

    const total = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
    await Cart.updateOne({ _id: cartId }, { $set: { totalItems: total } });
    return total;
}

// ---- controllers ----

// GET /cart/count
// returns item count of the single open cart (isBooked:false) for the user
const getCount = async (req, res) => {
    try {
        const userId = req.user && req.user._id;
        if (!userId) return res.status(401).json({ error: "unauthorized" });

        const active = await Cart.findOne({ userId, isBooked: false }).lean();
        if (!active) return res.json({ count: 0 });

        const count = await recalcCartTotals(active._id);
        return res.json({ count });
    } catch (e) {
        console.error("getCount error:", e);
        return res.status(500).json({ error: "server_error" });
    }
};


async function ensureSingleActiveCartReplace(userId, businessId) {
    // find any open cart for the user
    let cart = await Cart.findOne({ userId, isBooked: false });

    // none -> create
    if (!cart) {
        return await Cart.create({
            userId,
            businessId,
            items: [],
            totalItems: 0,
            isBooked: false,
        });
    }

    // if cart is for a different business -> delete existing line items and reuse cart with new business
    if (String(cart.businessId) !== String(businessId)) {
        if (Array.isArray(cart.items) && cart.items.length) {
            await CartItem.deleteMany({ _id: { $in: cart.items } });
        }
        cart.items = [];
        cart.totalItems = 0;
        cart.businessId = businessId;
        await cart.save();

        // hygiene: if there are any OTHER open carts, remove them
        await Cart.deleteMany({ userId, isBooked: false, _id: { $ne: cart._id } });
    }

    return cart;
}

/**
 * Look up the product's effective per-item shipping rate for a given method.
 * Used during guest-cart merge where no shippingCharge was stored by the frontend.
 */
async function resolveShippingChargeForMerge(productId, variantId, shippingMethod) {
    try {
        const method = ['standard', 'overnight', 'local'].includes(shippingMethod)
            ? shippingMethod
            : 'standard';

        // Fetch variant shipping first (highest priority)
        if (variantId) {
            const variant = await ProductVariant.findById(variantId)
                .select('shipping')
                .lean();
            const variantShipping = normalizeShipping(variant?.shipping);
            if (variantShipping && variantShipping[method] > 0) {
                return variantShipping[method];
            }
        }

        // Fall back to product-level shipping
        const product = await Product.findById(productId)
            .select('shipping businessId')
            .lean();
        if (!product) return 0;

        const productShipping = normalizeShipping(product.shipping);
        if (productShipping && productShipping[method] > 0) {
            return productShipping[method];
        }

        // Last resort: business flat-rate settings
        const business = product.businessId
            ? await Business.findById(product.businessId)
                .select('shippingSettings')
                .lean()
            : null;

        const settings = business?.shippingSettings;
        if (!settings?.method || !settings?.flatRate) return 0;

        // map 'overnight' -> 'express' for flatRate key lookup
        const speedKey = method === 'overnight' ? 'express' : method;
        const rate = settings.flatRate[speedKey];
        return rate != null ? Number(rate) : 0;
    } catch {
        return 0;
    }
}

mergeGuestCart = async (req, res) => {
    try {
        const userId = req.user && req.user._id;
        if (!userId) return res.status(401).json({ message: "unauthorized" });

        const { businessId, items = [] } = req.body || {};
        if (!businessId) return res.status(400).json({ message: "businessId_required" });

        // ensure single active cart; clear & switch business if needed
        const cart = await ensureSingleActiveCartReplace(userId, businessId);

        // upsert items (productId + variantId + size unique within THIS cart)
        for (const it of items) {
            if (!it || !it.productId || !it.variantId) continue;
            // DB expects `variant` (string) - map incoming `size` -> `variant`
            const variantStr = String(it.size ?? it?.variant?.size ?? "").trim();
            if (!variantStr) continue;
            const inc = Math.max(1, Number(it.quantity || 1))
            const shippingMethod = resolveRequestedShippingMethod(it) || 'standard';

            const existing = await CartItem.findOne({
                _id: { $in: cart.items },
                productId: it.productId,
                variantId: it.variantId,
                variant: variantStr,
                shippingMethod,
                userId,                         // required by schema
                businessId: cart.businessId,    // required by schema
            });

            if (existing) {
                existing.quantity = Math.max(1, Number(existing.quantity || 0) + inc);
                // Recompute from product/business settings - never trust guest's stored 0
                existing.shippingCharge = await resolveShippingChargeForMerge(it.productId, it.variantId, shippingMethod);
                await existing.save();
            } else {
                const computedShipping = await resolveShippingChargeForMerge(it.productId, it.variantId, shippingMethod);
                const created = await CartItem.create({
                    productId: it.productId,
                    variantId: it.variantId,
                    businessId: cart.businessId, // required
                    userId,                      // required
                    variant: variantStr,         // required (string)
                    shippingMethod,
                    shippingCharge: computedShipping,   // computed from DB, not guest's 0
                    quantity: inc,
                });
                await Cart.updateOne({ _id: cart._id }, { $addToSet: { items: created._id } });
            }
        }

        const count = await recalcCartTotals(cart._id);
        return res.json({ count });
    } catch (e) {
        console.error("mergeGuestCart error:", e);
        return res.status(500).json({ message: "server_error" });
    }
};






module.exports = {
    getCart,
    addItemToCart,
    updateCartItem,
    removeItemFromCart,
    updateCartItemByComposite,
    removeItemByComposite,
    getProductsMini,
    getVariantsMini,
    getCount,
    mergeGuestCart
};
