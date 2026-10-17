const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { httpErr, nowIso } = require('../utils/helpers');

router.get('/settings', (req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings ORDER BY key').all();
    const obj = {};
    rows.forEach(r => { obj[r.key] = r.value; });
    res.json(obj);
  } catch (e) { next(e); }
});

router.put('/settings/:key', (req, res, next) => {
  try {
    const db = getDb();
    const key = req.params.key;
    const value = req.body?.value;
    if (value === undefined) throw httpErr(400, 'value required');
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, String(value), nowIso());
    res.json({ key, value: String(value) });
  } catch (e) { next(e); }
});

router.get('/search', (req, res, next) => {
  try {
    const db = getDb();
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ customers: [], orders: [] });
    const like = '%' + q + '%';
    const customers = db.prepare(`
      SELECT id, phone, whatsapp, name, created_at FROM customers
      WHERE phone LIKE ? OR phone_normalized LIKE ? OR whatsapp LIKE ? OR name LIKE ?
      ORDER BY created_at DESC LIMIT 20
    `).all(like, like, like, like);
    const orders = db.prepare(`
      SELECT o.id, o.tracking_id, o.status, o.final_price_minor, o.currency,
             o.created_at, o.completed_at, c.phone, c.name AS customer_name
      FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE o.tracking_id LIKE ? OR CAST(o.id AS TEXT) LIKE ? OR c.phone LIKE ? OR c.name LIKE ?
      ORDER BY o.created_at DESC LIMIT 20
    `).all(like, like, like, like);
    res.json({ customers, orders });
  } catch (e) { next(e); }
});

router.get('/activity', (req, res, next) => {
  try {
    const db = getDb();
    const { customer_id, order_id } = req.query;
    const where = [], params = [];
    if (customer_id) { where.push('a.customer_id = ?'); params.push(customer_id); }
    if (order_id) { where.push('a.order_id = ?'); params.push(order_id); }
    const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = db.prepare(`
      SELECT a.*, c.name AS customer_name, c.phone, o.tracking_id
      FROM activity_logs a
      LEFT JOIN customers c ON c.id = a.customer_id
      LEFT JOIN orders o ON o.id = a.order_id
      ${wsql}
      ORDER BY a.created_at DESC LIMIT 500
    `).all(...params);
    res.json({ rows });
  } catch (e) { next(e); }
});

router.get('/purchase-history', (req, res, next) => {
  try {
    const db = getDb();
    const { search, customer_id } = req.query;
    const where = ["o.status = 'completed'"], params = [];
    if (customer_id) { where.push('o.customer_id = ?'); params.push(Number(customer_id)); }
    if (search) {
      where.push('(o.tracking_id LIKE ? OR c.phone LIKE ? OR c.name LIKE ?)');
      const q = `%${search}%`; params.push(q, q, q);
    }
    const wsql = 'WHERE ' + where.join(' AND ');
    const rows = db.prepare(`
      SELECT o.id, o.tracking_id, o.completed_at, o.final_price_minor, o.currency,
        o.customer_id, c.name AS customer_name, c.phone,
        (SELECT GROUP_CONCAT(oi.product_name, ', ') FROM order_items oi WHERE oi.order_id = o.id) AS product_summary,
        (SELECT COALESCE(SUM(p.amount_minor),0) FROM payments p WHERE p.order_id = o.id AND p.status = 'confirmed') AS paid_minor,
        (SELECT COALESCE(SUM(r.amount_minor),0) FROM refunds r WHERE r.order_id = o.id) AS refunded_minor,
        (SELECT COALESCE(SUM(oi.cost_minor * oi.quantity),0) FROM order_items oi WHERE oi.order_id = o.id AND oi.cost_minor IS NOT NULL) AS cost_known_minor,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.cost_minor IS NULL) AS missing_cost_count
      FROM orders o JOIN customers c ON c.id = o.customer_id
      ${wsql}
      ORDER BY o.completed_at DESC
      LIMIT 500
    `).all(...params);
    rows.forEach(r => {
      r.balance_minor = r.final_price_minor - r.paid_minor + r.refunded_minor;
      r.cost_minor = r.missing_cost_count > 0 ? null : r.cost_known_minor;
      r.profit_minor = r.cost_minor != null ? (r.final_price_minor - r.cost_minor) : null;
    });
    res.json({ rows });
  } catch (e) { next(e); }
});

module.exports = router;
