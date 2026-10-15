const Stripe = require("stripe");
const Order = require("../models/Order");
const {
  sanitizePaymentIntentForClient,
  sanitizeOrderForPaymentPoll,
} = require("../utils/paymentIntentResponse");
const {
  decrementInventoryForPaidOrder,
  releaseInventoryReservation,
} = require("../lib/inventory/orderInventory");
const {
  publicPaidOrderEmailDelivery,
  sendOrderPaidConfirmationIfNeeded,
} = require("../utils/sendOrderPaidConfirmation");
const {
  buildSucceededPaymentReconciliationFilter,
  buildSucceededPaymentReconciliationPipeline,
  canReconcileSucceededPayment,
} = require("../utils/orderPaidEmailEligibility");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const toPublicEmailDelivery = (result) =>
  typeof publicPaidOrderEmailDelivery === "function"
    ? publicPaidOrderEmailDelivery(result)
    : {
        emailSent: Boolean(result?.emailSent),
        emailSkipped: Boolean(result?.emailSkipped),
        emailFailed: Boolean(result?.emailFailed),
        ...(result?.emailWarning ? { emailWarning: result.emailWarning } : {}),
      };

async function cancelRetryablePaymentIntent(paymentIntent) {
  if (!paymentIntent?.id) {
    return { status: paymentIntent?.status || "unknown", paymentIntent };
  }

  if (
    paymentIntent.status === "canceled" ||
    paymentIntent.status === "succeeded"
  ) {
    return { status: paymentIntent.status, paymentIntent };
  }

  try {
    const canceled = await stripe.paymentIntents.cancel(paymentIntent.id, {
      cancellation_reason: "abandoned",
    });
    return {
      status: canceled?.status || "canceled",
      paymentIntent: canceled || paymentIntent,
    };
  } catch (error) {
    const current = await stripe.paymentIntents.retrieve(paymentIntent.id);
    if (current?.status === "canceled" || current?.status === "succeeded") {
      return { status: current.status, paymentIntent: current };
    }
    throw error;
  }
}

/**
 * When Stripe authoritatively confirms the PaymentIntent succeeded, reconcile
 * the related orders and decrement inventory once (idempotent via
 * inventoryDecrementedAt). Shared by webhook delivery and polling fallback.
 */
async function reconcileSucceededPaymentIntentOrders(
  orders,
  paymentIntent,
  paymentEvidence = {},
  { reloadOnMiss = false } = {}
) {
  if (!paymentIntent || paymentIntent.status !== "succeeded") {
    return { reconciled: false, emailResults: [], orders };
  }

  const emailResults = [];
  const reconciledOrders = [];
  for (const order of orders) {
    if (!canReconcileSucceededPayment(order)) {
      console.log("Skipping stale succeeded-payment reconciliation for closed order", {
        orderId: String(order._id),
        paymentStatus: order.paymentStatus,
        status: order.status,
      });
      const authoritativeOrder = reloadOnMiss
        ? await Order.findById(order._id)
        : null;
      reconciledOrders.push(authoritativeOrder || order);
      continue;
    }

    const reconciledOrder = await Order.findOneAndUpdate(
      buildSucceededPaymentReconciliationFilter(order._id, paymentIntent.id),
      buildSucceededPaymentReconciliationPipeline(paymentEvidence),
      { new: true }
    );
    if (!reconciledOrder) {
      console.log("Skipping stale succeeded-payment reconciliation after state changed", {
        orderId: String(order._id),
      });
      const authoritativeOrder = reloadOnMiss
        ? await Order.findById(order._id)
        : null;
      reconciledOrders.push(authoritativeOrder || order);
      continue;
    }

    reconciledOrders.push(reconciledOrder);
    console.log("Reconciled paid order from succeeded PaymentIntent", {
      orderId: String(reconciledOrder._id),
      paymentStatus: reconciledOrder.paymentStatus,
      status: reconciledOrder.status,
      paymentIntentId: paymentIntent.id,
    });

    try {
      const inventoryResult = await decrementInventoryForPaidOrder(reconciledOrder);
      if (inventoryResult.decremented) {
        console.log(
          `Inventory decremented for paid order ${reconciledOrder._id}`,
          JSON.stringify({ lines: inventoryResult.lines?.length || 0 })
        );
      } else if (inventoryResult.reason === "already_decremented") {
        console.log(
          `Inventory already decremented for order ${reconciledOrder._id}, skipping`
        );
      }
    } catch (inventoryErr) {
      console.error(
        `Failed to decrement inventory for paid order ${reconciledOrder._id}:`,
        inventoryErr
      );
    }

    // Local/test Mode often never receives Stripe webhook delivery, so polling
    // and webhook reconciliation share the same persisted email orchestration.
    try {
      const emailResult = await sendOrderPaidConfirmationIfNeeded(reconciledOrder, {
        currency: paymentIntent.currency,
      });
      emailResults.push(emailResult);
      if (emailResult.emailWarning) {
        console.error("Paid-order email delivery incomplete", {
          orderId: String(reconciledOrder._id),
        });
      }
    } catch {
      emailResults.push({
        emailSent: false,
        emailSkipped: false,
        emailFailed: true,
        emailWarning: "paid_order_email_delivery_incomplete",
      });
      console.error("Unexpected paid-order email orchestration failure", {
        orderId: String(reconciledOrder._id),
      });
    }
  }

  return { reconciled: true, emailResults, orders: reconciledOrders };
}

async function failUnpaidOrderAndReleaseReservation(order, paymentIntent) {
  const failedOrder = await Order.findOneAndUpdate(
    {
      _id: order._id,
      paymentStatus: { $ne: "paid" },
      inventoryDecrementedAt: null,
    },
    {
      $set: {
        paymentStatus: "failed",
        status: "cancelled",
      },
    },
    { new: true }
  );

  if (!failedOrder) {
    console.log("Ignoring stale failed/canceled payment event for paid/finalized order", {
      orderId: String(order._id),
      paymentIntentId: paymentIntent.id,
    });
    return { ignored: true };
  }

  await releaseInventoryReservation(failedOrder);
  return { ignored: false, order: failedOrder };
}

exports.stripePaymentWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Stripe webhook signature invalid:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (
      event.type === "payment_intent.payment_failed" ||
      event.type === "payment_intent.canceled"
    ) {
      const paymentIntent = event.data.object;
      let cancellation = null;
      if (event.type === "payment_intent.payment_failed") {
        cancellation = await cancelRetryablePaymentIntent(paymentIntent);
      }

      const orders = await Order.find({ paymentId: paymentIntent.id }).populate([]);
      if (cancellation?.status === "succeeded") {
        await reconcileSucceededPaymentIntentOrders(
          orders,
          cancellation.paymentIntent
        );
        return res.json({ received: true });
      }

      for (const order of orders) {
        await failUnpaidOrderAndReleaseReservation(order, paymentIntent);
      }

      return res.json({ received: true });
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;
      const paymentId = pi.id;

      const orders = await Order.find({ paymentId }).populate([
        { path: "userId", select: "name email" },
        { path: "vendorId", select: "name email" },
        {
          path: "businessId",
          select: "businessName slug email owner",
          populate: { path: "owner", select: "name email" },
        },
        { path: "items.productId", select: "name title" },
      ]);
      if (!orders.length) {
        console.warn(`⚠️ No orders found for paymentId ${paymentId}`);
        return res.status(200).json({ received: true });
      }

      const chargeId = pi.latest_charge;
      if (!chargeId) {
        console.warn(`⚠️ No latest_charge on PI ${paymentId}`);
      }
      let transferId = null;
      let applicationFeeId = null;

      if (chargeId) {
        const charge = await stripe.charges.retrieve(chargeId);
        transferId = charge.transfer || null;
        applicationFeeId =
          (typeof charge.application_fee === "string"
            ? charge.application_fee
            : charge.application_fee?.id) || null;
      }

      await reconcileSucceededPaymentIntentOrders(orders, pi, {
        chargeId,
        transferId,
        applicationFeeId,
      });

      console.log(
        `✅ Stripe payment confirmed and email delivery processed for ${orders.length} order(s)`
      );
      return res.json({ received: true });
    }

    res.json({ received: true });
  } catch (err) {
    console.error("⚠️ Webhook handler error:", err);
    return res.status(500).send("Webhook handler failed");
  }
};

// ✅ Retrieve payment intent details (sanitized for frontend)
// Also reconciles paid status + inventory when webhooks were not delivered
// (common in local Stripe Test Mode without `stripe listen`).
exports.retrieveIntent = async (req, res) => {
  const { id } = req.params;
  const customerId = req.user?.id || req.user?._id;

  try {
    const orders = await Order.find({ paymentId: id })
      .select("userId groupOrderId status paymentStatus totalAmount currency items")
      .populate({
        path: "items.productId",
        select: "title coverImage",
      });

    if (!orders || orders.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No orders found for this payment" });
    }

    const ownsAllOrders = orders.every(
      (order) => order.userId?.toString() === String(customerId)
    );

    if (!ownsAllOrders) {
      return res.status(403).json({
        success: false,
        message: "Not allowed to view this payment.",
      });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(id);

    const reconciliation = await reconcileSucceededPaymentIntentOrders(
      orders,
      paymentIntent,
      {},
      { reloadOnMiss: true }
    );
    const authoritativeOrders = new Map(
      (reconciliation.orders || []).map((order) => [String(order._id), order])
    );
    for (const order of orders) {
      const authoritative = authoritativeOrders.get(String(order._id));
      if (!authoritative) continue;
      order.paymentStatus = authoritative.paymentStatus;
      order.status = authoritative.status;
    }
    if (paymentIntent.status === "canceled") {
      for (const order of orders) {
        const failureResult = await failUnpaidOrderAndReleaseReservation(
          order,
          paymentIntent
        );
        if (!failureResult.ignored) {
          order.paymentStatus = "failed";
          order.status = "cancelled";
        }
      }
    }

    const deliveryResults = reconciliation.emailResults || [];
    const emailDelivery = toPublicEmailDelivery({
      emailSent: deliveryResults.some((result) => result?.emailSent),
      emailSkipped: deliveryResults.some((result) => result?.emailSkipped),
      emailFailed: deliveryResults.some((result) => result?.emailFailed),
      emailWarning: deliveryResults.some((result) => result?.emailWarning)
        ? "paid_order_email_delivery_incomplete"
        : undefined,
    });

    return res.status(200).json({
      success: true,
      paymentIntent: sanitizePaymentIntentForClient(paymentIntent),
      orders: orders.map(sanitizeOrderForPaymentPoll),
      ...(paymentIntent.status === "succeeded" && deliveryResults.length
        ? { emailDelivery }
        : {}),
    });
  } catch (error) {
    console.error("❌ Failed to retrieve payment intent:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment information",
    });
  }
};
