const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { submitOrder } = require('../rolemall');
const store = require('../store');

/**
 * Verify the Lightfunnels HMAC signature.
 */
function verifyWebhook(req) {
  const hmacHeader = req.headers['lightfunnels-hmac'];
  if (!hmacHeader) return false;

  const secret = process.env.LF_CLIENT_SECRET;
  const body = req.rawBody || Buffer.from(JSON.stringify(req.body));
  const calculated = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');

  return calculated === hmacHeader;
}

/**
 * POST /webhooks/order-confirmed/:accountId
 * Lightfunnels fires this when an order is confirmed (all upsells done).
 */
router.post('/order-confirmed/:accountId', async (req, res) => {
  const { accountId } = req.params;

  if (!verifyWebhook(req)) {
    console.warn(`[Webhook] Invalid HMAC for account ${accountId}`);
    return res.status(403).json({ error: 'Invalid webhook signature' });
  }

  res.status(200).json({ received: true });

  const payload = req.body;
  const orderId = payload?.node?._id || payload?.node?.id || 'unknown';

  console.log(`[Webhook] order/confirmed for account=${accountId} order=${orderId}`);

  const orderRecord = {
    lf_order_id: orderId,
    lf_order_name: payload?.node?.name,
    account_id: accountId,
    customer: payload?.node?.customer?.full_name,
    total: payload?.node?.total,
    received_at: new Date().toISOString(),
    rolemall_status: 'pending',
    rolemall_response: null,
    error: null,
  };

  try {
    const result = await submitOrder(payload);
    orderRecord.rolemall_status = 'success';
    orderRecord.rolemall_response = result.response;
    orderRecord.rolemall_body = result.body;
    console.log(`[Rolemall] Order ${orderId} submitted successfully`, result.response);
  } catch (err) {
    orderRecord.rolemall_status = 'failed';
    orderRecord.error = err.message;
    console.error(`[Rolemall] Failed to submit order ${orderId}:`, err.message);
  }

  store.saveOrder(orderRecord);
});

module.exports = router;
