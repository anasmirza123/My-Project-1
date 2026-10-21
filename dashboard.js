const { getDb } = require('../db');
const { likeEscape } = require('./util');
const { listOrders } = require('./orders');

function stats() {
  const db = getDb();
  const counts = db.prepare('SELECT * FROM v_dashboard_counts').get();
  const recentCustomers = db.prepare(`SELECT id, name, phone, whatsapp, created_at,
      (SELECT group_concat(g.name, ',') FROM customer_categories cc JOIN categories g ON g.id = cc.category_id WHERE cc.customer_id = c.id) AS categories
    FROM customers c WHERE status <> 'archived' ORDER BY created_at DESC, id DESC LIMIT 8`).all();
  const recentOrders = listOrders({ status: 'draft,confirmed', pageSize: 6 }).items;
  const recentFinalized = listOrders({ status: 'completed', pageSize: 6 }).items;
  return { counts, recentCustomers, recentOrders, recentFinalized };
}

function search(q) {
  const db = getDb();
  const term = String(q || '').trim();
  if (term.length < 2) return { customers: [], orders: [] };
  const like = likeEscape(term); const digits = term.replace(/\D/g, '').replace(/^0/, '');
  const cArgs = [like, like, like]; let cExtra = '';
  if (digits.length >= 3) { cExtra = `OR c.phone_normalized LIKE ? OR c.whatsapp_normalized LIKE ?`; cArgs.push('%' + digits + '%', '%' + digits + '%'); }
  const customers = db.prepare(`SELECT c.id, c.name, c.phone, c.whatsapp FROM customers c
    WHERE c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.whatsapp LIKE ? ESCAPE '\\' ${cExtra}
    ORDER BY c.created_at DESC LIMIT 8`).all(...cArgs).map((r) => ({ type: 'customer', ...r }));
  const oArgs = [like, like, like]; let oExtra = '';
  if (/^\d+$/.test(term)) { oExtra = 'OR o.id = ?'; oArgs.push(Number(term)); }
  oArgs.push(like);
  const orders = db.prepare(`SELECT o.id, o.tracking_id, o.status, o.customer_id, COALESCE(o.customer_name_snapshot, c.name) AS customer_name,
      (SELECT group_concat(i.product_name, ', ') FROM order_items i WHERE i.order_id = o.id) AS product_summary
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.tracking_id LIKE ? ESCAPE '\\' OR o.order_notes LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.product_name LIKE ? ESCAPE '\\') ${oExtra}
      OR o.product_requirements LIKE ? ESCAPE '\\'
    ORDER BY o.id DESC LIMIT 8`).all(...oArgs).map((r) => ({ type: 'order', ...r }));
  return { customers, orders };
}
module.exports = { stats, search };
