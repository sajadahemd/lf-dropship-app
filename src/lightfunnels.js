const axios = require('axios');

const LF_API_URL = 'https://api.lightfunnels.com/graphql';
const LF_TOKEN_URL = 'https://api.lightfunnels.com/api/access_token';

/**
 * Exchange the OAuth2 authorization code for an access token.
 */
async function getAccessToken(code) {
  const clientId = process.env.LF_CLIENT_ID;
  const clientSecret = process.env.LF_CLIENT_SECRET;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  console.log('[LF] Exchanging code for token...');
  console.log('[LF] Token URL:', LF_TOKEN_URL);
  console.log('[LF] Code:', code);

  try {
    const response = await axios.post(
      LF_TOKEN_URL,
      new URLSearchParams({ code }).toString(),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    console.log('[LF] Token response:', response.data);
    return response.data.access_token;
  } catch (err) {
    const detail = err.response
      ? `Status ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    console.error('[LF] Token exchange failed:', detail);
    throw new Error(`Token exchange failed — ${detail}`);
  }
}

/**
 * Run a GraphQL query/mutation against the Lightfunnels API.
 */
async function graphql(accessToken, query, variables = {}) {
  const response = await axios.post(
    LF_API_URL,
    { query, variables },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  if (response.data.errors) {
    throw new Error(JSON.stringify(response.data.errors));
  }
  return response.data.data;
}

/**
 * Register the order/confirmed webhook for this account.
 */
async function registerWebhook(accessToken, appUrl, accountId) {
  const mutation = `
    mutation CreateWebhookMutation($node: WebhookInput!) {
      createWebhook(node: $node) {
        type
        url
      }
    }
  `;
  const variables = {
    node: {
      type: 'order/confirmed',
      url: `${appUrl}/webhooks/order-confirmed/${accountId}`,
      settings: {},
    },
  };
  return graphql(accessToken, mutation, variables);
}

/**
 * Fetch basic account info (to get the account ID).
 */
async function getAccountInfo(accessToken) {
  const query = `
    query {
      node {
        id
        name
      }
    }
  `;
  return graphql(accessToken, query);
}

/**
 * Import a Rolemall product into a Lightfunnels store.
 * rmProduct shape: { name, description, price, images: [{url}], id, strung }
 */
async function importProduct(accessToken, rmProduct) {
  const productId = rmProduct.item_id || rmProduct._id || rmProduct.id;

  const mutation = `
    mutation CreateProduct($node: InputProduct!) {
      createProduct(node: $node) {
        id
        _id
        title
        price
      }
    }
  `;

  const price = parseFloat(rmProduct.price) || 0;
  const comparePrice = parseFloat(rmProduct.compare_price || rmProduct.original_price || 0) || null;

  const node = {
    title: rmProduct.name || rmProduct.title || 'Imported Product',
    description: rmProduct.description || '',
    price,
    sku: `RM:${productId}`,
    product_type: 'physical_product',
    options: [],
    variants: [],
    images: [],
  };

  if (comparePrice && comparePrice > price) {
    node.compare_at_price = comparePrice;
  }

  return graphql(accessToken, mutation, { node });
}

module.exports = { getAccessToken, graphql, registerWebhook, getAccountInfo, importProduct };
