const express = require('express');
const router = express.Router();
const store = require('../store');

router.get('/', (req, res) => {
  const accountIdFromQuery = req.query.account_id;

  if (accountIdFromQuery) {
    req.session.accountId = accountIdFromQuery;
  }

  const accountId = req.session.accountId;
  const account = accountId ? store.getAccount(accountId) : null;

  if (!account || !account.access_token) {
    const redirectBack = encodeURIComponent(`${process.env.APP_URL}/dashboard`);
    return res.redirect(`/app${accountIdFromQuery ? `?account_id=${accountIdFromQuery}` : ''}`);
  }

  const orders = store.getOrders(50);
  const stats = store.getStats();
  const accounts = store.getAllAccounts();

  res.render('dashboard', {
    orders,
    stats,
    accounts,
    appUrl: process.env.APP_URL,
    installUrl: `${process.env.APP_URL}/auth/install`,
  });
});

module.exports = router;
