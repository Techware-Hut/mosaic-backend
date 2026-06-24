const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const BusinessDraft = require("../models/BusinessDraft");
const SubscriptionPlan = require("../models/SubscriptionPlan");
const Subscription = require("../models/Subscription");
const Business = require("../models/Business");
const { sendWelcomeEmail } = require("../utils/WellcomeMailer");
const { ensurePlanPrice } = require('../helpers/stripePlan');
const { buildFrontendUrl } = require('../utils/frontendUrl');

exports.createCheckoutSession = async (req, res) => {
  try {
    const { draftId } = req.body;

    // ✅ 1. Find draft
    const draft = await BusinessDraft.findById(draftId);
    if (!draft) {
      return res
        .status(404)
        .json({ message: "Business draft not found or expired." });
    }

    // ✅ 2. Validate Stripe Price ID
    const plan = await SubscriptionPlan.findById(draft.subscriptionPlanId);
    if (!plan) return res.status(400).json({ message: 'Invalid subscription plan selected' });

    // Make sure the plan has a Stripe price (create if missing)
    const { priceId } = await ensurePlanPrice(plan);
    // ✅ 3. Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: draft.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: buildFrontendUrl("/partners"),
      cancel_url: buildFrontendUrl("/partners"),
      metadata: {
        draftId: draft._id.toString(),
        ownerId: draft.owner.toString(),
        planId: String(plan._id),
      },
    });

    res.status(200).json({ sessionUrl: session.url });
  } catch (error) {
    console.error("Stripe session creation failed:", error);
    res.status(500).json({ message: "Failed to create checkout session" });
  }
};

const endpointSecret = process.env.STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET;

exports.handleStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle successful checkout session completion
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { draftId, ownerId } = session.metadata;
    const stripeSubscriptionId = session.subscription;
    const stripeCustomerId = session.customer;

    console.log(
      `Processing checkout.session.completed for Draft ID: ${draftId}`
    );

    let newSubscription;
    let business;

    try {
      // Check if this subscription is already linked to a business
      const existingSubscription = await Subscription.findOne({
        stripeSubscriptionId,
      });
      if (existingSubscription && existingSubscription.businessId) {
        const existingBiz = await Business.findById(existingSubscription.businessId);
        if (existingBiz && !existingBiz.stripeCustomerId && stripeCustomerId) {
          existingBiz.stripeCustomerId = String(stripeCustomerId);
          await existingBiz.save();
        }
        console.error("This subscription is already linked to a business.");
        return res.status(400).send("This subscription is already linked to a business.");
      }


      // Find the draft
      const draft = await BusinessDraft.findById(draftId);
      if (!draft) {
        console.error(`Draft ${draftId} not found (possibly expired)`);
        return res.status(404).send("Draft not found");
      }

      console.log("Draft found for checkout completion", { draftId });

      // Set subscription start and end dates
      const startDate = new Date();
      const endDate = new Date();
      endDate.setFullYear(startDate.getFullYear() + 1); // 1-year duration

      // Create the subscription first
      newSubscription = await Subscription.create({
        userId: ownerId,
        businessId: null, // This will be updated later
        subscriptionPlanId: draft.subscriptionPlanId,
        stripeSubscriptionId,
        stripeCustomerId,
        payerEmail: draft.email,
        paymentStatus: "COMPLETED",
        startDate,
        endDate,
        status: "active",
      });

      console.log("New subscription created", {
        subscriptionId: newSubscription._id.toString(),
        stripeSubscriptionId,
      });

      // Check for business name conflict
      let businessName = draft.businessName;
      let existingBusiness = await Business.findOne({
        businessName: { $regex: new RegExp(`^${businessName}$`, "i") },
      });

      let counter = 1;
      while (existingBusiness) {
        businessName = `${draft.businessName}-${counter}`;
        existingBusiness = await Business.findOne({
          businessName: { $regex: new RegExp(`^${businessName}$`, "i") },
        });
        counter++;
      }

      // Create the business
      business = new Business({
        owner: ownerId,
        businessName,
        email: draft.email,
        description: draft.formData.description,
        phone: draft.formData.phoneNumber,
        listingType: draft.formData.listingType,
        address: {
          street: draft.formData.address || "",
          city: draft.formData.city || "",
          state: draft.formData.state || "",
          zipCode: draft.formData.zipCode || "",
          country: draft.formData.country || "",
        },
        taxId: draft.formData.taxId,
        businessLicenseNumber: draft.formData.businessLicenseNumber,
        isFranchise: draft.formData.isFranchise,
        franchiseLocation: draft.formData.franchiseLocation,
        socialLinks: draft.formData.socialLinks || {},
        productCategories: draft.formData.productCategories || [],
        serviceCategories: draft.formData.serviceCategories || [],
        foodCategories: draft.formData.foodCategories || [],
        logo: draft.formData.logo || "",
        coverImage: draft.formData.coverImage || "",
        minorityType: draft.minorityType, // Use minorityType from the draft
        isApproved: true,
        isActive: true, // Default to active; admin can deactivate later if needed
        subscriptionId: newSubscription._id,
        stripeSubscriptionId,
        stripeCustomerId: stripeCustomerId ? String(stripeCustomerId) : undefined,
      });

      // Save the business
      await business.save();

      console.log("Business created from draft", {
        businessId: business._id.toString(),
        ownerId: String(ownerId),
      });

      // Update subscription with business ID
      newSubscription.businessId = business._id;
      await newSubscription.save();

      // Delete the draft
      await draft.deleteOne();

      console.log(`Business ${business.businessName} created from draft`);

      // Respond with success message
      const responseMessage =
        businessName !== draft.businessName
          ? `Business name was already in use, so we have assigned you a new name: ${business.businessName}. You can change it later.`
          : `Business created successfully.`;

      sendWelcomeEmail(business.email, businessName);
      return res.status(200).json({
        message: responseMessage,
        business,
      });
    } catch (error) {
      console.error("Error creating business from draft:", error);

      // Handle rollback if necessary
      if (newSubscription) {
        newSubscription.businessId = null;
        await newSubscription.save(); // Save the updated subscription with businessId as null
      }
      if (business) {
        await business.deleteOne(); // Ensure that the business is removed if an error occurs
      }

      if (!res.headersSent) {
        return res.status(500).send("Webhook processing failed");
      }
    }
  }
  if (event.type === "account.updated") {
    const account = event.data.object;
    console.log("Processing Stripe account update", {
      accountId: account.id,
      chargesEnabled: !!account.charges_enabled,
      payoutsEnabled: !!account.payouts_enabled,
    });

    try {
      const business = await Business.findOne({
        stripeConnectAccountId: account.id,
      });
      if (business) {
        business.chargesEnabled = !!account.charges_enabled;
        business.payoutsEnabled = !!account.payouts_enabled;
        if (account.capabilities) {
          business.capabilities = {
            card_payments: account.capabilities.card_payments || "inactive",
            transfers: account.capabilities.transfers || "inactive",
          };
        }
        const completed = account.charges_enabled && account.payouts_enabled;
        business.onboardingStatus = completed
          ? "completed"
          : "requirements_due";
        if (completed && !business.onboardedAt)
          business.onboardedAt = new Date();
        await business.save();
      }
    } catch (e) {
      console.error("Failed to sync account.updated:", e);
    }
    return res.status(200).send();
  }

  return res.status(400).send(`Unhandled event type: ${event.type}`);
};
