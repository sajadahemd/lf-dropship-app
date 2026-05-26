const express = require('express');
const router = express.Router();
const { fetchCategories, fetchProducts, fetchProductDetails } = require('../rolemall');
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

    res.json({ ok: true, data: result?.data?.createProduct || result });
  } catch (err) {
    console.error('[Import] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
