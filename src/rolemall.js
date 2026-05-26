const axios = require('axios');

const ROLEMALL_BASE = 'https://rolemall.com/api';
const ROLEMALL_ORDER_URL = `${ROLEMALL_BASE}/add-simple-order-no-limit`;

function getToken() {
  const token = process.env.ROLEMALL_TOKEN;
  if (!token) throw new Error('ROLEMALL_TOKEN is not set in environment variables');
  return token;
}

async function fetchCategories() {
  const response = await axios.get(`${ROLEMALL_BASE}/categories`);
  return response.data;
}

async function fetchProducts({ page = 1, limit = 20, category = null, search = null } = {}) {
  const params = { page, limit };
  if (category) params.category = category;
  if (search) params.search = search;
  params.token = getToken();
  const response = await axios.get(`${ROLEMALL_BASE}/products`, { params });
  return response.data;
}

function buildStrung(product_id) {
  return `${getToken()}gootquality${product_id}`;
}

async function fetchProductDetails({ strung = null, product_id = null } = {}) {
  const params = {};
  if (strung) {
    params.strung = strung;
  } else if (product_id) {
    params.strung = buildStrung(product_id);
  } else {
    throw new Error('product_id or strung required');
  }
  const response = await axios.get(`${ROLEMALL_BASE}/product-details`, { params });
  return response.data;
}

/**
 * Fetch status for a single Rolemall order.
 * Rolemall exposes order status at GET /api/order-status?token=&order_id=
 * Returns null if the endpoint is unavailable or the order is not found.
 */
async function fetchOrderStatus(rolemallOrderId) {
  const token = getToken();
  try {
    const response = await axios.get(`${ROLEMALL_BASE}/order-status`, {
      params: { token, order_id: rolemallOrderId },
    });
    return response.data;
  } catch (err) {
    const detail = err.response
      ? `${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    console.warn('[Rolemall] fetchOrderStatus failed for', rolemallOrderId, '—', detail);
    return null;
  }
}

/**
 * Fetch the merchant's recent orders from Rolemall.
 * Used to bulk-sync fulfillment statuses when a direct order-status endpoint
 * is not available.
 */
async function fetchMyOrders({ page = 1, limit = 100 } = {}) {
  const token = getToken();
  try {
    const response = await axios.get(`${ROLEMALL_BASE}/my-orders`, {
      params: { token, page, limit },
    });
    return response.data;
  } catch (err) {
    const detail = err.response
      ? `${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    console.warn('[Rolemall] fetchMyOrders failed —', detail);
    return null;
  }
}

/**
 * Extract the Rolemall order ID from the submit response.
 * Handles the common response shapes Rolemall returns.
 */
function extractRolemallOrderId(responseData) {
  if (!responseData) return null;
  return (
    responseData.order_id ||
    responseData.id ||
    responseData.data?.order_id ||
    responseData.data?.id ||
    null
  );
}

function mapOrderToRolemall(lfOrder) {
  const order = lfOrder.node;
  const shipping = order.shipping_address || order.billing_address || {};
  const customer = order.customer || {};

  const phone =
    shipping.phone ||
    order.billing_address?.phone ||
    order.phone ||
    '';

  const firstName = shipping.first_name || customer.full_name?.split(' ')[0] || '';
  const lastName = shipping.last_name || customer.full_name?.split(' ').slice(1).join(' ') || '';
  const fullName = `${firstName} ${lastName}`.trim() || customer.full_name || 'Unknown';

  const city = shipping.city || '';
  const address = [shipping.line1, shipping.line2].filter(Boolean).join(', ') || shipping.line1 || '';

  const items = order.items || [];
  const totalCount = items.reduce((sum, item) => sum + (item.quantity || 1), 0);

  let itemId = 0;
  if (items.length > 0) {
    const sku = items[0].sku || '';
    const match = sku.match(/RM:(\d+)/i);
    if (match) {
      itemId = parseInt(match[1], 10);
    }
  }

  const allPrice = Math.round(order.total || order.subtotal || 0);

  return {
    cus_name: fullName,
    cus_num1: phone,
    capetel: phone,
    city,
    address,
    item_id: itemId,
    all_price: allPrice,
    count: totalCount,
    note: `LF Order #${order.name} | ID: ${order._id}`,
    ip: order.client_details?.ip || '',
  };
}

async function submitOrder(lfOrderPayload) {
  const token = process.env.ROLEMALL_TOKEN;
  if (!token) {
    throw new Error('ROLEMALL_TOKEN is not set in environment variables');
  }

  const body = mapOrderToRolemall(lfOrderPayload);

  const response = await axios.post(
    ROLEMALL_ORDER_URL,
    body,
    {
      params: { token },
      headers: { 'Content-Type': 'application/json' },
    }
  );

  const rolemallOrderId = extractRolemallOrderId(response.data);

  return { body, response: response.data, rolemallOrderId };
}

module.exports = {
  submitOrder,
  mapOrderToRolemall,
  fetchCategories,
  fetchProducts,
  fetchProductDetails,
  fetchOrderStatus,
  fetchMyOrders,
  buildStrung,
};
