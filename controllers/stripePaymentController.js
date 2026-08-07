const Stripe = require("stripe");
const Order = require("../models/Order");
const { sendOrderPaidEmails } = require("../utils/OrderMail");
const {
  appendOrderLifecycleEmailLog,
  buildOrderLifecycleEmailFingerprint,
} = require("../utils/orderLifecycleEmailDelivery");
const {
  sanitizePaymentIntentForClient,
  sanitizeOrderForPaymentPoll,
} = require("../utils/paymentIntentResponse");
const {
  decrementInventoryForPaidOrder,
  releaseInventoryReservation,
} = require("../lib/inventory/orderInventory");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function cancelRetryablePaymentIntent(paymentIntent) {
  if (!paymentIntent?.id || paymentIntent.status === "canceled") return;

  try {
    await stripe.paymentIntents.cancel(paymentIntent.id, {
      cancellation_reason: "abandoned",
    });
  } catch (error) {
    const current = await stripe.paymentIntents.retrieve(paymentIntent.id);
    if (current?.status !== "canceled") throw error;
  }
}

/**
 * Webhook fallback for local Test Mode / missed Stripe CLI forwards:
 * when Stripe confirms the PI succeeded, mark orders paid/ordered and
 * decrement inventory once (idempotent via inventoryDecrementedAt).
 */
async function reconcileSucceededPaymentIntentOrders(orders, paymentIntent) {
  if (!paymentIntent || paymentIntent.status !== "succeeded") {
    return { reconciled: false };
  }

  for (const order of orders) {
    const needsPaid = order.paymentStatus !== "paid";
    const needsOrdered = order.status === "created";

    if (needsPaid || needsOrdered) {
      const update = {};
      if (needsPaid) update.paymentStatus = "paid";
      if (needsOrdered) {
        update.status = "ordered";
        update.$push = { statusHistory: { status: "ordered" } };
      }

      await Order.findByIdAndUpdate(order._id, update);
      if (needsPaid) order.paymentStatus = "paid";
      if (needsOrdered) order.status = "ordered";

      console.log("retrieveIntent reconciled paid order (webhook fallback)", {
        orderId: String(order._id),
        paymentStatus: order.paymentStatus,
        status: order.status,
        paymentIntentId: paymentIntent.id,
      });
    }

    try {
      const inventoryResult = await decrementInventoryForPaidOrder(order);
      if (inventoryResult.decremented) {
        console.log(
          `Inventory decremented via retrieveIntent for order ${order._id}`,
          JSON.stringify({ lines: inventoryResult.lines?.length || 0 })
        );
      } else if (inventoryResult.reason === "already_decremented") {
        console.log(
          `Inventory already decremented for order ${order._id} (retrieveIntent idempotent skip)`
        );
      }
    } catch (inventoryErr) {
      console.error(
        `Failed to decrement inventory via retrieveIntent for order ${order._id}:`,
        inventoryErr
      );
    }
  }

  return { reconciled: true };
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
      if (event.type === "payment_intent.payment_failed") {
        await cancelRetryablePaymentIntent(paymentIntent);
      }

      const orders = await Order.find({ paymentId: paymentIntent.id }).populate([]);
      for (const order of orders) {
        await releaseInventoryReservation(order);
        order.paymentStatus = "failed";
        order.status = "cancelled";
        await order.save();
      }

      return res.json({ received: true });
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;
      const paymentId = pi.id;

      const orders = await Order.find({ paymentId }).populate([
        // customer
        { path: "userId", select: "name email" },
        // vendor account
        { path: "vendorId", select: "name email" },
        // business (for name/slug/email/owner)
        { path: "businessId", select: "businessName slug email owner", populate: { path: "owner", select: "name email" } },
        // item product names (fallback safe)
        { path: "items.productId", select: "name title" },
      ]);
      if (!orders.length) {
        console.warn(`⚠️ No orders found for paymentId ${paymentId}`);
        return res.status(200).json({ received: true });
      }

      // Get latest charge + related IDs
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

      for (const order of orders) {
        const shouldSendPaidEmail = !order.paidConfirmationEmailSentAt;

        // status updates
        order.paymentStatus = "paid";
        if (order.status === "created") {
          order.status = "ordered";
          order.statusHistory.push({ status: "ordered" });
        }

        // store IDs on each item (matches your current schema)

        order.items.forEach((it) => {
          it.chargeId = chargeId || it.chargeId;
          it.transferId = transferId || it.transferId;
          it.applicationFeeId = applicationFeeId || it.applicationFeeId;
        });
        order.markModified("items");

        // If you later add top-level fields on the order, you can also set:
        // order.chargeId = chargeId;
        // order.transferId = transferId;
        // order.applicationFeeId = applicationFeeId;

        await order.save();

        try {
          const inventoryResult = await decrementInventoryForPaidOrder(order);
          if (inventoryResult.decremented) {
            console.log(
              `Inventory decremented for paid order ${order._id}`,
              JSON.stringify({ lines: inventoryResult.lines?.length || 0 })
            );
          } else if (inventoryResult.reason === "already_decremented") {
            console.log(
              `Inventory already decremented for order ${order._id}, skipping`
            );
          }
        } catch (inventoryErr) {
          console.error(
            `Failed to decrement inventory for paid order ${order._id}:`,
            inventoryErr
          );
          // Payment is already succeeded — do not fail the webhook; ops can reconcile.
        }

        if (!shouldSendPaidEmail) {
          console.log(
            `Paid confirmation email already sent for order ${order._id}, skipping duplicate send`
          );
          continue;
        }

        // ✅ recipients (deduped)
        const customerEmails = [...new Set([order.userId?.email].filter(Boolean))];

        const vendorEmails = [
          order.vendorId?.email,
          order.businessId?.email,
          order.businessId?.owner?.email,
        ].filter(Boolean);
        const uniqueVendorEmails = [...new Set(vendorEmails)];
        const paidEmailFingerprint = buildOrderLifecycleEmailFingerprint(
          order,
          "order_paid_confirmation"
        );

        // ✅ send emails (best-effort)
        try {
          await sendOrderPaidEmails({
            order,                           // hydrated order (with userId, vendorId, businessId, items.productId)
            currency: pi.currency,           // e.g. 'usd' or 'inr'
            customerEmails,
            vendorEmails: uniqueVendorEmails,
          });
          order.paidConfirmationEmailSentAt = new Date();
          await order.save();
          await appendOrderLifecycleEmailLog(order, {
            event: "order_paid_confirmation",
            fingerprint: paidEmailFingerprint,
            deliveryStatus: "sent",
            recipientRole: "customer",
          });
        } catch (mailErr) {
          await appendOrderLifecycleEmailLog(order, {
            event: "order_paid_confirmation",
            fingerprint: paidEmailFingerprint,
            deliveryStatus: "failed",
            recipientRole: "customer",
            error: mailErr?.message || "Unknown email error",
          });
          console.error("✉️ Failed to send order-paid emails:", mailErr?.message || mailErr);
        }
      }

      console.log(`✅ Stripe payment confirmed and emails sent for ${orders.length} order(s)`);
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
      .select('userId groupOrderId status paymentStatus totalAmount currency items')
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

    await reconcileSucceededPaymentIntentOrders(orders, paymentIntent);
    if (paymentIntent.status === "canceled") {
      for (const order of orders) {
        await releaseInventoryReservation(order);
        await Order.findByIdAndUpdate(order._id, {
          paymentStatus: "failed",
          status: "cancelled",
        });
        order.paymentStatus = "failed";
        order.status = "cancelled";
      }
    }

    return res.status(200).json({
      success: true,
      paymentIntent: sanitizePaymentIntentForClient(paymentIntent),
      orders: orders.map(sanitizeOrderForPaymentPoll),
    });
  } catch (error) {
    console.error("❌ Failed to retrieve payment intent:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment information",
    });
  }
};
