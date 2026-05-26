# LF Dropship Bridge

A Lightfunnels app that automatically forwards confirmed orders to the [Rolemall](https://rolemall.com) dropshipping API.

## How it works

1. Merchant installs the app via the **Install URL**
2. They approve the OAuth2 consent screen on Lightfunnels
3. The app exchanges the code for an access token and registers the `order/confirmed` webhook
4. When a customer completes a purchase, Lightfunnels fires the webhook
5. The app maps the order data and submits it to Rolemall's `/api/add-simple-order-no-limit` endpoint
6. The result is shown in the dashboard

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `LF_CLIENT_ID` | Your Lightfunnels app Client ID |
| `LF_CLIENT_SECRET` | Your Lightfunnels app Client Secret |
| `APP_URL` | Your public app URL (e.g. `https://yourapp.ngrok.io`) |
| `ROLEMALL_TOKEN` | Your Rolemall API token |
| `SESSION_SECRET` | A long random string for session signing |

### 3. Rolemall product ID mapping

The app reads the Rolemall product ID from the **SKU** field of your Lightfunnels product variants.

Set the SKU in the format: `RM:12345` (where `12345` is the Rolemall `item_id`).

If no matching SKU is found, `item_id` defaults to `0`.

### 4. Run locally (dev)

For local development, expose your server with [ngrok](https://ngrok.com/):

```bash
npx ngrok http 3000
```

Update `APP_URL` in `.env` with the ngrok HTTPS URL, then:

```bash
npm run dev
```

### 5. Install the app

Open:
```
http://localhost:3000/auth/install
```

This redirects to the Lightfunnels consent screen. After approval, the webhook is automatically registered.

### 6. Configure redirect URI in Lightfunnels Partners

In your app settings on https://partners.lightfunnels.com, add this redirect URI:
```
{APP_URL}/auth/callback
```

## Dashboard

Visit `http://localhost:3000/dashboard` to see:
- Connected accounts
- Order forwarding stats (total / forwarded / failed)
- Recent orders with Rolemall response details

## Rolemall API field mapping

| Rolemall field | Source |
|----------------|--------|
| `cus_name` | Customer full name |
| `cus_num1` | Shipping/billing phone |
| `capetel` | Same phone (secondary) |
| `city` | Shipping city |
| `address` | Shipping address line1 |
| `item_id` | Parsed from SKU `RM:<id>` |
| `all_price` | Order total (integer) |
| `count` | Sum of all item quantities |
| `note` | LF order name + ID |
| `ip` | Customer IP |

## Production deployment

Set `APP_URL` to your production domain and configure the redirect URI accordingly in the Lightfunnels Partners dashboard.
