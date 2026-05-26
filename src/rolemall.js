const axios = require('axios');

const ROLEMALL_API_URL = 'https://rolemall.com/api/add-simple-order-no-limit';
const ROLEMALL_BASE = 'https://rolemall.com/api';

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

async function fetchProductDetails({ strung = null, product_id = null } = {}) {
  const params = {};
  if (strung) params.strung = strung;
  if (product_id) params.product_id = product_id;
  const response = await axios.get(`${ROLEMALL_BASE}/product-details`, { params });
  return response.data;
}

/**
 * Map a Lightfunnels order/confirmed webhook payload to a Rolemall order request.
 *
 * Field mapping:
 *   cus_name   -> customer full name
 *   cus_num1   -> customer phone (billing or shipping)
 *   capetel    -> same phone (secondary contact field)
 *   city       -> shipping city
 *   address    -> shipping address line1
 *   item_id    -> extracted from variant SKU or product numeric ID (see note below)
 *   all_price  -> order total (integer)
 *   count      -> quantity of first item (multi-item: sum of quantities)
 *   note       -> order name + LF order ID
 *   ip         -> client IP
 *
 * NOTE: Rolemall's item_id must match the product ID in your Rolemall catalog.
 * Store it in the product's SKU field on Lightfunnels, e.g. "RM:12345".
 * The app will parse "RM:<id>" from the SKU; if absent it falls back to 0.
 */
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

/**
 * Submit an order to Rolemall.
 */
async function submitOrder(lfOrderPayload) {
  const token = process.env.ROLEMALL_TOKEN;
  if (!token) {
    throw new Error('ROLEMALL_TOKEN is not set in environment variables');
  }

  const body = mapOrderToRolemall(lfOrderPayload);

  const response = await axios.post(
    ROLEMALL_API_URL,
    body,
    {
      params: { token },
      headers: { 'Content-Type': 'application/json' },
    }
  );

  return { body, response: response.data };
}

module.exports = { submitOrder, mapOrderToRolemall, fetchCategories, fetchProducts, fetchProductDetails };
