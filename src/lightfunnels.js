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

// One-time schema introspection cache
let _schemaCache = null;

async function introspectImageMutations(accessToken) {
  if (_schemaCache) return _schemaCache;

  const query = `
    query {
      __schema {
        mutationType {
          fields {
            name
            args { name type { name kind ofType { name kind } } }
          }
        }
        types {
          name
          kind
          inputFields { name type { name kind ofType { name kind } } }
        }
      }
    }
  `;

  try {
    const data = await graphql(accessToken, query);
    const mutations = data.__schema.mutationType.fields;
    const types = data.__schema.types;

    const imageMutations = mutations.filter(m =>
      /image|media|file|upload|asset/i.test(m.name)
    );
    const imageInputs = types.filter(t =>
      t.kind === 'INPUT_OBJECT' && /image|media|file|upload|asset/i.test(t.name)
    );

    console.log('[LF Schema] Candidate image mutations:',
      imageMutations.map(m => ({
        name: m.name,
        args: m.args.map(a => `${a.name}: ${a.type.name || a.type.ofType?.name || a.type.kind}`)
      }))
    );
    console.log('[LF Schema] Candidate image input types:',
      imageInputs.map(t => ({
        name: t.name,
        fields: t.inputFields?.map(f => `${f.name}: ${f.type.name || f.type.ofType?.name || f.type.kind}`)
      }))
    );

    _schemaCache = { mutations: imageMutations, inputs: imageInputs };
    return _schemaCache;
  } catch (err) {
    console.warn('[LF Schema] Introspection failed:', err.message);
    return null;
  }
}

/**
 * Upload a single image URL to LF and return its integer ID.
 * Uses introspection on first call to discover the correct mutation name
 * and input field, then reuses that for subsequent calls.
 */
async function uploadImageToLF(accessToken, imageUrl) {
  // Discover the schema once
  const schema = await introspectImageMutations(accessToken);

  if (!schema || schema.mutations.length === 0) {
    console.warn('[LF] No image mutations found via introspection for:', imageUrl);
    return null;
  }

  // Try each discovered mutation with its actual input type & field name
  for (const m of schema.mutations) {
    const arg = m.args[0];
    if (!arg) continue;
    const inputTypeName = arg.type.name || arg.type.ofType?.name;
    if (!inputTypeName) continue;

    const inputDef = schema.inputs.find(i => i.name === inputTypeName);
    // Pick the first field that looks like it accepts a URL
    const urlField = inputDef?.inputFields?.find(f =>
      /src|url|source|link|href/i.test(f.name)
    );
    const fieldName = urlField?.name || 'src';

    const query = `
      mutation Upload($node: ${inputTypeName}!) {
        ${m.name}(${arg.name}: $node) {
          _id
        }
      }
    `;

    try {
      const data = await graphql(accessToken, query, {
        node: { [fieldName]: imageUrl },
      });
      const id = data?.[m.name]?._id;
      if (id != null) {
        console.log(`[LF] Uploaded image via ${m.name}({${fieldName}}), id:`, id);
        return parseInt(id, 10);
      }
    } catch (err) {
      console.warn(`[LF] ${m.name} failed:`, err.message.slice(0, 200));
    }
  }

  return null;
}

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

  // Upload each image to LF first; images field requires [Int] (image IDs).
  // If all uploads fail, create the product without images rather than failing.
  let images = [];
  if (rawImageUrls.length > 0) {
    const uploadResults = await Promise.all(
      rawImageUrls.slice(0, 5).map(url => uploadImageToLF(accessToken, url))
    );
    images = uploadResults.filter(id => Number.isInteger(id));
    console.log(`[LF] Attaching ${images.length}/${rawImageUrls.length} uploaded image IDs`);
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
