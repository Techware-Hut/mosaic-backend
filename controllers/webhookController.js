const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Order = require('../models/Order');
const Subscription = require('../models/Subscription'); // ← ADD THIS LINE
const {
  decrementInventoryForPaidOrder,
  releaseInventoryReservation,
} = require('../lib/inventory/orderInventory');


const toStripePayloadBuffer = (body) => {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8');
  }

  return null;
};

const cancelRetryablePaymentIntent = async (paymentIntent) => {
  if (!paymentIntent?.id) {
    return { status: paymentIntent?.status || 'unknown', paymentIntent };
  }

  if (
    paymentIntent.status === 'canceled' ||
    paymentIntent.status === 'succeeded'
  ) {
    return { status: paymentIntent.status, paymentIntent };
  }

  try {
    const canceled = await stripe.paymentIntents.cancel(paymentIntent.id, {
      cancellation_reason: 'abandoned',
    });
    return {
      status: canceled?.status || 'canceled',
      paymentIntent: canceled || paymentIntent,
    };
  } catch (error) {
    // Webhook delivery is at-least-once. A prior delivery may already have
    // cancelled the intent, or payment may have won the cancellation race.
    const current = await stripe.paymentIntents.retrieve(paymentIntent.id);
    if (current?.status === 'canceled' || current?.status === 'succeeded') {
      return { status: current.status, paymentIntent: current };
    }
    throw error;
  }
};

const reconcileSucceededOrderPayment = async (orderId, paymentIntent) => {
  const updatedOrder = await Order.findByIdAndUpdate(
    orderId,
    {
      paymentStatus: 'paid',
      status: 'ordered',
    },
    { new: true }
  );

  if (!updatedOrder) {
    console.warn(
      `Order webhook could not find order ${orderId} for payment intent ${paymentIntent.id}.`
    );
    return { reconciled: false };
  }

  console.log('Order marked paid from webhook', {
    orderId: updatedOrder._id.toString(),
    paymentStatus: updatedOrder.paymentStatus,
    status: updatedOrder.status,
  });

  try {
    const inventoryResult = await decrementInventoryForPaidOrder(updatedOrder);
    if (inventoryResult.decremented) {
      console.log(
        `Inventory decremented for paid order ${updatedOrder._id}`,
        JSON.stringify({ lines: inventoryResult.lines?.length || 0 })
      );
    } else if (inventoryResult.reason === 'already_decremented') {
      console.log(
        `Inventory already decremented for order ${updatedOrder._id}, skipping`
      );
    }
  } catch (inventoryErr) {
    console.error(
      `Failed to decrement inventory for paid order ${updatedOrder._id}:`,
      inventoryErr
    );
  }

  return { reconciled: true, order: updatedOrder };
};

const failUnpaidOrderAndReleaseReservation = async (orderId, paymentIntent) => {
  const failedOrder = await Order.findOneAndUpdate(
    {
      _id: orderId,
      paymentStatus: { $ne: 'paid' },
      inventoryDecrementedAt: null,
    },
    {
      $set: {
        paymentStatus: 'failed',
        status: 'cancelled',
      },
    },
    { new: true }
  );

  if (!failedOrder) {
    console.log('Ignoring stale failed/canceled payment event for paid/finalized order', {
      orderId,
      paymentIntentId: paymentIntent.id,
    });
    return { ignored: true };
  }

  await releaseInventoryReservation(failedOrder);
  return { ignored: false, order: failedOrder };
};

// Webhook to handle Stripe events (like successful payments)
const handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const payload = toStripePayloadBuffer(req.body);
  const endpointSecret = process.env.STRIPE_ORDER_WEBHOOK_SECRET;

  let event;

  try {
    if (!sig) {
      return res.status(400).send('Webhook Error: stripe-signature header is required');
    }

    if (!endpointSecret) {
      console.error('Stripe webhook secret is missing for /api/webhooks/stripe');
      return res.status(500).send('Stripe webhook secret is not configured');
    }

    if (!payload) {
      console.error('Stripe webhook received a non-raw body', {
        bodyType: typeof req.body,
        isBuffer: Buffer.isBuffer(req.body),
        contentType: req.headers['content-type'],
      });
      return res.status(400).send('Webhook Error: expected raw request body');
    }

    // Verify the webhook signature to ensure the event is from Stripe
    event = stripe.webhooks.constructEvent(payload, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', {
      message: err.message,
      contentType: req.headers['content-type'],
      payloadLength: payload ? payload.length : 0,
      signaturePresent: Boolean(sig),
      endpointSecretPresent: Boolean(endpointSecret),
    });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Order webhook received', {
    type: event.type,
    endpointSecretPresent: Boolean(endpointSecret),
  });

  // Handle the event based on its type
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      const orderId = paymentIntent.metadata.orderId;
      console.log('Order payment succeeded event', {
        paymentIntentId: paymentIntent.id,
        orderId,
      });

      try {
        await reconcileSucceededOrderPayment(orderId, paymentIntent);
      } catch (error) {
        console.error(`Failed to update order ${orderId} after payment success:`, error);
        return res.status(500).send('Failed to update order status');
      }
      
      res.status(200).send({ received: true });
      break;

    case 'payment_intent.payment_failed':
      const failedPaymentIntent = event.data.object;
      const failedOrderId = failedPaymentIntent.metadata.orderId;
      console.log('Order payment failed event', {
        paymentIntentId: failedPaymentIntent.id,
        orderId: failedOrderId,
      });

      // A failed PaymentIntent is normally retryable. Cancel it before
      // releasing stock so the old client secret cannot later oversell.
      try {
        const cancellation = await cancelRetryablePaymentIntent(
          failedPaymentIntent
        );
        if (cancellation.status === 'succeeded') {
          await reconcileSucceededOrderPayment(
            failedOrderId,
            cancellation.paymentIntent
          );
        } else {
          const failureResult = await failUnpaidOrderAndReleaseReservation(
            failedOrderId,
            failedPaymentIntent
          );
          if (!failureResult.ignored) {
            console.log('Order marked failed from webhook', {
              orderId: failureResult.order._id.toString(),
              paymentStatus: failureResult.order.paymentStatus,
              status: failureResult.order.status,
            });
          }
        }
      } catch (error) {
        console.error(`Failed to update order ${failedOrderId} after payment failure:`, error);
        return res.status(500).send('Failed to update order status');
      }

      res.status(200).send({ received: true });
      break;

    case 'payment_intent.canceled':
      const canceledPaymentIntent = event.data.object;
      const canceledOrderId = canceledPaymentIntent.metadata.orderId;
      try {
        await failUnpaidOrderAndReleaseReservation(
          canceledOrderId,
          canceledPaymentIntent
        );
      } catch (error) {
        console.error(`Failed to release inventory for cancelled order ${canceledOrderId}:`, error);
        return res.status(500).send('Failed to release order inventory');
      }

      res.status(200).send({ received: true });
      break;

    // Handle additional events, for example, 'payment_intent.requires_action'
    case 'payment_intent.requires_action':
      const requiresActionPaymentIntent = event.data.object;
      const actionOrderId = requiresActionPaymentIntent.metadata.orderId;

      console.log(`Payment intent requires further action for order ${actionOrderId}.`);
      res.status(200).send({ received: true });
      break;

    // Handle charge refunded event
    case 'charge.refunded':
      const chargeRefunded = event.data.object;
      const refundedOrderId = chargeRefunded.metadata.orderId;
      console.log('Order refund event', {
        chargeId: chargeRefunded.id,
        orderId: refundedOrderId,
      });

      // Update order status to refunded
      try {
        const refundedOrder = await Order.findByIdAndUpdate(refundedOrderId, { 
          paymentStatus: 'refunded', 
          status: 'refunded' 
        }, { new: true });

        if (!refundedOrder) {
          console.warn(`Order webhook could not find refunded order ${refundedOrderId} for charge ${chargeRefunded.id}.`);
        } else {
          console.log('Order marked refunded from webhook', {
            orderId: refundedOrder._id.toString(),
            paymentStatus: refundedOrder.paymentStatus,
            status: refundedOrder.status,
          });
        }
      } catch (error) {
        console.error(`Failed to update order ${refundedOrderId} after refund:`, error);
        return res.status(500).send('Failed to update order status');
      }

      res.status(200).send({ received: true });
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
      res.status(200).send({ received: true });
  }
};

// Add to webhookController.js or create subscriptionWebhook.js
const handleSubscriptionWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const payload = req.body;
  const endpointSecret = process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET;

  let event;

  try {
    if (!sig) {
      return res.status(400).send('Webhook Error: stripe-signature header is required');
    }

    if (!endpointSecret) {
      console.error('Stripe webhook secret is missing for /api/subscription/webhook');
      return res.status(500).send('Stripe webhook secret is not configured');
    }

    event = stripe.webhooks.constructEvent(payload, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('🔹 Received Stripe event type:', event.type);
  switch (event.type) {
    case 'customer.created':
      console.log(`Ignoring Stripe event type: ${event.type}`);
      break;

    case 'invoice.payment_succeeded':
      const invoice = event.data.object;
      console.log('🔹 Stripe subscription ID:', invoice.subscription);

      const subscription = await Subscription.findOne({
        stripeSubscriptionId: invoice.subscription
      });

      if (!subscription) {
        console.error('❌ Subscription not found for:', invoice.subscription);
        break;
      }

      subscription.paymentStatus = 'COMPLETED';
      subscription.status = 'active';
      await subscription.save();
      console.log(`✅ Subscription payment succeeded: ${subscription._id}`);
      break;

    case 'invoice.payment_failed':
      const failedInvoice = event.data.object;

      const failedSub = await Subscription.findOne({
        stripeSubscriptionId: failedInvoice.subscription
      });

      if (!failedSub) {
        console.error('❌ Failed subscription not found for:', failedInvoice.subscription);
        break;
      }

      failedSub.paymentStatus = 'FAILED';
      failedSub.status = 'cancelled';
      await failedSub.save();
      console.log(`❌ Subscription payment failed: ${failedSub._id}`);
      break;

    case 'charge.updated':
      const charge = event.data.object;
      
      if (charge.status === 'succeeded' && charge.metadata.subscriptionId) {
        try {
          const subscription = await Subscription.findOne({
            stripeSubscriptionId: charge.metadata.subscriptionId
          });

          if (subscription) {
            subscription.paymentStatus = 'COMPLETED';
            subscription.status = 'active';
            await subscription.save();
            console.log(`✅ Subscription charge updated - payment succeeded: ${subscription._id}`);
          } else {
            console.error('❌ Subscription not found for:', charge.metadata.subscriptionId);
          }
        } catch (error) {
          console.error('Error handling charge.updated:', error);
        }
      }
      break;

    case 'charge.succeeded':
      const chargeSucceeded = event.data.object;
      
      if (chargeSucceeded.metadata.subscriptionId) {
        try {
          const subscription = await Subscription.findOne({
            stripeSubscriptionId: chargeSucceeded.metadata.subscriptionId
          });

          if (subscription) {
            subscription.paymentStatus = 'COMPLETED';
            subscription.status = 'active';
            await subscription.save();
            console.log(`✅ Subscription charge succeeded: ${subscription._id}`);
          }
        } catch (error) {
          console.error('Error handling charge.succeeded:', error);
        }
      }
      break;

    case 'payment_intent.succeeded':
      const paymentIntentSucceeded = event.data.object;
      
      if (paymentIntentSucceeded.metadata.subscriptionId) {
        try {
          const subscription = await Subscription.findOne({
            stripeSubscriptionId: paymentIntentSucceeded.metadata.subscriptionId
          });

          if (subscription) {
            subscription.paymentStatus = 'COMPLETED';
            subscription.status = 'active';
            await subscription.save();
            console.log(`✅ Subscription payment intent succeeded: ${subscription._id}`);
          }
        } catch (error) {
          console.error('Error handling payment_intent.succeeded:', error);
        }
      }
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.status(200).send({ received: true });
};



module.exports = { handleStripeWebhook, handleSubscriptionWebhook };

