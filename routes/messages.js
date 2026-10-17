const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { httpErr, nowIso } = require('../utils/helpers');

router.get('/customers/:id/messages', (req, res, next) => {
  try {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM customer_messages WHERE customer_id = ? ORDER BY created_at DESC')
      .all(Number(req.params.id)));
  } catch (e) { next(e); }
});

router.post('/customers/:id/messages', (req, res, next) => {
  try {
    const db = getDb();
    const cid = Number(req.params.id);
    if (!db.prepare('SELECT id FROM customers WHERE id = ?').get(cid)) throw httpErr(404, 'Customer not found');
    const b = req.body || {};
    if (!b.message_text) throw httpErr(400, 'Message text required');
    const info = db.prepare(`
      INSERT INTO customer_messages (customer_id, order_id, source, message_text, message_at, notes, created_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(cid, b.order_id || null, b.source || 'whatsapp', b.message_text,
      b.message_at || null, b.notes || null, nowIso());
    res.status(201).json(db.prepare('SELECT * FROM customer_messages WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

module.exports = router;
