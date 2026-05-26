/**
 * Simple in-memory store.
 * In production, replace with a database (e.g. SQLite, PostgreSQL).
 */

const accounts = new Map();
const orders = [];

module.exports = {
  saveAccount(accountId, data) {
    accounts.set(accountId, { ...accounts.get(accountId), ...data });
  },

  getAccount(accountId) {
    return accounts.get(accountId) || null;
  },

  getAllAccounts() {
    return Array.from(accounts.entries()).map(([id, data]) => ({ id, ...data }));
  },

  saveOrder(order) {
    orders.unshift(order);
    if (orders.length > 500) orders.pop();
  },

  getOrders(limit = 50) {
    return orders.slice(0, limit);
  },

  getStats() {
    const total = orders.length;
    const forwarded = orders.filter(o => o.rolemall_status === 'success').length;
    const failed = orders.filter(o => o.rolemall_status === 'failed').length;
    return { total, forwarded, failed, accounts: accounts.size };
  }
};
