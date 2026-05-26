const axios = require('axios');

const LF_API_URL = 'https://api.lightfunnels.com/graphql';
const LF_TOKEN_URL = 'https://api.lightfunnels.com/api/access_token';

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
 * Image-upload status:
 *   LF's GraphQL exposes InputProduct.images as [ID!] — pre-existing image IDs.
 *   Their developer docs (https://developer.lightfunnels.com/) do not publish
 *   a public mutation or REST endpoint to upload an image and obtain that ID.
 *   Schema introspection is blocked on api.lightfunnels.com.
 *
 *   Until LF support confirms the correct upload endpoint, we skip image
 *   uploads entirely so product creation succeeds. Images need to be uploaded
 *   manually inside LF admin, or via a custom endpoint we obtain from LF.
 */

/**
 * Import a Rolemall product into a Lightfunnels store.
 *
 * Image strategy:
 *   1. Try to upload each Rolemall image URL to LF media storage (createMedia).
 *   2. If that succeeds, attach by media ID.
 *   3. If createMedia is not supported or errors, fall back to passing {src} URLs
 *      directly in the images array (LF accepts this on some plan tiers).
 *   4. Either way, the product is created — images may be absent in the worst case.
 */
async function importProduct(accessToken, rmProduct) {
  const productId = rmProduct.item_id || rmProduct._id || rmProduct.id;

  const price = parseFloat(rmProduct.price) || 0;
  const comparePrice = parseFloat(rmProduct.compare_price || rmProduct.original_price || 0) || null;

  const rawImageUrls = Array.isArray(rmProduct.img)
    ? rmProduct.img
    : rmProduct.img
    ? [rmProduct.img]
    : [];

  // LF's InputProduct.images expects [ID!] of pre-uploaded images.
  // No public upload mechanism is documented — see note above. Skip for now.
  const images = [];
  if (rawImageUrls.length > 0) {
    console.log(
      `[LF] Skipping ${rawImageUrls.length} Rolemall image URL(s) — ` +
      `LF requires pre-existing image IDs and exposes no public upload endpoint. ` +
      `Pending LF support confirmation.`
    );
  }

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

  const node = {
    title: rmProduct.name || rmProduct.title || 'Imported Product',
    description: rmProduct.body || rmProduct.description || '',
    price,
    sku: `RM:${productId}`,
    product_type: 'physical_product',
    options: [],
    variants: [],
    images,
  };

  if (comparePrice && comparePrice > price) {
    node.compare_at_price = comparePrice;
  }

  return graphql(accessToken, mutation, { node });
}

module.exports = { getAccessToken, graphql, registerWebhook, getAccountInfo, importProduct };
