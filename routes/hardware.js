const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { httpErr, nowIso } = require('../utils/helpers');

router.get('/customers/:id/hardware', (req, res, next) => {
  try {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM hardware_requirements WHERE customer_id = ? ORDER BY created_at DESC')
      .all(Number(req.params.id)));
  } catch (e) { next(e); }
});

router.post('/customers/:id/hardware', (req, res, next) => {
  try {
    const db = getDb();
    const cid = Number(req.params.id);
    if (!db.prepare('SELECT id FROM customers WHERE id = ?').get(cid)) throw httpErr(404, 'Customer not found');
    const b = req.body || {};
    const now = nowIso();
    const info = db.prepare(`
      INSERT INTO hardware_requirements (customer_id, product_name, brand, model, specifications,
        quantity, budget_minor, currency, notes, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(cid, b.product_name || null, b.brand || null, b.model || null, b.specifications || null,
      b.quantity ? parseInt(b.quantity, 10) : null,
      b.budget_minor != null ? parseInt(b.budget_minor, 10) : null,
      b.currency || 'PKR', b.notes || null, now, now);
    res.status(201).json(db.prepare('SELECT * FROM hardware_requirements WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

router.get('/hardware', (req, res, next) => {
  try {
    const db = getDb();
    res.json(db.prepare(`
      SELECT h.*, c.phone, c.name AS customer_name
      FROM hardware_requirements h JOIN customers c ON c.id = h.customer_id
      ORDER BY h.created_at DESC
    `).all());
  } catch (e) { next(e); }
});

module.exports = router;
