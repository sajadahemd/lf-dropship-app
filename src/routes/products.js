const express = require('express');
const router = express.Router();
const { fetchCategories, fetchProducts, fetchProductDetails, fetchOrderStatus, fetchMyOrders } = require('../rolemall');
const { importProduct } = require('../lightfunnels');
const store = require('../store');

function getAccountToken(req) {
  const accountId = req.session.accountId || req.body.account_id || req.query.account_id;
  if (!accountId) return null;
  const account = store.getAccount(accountId);
  return account ? account.access_token : null;
}

router.get('/categories', async (req, res) => {
  try {
    const data = await fetchCategories();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/products', async (req, res) => {
  try {
    const { page = 1, limit = 20, category, search } = req.query;
    const data = await fetchProducts({
      page: parseInt(page),
      limit: parseInt(limit),
      category: category || null,
      search: search || null,
    });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/product-details', async (req, res) => {
  try {
    const { product_id, strung } = req.query;
    const data = await fetchProductDetails({ product_id, strung });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/imported-products', (req, res) => {
  res.json({ ok: true, data: store.getImportedProducts() });
});

router.post('/import', async (req, res) => {
  const accessToken = getAccountToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: 'Not authenticated. Please reinstall the app.' });
  }

  try {
    const { product_id, strung } = req.body;
    if (!product_id && !strung) {
      return res.status(400).json({ ok: false, error: 'product_id or strung required' });
    }

    const detailsResponse = await fetchProductDetails({ product_id, strung });
    const rmProduct = detailsResponse.data || detailsResponse;
    const result = await importProduct(accessToken, rmProduct);

    const lfProduct = result?.data?.createProduct || result;
    const lfProductId = lfProduct?._id || lfProduct?.id;
    const rolemallId = product_id || (rmProduct.item_id || rmProduct._id || rmProduct.id);

    if (lfProductId && rolemallId) {
      store.saveImportedProduct(String(rolemallId), String(lfProductId), lfProduct?.title || '');
    }

    res.json({ ok: true, data: lfProduct });
  } catch (err) {
    console.error('[Import] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/sync-orders
 * Polls Rolemall for fulfillment status on all successfully submitted orders
 * that have a rolemall_order_id stored.
 *
 * Strategy:
 *   1. Try GET /api/order-status per order (direct lookup).
 *   2. Fall back to GET /api/my-orders and match by order ID if direct lookup
 *      returns nothing (some Rolemall tiers don't expose per-order status).
 */
router.post('/sync-orders', async (req, res) => {
  try {
    const allOrders = store.getOrders(500);
    const syncable = allOrders.filter(
      o => o.rolemall_status === 'success' && o.rolemall_order_id
    );

    if (syncable.length === 0) {
      return res.json({ ok: true, checked: 0, updated: 0, message: 'No orders with Rolemall IDs to sync.' });
    }

    // Try bulk fetch first (fewer API calls)
    let bulkOrders = null;
    const bulkData = await fetchMyOrders({ limit: 200 });
    if (bulkData) {
      const list = bulkData.data || bulkData.orders || bulkData;
      if (Array.isArray(list)) {
        bulkOrders = {};
        list.forEach(o => {
          const id = o.order_id || o.id || o._id;
          if (id) bulkOrders[String(id)] = o;
        });
      }
    }

    let updated = 0;
    for (const order of syncable) {
      const rmId = String(order.rolemall_order_id);
      let statusData = bulkOrders?.[rmId] || null;

      if (!statusData) {
        statusData = await fetchOrderStatus(order.rolemall_order_id);
      }

      if (!statusData) continue;

      const fulfillmentStatus =
        statusData.status ||
        statusData.fulfillment_status ||
        statusData.state ||
        statusData.order_status ||
        null;

      if (fulfillmentStatus) {
        store.updateOrder(order.lf_order_id, {
          fulfillment_status: String(fulfillmentStatus),
          fulfillment_synced_at: new Date().toISOString(),
        });
        updated++;
      }
    }

    res.json({ ok: true, checked: syncable.length, updated });
  } catch (err) {
    console.error('[Sync] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
