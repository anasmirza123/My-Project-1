const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { httpErr, nowIso } = require('../utils/helpers');

router.get('/orders/:id/expenses', (req, res, next) => {
  try {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM order_expenses WHERE order_id = ? ORDER BY created_at DESC')
      .all(Number(req.params.id)));
  } catch (e) { next(e); }
});

router.post('/orders/:id/expenses', (req, res, next) => {
  try {
    const db = getDb();
    const oid = Number(req.params.id);
    if (!db.prepare('SELECT id FROM orders WHERE id = ?').get(oid)) throw httpErr(404, 'Order not found');
    const b = req.body || {};
    const amount = parseInt(b.amount_minor, 10);
    if (!amount || amount <= 0) throw httpErr(400, 'Amount must be positive');
    const info = db.prepare(`
      INSERT INTO order_expenses (order_id, category, description, amount_minor, created_at)
      VALUES (?,?,?,?,?)
    `).run(oid, b.category || 'other', b.description || null, amount, nowIso());
    res.status(201).json(db.prepare('SELECT * FROM order_expenses WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

router.delete('/orders/:id/expenses/:expId', (req, res, next) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM order_expenses WHERE id = ? AND order_id = ?')
      .run(Number(req.params.expId), Number(req.params.id));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
