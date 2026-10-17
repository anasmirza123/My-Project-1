const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { httpErr, nowIso, todayIsoDate, logActivity } = require('../utils/helpers');

router.get('/followups', (req, res, next) => {
  try {
    const db = getDb();
    const { status, due, search } = req.query;
    const today = todayIsoDate();
    const where = [], params = [];
    if (status) { where.push('f.status = ?'); params.push(status); }
    if (due === 'today') { where.push("f.status = 'scheduled' AND f.due_date = ?"); params.push(today); }
    else if (due === 'overdue') { where.push("f.status = 'scheduled' AND f.due_date < ?"); params.push(today); }
    else if (due === 'upcoming') { where.push("f.status = 'scheduled' AND f.due_date > ?"); params.push(today); }
    if (search) {
      where.push('(c.phone LIKE ? OR c.name LIKE ? OR o.tracking_id LIKE ?)');
      const q = `%${search}%`; params.push(q, q, q);
    }
    const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = db.prepare(`
      SELECT f.*, c.name AS customer_name, c.phone, o.tracking_id, o.final_price_minor, o.currency
      FROM followups f
      JOIN customers c ON c.id = f.customer_id
      LEFT JOIN orders o ON o.id = f.order_id
      ${wsql}
      ORDER BY f.due_date ASC, f.due_time ASC
      LIMIT 500
    `).all(...params);
    res.json({ rows, today });
  } catch (e) { next(e); }
});

router.get('/follow-ups', (req, res, next) => {
  // Alias for compatibility with older frontend
  router.handle({ ...req, url: '/followups' + (req._parsedUrl?.search || '') }, res, next);
});

router.post('/followups', (req, res, next) => {
  try {
    const db = getDb();
    const b = req.body || {};
    if (!b.customer_id) throw httpErr(400, 'customer_id required');
    if (!b.due_date) throw httpErr(400, 'due_date required');
    const validTypes = ['next_visit','new_order','payment','product','checkin','delivery','other'];
    const type = validTypes.includes(b.type) ? b.type : 'next_visit';
    const now = nowIso();
    const info = db.prepare(`
      INSERT INTO followups (customer_id, order_id, due_date, due_time, type, purpose, notes, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(b.customer_id, b.order_id || null, b.due_date, b.due_time || null, type,
      b.purpose || null, b.notes || null, 'scheduled', now, now);
    logActivity({ customerId: b.customer_id, orderId: b.order_id || null,
      actionType: 'follow_up_created', details: { due_date: b.due_date } });
    res.status(201).json(db.prepare('SELECT * FROM followups WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

router.post('/follow-ups', (req, res, next) => {
  req.url = '/followups';
  router.handle(req, res, next);
});

router.put('/followups/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const f = db.prepare('SELECT * FROM followups WHERE id = ?').get(id);
    if (!f) throw httpErr(404, 'Follow-up not found');
    const b = req.body || {};
    const updates = {};
    if (b.due_date !== undefined) updates.due_date = b.due_date;
    if (b.due_time !== undefined) updates.due_time = b.due_time;
    if (b.status !== undefined) {
      const valid = ['scheduled','completed','rescheduled','cancelled'];
      if (!valid.includes(b.status)) throw httpErr(400, 'Invalid status');
      updates.status = b.status;
      if (b.status === 'completed') updates.completed_at = nowIso();
    }
    if (b.purpose !== undefined) updates.purpose = b.purpose;
    if (b.notes !== undefined) updates.notes = b.notes;
    if (b.type !== undefined) updates.type = b.type;
    if (!Object.keys(updates).length) return res.json(f);
    updates.updated_at = nowIso();
    const setSql = Object.keys(updates).map(k => k + ' = ?').join(', ');
    db.prepare(`UPDATE followups SET ${setSql} WHERE id = ?`).run(...Object.values(updates), id);
    res.json(db.prepare('SELECT * FROM followups WHERE id = ?').get(id));
  } catch (e) { next(e); }
});

router.patch('/followups/:id', (req, res, next) => {
  req.method = 'PUT';
  router.handle(req, res, next);
});

router.patch('/follow-ups/:id', (req, res, next) => {
  req.method = 'PUT';
  req.url = '/followups/' + req.params.id;
  router.handle(req, res, next);
});

module.exports = router;
