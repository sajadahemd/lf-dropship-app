const express = require('express');
const router = express.Router();
const { getAccessToken, registerWebhook } = require('../lightfunnels');
const store = require('../store');

const LF_SCOPES = 'orders,products,funnels';

/**
 * GET /
 * LF loads this URL in an iframe with ?account_id=...&iframe=true
 * If we already have a session for this account → show dashboard.
 * Otherwise → redirect the iframe to the OAuth consent screen.
 */
router.get('/app', (req, res) => {
  const { account_id } = req.query;
  console.log('[Auth] App loaded with params:', req.query);

  const clientId = process.env.LF_CLIENT_ID;
  const appUrl = process.env.APP_URL;
  const redirectUri = `${appUrl}/auth/callback`;
  const state = account_id || Math.random().toString(36).substring(2);

  req.session.pendingAccountId = account_id || null;

  const existing = account_id ? store.getAccount(account_id) : null;
  if (existing && existing.access_token) {
    req.session.accountId = account_id;
    return res.redirect('/dashboard');
  }

  const consentUrl =
    `https://app.lightfunnels.com/admin/oauth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(LF_SCOPES)}` +
    `&state=${encodeURIComponent(state)}`;

  console.log('[Auth] Redirecting to consent:', consentUrl);
  res.redirect(consentUrl);
});

/**
 * GET /auth/install
 * Manual install entry point (same as /app but explicit).
 */
router.get('/auth/install', (req, res) => {
  res.redirect('/app');
});

/**
 * GET /auth/callback
 * Lightfunnels redirects here after the merchant approves.
 * The redirect_uri registered in LF Partners must be:
 *   {APP_URL}/auth/callback
 */
router.get('/auth/callback', async (req, res) => {
  console.log('[Auth] Callback query params:', req.query);
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).send(
      `<h2>Missing authorization code.</h2><pre>Received params: ${JSON.stringify(req.query, null, 2)}</pre>`
    );
  }

  try {
    const accessToken = await getAccessToken(code);

    const accountId = state || req.session.pendingAccountId || `acc_${Date.now()}`;

    store.saveAccount(accountId, {
      access_token: accessToken,
      installed_at: new Date().toISOString(),
    });

    const appUrl = process.env.APP_URL;
    try {
      await registerWebhook(accessToken, appUrl, accountId);
      console.log('[LF] Webhook registered for account:', accountId);
    } catch (whErr) {
      console.warn('[LF] Webhook registration warning (may already exist):', whErr.message);
    }

    req.session.accountId = accountId;
    res.redirect(`/dashboard?account_id=${encodeURIComponent(accountId)}`);
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.status(500).render('error', {
      message: 'Failed to complete OAuth flow.',
      detail: err.message,
    });
  }
});

module.exports = router;
