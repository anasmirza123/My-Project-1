const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const {
  httpErr, nowIso, logActivity, getPaymentsSummary
} = require('../utils/helpers');

router.get('/payments', (req, res, next) => {
  try {
    const db = getDb();
    const { search } = req.query;
    const where = [], params = [];
    if (search) {
      where.push('(o.tracking_id LIKE ? OR c.phone LIKE ? OR c.name LIKE ?)');
      const q = `%${search}%`; params.push(q, q, q);
    }
    const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = db.prepare(`
      SELECT p.*, o.tracking_id, c.name AS customer_name, c.phone
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      JOIN customers c ON c.id = o.customer_id
      ${wsql}
      ORDER BY p.paid_at DESC LIMIT 500
    `).all(...params);
    res.json({ rows });
  } catch (e) { next(e); }
});

router.get('/orders/:id/payments', (req, res, next) => {
  try {
    const db = getDb();
    const oid = Number(req.params.id);
    if (!db.prepare('SELECT id FROM orders WHERE id = ?').get(oid)) throw httpErr(404, 'Order not found');
    res.json({
      rows: db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY paid_at DESC').all(oid),
      summary: getPaymentsSummary(oid)
    });
  } catch (e) { next(e); }
});

router.post('/orders/:id/payments', (req, res, next) => {
  try {
    const db = getDb();
    const oid = Number(req.params.id);
    if (!db.prepare('SELECT id FROM orders WHERE id = ?').get(oid)) throw httpErr(404, 'Order not found');
    const b = req.body || {};
    const amount = parseInt(b.amount_minor, 10);
    if (!amount || amount <= 0) throw httpErr(400, 'Amount must be positive');
    const method = b.method || 'cash';
    if (!['cash','bank','mobile','card','other'].includes(method)) throw httpErr(400, 'Invalid method');
    const paidAt = b.paid_at || nowIso();
    const info = db.prepare(`
      INSERT INTO payments (order_id, amount_minor, method, reference, notes, paid_at)
      VALUES (?,?,?,?,?,?)
    `).run(oid, amount, method, b.reference || null, b.notes || null, paidAt);
    const order = db.prepare('SELECT customer_id FROM orders WHERE id = ?').get(oid);
    logActivity({ customerId: order.customer_id, orderId: oid, actionType: 'payment_received', details: { amount_minor: amount } });
    res.status(201).json({
      payment: db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid),
      summary: getPaymentsSummary(oid)
    });
  } catch (e) { next(e); }
});

router.post('/payments', (req, res, next) => {
  try {
    const db = getDb();
    const b = req.body || {};
    if (!b.order_id) throw httpErr(400, 'order_id required');
    const oid = Number(b.order_id);
    if (!db.prepare('SELECT id FROM orders WHERE id = ?').get(oid)) throw httpErr(404, 'Order not found');
    const amount = parseInt(b.amount_minor, 10);
    if (!amount || amount <= 0) throw httpErr(400, 'Amount must be positive');
    const method = b.method || 'cash';
    if (!['cash','bank','mobile','card','other'].includes(method)) throw httpErr(400, 'Invalid method');
    const paidAt = b.paid_at || nowIso();
    const info = db.prepare(`
      INSERT INTO payments (order_id, amount_minor, method, reference, notes, paid_at)
      VALUES (?,?,?,?,?,?)
    `).run(oid, amount, method, b.reference || null, b.notes || null, paidAt);
    const order = db.prepare('SELECT customer_id FROM orders WHERE id = ?').get(oid);
    logActivity({ customerId: order.customer_id, orderId: oid, actionType: 'payment_received', details: { amount_minor: amount } });
    res.status(201).json({
      payment: db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid),
      summary: getPaymentsSummary(oid)
    });
  } catch (e) { next(e); }
});

router.post('/payments/:id/reverse', (req, res, next) => {
  try {
    const db = getDb();
    const pid = Number(req.params.id);
    const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(pid);
    if (!p) throw httpErr(404, 'Payment not found');
    if (p.status === 'reversed') throw httpErr(400, 'Already reversed');
    db.prepare("UPDATE payments SET status='reversed' WHERE id=?").run(pid);
    const order = db.prepare('SELECT customer_id FROM orders WHERE id = ?').get(p.order_id);
    logActivity({ customerId: order.customer_id, orderId: p.order_id,
      actionType: 'payment_reversed', details: { amount_minor: p.amount_minor } });
    res.json({ ok: true, summary: getPaymentsSummary(p.order_id) });
  } catch (e) { next(e); }
});

// Refunds
router.get('/orders/:id/refunds', (req, res, next) => {
  try {
    const db = getDb();
    const oid = Number(req.params.id);
    res.json(db.prepare('SELECT * FROM refunds WHERE order_id = ? ORDER BY refunded_at DESC').all(oid));
  } catch (e) { next(e); }
});

router.post('/orders/:id/refunds', (req, res, next) => {
  try {
    const db = getDb();
    const oid = Number(req.params.id);
    if (!db.prepare('SELECT id FROM orders WHERE id = ?').get(oid)) throw httpErr(404, 'Order not found');
    const b = req.body || {};
    const amount = parseInt(b.amount_minor, 10);
    if (!amount || amount <= 0) throw httpErr(400, 'Amount must be positive');
    const info = db.prepare(`
      INSERT INTO refunds (order_id, payment_id, amount_minor, method, reason)
      VALUES (?,?,?,?,?)
    `).run(oid, b.payment_id || null, amount, b.method || 'cash', b.reason || null);
    const order = db.prepare('SELECT customer_id FROM orders WHERE id = ?').get(oid);
    logActivity({ customerId: order.customer_id, orderId: oid, actionType: 'refund_created', details: { amount_minor: amount } });
    res.status(201).json({
      refund: db.prepare('SELECT * FROM refunds WHERE id = ?').get(info.lastInsertRowid),
      summary: getPaymentsSummary(oid)
    });
  } catch (e) { next(e); }
});

module.exports = router;
