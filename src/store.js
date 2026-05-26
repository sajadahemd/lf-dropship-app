const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const IMPORTED_FILE = path.join(DATA_DIR, 'imported_products.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAccounts() {
  try {
    ensureDir();
    if (!fs.existsSync(ACCOUNTS_FILE)) return {};
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  } catch { return {}; }
}

function writeAccounts(data) {
  ensureDir();
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2));
}

function readOrders() {
  try {
    ensureDir();
    if (!fs.existsSync(ORDERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
  } catch { return []; }
}

function writeOrders(data) {
  ensureDir();
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(data, null, 2));
}

function readImported() {
  try {
    ensureDir();
    if (!fs.existsSync(IMPORTED_FILE)) return {};
    return JSON.parse(fs.readFileSync(IMPORTED_FILE, 'utf8'));
  } catch { return {}; }
}

function writeImported(data) {
  ensureDir();
  fs.writeFileSync(IMPORTED_FILE, JSON.stringify(data, null, 2));
}

module.exports = {
  saveAccount(accountId, data) {
    const accounts = readAccounts();
    accounts[accountId] = { ...(accounts[accountId] || {}), ...data };
    writeAccounts(accounts);
  },

  getAccount(accountId) {
    const accounts = readAccounts();
    return accounts[accountId] || null;
  },

  getAllAccounts() {
    const accounts = readAccounts();
    return Object.entries(accounts).map(([id, data]) => ({ id, ...data }));
  },

  saveOrder(order) {
    const orders = readOrders();
    orders.unshift(order);
    if (orders.length > 500) orders.pop();
    writeOrders(orders);
  },

  getOrders(limit = 50) {
    return readOrders().slice(0, limit);
  },

  updateOrder(lfOrderId, updates) {
    const orders = readOrders();
    const idx = orders.findIndex(o => o.lf_order_id === lfOrderId);
    if (idx !== -1) {
      orders[idx] = { ...orders[idx], ...updates };
      writeOrders(orders);
      return true;
    }
    return false;
  },

  getStats() {
    const orders = readOrders();
    const accounts = readAccounts();
    const total = orders.length;
    const forwarded = orders.filter(o => o.rolemall_status === 'success').length;
    const failed = orders.filter(o => o.rolemall_status === 'failed').length;
    return { total, forwarded, failed, accounts: Object.keys(accounts).length };
  },

  saveImportedProduct(rolemallId, lfProductId, lfProductTitle) {
    const imported = readImported();
    imported[String(rolemallId)] = {
      lfId: lfProductId,
      title: lfProductTitle,
      importedAt: new Date().toISOString(),
    };
    writeImported(imported);
  },

  getImportedProducts() {
    return readImported();
  },

  isImported(rolemallId) {
    const imported = readImported();
    return !!imported[String(rolemallId)];
  },
};
