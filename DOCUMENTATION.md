# LF Dropship Bridge - Technical Documentation

## Overview

**LF Dropship Bridge** is a Node.js/Express application that connects **Lightfunnels** e-commerce stores with **Rolemall/Mojod** dropshipping API. It enables:

1. **Product Import**: Browse Rolemall catalog and import products to Lightfunnels stores
2. **Order Forwarding**: Automatically forward confirmed orders from Lightfunnels to Rolemall for fulfillment

## Architecture

```
┌─────────────────┐     OAuth2      ┌─────────────────┐
│   Lightfunnels  │ ◄──────────────► │  LF Dropship    │
│   (Store/Funnel)│    Webhooks      │     Bridge      │
└─────────────────┘                  └─────────────────┘
       │                                       │
       │         order/confirmed                 │
       │────────────────────────────────────────>│
       │                                       │
       │                                       │ REST API
       │                                       ▼
       │                              ┌─────────────────┐
       │                              │   Rolemall/     │
       │                              │     Mojod       │
       │                              │  (Dropshipper)  │
       │                              └─────────────────┘
       │
       │  GraphQL (createProduct)
       │<─────────────────────────────────────────
```

## Key Components

### 1. Authentication Flow (`src/routes/auth.js`)

**OAuth2 with Lightfunnels:**
- **Scopes**: `orders`, `products`, `funnels` (required for product creation and order webhooks)
- **App URL**: Loaded in iframe with `?account_id=...&iframe=true`
- **Flow**:
  1. LF loads app URL in iframe
  2. Check session for existing token
  3. If none → redirect iframe to LF consent screen
  4. User approves → LF redirects to `/auth/callback` with `code`
  5. Exchange `code` for `access_token`
  6. Register webhook for `order/confirmed`
  7. Redirect to dashboard with `account_id`

**Session Management:**
- Uses `express-session` with cookies
- On Railway: `SameSite=None` in production (required for iframe)
- Fallback: `account_id` passed in query/body for stateless requests

### 2. Data Store (`src/store.js`)

**File-backed JSON persistence:**
```
data/
├── accounts.json   # account_id → { access_token, installed_at }
└── orders.json     # Array of forwarded orders
```

**Why not in-memory?** Railway restarts wipe memory. File storage persists across deploys (within same deployment; use Railway Postgres for true persistence).

### 3. Rolemall API Integration (`src/rolemall.js`)

**Token Format:**
- Shop URL: `https://rolemall.com/fPO2KKkshop`
- API Token: `fPO2KKk` (part before "shop")

**Endpoints:**

| Endpoint | Description |
|----------|-------------|
| `GET /api/categories` | Fetch product categories |
| `GET /api/products?token={token}&page=1&limit=20` | Paginated product list |
| `GET /api/product-details?strung={token}gootquality{id}` | Single product details |
| `POST /api/add-simple-order-no-limit?token={token}` | Place an order |

**Product Data Structure:**
```json
{
  "_id": 4253,
  "name": "Product Name",
  "body": "Full description",
  "price": 16000,
  "category": 5,
  "img": ["https://mojod.app/images/..."]
}
```

### 4. Lightfunnels GraphQL (`src/lightfunnels.js`)

**API Endpoint:** `https://api.lightfunnels.com/graphql`

**Key Operations:**

**Create Product:**
```graphql
mutation CreateProduct($node: InputProduct!) {
  createProduct(node: $node) {
    id
    _id
    title
    price
  }
}
```

**Required Fields:**
- `title` (String)
- `price` (Float)
- `sku` (String) - used as `RM:{rolemall_item_id}`
- `product_type`: `physical_product`
- `options`: `[]` (required even if empty)
- `variants`: `[]` (required even if empty)
- `images`: `[]` (LF requires image IDs, not URLs - separate upload needed)

**Register Webhook:**
```graphql
mutation CreateWebhook($node: InputWebhook!) {
  createWebhook(node: $node) {
    id
  }
}
```

### 5. Product Import Flow

```
1. User clicks "Import to LF" in dashboard
   ↓
2. POST /api/import { product_id, account_id }
   ↓
3. Build strung: {token}gootquality{product_id}
   ↓
4. GET /api/product-details?strung=...
   ↓
5. Transform Rolemall product → LF InputProduct
   ↓
6. GraphQL createProduct mutation
   ↓
7. Product appears in LF store
```

### 6. Order Forwarding Flow

```
1. Customer places order in LF store
   ↓
2. LF sends webhook POST /webhooks/order-confirmed/:accountId
   ↓
3. Verify HMAC signature (LF_CLIENT_SECRET)
   ↓
4. Extract line items with SKUs matching RM:*
   ↓
5. For each RM product:
   - Extract item_id from SKU
   - Build strung: {token}gootquality{item_id}
   ↓
6. POST /api/add-simple-order-no-limit
   {
     cus_name, cus_num1, capetel, city, address,
     strung: "fPO2KKkgootquality1234",
     quantity: 1,
     notes: "..."
   }
   ↓
7. Store result in orders.json
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `LF_CLIENT_ID` | Lightfunnels app client ID | `WjyhOgcNU56uuMHG0Acek` |
| `LF_CLIENT_SECRET` | Lightfunnels app secret | `X_xtbKjen_9b76...` |
| `APP_URL` | Public app URL | `https://...railway.app` |
| `ROLEMALL_TOKEN` | Shop token (before "shop") | `fPO2KKk` |
| `SESSION_SECRET` | Session cookie secret | Random string |
| `NODE_ENV` | Environment | `production` |
| `PORT` | Server port | `3001` |

## Dashboard UI

**Tabs:**

1. **Products**: Browse Rolemall catalog, filter by category, search, paginate
2. **Orders**: View forwarded orders with Rolemall status
3. **Overview**: Stats and connected accounts

**Product Card Actions:**
- **Import to LF**: Creates product in Lightfunnels
- **Details**: Shows raw Rolemall product data (for debugging)

## Deployment

**Railway (Recommended):**
```bash
# Install CLI
npm install -g @railway/cli

# Login & deploy
railway login
railway init --name lf-dropship-app
railway up

# Set environment variables
railway variables set LF_CLIENT_ID=... LF_CLIENT_SECRET=... ROLEMALL_TOKEN=...

# Get public URL
railway domain
```

**Lightfunnels Partners Configuration:**
- App URL: `https://{your-domain}/`
- Redirect URI: `https://{your-domain}/auth/callback`

## Troubleshooting

### "Not authenticated" Error
- Session expired or account data lost
- Solution: Reinstall app via `/auth/install`

### 404 on Import
- Wrong GraphQL endpoint (should be `/graphql` not `/api/graphql`)
- Missing required fields in createProduct mutation

### Products Not Loading
- Check `ROLEMALL_TOKEN` format (should be part before "shop", not full slug)
- Verify Rolemall API is accessible

### Webhook Not Firing
- Check webhook registered successfully (in dashboard logs)
- Verify app has `orders` scope

## File Structure

```
src/
├── index.js           # Express setup, session, routes
├── lightfunnels.js    # LF GraphQL client, OAuth, webhooks
├── rolemall.js        # Rolemall API client, order mapping
├── store.js           # File-backed data persistence
└── routes/
    ├── auth.js        # OAuth flow, iframe handling
    ├── dashboard.js   # Dashboard rendering
    ├── products.js    # Product import API
    └── webhooks.js    # Order webhook handler

views/
├── dashboard.ejs      # Main dashboard UI
└── error.ejs          # Error page
```

## Security Considerations

1. **Session cookies**: `SameSite=None; Secure` required for iframe context
2. **HMAC verification**: Webhook payloads verified with `LF_CLIENT_SECRET`
3. **Token storage**: Access tokens stored server-side only (never exposed to client)
4. **HTTPS**: Required in production (Railway provides this automatically)

## Future Enhancements

- **Image Upload**: Upload Rolemall images to LF file storage
- **Variants**: Support products with options (size, color)
- **Inventory Sync**: Sync stock levels from Rolemall to LF
- **Order Status**: Poll Rolemall for fulfillment status updates
- **Database**: Replace file storage with PostgreSQL for multi-instance scaling
